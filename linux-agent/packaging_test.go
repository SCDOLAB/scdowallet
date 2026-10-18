package main

import (
	"os"
	"os/exec"
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
	if !strings.Contains(string(ver), `Version = "0.2.0"`) {
		t.Fatal("version")
	}
	inst, _ := os.ReadFile("packaging/install.sh")
	if !strings.Contains(string(inst), `VERSION="0.2.0"`) {
		t.Fatal("install.sh version")
	}
	for _, needle := range []string{
		"scdo-agent-update.timer",
		"scdo-agent-boot.service",
		"RandomizedDelaySec=1h",
		"upgrade-now",
		"ExecStart=/usr/bin/scdo-agent upgrade-now",
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
}
