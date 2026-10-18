package update

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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

func TestFilesArchFallsBackAndRejectsTamper(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	amd := strings.Repeat("cd", 32)
	arm := strings.Repeat("ef", 32)
	flat := strings.Repeat("ab", 32)
	obj := map[string]any{
		"arch":    "amd64",
		"sha256":  flat,
		"size":    10,
		"url":     "https://scdo.com.au/downloads/wallet/linux/scdo-agent_0.5.0_linux_amd64.tar.gz",
		"version": "0.5.0",
		"files": map[string]any{
			"amd64": map[string]any{
				"sha256": amd,
				"size":   11,
				"url":    "https://scdo.com.au/downloads/wallet/linux/scdo-agent_0.5.0_linux_amd64.tar.gz",
				"deb": map[string]any{
					"sha256": strings.Repeat("11", 32),
					"size":   3,
					"url":    "https://scdo.com.au/downloads/wallet/linux/scdo-agent_0.5.0_linux_amd64.deb",
				},
			},
			"arm64": map[string]any{
				"sha256": arm,
				"size":   12,
				"url":    "https://scdo.com.au/downloads/wallet/linux/scdo-agent_0.5.0_linux_arm64.tar.gz",
			},
		},
	}
	msg, err := CanonicalManifest(obj)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, `"files"`) || strings.Contains(msg, `"signature"`) {
		t.Fatal(msg)
	}
	obj["signature"] = base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte(msg)))
	blob, err := json.Marshal(obj)
	if err != nil {
		t.Fatal(err)
	}
	pubB64 := base64.StdEncoding.EncodeToString(pub)
	armManifest, err := VerifyArch(blob, pubB64, "arm64")
	if err != nil {
		t.Fatal(err)
	}
	if armManifest.Arch != "arm64" || armManifest.SHA256 != arm || armManifest.Size != 12 {
		t.Fatalf("%+v", armManifest)
	}
	if !strings.HasSuffix(armManifest.URL, "linux_arm64.tar.gz") {
		t.Fatal(armManifest.URL)
	}
	amdManifest, err := VerifyArch(blob, pubB64, "amd64")
	if err != nil {
		t.Fatal(err)
	}
	if amdManifest.Arch != "amd64" || amdManifest.SHA256 != amd || amdManifest.Size != 11 {
		t.Fatalf("files.amd64 not selected: %+v", amdManifest)
	}
	flatManifest, err := Verify(blob, pubB64)
	if err != nil {
		t.Fatal(err)
	}
	if flatManifest.SHA256 != flat || flatManifest.Arch != "amd64" || flatManifest.Size != 10 {
		t.Fatalf("flat fallback %+v", flatManifest)
	}
	delete(obj["files"].(map[string]any), "arm64")
	msg2, err := CanonicalManifest(obj)
	if err != nil {
		t.Fatal(err)
	}
	obj["signature"] = base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte(msg2)))
	blob2, _ := json.Marshal(obj)
	fell, err := VerifyArch(blob2, pubB64, "arm64")
	if err != nil {
		t.Fatal(err)
	}
	if fell.Arch != "amd64" || fell.SHA256 != flat {
		t.Fatalf("missing files.arm64 should use flat fields: %+v", fell)
	}
	obj["files"].(map[string]any)["arm64"] = map[string]any{
		"sha256": arm,
		"size":   12,
		"url":    "https://scdo.com.au/downloads/wallet/linux/tampered.tar.gz",
	}
	bad, _ := json.Marshal(obj)
	if _, err := VerifyArch(bad, pubB64, "arm64"); err == nil {
		t.Fatal("tampered files.arm64 was accepted")
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
