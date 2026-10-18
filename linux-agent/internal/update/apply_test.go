package update

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRollbackRestoresBinaryAndLeavesKeys(t *testing.T) {
	root := t.TempDir()
	keyPath := filepath.Join(root, "rack", "keys", "ledger.key")
	if err := os.MkdirAll(filepath.Dir(keyPath), 0o700); err != nil {
		t.Fatal(err)
	}
	before := []byte("secret-key-material")
	if err := os.WriteFile(keyPath, before, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "rack", "meta.json"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(root, "bin", "scdo-agent")
	if err := os.MkdirAll(filepath.Dir(bin), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bin, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	pack := tarGz(t, []byte("new-binary"))
	raw, pub := signed(t, pack)
	when := time.Date(2026, 10, 18, 3, 0, 0, 0, time.UTC)
	var restarts []string
	out, err := Apply(context.Background(), Config{
		Version: "0.1.0", Arch: "amd64", Binary: bin, DataRoot: root, HealthWindow: 0,
		PubKey: pub,
	}, Deps{
		Now:       func() time.Time { return when },
		Fetch:     func(context.Context) ([]byte, error) { return raw, nil },
		Download:  func(context.Context, Manifest) ([]byte, error) { return pack, nil },
		ListUnits: func() ([]string, error) { return []string{"rack"}, nil },
		Restart: func(name string) error {
			restarts = append(restarts, name)
			return nil
		},
		Active:    func(string) bool { return false },
		Heartbeat: func(string) (time.Time, bool) { return time.Time{}, false },
	})
	if err != nil {
		t.Fatal(err)
	}
	if out != OutcomeRolledBack {
		t.Fatalf("outcome %s", out)
	}
	got, err := os.ReadFile(bin)
	if err != nil || string(got) != "old-binary" {
		t.Fatalf("binary %q %v", got, err)
	}
	after, err := os.ReadFile(keyPath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("ledger key changed")
	}
	backupKey := filepath.Join(root, "backups", "20261018T030000Z", "agents", "rack", "keys", "ledger.key")
	copied, err := os.ReadFile(backupKey)
	if err != nil || !bytes.Equal(before, copied) {
		t.Fatal("backup is missing the key copy")
	}
	if len(restarts) < 1 || restarts[0] != "rack" {
		t.Fatalf("restarts %v", restarts)
	}
	doc, ok, err := LoadResult(root)
	if err != nil || !ok || doc.Outcome != "rolled-back" || doc.From != "0.1.0" || doc.To != "0.2.0" {
		t.Fatalf("%+v %v", doc, err)
	}
}

func TestUpdateSwapsWhenHealthyAndPrunes(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "scdo-agent")
	if err := os.WriteFile(bin, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	for i, name := range []string{"20200101T000000Z", "20200102T000000Z", "20200103T000000Z", "20200104T000000Z", "20200105T000000Z"} {
		if err := os.MkdirAll(filepath.Join(root, "backups", name), 0o700); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			if err := os.WriteFile(filepath.Join(root, "backups", name, "marker"), []byte("old"), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := os.MkdirAll(filepath.Join(root, "backups", "notes"), 0o700); err != nil {
		t.Fatal(err)
	}
	pack := tarGz(t, []byte("new-binary"))
	raw, pub := signed(t, pack)
	when := time.Date(2026, 10, 18, 4, 0, 0, 0, time.UTC)
	out, err := Apply(context.Background(), Config{
		Version: "0.1.0", Arch: "amd64", Binary: bin, DataRoot: root, HealthWindow: time.Minute, PubKey: pub,
	}, Deps{
		Now:       func() time.Time { return when },
		Fetch:     func(context.Context) ([]byte, error) { return raw, nil },
		Download:  func(context.Context, Manifest) ([]byte, error) { return pack, nil },
		ListUnits: func() ([]string, error) { return []string{"a", "b"}, nil },
		Restart:   func(string) error { return nil },
		Active:    func(string) bool { return true },
		Heartbeat: func(string) (time.Time, bool) { return when, true },
	})
	if err != nil || out != OutcomeUpdated {
		t.Fatalf("%s %v", out, err)
	}
	got, _ := os.ReadFile(bin)
	if string(got) != "new-binary" {
		t.Fatalf("binary %s", got)
	}
	entries, _ := os.ReadDir(filepath.Join(root, "backups"))
	var stamped int
	for _, e := range entries {
		if backupName.MatchString(e.Name()) {
			stamped++
		}
	}
	if stamped != 5 {
		t.Fatalf("backups %d", stamped)
	}
	if _, err := os.Stat(filepath.Join(root, "backups", "20200101T000000Z")); !os.IsNotExist(err) {
		t.Fatal("oldest backup was kept")
	}
	if _, err := os.Stat(filepath.Join(root, "backups", "notes")); err != nil {
		t.Fatal("non-backup directory removed")
	}
	if _, err := os.Stat(filepath.Join(root, "backups", "20261018T040000Z", "scdo-agent")); err != nil {
		t.Fatal("new backup missing")
	}
}

func TestBadSignatureDoesNotReplace(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "scdo-agent")
	if err := os.WriteFile(bin, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	_, err := Apply(context.Background(), Config{
		Version: "0.1.0", Arch: "amd64", Binary: bin, DataRoot: root, PubKey: PubKeyB64,
	}, Deps{
		Fetch: func(context.Context) ([]byte, error) {
			return []byte(`{"version":"9.9.9","signature":"aaaa"}`), nil
		},
		Download: func(context.Context, Manifest) ([]byte, error) { t.Fatal("downloaded"); return nil, nil },
	})
	if err == nil {
		t.Fatal("expected signature error")
	}
	got, _ := os.ReadFile(bin)
	if string(got) != "old-binary" {
		t.Fatal("binary replaced")
	}
}

func tarGz(t *testing.T, bin []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	if err := tw.WriteHeader(&tar.Header{Name: "scdo-agent", Mode: 0o755, Size: int64(len(bin))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(bin); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func signed(t *testing.T, pack []byte) ([]byte, string) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	obj := map[string]any{
		"arch":    "amd64",
		"sha256":  SumHex(pack),
		"size":    len(pack),
		"url":     "https://scdo.com.au/downloads/wallet/linux/scdo-agent_0.2.0_linux_amd64.tar.gz",
		"version": "0.2.0",
	}
	msg, err := CanonicalManifest(obj)
	if err != nil {
		t.Fatal(err)
	}
	obj["signature"] = base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte(msg)))
	blob, err := json.Marshal(obj)
	if err != nil {
		t.Fatal(err)
	}
	return blob, base64.StdEncoding.EncodeToString(pub)
}
