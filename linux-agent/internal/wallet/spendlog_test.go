package wallet

import (
	"math/big"
	"testing"
	"time"
)

func TestSpendLogCountsPendingInTheWindow(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 10, 18, 4, 0, 0, 0, time.UTC)
	doc := Doc{SpentAtomic: "0"}
	if err := withSpendLock(dir, func(log *spendLog) error {
		seedHistory(doc, log, now)
		reservePending(log, "a", "10000", "", now)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	log := readSpend(dir)
	if log.window(now).Cmp(big.NewInt(10000)) != 0 {
		t.Fatal(log.window(now))
	}
	if log.window(now.Add(121*time.Second)).Sign() != 0 {
		t.Fatal("pending expired")
	}
	if err := withSpendLock(dir, func(log *spendLog) error {
		noteSettled(log, "a", "0x"+bytesHex(32), now)
		reservePending(log, "b", "6000", "", now)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	log = readSpend(dir)
	if log.window(now).Cmp(big.NewInt(16000)) != 0 {
		t.Fatal(log.window(now))
	}
	old := now.Add(-25 * time.Hour)
	if err := withSpendLock(dir, func(log *spendLog) error {
		log.Entries[0].At = old.UTC().Format(time.RFC3339)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if readSpend(dir).window(now).Cmp(big.NewInt(6000)) != 0 {
		t.Fatal("settled entry outside 24h still counted")
	}
}

func bytesHex(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = 0xab
	}
	return hexEncode(b)
}

func hexEncode(b []byte) string {
	const digits = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, v := range b {
		out[i*2] = digits[v>>4]
		out[i*2+1] = digits[v&0x0f]
	}
	return string(out)
}
