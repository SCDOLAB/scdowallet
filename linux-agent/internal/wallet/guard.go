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
	Now      time.Time
}

// Allow reports whether this agent may sign the payment.
// The x402 SDK still applies its own per-payment cap. This is the SCDO cap,
// daily total, payee allowlist, and kill switch.
func Allow(doc Doc, d Decision) error {
	if doc.Killed {
		return policyf("wallet kill switch is on")
	}
	if d.Network != NetworkSepolia {
		return policyf("only Base Sepolia (eip155:84532) payments are enabled")
	}
	if !sameAddr(d.Asset, SepoliaUSDC) {
		return policyf("only Base Sepolia USDC is enabled")
	}
	amount, ok := new(big.Int).SetString(d.Amount, 10)
	if !ok || amount.Sign() <= 0 {
		return policyf("bad amount")
	}
	max, ok := new(big.Int).SetString(doc.MaxAtomic, 10)
	if !ok {
		return policyf("bad spend cap")
	}
	if amount.Cmp(max) > 0 {
		return policyf("amount %s is above the per-payment cap %s", d.Amount, doc.MaxAtomic)
	}
	daily, ok := new(big.Int).SetString(doc.DailyAtomic, 10)
	if !ok {
		return policyf("bad daily cap")
	}
	if new(big.Int).Add(doc.spentToday(d.Now), amount).Cmp(daily) > 0 {
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
	s = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s), "$"))
	if s == "" || strings.HasPrefix(s, "-") || strings.ContainsAny(s, "eE+") {
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
	if len(frac) > 6 || !digits(whole) || !digits(frac) {
		return "", fmt.Errorf("USDC supports 6 decimals")
	}
	for len(frac) < 6 {
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
	w.Mul(w, big.NewInt(1_000_000))
	w.Add(w, f)
	if w.Sign() <= 0 {
		return "", fmt.Errorf("bad amount")
	}
	return w.String(), nil
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
	n, ok := new(big.Int).SetString(strings.TrimSpace(atomic), 10)
	if !ok || n.Sign() < 0 {
		return "0.000000"
	}
	whole := new(big.Int).Quo(n, big.NewInt(1_000_000))
	frac := new(big.Int).Mod(n, big.NewInt(1_000_000)).Int64()
	return fmt.Sprintf("%s.%06d", whole.String(), frac)
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
