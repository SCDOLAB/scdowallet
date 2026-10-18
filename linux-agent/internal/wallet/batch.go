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

// BatchConfirmed is a booked operator batch.
type BatchConfirmed struct {
	ledger.Result
	MerkleRoot string
	Receipt    string
}

// ConfirmBatch POSTs /operator/batch. The merkle root is the sorted-pair
// keccak of each bot's bind hash, in the order given. An odd node is carried up.
func ConfirmBatch(ctx context.Context, opt BatchOptions) (BatchConfirmed, error) {
	if len(opt.Bots) == 0 || len(opt.Bots) > 1000 {
		return BatchConfirmed{}, fmt.Errorf("agents")
	}
	lay, err := agent.Open(opt.Root, opt.Name)
	if err != nil {
		return BatchConfirmed{}, err
	}
	agentKey, err := lay.OpenKey(opt.Passphrase)
	if err != nil {
		return BatchConfirmed{}, err
	}
	defer wipeKey(agentKey)
	agents := make([]any, 0, len(opt.Bots))
	leaves := make([]string, 0, len(opt.Bots))
	seen := map[string]struct{}{}
	for _, bot := range opt.Bots {
		child, err := agent.Open(opt.Root, bot)
		if err != nil {
			return BatchConfirmed{}, err
		}
		doc, err := loadDoc(child.Dir)
		if err != nil {
			return BatchConfirmed{}, err
		}
		if doc.BindHash == "" {
			return BatchConfirmed{}, fmt.Errorf("bind hash")
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
		return BatchConfirmed{}, err
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
		return BatchConfirmed{}, err
	}
	env, _, err := ledger.Sign(agentKey, "batch", seq, map[string]any{
		"agents":     agents,
		"merkleRoot": root,
	}, now.UnixMilli())
	if err != nil {
		return BatchConfirmed{}, err
	}
	res, err := (&ledger.Client{URLs: urls, Agent: "scdo-agent"}).Post(ctx, "batch", env)
	if err != nil || !res.OK {
		if res.Error != "" {
			return BatchConfirmed{Result: res, MerkleRoot: root}, fmt.Errorf("%s", res.Error)
		}
		if err != nil {
			return BatchConfirmed{Result: res, MerkleRoot: root}, err
		}
		return BatchConfirmed{Result: res, MerkleRoot: root}, fmt.Errorf("ledger")
	}
	if echoed, _ := res.Body["merkleRoot"].(string); echoed != "" && !strings.EqualFold(echoed, root) {
		return BatchConfirmed{Result: res, MerkleRoot: root}, fmt.Errorf("merkle root")
	}
	receipt := res.Body
	if receipt == nil {
		receipt = map[string]any{"ok": true}
	}
	text, err := ledger.Canonical(receipt)
	if err != nil {
		return BatchConfirmed{Result: res, MerkleRoot: root}, err
	}
	return BatchConfirmed{Result: res, MerkleRoot: root, Receipt: text}, nil
}
