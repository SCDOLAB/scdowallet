package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestPackagingCopy(t *testing.T) {
	files := []string{
		"packaging/install.sh",
		"packaging/scdo-agent@.service",
		"packaging/scdo-agent-update.service",
		"packaging/scdo-agent-update.timer",
		"packaging/scdo-agent-boot.service",
		"packaging/postinstall.sh",
		"README.md",
		"scripts/package.sh",
		"scripts/rig-hook.sh",
	}
	var all string
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		all += string(b)
	}
	if strings.Contains(all, "scdoscan.io") || strings.Contains(all, "82.223.19.88") {
		t.Fatal("packaging must not reference a rejected host")
	}
	if !strings.Contains(all, "https://scdo.com.au/downloads/wallet/linux") {
		t.Fatal("install base missing")
	}
	if !strings.Contains(all, "sha256sum") || !strings.Contains(all, "scdo-agent@.service") {
		t.Fatal("installer incomplete")
	}
	if !strings.Contains(all, "https://apeccapital.org") || !strings.Contains(all, "https://scdo.com.au") {
		t.Fatal("ledger bases missing from docs")
	}
	lower := strings.ToLower(all)
	if strings.Contains(lower, "mining") || strings.Contains(all, "中文") || strings.Contains(all, "挖礦") || strings.Contains(all, "礦") {
		t.Fatal("packaging copy uses forbidden wording")
	}
	ver, err := os.ReadFile("internal/buildinfo/version.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(ver), `Version = "0.4.0"`) {
		t.Fatal("version")
	}
	inst, _ := os.ReadFile("packaging/install.sh")
	if !strings.Contains(string(inst), `VERSION="0.4.0"`) {
		t.Fatal("install.sh version")
	}
	for _, needle := range []string{
		"scdo-agent-update.timer",
		"scdo-agent-boot.service",
		"RandomizedDelaySec=1h",
		"upgrade-now",
		"ExecStart=/usr/bin/scdo-agent upgrade-now",
		"0xe1A6728e467ed9Fa2F2d0d7eE425a95c9d941F4d",
		"0xeB49023E929bb71A4818924DffC46Eb8B46546c4",
		"0x5bc80C209263Fe4F0455c76eC41F663E62D814dF",
	} {
		if !strings.Contains(all, needle) {
			t.Fatal("missing " + needle)
		}
	}
	for _, f := range []string{"packaging/install.sh", "packaging/postinstall.sh", "scripts/package.sh", "scripts/rig-hook.sh"} {
		out, err := exec.Command("sh", "-n", f).CombinedOutput()
		if err != nil {
			t.Fatalf("%s: %s", f, out)
		}
	}
	if !strings.Contains(all, "https://github.com/coinbase/x402") || !strings.Contains(all, "Apache-2.0") || !strings.Contains(all, "Copyright 2026 x402 Foundation") {
		t.Fatal("x402 credit missing")
	}
	if !strings.Contains(all, "third_party/x402/LICENSE") || !strings.Contains(all, "x402-NOTICE") {
		t.Fatal("package does not ship the x402 licence")
	}
	for _, f := range []string{"third_party/x402/LICENSE", "third_party/x402/NOTICE"} {
		b, err := os.ReadFile(f)
		if err != nil || len(b) < 40 {
			t.Fatal(f)
		}
	}
	err = filepath.Walk(".", func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		if strings.HasPrefix(path, "third_party/") {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.Contains(string(b), "TransferWithAuthorization") {
			t.Fatalf("local EIP-3009 type in %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
