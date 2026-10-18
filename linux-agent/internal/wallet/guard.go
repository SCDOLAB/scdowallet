package wallet

import (
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"strings"
	"time"
)

// ErrPolicy is a refusal made before any signature. The CLI exits 3.
var ErrPolicy = errors.New("payment stopped by policy")

type policyError struct{ msg string }

func (e *policyError) Error() string { return e.msg }

func (e *policyError) Unwrap() error { return ErrPolicy }

func policyf(format string, args ...any) error {
	return &policyError{msg: fmt.Sprintf(format, args...)}
}

// Decision is one offered payment the x402 client is about to sign.
type Decision struct {
	Network  string
	Asset    string
	PayTo    string
	Amount   string
	Resource string
	Name     string
	Version  string
	Now      time.Time
}

// Allow reports whether this agent may sign the payment.
// The x402 SDK still applies its own per-payment cap. This is the SCDO cap,
// daily total, payee allowlist, and kill switch.
func Allow(doc Doc, d Decision) error {
	if doc.Killed {
		return policyf("wallet kill switch is on")
	}
	max, daily, spent, err := capFor(doc, d)
	if err != nil {
		return err
	}
	amount, ok := new(big.Int).SetString(d.Amount, 10)
	if !ok || amount.Sign() <= 0 {
		return policyf("bad amount")
	}
	if amount.Cmp(max) > 0 {
		return policyf("amount %s is above the per-payment cap %s", d.Amount, max.String())
	}
	if new(big.Int).Add(spent, amount).Cmp(daily) > 0 {
		return policyf("Payment stopped: over today's limit")
	}
	if len(doc.Payees) > 0 && !payeeAllowed(doc.Payees, d.PayTo) {
		return policyf("payee %s is not on the allowlist", d.PayTo)
	}
	if len(doc.Domains) > 0 && !domainAllowed(doc.Domains, d.Resource) {
		return policyf("host is not on the allowlist")
	}
	return nil
}

func payeeAllowed(list []string, payee string) bool {
	for _, item := range list {
		if sameAddr(item, payee) {
			return true
		}
	}
	return false
}

func domainAllowed(list []string, rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return false
	}
	for _, item := range list {
		p := strings.ToLower(strings.TrimSpace(item))
		if p == host {
			return true
		}
		if strings.HasPrefix(p, "*.") {
			suffix := p[1:]
			if strings.HasSuffix(host, suffix) && len(host) > len(suffix) {
				return true
			}
		}
	}
	return false
}

// ParseUSDC converts a decimal USDC string such as "1" or "0.10" into 6-decimal atomic units.
func ParseUSDC(s string) (string, error) {
	return ParseDecimal(s, USDCDecimals)
}

// ParseDecimal converts a decimal token amount into atomic units.
func ParseDecimal(s string, decimals int) (string, error) {
	s = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s), "$"))
	if s == "" || strings.HasPrefix(s, "-") || strings.ContainsAny(s, "eE+") || decimals < 0 || decimals > 36 {
		return "", fmt.Errorf("bad amount")
	}
	parts := strings.Split(s, ".")
	if len(parts) > 2 {
		return "", fmt.Errorf("bad amount")
	}
	whole := parts[0]
	if whole == "" {
		whole = "0"
	}
	frac := ""
	if len(parts) == 2 {
		frac = parts[1]
	}
	if len(frac) > decimals || !digits(whole) || !digits(frac) {
		return "", fmt.Errorf("amount supports %d decimals", decimals)
	}
	for len(frac) < decimals {
		frac += "0"
	}
	w, ok := new(big.Int).SetString(whole, 10)
	if !ok {
		return "", fmt.Errorf("bad amount")
	}
	f, ok := new(big.Int).SetString(frac, 10)
	if !ok {
		return "", fmt.Errorf("bad amount")
	}
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)
	w.Mul(w, scale)
	w.Add(w, f)
	if w.Sign() <= 0 {
		return "", fmt.Errorf("bad amount")
	}
	return w.String(), nil
}

func capFor(doc Doc, d Decision) (max, daily, spent *big.Int, err error) {
	var maxRaw, dailyRaw string
	switch {
	case d.Network == NetworkSepolia && sameAddr(d.Asset, SepoliaUSDC):
		maxRaw, dailyRaw = doc.MaxAtomic, doc.DailyAtomic
		spent = doc.spentToday(d.Now)
	case d.Network == NetworkShard0 && sameAddr(d.Asset, WSCDO):
		if d.Name != WSCDOName || d.Version != WSCDOVersion {
			return nil, nil, nil, policyf("WSCDO domain must be name %s version %s", WSCDOName, WSCDOVersion)
		}
		maxRaw, dailyRaw = doc.maxWSCDO(), doc.dailyWSCDO()
		spent = doc.spentWSCDO(d.Now)
	default:
		return nil, nil, nil, policyf("only Base Sepolia USDC (eip155:84532) and Shard0 WSCDO (eip155:5680) are enabled")
	}
	var ok bool
	max, ok = new(big.Int).SetString(maxRaw, 10)
	if !ok {
		return nil, nil, nil, policyf("bad spend cap")
	}
	daily, ok = new(big.Int).SetString(dailyRaw, 10)
	if !ok {
		return nil, nil, nil, policyf("bad daily cap")
	}
	return max, daily, spent, nil
}

func digits(s string) bool {
	if s == "" {
		return true
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// FormatUSDC renders a 6-decimal atomic amount as a fixed decimal string.
func FormatUSDC(atomic string) string {
	return FormatDecimal(atomic, USDCDecimals)
}

// FormatDecimal renders an atomic amount with a fixed number of decimals.
func FormatDecimal(atomic string, decimals int) string {
	if decimals < 0 || decimals > 36 {
		return "0"
	}
	n, ok := new(big.Int).SetString(strings.TrimSpace(atomic), 10)
	if !ok || n.Sign() < 0 {
		n = big.NewInt(0)
	}
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)
	whole := new(big.Int).Quo(n, scale)
	frac := new(big.Int).Mod(n, scale).String()
	if decimals == 0 {
		return whole.String()
	}
	if len(frac) < decimals {
		frac = strings.Repeat("0", decimals-len(frac)) + frac
	}
	return whole.String() + "." + frac
}

// USDCap is the x402 SDK per-payment dollar cap for a 6-decimal atomic amount.
func USDCap(atomic string) string {
	n, ok := new(big.Int).SetString(strings.TrimSpace(atomic), 10)
	if !ok || n.Sign() < 0 {
		return "$1"
	}
	whole := new(big.Int).Quo(n, big.NewInt(1_000_000))
	frac := new(big.Int).Mod(n, big.NewInt(1_000_000)).Int64()
	if frac == 0 {
		return "$" + whole.String()
	}
	s := strings.TrimRight(fmtFrac(whole.String(), frac), "0")
	return "$" + s
}

func fmtFrac(whole string, frac int64) string {
	return fmt.Sprintf("%s.%06d", whole, frac)
}
