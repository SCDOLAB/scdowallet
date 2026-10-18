package wallet

import (
	"math/big"
	"strings"
	"testing"
	"time"
)

func TestAllowCapsKillAndPayees(t *testing.T) {
	now := time.Date(2026, 10, 18, 3, 0, 0, 0, time.UTC)
	doc := Doc{Network: NetworkSepolia, MaxAtomic: "10000", DailyAtomic: "15000", SpentAtomic: "0", Payees: []string{"0xE3837fE309618AE075DbeF0A20735c0615a308E6"}}
	ok := Decision{Network: NetworkSepolia, Asset: SepoliaUSDC, PayTo: "0xe3837fe309618ae075dbef0a20735c0615a308e6", Amount: "10000", Now: now}
	if err := Allow(doc, ok); err != nil {
		t.Fatal(err)
	}
	if err := Allow(doc, Decision{Network: "eip155:8453", Asset: SepoliaUSDC, PayTo: ok.PayTo, Amount: "1", Now: now}); err == nil || !strings.Contains(err.Error(), "eip155:84532") {
		t.Fatal(err)
	}
	over := ok
	over.Amount = "10001"
	if err := Allow(doc, over); err == nil {
		t.Fatal("per-payment cap")
	}
	doc.SpentAtomic = "10000"
	doc.SpentDay = "2026-10-18"
	if err := Allow(doc, ok); err == nil {
		t.Fatal("daily cap")
	}
	doc.SpentDay = "2026-10-17"
	if err := Allow(doc, ok); err != nil {
		t.Fatal(err)
	}
	doc.Killed = true
	if err := Allow(doc, ok); err == nil {
		t.Fatal("kill switch")
	}
	doc.Killed = false
	ok.PayTo = "0x0000000000000000000000000000000000000001"
	if err := Allow(doc, ok); err == nil {
		t.Fatal("allowlist")
	}
	if USDCap("10000") != "$0.01" || USDCap("1000000") != "$1" {
		t.Fatalf("%s %s", USDCap("10000"), USDCap("1000000"))
	}
	if doc.spentToday(now).Cmp(big.NewInt(0)) != 0 {
		t.Fatal("stale day")
	}
}
