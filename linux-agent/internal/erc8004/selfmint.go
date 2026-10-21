package erc8004

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"time"
)

// selfMinted finds a Registered(agentId, uri, owner=address) log whose transaction was sent
// by address and whose token address still owns. That is criterion (1) of the Agent Ledger
// verified definition v1-2026-10-21.
func selfMinted(ctx context.Context, node *rpc, address string) (foundReg, bool, error) {
	regs, err := node.registrations(ctx, address)
	if err != nil {
		return foundReg{}, false, err
	}
	var best *foundReg
	for i := range regs {
		owner, err := node.ownerOf(ctx, regs[i].id)
		if err != nil || !strings.EqualFold(owner, address) {
			continue
		}
		from, err := node.txFrom(ctx, regs[i].tx)
		if err != nil || !strings.EqualFold(from, address) {
			continue
		}
		if best == nil || regs[i].id.Cmp(best.id) < 0 {
			best = &regs[i]
		}
	}
	if best == nil {
		return foundReg{}, false, nil
	}
	return *best, true, nil
}

// SelfMintedID reports the agent's self-minted identity, if any.
func SelfMintedID(ctx context.Context, rpcs []string, address string) (string, string, bool, error) {
	if len(rpcs) == 0 {
		rpcs = DefaultRPCs()
	}
	node, err := (&rpc{URLs: rpcs}).dial(ctx)
	if err != nil {
		return "", "", false, err
	}
	item, ok, err := selfMinted(ctx, node, address)
	if err != nil || !ok {
		return "", "", false, err
	}
	return item.id.String(), item.tx, true, nil
}

func (c *rpc) txFrom(ctx context.Context, hash string) (string, error) {
	raw, err := c.call(ctx, "eth_getTransactionByHash", []any{hash})
	if err != nil {
		return "", err
	}
	var doc struct {
		From string `json:"from"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return "", err
	}
	return doc.From, nil
}

// mintCost is gas estimate (with the 20% margin from estimate) times gas price, plus 10%.
func mintCost(ctx context.Context, node *rpc, address string, data []byte) (*big.Int, error) {
	gas, err := node.estimate(ctx, address, data)
	if err != nil {
		return nil, err
	}
	price, err := node.gasPrice(ctx)
	if err != nil {
		return nil, err
	}
	cost := new(big.Int).Mul(new(big.Int).SetUint64(gas), price)
	cost.Add(cost, new(big.Int).Div(cost, big.NewInt(10)))
	return cost, nil
}

// ensureGas makes sure the agent can pay for its own mint. When it cannot, it asks
// for the one-time ledger drip and waits until the drip is confirmed on chain.
func ensureGas(ctx context.Context, opt Options, node *rpc, address string, data []byte) error {
	need, err := mintCost(ctx, node, address, data)
	if err != nil {
		return err
	}
	bal, err := node.balance(ctx, address)
	if err != nil {
		return err
	}
	if bal.Cmp(need) >= 0 {
		return nil
	}
	if opt.Drip == nil {
		return fmt.Errorf("Shard0 account %s has no SCDO for gas", address)
	}
	if _, err := opt.Drip(ctx); err != nil {
		return fmt.Errorf("gas drip: %w", err)
	}
	wait := opt.DripWait
	if wait <= 0 {
		wait = 3 * time.Minute
	}
	deadline := time.Now().Add(wait)
	for {
		bal, err = node.balance(ctx, address)
		if err == nil && bal.Cmp(need) >= 0 {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("gas drip not confirmed yet for %s", address)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
}
