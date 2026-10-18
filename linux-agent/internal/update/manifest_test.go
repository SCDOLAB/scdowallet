package update

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestManifestMatchesDesktopCanonical(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fix struct {
		PublicKey string         `json:"publicKeyB64"`
		Canonical string         `json:"canonical"`
		Manifest  map[string]any `json:"manifest"`
	}
	if err := json.Unmarshal(raw, &fix); err != nil {
		t.Fatal(err)
	}
	got, err := CanonicalManifest(fix.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	if got != fix.Canonical {
		t.Fatalf("canonical\n got %s\nwant %s", got, fix.Canonical)
	}
	blob, err := json.Marshal(fix.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	m, err := Verify(blob, fix.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	if m.Version != "0.2.0" || m.Arch != "amd64" || m.Size != 12 {
		t.Fatalf("%+v", m)
	}
	// Tamper after a valid signature.
	fix.Manifest["version"] = "9.9.9"
	bad, _ := json.Marshal(fix.Manifest)
	if _, err := Verify(bad, fix.PublicKey); err == nil {
		t.Fatal("tampered manifest was accepted")
	}
	// Production key rejects this test signature.
	if _, err := Verify(blob, PubKeyB64); err == nil {
		t.Fatal("production key accepted a test signature")
	}
	if PubKeyB64 != "4qt9g0KOI32agOxfEU+/W28zA8iRjt8pYSkcj/VTW5k=" {
		t.Fatal("public key drifted from the desktop updater")
	}
}

func TestManifestRejectsOtherHosts(t *testing.T) {
	obj := map[string]any{
		"arch": "amd64", "sha256": "ab", "size": 1,
		"url": "https://82.223.19.88/node", "version": "0.2.0", "signature": "aa",
	}
	blob, _ := json.Marshal(obj)
	if _, err := Verify(blob, PubKeyB64); err == nil {
		t.Fatal("unsigned foreign url accepted")
	}
	for _, host := range []string{
		"https://scdoscan.io/downloads/wallet/linux/a.tar.gz",
		"http://scdo.com.au/downloads/wallet/linux/a.tar.gz",
		"https://example.com/a.tar.gz",
	} {
		if err := urlAllowed(host); err == nil {
			t.Fatal(host)
		}
	}
	if err := urlAllowed("https://scdo.com.au/downloads/wallet/linux/scdo-agent_0.2.0_linux_amd64.tar.gz"); err != nil {
		t.Fatal(err)
	}
}

func TestCompareVersions(t *testing.T) {
	if CompareVersions("0.2.0", "0.1.0") != 1 {
		t.Fatal("newer")
	}
	if CompareVersions("0.1.0", "0.2.0") != -1 {
		t.Fatal("older")
	}
	if CompareVersions("1.0.0", "1.0.0-beta.1") != 1 {
		t.Fatal("release beats pre")
	}
	if CompareVersions("1.0.0", "1.0.0") != 0 {
		t.Fatal("equal")
	}
}
