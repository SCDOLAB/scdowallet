package wallet

import (
	"encoding/hex"
	"os"
	"testing"

	"golang.org/x/crypto/sha3"
)

func TestEmailCommitVector(t *testing.T) {
	salt := bytesRepeat(0x11, 32)
	got, err := EmailCommit(salt, "  Grok-Ops-7@Mail.Grokbot.com ")
	if err != nil {
		t.Fatal(err)
	}
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write([]byte("scdo-bot-email-v1"))
	_, _ = h.Write(salt)
	_, _ = h.Write([]byte("grok-ops-7@mail.grokbot.com"))
	want := "0x" + hex.EncodeToString(h.Sum(nil))
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
	if _, err := EmailCommit(salt[:16], "a@b.co"); err == nil {
		t.Fatal("short salt")
	}
	dir := t.TempDir()
	first, err := loadOrCreateSalt(dir)
	if err != nil || len(first) != 32 {
		t.Fatal(err)
	}
	second, err := loadOrCreateSalt(dir)
	if err != nil || hex.EncodeToString(first) != hex.EncodeToString(second) {
		t.Fatal("salt replaced")
	}
	fi, err := os.Stat(dir + "/email.salt")
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatal(fi.Mode())
	}
}

func bytesRepeat(b byte, n int) []byte {
	out := make([]byte, n)
	for i := range out {
		out[i] = b
	}
	return out
}
