package wallet

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/keys"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
	"golang.org/x/crypto/sha3"
)

// CreateOptions binds a bot wallet on Base Sepolia.
type CreateOptions struct {
	Root       string
	Name       string
	BotID      string
	MaxAtomic  string
	Daily      string
	Payees     []string
	Platform   string
	Operator   string
	Passphrase []byte
	LedgerURLs []string
	Now        func() time.Time
}

// Created is the public result of a bind.
type Created struct {
	Agent   string
	Wallet  string
	BotID   string
	Ledger  string
	Network string
}

// Create writes keys/wallet.key when it is missing and POSTs /bind.
// An existing wallet key is never replaced. Mainnet is not bound.
func Create(ctx context.Context, opt CreateOptions) (Created, error) {
	if strings.TrimSpace(opt.BotID) == "" {
		return Created{}, fmt.Errorf("bot id is required")
	}
	lay, err := agent.Open(opt.Root, opt.Name)
	if err != nil {
		return Created{}, err
	}
	agentKey, err := lay.OpenKey(opt.Passphrase)
	if err != nil {
		return Created{}, err
	}
	defer wipeKey(agentKey)
	if err := agent.EnsureWallet(lay.Dir, opt.Passphrase); err != nil {
		return Created{}, err
	}
	walletKey, err := (keys.Store{Dir: filepath.Join(lay.Dir, "keys")}).Open("wallet", opt.Passphrase)
	if err != nil {
		return Created{}, err
	}
	defer wipeKey(walletKey)

	doc, err := loadDoc(lay.Dir)
	if err != nil {
		return Created{}, err
	}
	doc.BotID = opt.BotID
	doc.Network = NetworkSepolia
	doc.Address = walletKey.Address()
	if strings.TrimSpace(opt.MaxAtomic) != "" {
		doc.MaxAtomic = strings.TrimSpace(opt.MaxAtomic)
	}
	if strings.TrimSpace(opt.Daily) != "" {
		doc.DailyAtomic = strings.TrimSpace(opt.Daily)
	}
	if len(opt.Payees) > 0 {
		doc.Payees = opt.Payees
	}
	platform := opt.Platform
	if platform == "" {
		platform = "other"
	}
	if platform != "other" && platform != "grok" {
		return Created{}, fmt.Errorf("platform")
	}

	nonce, err := proofNonce()
	if err != nil {
		return Created{}, err
	}
	wallets := map[string]any{
		NetworkSepolia: walletKey.Address(),
		"eip155:5680":  agentKey.Address(),
	}
	body := map[string]any{
		"botId":    opt.BotID,
		"platform": platform,
		"custody":  "self",
		"wallets":  wallets,
	}
	if !sameAddr(walletKey.Address(), agentKey.Address()) {
		bot := opt.BotID
		_, sig, err := ledger.WalletProof(walletKey, agentKey.Address(), &bot, NetworkSepolia, nonce)
		if err != nil {
			return Created{}, err
		}
		body["walletProofs"] = map[string]any{
			NetworkSepolia: map[string]any{"nonce": nonce, "sig": sig},
		}
	}
	if strings.TrimSpace(opt.Operator) != "" {
		op, err := ledger.ChecksumAddress(opt.Operator)
		if err != nil {
			return Created{}, err
		}
		body["operator"] = op
	}
	commit, err := limitsCommit(doc)
	if err != nil {
		return Created{}, err
	}
	body["limitsCommit"] = commit

	seq, err := lay.NextSeq()
	if err != nil {
		return Created{}, err
	}
	now := time.Now()
	if opt.Now != nil {
		now = opt.Now()
	}
	env, _, err := ledger.Sign(agentKey, "bind", seq, body, now.UnixMilli())
	if err != nil {
		return Created{}, err
	}
	urls := opt.LedgerURLs
	if len(urls) == 0 {
		urls = ledger.DefaultURLs()
	}
	res, err := (&ledger.Client{URLs: urls, Agent: "scdo-agent"}).Post(ctx, "bind", env)
	if err != nil {
		return Created{}, err
	}
	if err := saveDoc(lay.Dir, doc); err != nil {
		return Created{}, err
	}
	return Created{
		Agent:   agentKey.Address(),
		Wallet:  walletKey.Address(),
		BotID:   opt.BotID,
		Ledger:  strings.TrimRight(res.Ledger, "/") + "/agents/" + agentKey.Address(),
		Network: NetworkSepolia,
	}, nil
}

func proofNonce() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func limitsCommit(doc Doc) (string, error) {
	c, err := ledger.Canonical(map[string]any{
		"budgetAtomic": doc.DailyAtomic,
		"maxAtomic":    doc.MaxAtomic,
		"network":      doc.Network,
	})
	if err != nil {
		return "", err
	}
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write([]byte(c))
	return "0x" + hex.EncodeToString(h.Sum(nil)), nil
}

func wipeKey(k *ledger.Key) {
	if k == nil {
		return
	}
	ledger.Wipe(k.Scalar())
}
