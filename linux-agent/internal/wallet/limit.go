package wallet

import (
	"fmt"
	"strings"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

// LimitUpdate changes the local policy. Amounts are decimal units of Asset.
type LimitUpdate struct {
	Asset        string
	PerPayment   string
	Daily        string
	Payees       []string
	Domains      []string
	ClearPayees  bool
	ClearDomains bool
}

// View is the public wallet record for wallet show.
type View struct {
	Agent           string
	Doc             Doc
	SpentDisplay    string
	MaxDisplay      string
	DailyDisplay    string
	Asset           string
	WSCDOMaxDisplay string
	WSCDODaily      string
}

// Show reads the public wallet record. It does not open a key.
func Show(root, name string) (View, error) {
	lay, err := agent.Open(root, name)
	if err != nil {
		return View{}, err
	}
	doc, err := loadDoc(lay.Dir)
	if err != nil {
		return View{}, err
	}
	now := time.Now()
	spent := enforcedSpent(doc, readSpend(lay.Dir), now)
	asset := doc.Asset
	if asset == "" {
		asset = AssetUSDC
	}
	return View{
		Agent:           lay.Meta.Address,
		Doc:             doc,
		SpentDisplay:    FormatUSDC(spent.String()),
		MaxDisplay:      FormatUSDC(doc.MaxAtomic),
		DailyDisplay:    FormatUSDC(doc.DailyAtomic),
		Asset:           asset,
		WSCDOMaxDisplay: FormatDecimal(doc.maxWSCDO(), WSCDODecimals),
		WSCDODaily:      FormatDecimal(doc.dailyWSCDO(), WSCDODecimals),
	}, nil
}

// ApplyLimit writes per-payment, daily, payee, and domain limits on this machine.
func ApplyLimit(root, name string, upd LimitUpdate) (Doc, error) {
	lay, err := agent.Open(root, name)
	if err != nil {
		return Doc{}, err
	}
	doc, err := loadDoc(lay.Dir)
	if err != nil {
		return Doc{}, err
	}
	asset, err := NormalizeAsset(upd.Asset)
	if err != nil {
		return Doc{}, err
	}
	decimals := USDCDecimals
	if asset == AssetWSCDO {
		decimals = WSCDODecimals
		doc.Asset = AssetWSCDO
	}
	if strings.TrimSpace(upd.PerPayment) != "" {
		atomic, err := ParseDecimal(upd.PerPayment, decimals)
		if err != nil {
			return Doc{}, err
		}
		if asset == AssetWSCDO {
			doc.MaxWSCDO = atomic
		} else {
			doc.MaxAtomic = atomic
		}
	}
	if strings.TrimSpace(upd.Daily) != "" {
		atomic, err := ParseDecimal(upd.Daily, decimals)
		if err != nil {
			return Doc{}, err
		}
		if asset == AssetWSCDO {
			doc.DailyWSCDO = atomic
		} else {
			doc.DailyAtomic = atomic
		}
	}
	if upd.ClearPayees {
		doc.Payees = nil
	}
	for _, payee := range upd.Payees {
		addr, err := ledger.ChecksumAddress(payee)
		if err != nil {
			return Doc{}, err
		}
		if !payeeAllowed(doc.Payees, addr) {
			doc.Payees = append(doc.Payees, addr)
		}
	}
	if upd.ClearDomains {
		doc.Domains = nil
	}
	for _, domain := range upd.Domains {
		cleaned, err := cleanDomain(domain)
		if err != nil {
			return Doc{}, err
		}
		if !containsFold(doc.Domains, cleaned) {
			doc.Domains = append(doc.Domains, cleaned)
		}
	}
	commit, err := limitsCommit(doc)
	if err != nil {
		return Doc{}, err
	}
	doc.LimitsCommit = commit
	if err := saveDoc(lay.Dir, doc); err != nil {
		return Doc{}, err
	}
	return doc, nil
}

func cleanDomain(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimPrefix(s, "https://")
	s = strings.TrimPrefix(s, "http://")
	if i := strings.IndexByte(s, '/'); i >= 0 {
		s = s[:i]
	}
	if s == "" || strings.ContainsAny(s, " \t") {
		return "", fmt.Errorf("domain")
	}
	return s, nil
}

func containsFold(list []string, want string) bool {
	for _, item := range list {
		if strings.EqualFold(item, want) {
			return true
		}
	}
	return false
}
