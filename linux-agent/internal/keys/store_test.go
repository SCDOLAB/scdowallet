package keys

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

func TestPlainKeyPermissionsAndReuse(t *testing.T) {
	dir := t.TempDir()
	s := Store{Dir: dir}
	k, err := s.Create("ledger", nil)
	if err != nil {
		t.Fatal(err)
	}
	path, err := s.Path("ledger")
	if err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("mode %o", st.Mode().Perm())
	}
	again, err := s.Open("ledger", nil)
	if err != nil {
		t.Fatal(err)
	}
	if again.Address() != k.Address() {
		t.Fatal("address changed")
	}
	if _, err := s.Create("ledger", nil); err != ErrExists {
		t.Fatalf("overwrite err %v", err)
	}
}

func TestEncryptedKeyHidesScalar(t *testing.T) {
	dir := t.TempDir()
	s := Store{Dir: dir}
	pass := []byte("test-passphrase")
	k, err := s.Create("ledger", pass)
	if err != nil {
		t.Fatal(err)
	}
	path, _ := s.Path("ledger")
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	scalar := k.Scalar()
	defer ledger.Wipe(scalar)
	if len(scalar) != 32 {
		t.Fatal("scalar length")
	}
	enc := hex.EncodeToString(scalar)
	if bytesContains(blob, enc) || bytesContains(blob, "0x"+enc) {
		t.Fatal("encrypted key file contains the scalar")
	}
	if _, err := s.Open("ledger", nil); err != ErrPassphrase {
		t.Fatalf("missing pass %v", err)
	}
	if _, err := s.Open("ledger", []byte("nope")); err != ErrPassphrase {
		t.Fatalf("wrong pass %v", err)
	}
	got, err := s.Open("ledger", pass)
	if err != nil {
		t.Fatal(err)
	}
	if got.Address() != k.Address() {
		t.Fatal("address mismatch after decrypt")
	}
}

func TestSecondPurposeIsIsolated(t *testing.T) {
	dir := t.TempDir()
	s := Store{Dir: dir}
	ledgerKey, err := s.Create("ledger", nil)
	if err != nil {
		t.Fatal(err)
	}
	walletKey, err := s.Create("wallet", nil)
	if err != nil {
		t.Fatal(err)
	}
	if ledgerKey.Address() == walletKey.Address() {
		t.Fatal("purposes share an address")
	}
	lb, _ := os.ReadFile(filepath.Join(dir, "ledger.key"))
	wb, _ := os.ReadFile(filepath.Join(dir, "wallet.key"))
	ls := ledgerKey.Scalar()
	ws := walletKey.Scalar()
	defer ledger.Wipe(ls)
	defer ledger.Wipe(ws)
	if bytesContains(wb, hex.EncodeToString(ls)) || bytesContains(lb, hex.EncodeToString(ws)) {
		t.Fatal("key files are not isolated")
	}
	if _, err := s.Path("other"); err == nil {
		t.Fatal("unknown purpose")
	}
}

func bytesContains(b []byte, s string) bool {
	return strings.Contains(string(b), s)
}
