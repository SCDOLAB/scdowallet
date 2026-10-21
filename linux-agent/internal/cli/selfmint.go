package cli

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/erc8004"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

// dripper asks the ledger for the one-time Shard0 gas drip, signed by the agent key.
func dripper(lay *agent.Layout, key *ledger.Key, client *ledger.Client) func(context.Context) (string, error) {
	return func(ctx context.Context) (string, error) {
		seq, err := lay.NextSeq()
		if err != nil {
			return "", err
		}
		env, _, err := ledger.Sign(key, "gas_drip", seq, map[string]any{"purpose": "erc8004_self_register"}, time.Now().UnixMilli())
		if err != nil {
			return "", err
		}
		res, err := client.Post(ctx, "gas_drip", env)
		if err != nil {
			return "", err
		}
		tx, _ := res.Body["tx"].(string)
		if reason, _ := res.Body["reason"].(string); reason != "" && tx == "" {
			return "", nil
		}
		if st, _ := res.Body["status"].(string); st == "failed" {
			return tx, fmt.Errorf("drip transaction failed")
		}
		return tx, nil
	}
}

// selfRegisterLoop makes sure this agent holds an ERC-8004 identity it minted itself
// (Agent Ledger verified v1-2026-10-21). It runs in the background next to the heartbeats
// and retries every retry until done or ctx ends.
func selfRegisterLoop(ctx context.Context, opt erc8004.Options, log func(string), retry time.Duration) {
	for {
		res, err := erc8004.Register(ctx, opt)
		if err == nil {
			if res.Already {
				log("erc8004 self-registered " + res.AgentID)
			} else {
				log("erc8004 self-registered " + res.AgentID + " tx " + res.Tx)
			}
			return
		}
		log("erc8004 " + strings.TrimSpace(err.Error()))
		select {
		case <-ctx.Done():
			return
		case <-time.After(retry):
		}
	}
}
