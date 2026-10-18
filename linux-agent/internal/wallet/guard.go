package wallet

import (
	"fmt"
	"math/big"
	"strings"
	"time"
)

// Decision is one offered payment the x402 client is about to sign.
type Decision struct {
	Network string
	Asset   string
	PayTo   string
	Amount  string
	Now     time.Time
}

// Allow reports whether this agent may sign the payment.
// The x402 SDK still applies its own per-payment cap. This is the SCDO cap,
// daily total, payee allowlist, and kill switch.
func Allow(doc Doc, d Decision) error {
	if doc.Killed {
		return fmt.Errorf("wallet kill switch is on")
	}
	if d.Network != NetworkSepolia {
		return fmt.Errorf("only Base Sepolia (eip155:84532) payments are enabled")
	}
	if !sameAddr(d.Asset, SepoliaUSDC) {
		return fmt.Errorf("only Base Sepolia USDC is enabled")
	}
	amount, ok := new(big.Int).SetString(d.Amount, 10)
	if !ok || amount.Sign() <= 0 {
		return fmt.Errorf("bad amount")
	}
	max, ok := new(big.Int).SetString(doc.MaxAtomic, 10)
	if !ok {
		return fmt.Errorf("bad spend cap")
	}
	if amount.Cmp(max) > 0 {
		return fmt.Errorf("amount %s is above the per-payment cap %s", d.Amount, doc.MaxAtomic)
	}
	daily, ok := new(big.Int).SetString(doc.DailyAtomic, 10)
	if !ok {
		return fmt.Errorf("bad daily cap")
	}
	if new(big.Int).Add(doc.spentToday(d.Now), amount).Cmp(daily) > 0 {
		return fmt.Errorf("amount %s would pass the daily cap %s", d.Amount, doc.DailyAtomic)
	}
	if len(doc.Payees) > 0 && !payeeAllowed(doc.Payees, d.PayTo) {
		return fmt.Errorf("payee %s is not on the allowlist", d.PayTo)
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
