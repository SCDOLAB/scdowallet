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
	Root  string
	Name  string
	BotID string
	Email string
	// Asset is usdc or wscdo. Empty means usdc.
	Asset string
	// MaxAtomic and Daily are decimal amounts of Asset ("1", "0.10"), not atomic units.
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
	Agent       string
	Wallet      string
	BotID       string
	EmailCommit string
	Ledger      string
	Network     string
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
	asset, err := NormalizeAsset(opt.Asset)
	if err != nil {
		return Created{}, err
	}
	doc.BotID = opt.BotID
	doc.Network = NetworkSepolia
	doc.Address = walletKey.Address()
	doc.Asset = asset
	// --max and --daily are decimal amounts of the selected asset.
	// USDC has 6 decimals and WSCDO has 18. Storing the raw flag would leave
	// a cap of 0 or 1 atomic unit.
	decimals := USDCDecimals
	if asset == AssetWSCDO {
		decimals = WSCDODecimals
	}
	if strings.TrimSpace(opt.MaxAtomic) != "" {
		atomic, err := ParseDecimal(opt.MaxAtomic, decimals)
		if err != nil {
			return Created{}, err
		}
		if asset == AssetWSCDO {
			doc.MaxWSCDO = atomic
		} else {
			doc.MaxAtomic = atomic
		}
	}
	if strings.TrimSpace(opt.Daily) != "" {
		atomic, err := ParseDecimal(opt.Daily, decimals)
		if err != nil {
			return Created{}, err
		}
		if asset == AssetWSCDO {
			doc.DailyWSCDO = atomic
		} else {
			doc.DailyAtomic = atomic
		}
	}
	if len(opt.Payees) > 0 {
		doc.Payees = opt.Payees
	}
	if strings.TrimSpace(opt.Email) != "" {
		salt, err := loadOrCreateSalt(lay.Dir)
		if err != nil {
			return Created{}, err
		}
		commit, err := EmailCommit(salt, opt.Email)
		for i := range salt {
			salt[i] = 0
		}
		if err != nil {
			return Created{}, err
		}
		if err := saveEmail(lay.Dir, opt.Email); err != nil {
			return Created{}, err
		}
		doc.EmailCommit = commit
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
	doc.LimitsCommit = commit
	body["limitsCommit"] = commit
	if doc.EmailCommit != "" {
		body["emailCommit"] = doc.EmailCommit
	}

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
	hash, err := ledger.EnvelopeHash(env)
	if err != nil {
		return Created{}, err
	}
	if res.Body != nil {
		if got, _ := res.Body["bindHash"].(string); got != "" && !strings.EqualFold(got, hash) {
			return Created{}, fmt.Errorf("bind hash")
		}
	}
	doc.BindHash = strings.ToLower(hash)
	if err := saveDoc(lay.Dir, doc); err != nil {
		return Created{}, err
	}
	return Created{
		Agent:       agentKey.Address(),
		Wallet:      walletKey.Address(),
		BotID:       opt.BotID,
		EmailCommit: doc.EmailCommit,
		Ledger:      strings.TrimRight(res.Ledger, "/") + "/agents/" + agentKey.Address(),
		Network:     NetworkSepolia,
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
	payees := doc.Payees
	if payees == nil {
		payees = []string{}
	}
	domains := doc.Domains
	if domains == nil {
		domains = []string{}
	}
	fields := map[string]any{
		"budgetAtomic": doc.DailyAtomic,
		"domains":      domains,
		"maxAtomic":    doc.MaxAtomic,
		"network":      doc.Network,
		"payees":       payees,
	}
	if doc.Asset == AssetWSCDO || doc.MaxWSCDO != "" || doc.DailyWSCDO != "" {
		fields["wscdo"] = WSCDO
		fields["wscdoNetwork"] = NetworkShard0
		fields["wscdoMaxAtomic"] = doc.maxWSCDO()
		fields["wscdoDailyAtomic"] = doc.dailyWSCDO()
	}
	c, err := ledger.Canonical(fields)
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
