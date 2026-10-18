package wallet

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

// BatchOptions confirms local bots that named this operator on /bind.
type BatchOptions struct {
	Root       string
	Name       string
	Bots       []string
	Passphrase []byte
	LedgerURLs []string
	Now        func() time.Time
}

// ConfirmBatch POSTs /operator/batch. The merkle root is the sorted-pair
// keccak of each bot's bind hash, in the order given. An odd node is carried up.
func ConfirmBatch(ctx context.Context, opt BatchOptions) (ledger.Result, error) {
	if len(opt.Bots) == 0 || len(opt.Bots) > 1000 {
		return ledger.Result{}, fmt.Errorf("agents")
	}
	lay, err := agent.Open(opt.Root, opt.Name)
	if err != nil {
		return ledger.Result{}, err
	}
	agentKey, err := lay.OpenKey(opt.Passphrase)
	if err != nil {
		return ledger.Result{}, err
	}
	defer wipeKey(agentKey)
	agents := make([]any, 0, len(opt.Bots))
	leaves := make([]string, 0, len(opt.Bots))
	seen := map[string]struct{}{}
	for _, bot := range opt.Bots {
		child, err := agent.Open(opt.Root, bot)
		if err != nil {
			return ledger.Result{}, err
		}
		doc, err := loadDoc(child.Dir)
		if err != nil {
			return ledger.Result{}, err
		}
		if doc.BindHash == "" {
			return ledger.Result{}, fmt.Errorf("bind hash")
		}
		addr := child.Meta.Address
		if _, ok := seen[strings.ToLower(addr)]; ok {
			continue
		}
		seen[strings.ToLower(addr)] = struct{}{}
		agents = append(agents, addr)
		leaves = append(leaves, doc.BindHash)
	}
	root, err := ledger.MerkleRoot(leaves)
	if err != nil {
		return ledger.Result{}, err
	}
	now := time.Now()
	if opt.Now != nil {
		now = opt.Now()
	}
	urls := opt.LedgerURLs
	if len(urls) == 0 {
		urls = ledger.DefaultURLs()
	}
	seq, err := lay.NextSeq()
	if err != nil {
		return ledger.Result{}, err
	}
	env, _, err := ledger.Sign(agentKey, "batch", seq, map[string]any{
		"agents":     agents,
		"merkleRoot": root,
	}, now.UnixMilli())
	if err != nil {
		return ledger.Result{}, err
	}
	res, err := (&ledger.Client{URLs: urls, Agent: "scdo-agent"}).Post(ctx, "batch", env)
	if err != nil || !res.OK {
		if res.Error != "" {
			return res, fmt.Errorf("%s", res.Error)
		}
		if err != nil {
			return res, err
		}
		return res, fmt.Errorf("ledger")
	}
	return res, nil
}
