package wallet

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

// Preview reads a 402 and runs the policy check. It does not sign.
func Preview(ctx context.Context, opt PayOptions) (Paid, error) {
	lay, err := agent.Open(opt.Root, opt.Name)
	if err != nil {
		return Paid{}, err
	}
	doc, err := loadDoc(lay.Dir)
	if err != nil {
		return Paid{}, err
	}
	now := time.Now()
	if opt.Now != nil {
		now = opt.Now()
	}
	policyDoc := doc
	if strings.TrimSpace(opt.MaxAtomic) != "" {
		tighter, err := tighterCap(doc.MaxAtomic, opt.MaxAtomic)
		if err != nil {
			return Paid{}, err
		}
		policyDoc.MaxAtomic = tighter
	}
	if err := rejectFrozen(ctx, opt.LedgerURLs, lay.Meta.Address); err != nil {
		return Paid{}, err
	}
	var spentDoc Doc
	err = withSpendLock(lay.Dir, func(log *spendLog) error {
		seedHistory(doc, log, now)
		spent := enforcedSpent(doc, *log, now)
		spentDoc = policyDoc
		spentDoc.SpentAtomic = spent.String()
		spentDoc.SpentDay = now.UTC().Format("2006-01-02")
		return nil
	})
	if err != nil {
		return Paid{}, err
	}
	base := opt.HTTP
	if base == nil {
		base = &http.Client{Timeout: 30 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, opt.URL, nil)
	if err != nil {
		return Paid{}, err
	}
	req.Header.Set("accept", "application/json")
	resp, err := base.Do(req)
	if err != nil {
		return Paid{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusPaymentRequired {
		return Paid{}, fmt.Errorf("resource did not return HTTP 402")
	}
	raw := body
	if h := resp.Header.Get("Payment-Required"); h != "" {
		if decoded, err := base64.StdEncoding.DecodeString(h); err == nil {
			raw = capChallenge(decoded)
		}
	} else {
		raw = capChallenge(body)
	}
	chosen, err := pickAccept(raw)
	if err != nil {
		return Paid{}, err
	}
	chosen.Resource = opt.URL
	chosen.Now = now
	if err := Allow(spentDoc, chosen); err != nil {
		return Paid{}, err
	}
	payTo := chosen.PayTo
	if sum, err := ledger.ChecksumAddress(chosen.PayTo); err == nil {
		payTo = sum
	}
	return Paid{
		Agent:    lay.Meta.Address,
		Wallet:   doc.Address,
		PayTo:    payTo,
		Amount:   chosen.Amount,
		Resource: opt.URL,
	}, nil
}

func pickAccept(raw []byte) (Decision, error) {
	var doc struct {
		Accepts []map[string]any `json:"accepts"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return Decision{}, fmt.Errorf("payment requirements")
	}
	var fallback Decision
	found := false
	for _, item := range doc.Accepts {
		scheme, _ := item["scheme"].(string)
		if scheme != "exact" {
			continue
		}
		d := Decision{
			Network: strField(item, "network"),
			Asset:   strField(item, "asset"),
			PayTo:   strField(item, "payTo"),
			Amount:  strField(item, "amount"),
		}
		if d.Network == NetworkSepolia && sameAddr(d.Asset, SepoliaUSDC) {
			return d, nil
		}
		if !found {
			fallback = d
			found = true
		}
	}
	if found {
		return fallback, nil
	}
	return Decision{}, policyf("only Base Sepolia (eip155:84532) payments are enabled")
}

func strField(m map[string]any, key string) string {
	switch v := m[key].(type) {
	case string:
		return v
	default:
		return ""
	}
}
