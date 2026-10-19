package wallet

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	if err := rejectFrozen(ctx, opt.LedgerURLs, lay.Meta.Address); err != nil {
		return Paid{}, err
	}
	var spend spendLog
	err = withSpendLock(lay.Dir, func(log *spendLog) error {
		seedHistory(doc, log, now)
		spend = *log
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
	usdcNet, err := payNetwork(opt, doc)
	if err != nil {
		return Paid{}, err
	}
	chosen, err := pickAccept(raw, usdcNet)
	if err != nil {
		return Paid{}, err
	}
	chosen.Resource = opt.URL
	chosen.Now = now
	check, err := spentCheck(doc, spend, chosen, opt.MaxAtomic, now)
	if err != nil {
		return Paid{}, err
	}
	if err := Allow(check, chosen); err != nil {
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

func pickAccept(raw []byte, usdcNet string) (Decision, error) {
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
		if extra, ok := item["extra"].(map[string]any); ok {
			d.Name = strField(extra, "name")
			d.Version = strField(extra, "version")
		}
		if d.Network == usdcNet && isUSDC(d.Network, d.Asset) {
			return d, nil
		}
		if d.Network == NetworkShard0 && sameAddr(d.Asset, WSCDO) {
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
	return Decision{}, policyf("no payment option on %s", NetworkLabel(usdcNet))
}

func strField(m map[string]any, key string) string {
	switch v := m[key].(type) {
	case string:
		return v
	default:
		return ""
	}
}
