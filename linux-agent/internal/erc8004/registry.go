// Package erc8004 registers a ledger agent on the Shard0 ERC-8004 identity registry.
//
// The registries are the plain contracts from erc-8004/erc-8004-contracts at
// commit b9e466c. Gas is native SCDO. This package does not log private keys.
package erc8004

import (
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

const (
	// ChainID is SCDO Shard0.
	ChainID int64 = 5680
	// IdentityRegistry is the plain ERC-8004 identity registry.
	IdentityRegistry = "0xe1A6728e467ed9Fa2F2d0d7eE425a95c9d941F4d"
	// ReputationRegistry is the plain ERC-8004 reputation registry.
	ReputationRegistry = "0xeB49023E929bb71A4818924DffC46Eb8B46546c4"
	// ValidationRegistry is the plain ERC-8004 validation registry.
	ValidationRegistry = "0x5bc80C209263Fe4F0455c76eC41F663E62D814dF"
	// MainAgentID is SCDO's own agent on the identity registry.
	MainAgentID = 2
	// MetadataKey is the on-chain key whose value is the ledger address.
	MetadataKey = "scdoLedgerAgent"
	recordFile  = "erc8004.json"
)

// Result is a registration that already exists or one this call sent.
type Result struct {
	AgentID  string
	Tx       string
	URI      string
	Address  string
	Registry string
	Already  bool
}

// Options registers one ledger identity.
type Options struct {
	Key *ledger.Key
	Dir string
	// RPCs overrides the public Shard0 endpoints. Client is set by tests.
	RPCs   []string
	Client *rpc
}

type metaEntry struct {
	MetadataKey   string
	MetadataValue []byte
}

type saved struct {
	V        int    `json:"v"`
	AgentID  string `json:"agentId"`
	Tx       string `json:"tx,omitempty"`
	URI      string `json:"uri"`
	Registry string `json:"registry"`
}

// AgentURI is the ledger registration file for an agent address.
func AgentURI(address string) string {
	return "https://scdo.com.au/agent-ledger/api/agents/" + address + "/registration.json"
}

// Register sends register(agentURI, metadata) when this address has no identity yet.
// A second call finds the existing agent id and does not send a transaction.
func Register(ctx context.Context, opt Options) (Result, error) {
	if opt.Key == nil {
		return Result{}, fmt.Errorf("agent key is missing")
	}
	address := opt.Key.Address()
	uri := AgentURI(address)
	out := Result{URI: uri, Address: address, Registry: IdentityRegistry}
	node, err := opt.client().dial(ctx)
	if err != nil {
		return out, err
	}
	if id, tx, ok := localMatch(ctx, node, opt.Dir, address); ok {
		out.AgentID, out.Tx, out.Already = id, tx, true
		return out, nil
	}
	found, err := node.registrations(ctx, address)
	if err != nil {
		return out, err
	}
	if len(found) > 0 {
		pick := choose(ctx, node, address, found)
		out.AgentID = pick.id.String()
		out.Tx = pick.tx
		out.Already = true
		_ = saveRecord(opt.Dir, out)
		return out, nil
	}
	bal, err := node.balance(ctx, address)
	if err != nil {
		return out, err
	}
	if bal.Sign() == 0 {
		return out, fmt.Errorf("Shard0 account %s has no SCDO for gas", address)
	}
	data, err := packRegister(uri, address)
	if err != nil {
		return out, err
	}
	raw, err := sign(ctx, opt.Key, node, data)
	if err != nil {
		return out, err
	}
	hash, err := node.send(ctx, raw)
	if err != nil {
		return out, err
	}
	out.Tx = hash
	rec, err := node.wait(ctx, hash)
	if err != nil {
		return out, err
	}
	if !rec.ok {
		return out, fmt.Errorf("registration transaction reverted")
	}
	id, ok := rec.agentID()
	if !ok {
		return out, fmt.Errorf("registration receipt has no agent id")
	}
	out.AgentID = id.String()
	if err := saveRecord(opt.Dir, out); err != nil {
		return out, err
	}
	return out, nil
}

func (o Options) client() *rpc {
	if o.Client != nil {
		return o.Client
	}
	urls := o.RPCs
	if len(urls) == 0 {
		urls = DefaultRPCs()
	}
	return &rpc{URLs: urls}
}

func packRegister(uri, address string) ([]byte, error) {
	return registryABI.Pack("register", uri, []metaEntry{{
		MetadataKey:   MetadataKey,
		MetadataValue: []byte(address),
	}})
}

func sign(ctx context.Context, key *ledger.Key, node *rpc, data []byte) ([]byte, error) {
	nonce, err := node.nonce(ctx, key.Address())
	if err != nil {
		return nil, err
	}
	gasPrice, err := node.gasPrice(ctx)
	if err != nil {
		return nil, err
	}
	gas, err := node.estimate(ctx, key.Address(), data)
	if err != nil {
		return nil, err
	}
	to := common.HexToAddress(IdentityRegistry)
	tx := types.NewTx(&types.LegacyTx{
		Nonce:    nonce,
		GasPrice: gasPrice,
		Gas:      gas,
		To:       &to,
		Value:    big.NewInt(0),
		Data:     data,
	})
	scalar := key.Scalar()
	priv, err := crypto.ToECDSA(scalar)
	ledger.Wipe(scalar)
	if err != nil {
		return nil, err
	}
	defer wipePriv(priv)
	signed, err := types.SignTx(tx, types.NewEIP155Signer(big.NewInt(ChainID)), priv)
	if err != nil {
		return nil, err
	}
	return signed.MarshalBinary()
}

func wipePriv(priv *ecdsa.PrivateKey) {
	if priv != nil && priv.D != nil {
		priv.D.SetInt64(0)
	}
}

type foundReg struct {
	id *big.Int
	tx string
}

func choose(ctx context.Context, node *rpc, address string, found []foundReg) foundReg {
	var best *foundReg
	for i := range found {
		if best == nil || found[i].id.Cmp(best.id) < 0 {
			best = &found[i]
		}
		meta, err := node.metadata(ctx, found[i].id)
		if err == nil && metaMatches(meta, address) {
			return found[i]
		}
	}
	return *best
}

func metaMatches(meta []byte, address string) bool {
	text := strings.TrimSpace(string(meta))
	if strings.EqualFold(text, address) {
		return true
	}
	if len(meta) == 20 || len(meta) == 32 {
		return strings.EqualFold(common.BytesToAddress(meta).Hex(), address)
	}
	return false
}

func localMatch(ctx context.Context, node *rpc, dir, address string) (string, string, bool) {
	rec, ok := loadRecord(dir)
	if !ok || rec.AgentID == "" {
		return "", "", false
	}
	id, ok := new(big.Int).SetString(rec.AgentID, 10)
	if !ok {
		return "", "", false
	}
	owner, err := node.ownerOf(ctx, id)
	if err != nil || !strings.EqualFold(owner, address) {
		return "", "", false
	}
	return rec.AgentID, rec.Tx, true
}

func loadRecord(dir string) (saved, bool) {
	if dir == "" {
		return saved{}, false
	}
	b, err := os.ReadFile(filepath.Join(dir, recordFile))
	if err != nil {
		return saved{}, false
	}
	var rec saved
	if json.Unmarshal(b, &rec) != nil {
		return saved{}, false
	}
	return rec, true
}

func saveRecord(dir string, res Result) error {
	if dir == "" {
		return nil
	}
	rec := saved{V: 1, AgentID: res.AgentID, Tx: res.Tx, URI: res.URI, Registry: res.Registry}
	b, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, recordFile), append(b, '\n'), 0o600)
}

func (r mined) agentID() (*big.Int, bool) {
	for _, lg := range r.logs {
		if len(lg.Topics) < 3 {
			continue
		}
		if !strings.EqualFold(lg.Topics[0], registeredTopic.Hex()) {
			continue
		}
		id := new(big.Int).SetBytes(common.FromHex(lg.Topics[1]))
		if id.Sign() > 0 {
			return id, true
		}
	}
	return nil, false
}

// receiptWait is how long a registration waits to be mined.
const receiptWait = 45 * time.Second
