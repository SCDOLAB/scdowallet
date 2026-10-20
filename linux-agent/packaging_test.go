package main

import (
	"os"
	"strings"
	"testing"
)

func TestPackagingCopy(t *testing.T) {
	files := []string{
		"packaging/install.sh",
		"packaging/scdo-agent@.service",
		"packaging/postinstall.sh",
		"README.md",
		"scripts/package.sh",
	}
	var all string
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		all += string(b)
	}
	if strings.Contains(all, "scdoscan.io") {
		t.Fatal("packaging must not reference scdoscan.io")
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
	if !strings.Contains(string(ver), `Version = "0.1.0"`) {
		t.Fatal("version")
	}
	inst, _ := os.ReadFile("packaging/install.sh")
	if !strings.Contains(string(inst), `VERSION="0.1.0"`) {
		t.Fatal("install.sh version")
	}
}
