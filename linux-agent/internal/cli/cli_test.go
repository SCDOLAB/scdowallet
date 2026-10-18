package cli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/i18n"
)

func TestInitListLogsAndWording(t *testing.T) {
	t.Setenv("SCDO_AGENT_DATA", "")
	t.Setenv("SCDO_AGENT_LEDGER", "")
	t.Setenv("SCDO_AGENT_PASSPHRASE_FILE", "")
	t.Setenv("LANG", "C")
	t.Setenv("LC_ALL", "")
	dir := t.TempDir()
	var out, errb bytes.Buffer
	code := Main([]string{"--data-dir", dir, "init", "--name", "a", "--payout", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "--label", "TEST"}, &out, &errb)
	if code != 0 {
		t.Fatalf("init %d %s", code, errb.String())
	}
	text := out.String()
	if !strings.Contains(text, "Address: 0x") || !strings.Contains(text, "bookkeeping node") {
		t.Fatal(text)
	}
	raw := readKey(t, dir, "a")
	if strings.Contains(text, raw) || strings.Contains(errb.String(), raw) {
		t.Fatal("init printed the key")
	}
	out.Reset()
	errb.Reset()
	code = Main([]string{"--data-dir", dir, "init", "--name", "b", "--payout", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "--role", "server-node"}, &out, &errb)
	if code != 0 {
		t.Fatal(errb.String())
	}
	if strings.Contains(out.String(), raw) {
		t.Fatal("second init printed the first key")
	}
	out.Reset()
	if code := Main([]string{"--data-dir", dir, "list"}, &out, &errb); code != 0 {
		t.Fatal(errb.String())
	}
	if !strings.Contains(out.String(), "a  0x") || !strings.Contains(out.String(), "b  0x") {
		t.Fatal(out.String())
	}
	out.Reset()
	if code := Main([]string{"logs", "--name", "a"}, &out, &errb); code != 0 {
		t.Fatal(errb.String())
	}
	if !strings.Contains(out.String(), "journalctl -u scdo-agent@a.service -f") {
		t.Fatal(out.String())
	}
	out.Reset()
	errb.Reset()
	if code := Main([]string{"--data-dir", dir, "init", "--name", "a", "--payout", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"}, &out, &errb); code == 0 {
		t.Fatal("re-init should fail")
	}
	if strings.Contains(errb.String(), raw) {
		t.Fatal("re-init printed the key")
	}
	out.Reset()
	if code := Main([]string{"--lang", "zh", "help"}, &out, &errb); code != 0 {
		t.Fatal(code)
	}
	if !strings.Contains(out.String(), "華語") || strings.Contains(out.String(), "中文") {
		t.Fatal(out.String())
	}
	for lang, table := range i18n.Catalog() {
		for k, s := range table {
			if strings.Contains(s, "中文") || strings.Contains(strings.ToLower(s), "mining") || strings.Contains(s, "挖礦") || strings.Contains(s, "礦") {
				t.Fatalf("%s %s contains forbidden wording", lang, k)
			}
		}
	}
}

func TestStatusReadsLedger(t *testing.T) {
	t.Setenv("SCDO_AGENT_LEDGER", "")
	t.Setenv("SCDO_AGENT_PASSPHRASE_FILE", "")
	dir := t.TempDir()
	var out, errb bytes.Buffer
	if code := Main([]string{"--data-dir", dir, "init", "--name", "s", "--payout", "0x0000000000000000000000000000000000000001"}, &out, &errb); code != 0 {
		t.Fatal(errb.String())
	}
	addr := addrFrom(out.String())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/agent-ledger/api/agents/"+addr {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":      true,
			"summary": map[string]any{"agent": addr, "online": true, "code": "light"},
		})
	}))
	defer srv.Close()
	out.Reset()
	code := Main([]string{"--data-dir", dir, "status", "--name", "s", "--ledger", srv.URL + "/agent-ledger/api"}, &out, &errb)
	if code != 0 {
		t.Fatalf("status %d %s %s", code, out.String(), errb.String())
	}
	if !strings.Contains(out.String(), "Online: true") || !strings.Contains(out.String(), addr) {
		t.Fatal(out.String())
	}
	out.Reset()
	errb.Reset()
	if code := Main([]string{"--lang", "zh", "--data-dir", dir, "status", "--name", "s", "--ledger", "https://scdoscan.io/agent-ledger/api"}, &out, &errb); code == 0 {
		t.Fatal("scdoscan must be refused")
	}
}

func TestLangFromLocale(t *testing.T) {
	if i18n.Detect("", "zh_TW.UTF-8", "en_US") != i18n.ZH {
		t.Fatal("LC_ALL")
	}
	if i18n.Detect("", "", "zh_CN.UTF-8") != i18n.ZH {
		t.Fatal("LANG")
	}
	if i18n.Detect("en", "zh_TW", "") != i18n.EN {
		t.Fatal("flag wins")
	}
	t.Setenv("LC_ALL", "")
	t.Setenv("LANG", "zh_HK.UTF-8")
	var out, errb bytes.Buffer
	Main([]string{"help"}, &out, &errb)
	if !strings.Contains(out.String(), "記帳代理") {
		t.Fatal(out.String())
	}
}

func addrFrom(s string) string {
	for _, line := range strings.Split(s, "\n") {
		if strings.Contains(line, "0x") {
			f := strings.Fields(line)
			return f[len(f)-1]
		}
	}
	return ""
}

func TestVersionCreditsX402(t *testing.T) {
	var out, errb bytes.Buffer
	if code := Main([]string{"version"}, &out, &errb); code != 0 {
		t.Fatal(errb.String())
	}
	text := out.String()
	if !strings.Contains(text, "0.3.0") || !strings.Contains(text, "https://github.com/coinbase/x402") || !strings.Contains(text, "Apache-2.0") || !strings.Contains(text, "Copyright 2026 x402 Foundation") {
		t.Fatal(text)
	}
}

func TestUpgradeNowNeedsRoot(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root")
	}
	var out, errb bytes.Buffer
	code := Main([]string{"upgrade-now"}, &out, &errb)
	if code != 1 || !strings.Contains(errb.String(), "root") {
		t.Fatalf("code %d out %q err %q", code, out.String(), errb.String())
	}
	out.Reset()
	if code := Main([]string{"help"}, &out, &errb); code != 0 || !strings.Contains(out.String(), "upgrade-now") {
		t.Fatal(out.String())
	}
}

func readKey(t *testing.T, root, name string) string {
	t.Helper()
	b, err := os.ReadFile(root + "/" + name + "/keys/ledger.key")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(b, &doc); err != nil || len(doc.Key) < 20 {
		t.Fatal("key file")
	}
	return doc.Key
}
