package wallet

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

func record(ctx context.Context, lay *agent.Layout, agentKey *ledger.Key, doc Doc, urls []string, now time.Time) (string, error) {
	if doc.LastTx == "" || doc.LastPayTo == "" || doc.LastAmount == "" {
		return "", fmt.Errorf("no payment to record")
	}
	body := map[string]any{
		"network": NetworkSepolia,
		"amount":  doc.LastAmount,
		"payTo":   doc.LastPayTo,
		"tx":      doc.LastTx,
	}
	if doc.LastResource != "" {
		body["resource"] = doc.LastResource
	}
	if doc.LastNonce != "" {
		body["nonce"] = doc.LastNonce
	}
	return postSigned(ctx, lay, agentKey, "spend", body, urls, now)
}

// Record posts /ledger/spend again for the last unsettled payment.
func Record(ctx context.Context, opt PayOptions) (Paid, error) {
	lay, doc, agentKey, walletKey, err := openPair(opt.Root, opt.Name, opt.Passphrase)
	if err != nil {
		return Paid{}, err
	}
	defer wipeKey(agentKey)
	defer wipeKey(walletKey)
	if doc.LastRecorded {
		return Paid{Agent: agentKey.Address(), Wallet: walletKey.Address(), Tx: doc.LastTx, Ledger: lookup(opt.LedgerURLs, agentKey.Address())}, nil
	}
	now := time.Now()
	if opt.Now != nil {
		now = opt.Now()
	}
	ledgerURL, err := record(ctx, lay, agentKey, doc, opt.LedgerURLs, now)
	if err != nil {
		return Paid{}, err
	}
	doc.LastRecorded = true
	if err := saveDoc(lay.Dir, doc); err != nil {
		return Paid{}, err
	}
	return Paid{
		Agent:    agentKey.Address(),
		Wallet:   walletKey.Address(),
		Tx:       doc.LastTx,
		PayTo:    doc.LastPayTo,
		Amount:   doc.LastAmount,
		Ledger:   ledgerURL,
		Basescan: "https://sepolia.basescan.org/tx/" + doc.LastTx,
	}, nil
}

// SetKilled toggles the local kill switch and posts /freeze or /unfreeze.
func SetKilled(ctx context.Context, root, name string, pass []byte, urls []string, killed bool, now time.Time) error {
	lay, doc, agentKey, walletKey, err := openPair(root, name, pass)
	if err != nil {
		return err
	}
	defer wipeKey(agentKey)
	defer wipeKey(walletKey)
	doc.Killed = killed
	if err := saveDoc(lay.Dir, doc); err != nil {
		return err
	}
	typ := "unfreeze"
	if killed {
		typ = "freeze"
	}
	_, err = postSigned(ctx, lay, agentKey, typ, map[string]any{}, urls, now)
	return err
}

// RevokeX posts /bind/x/revoke. The ledger returns revoked:false until an X binding exists.
func RevokeX(ctx context.Context, root, name string, pass []byte, urls []string, now time.Time) error {
	lay, _, agentKey, walletKey, err := openPair(root, name, pass)
	if err != nil {
		return err
	}
	defer wipeKey(agentKey)
	defer wipeKey(walletKey)
	_, err = postSigned(ctx, lay, agentKey, "xrevoke", map[string]any{}, urls, now)
	return err
}

// Export reads the public wallet record.
func Export(root, name string) (Doc, string, error) {
	lay, err := agent.Open(root, name)
	if err != nil {
		return Doc{}, "", err
	}
	doc, err := loadDoc(lay.Dir)
	if err != nil {
		return Doc{}, "", err
	}
	return doc, lay.Meta.Address, nil
}

// AllowPayee adds one checksummed address to the allowlist.
func AllowPayee(root, name, payee string) (Doc, error) {
	lay, err := agent.Open(root, name)
	if err != nil {
		return Doc{}, err
	}
	addr, err := ledger.ChecksumAddress(payee)
	if err != nil {
		return Doc{}, err
	}
	doc, err := loadDoc(lay.Dir)
	if err != nil {
		return Doc{}, err
	}
	if !payeeAllowed(doc.Payees, addr) {
		doc.Payees = append(doc.Payees, addr)
	}
	if err := saveDoc(lay.Dir, doc); err != nil {
		return Doc{}, err
	}
	return doc, nil
}

func postSigned(ctx context.Context, lay *agent.Layout, agentKey *ledger.Key, typ string, body map[string]any, urls []string, now time.Time) (string, error) {
	seq, err := lay.NextSeq()
	if err != nil {
		return "", err
	}
	if now.IsZero() {
		now = time.Now()
	}
	env, _, err := ledger.Sign(agentKey, typ, seq, body, now.UnixMilli())
	if err != nil {
		return "", err
	}
	if len(urls) == 0 {
		urls = ledger.DefaultURLs()
	}
	var last error
	for attempt := 0; attempt < 4; attempt++ {
		res, err := (&ledger.Client{URLs: urls, Agent: "scdo-agent"}).Post(ctx, typ, env)
		if err == nil && res.OK {
			return strings.TrimRight(res.Ledger, "/") + "/agents/" + agentKey.Address(), nil
		}
		last = err
		if res.Status == 400 || res.Status == 409 || res.Status == 413 {
			break
		}
		if typ != "spend" {
			break
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(time.Duration(attempt+1) * 200 * time.Millisecond):
		}
	}
	if last == nil {
		last = fmt.Errorf("ledger")
	}
	return "", last
}

func lookup(urls []string, agentAddr string) string {
	base := ledger.DefaultLedger
	if len(urls) > 0 && urls[0] != "" {
		base = urls[0]
	}
	return strings.TrimRight(base, "/") + "/agents/" + agentAddr
}
