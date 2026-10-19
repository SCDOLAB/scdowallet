package cli

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
	code := Main([]string{"--data-dir", dir, "init", "--name", "a", "--payout", "0x52908400098527886e0f7030069857d2e4169ee7", "--label", "TEST"}, &out, &errb)
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
	code = Main([]string{"--data-dir", dir, "init", "--name", "b", "--payout", "0x52908400098527886e0f7030069857d2e4169ee7", "--role", "server-node"}, &out, &errb)
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
	if code := Main([]string{"--data-dir", dir, "init", "--name", "a", "--payout", "0x52908400098527886e0f7030069857d2e4169ee7"}, &out, &errb); code == 0 {
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
	if code := Main([]string{"--data-dir", dir, "init", "--name", "s", "--payout", "0x52908400098527886E0F7030069857D2E4169EE7"}, &out, &errb); code != 0 {
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
	if !strings.Contains(text, "0.5.7") || !strings.Contains(text, "https://github.com/coinbase/x402") || !strings.Contains(text, "Apache-2.0") || !strings.Contains(text, "Copyright 2026 x402 Foundation") {
		t.Fatal(text)
	}
	for _, args := range [][]string{{"--version"}, {"-v"}, {"--lang", "zh", "--version"}} {
		out.Reset()
		errb.Reset()
		if code := Main(args, &out, &errb); code != 0 {
			t.Fatalf("%v code %d %s", args, code, errb.String())
		}
		if !strings.Contains(out.String(), "0.5.7") || !strings.Contains(out.String(), "https://github.com/coinbase/x402") {
			t.Fatalf("%v %s", args, out.String())
		}
	}
	out.Reset()
	errb.Reset()
	if code := Main([]string{"--not-a-flag"}, &out, &errb); code != 2 || !strings.Contains(errb.String(), "help") {
		t.Fatalf("unknown flag code %d %q", code, errb.String())
	}
}

func TestUserInstallDefaultsDataDir(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("SCDO_AGENT_MODE", "")
	t.Setenv("SCDO_AGENT_DATA", "")
	t.Setenv("SCDO_AGENT_PASSPHRASE_FILE", "")
	data := filepath.Join(home, ".local", "share", "scdo-agent")
	if err := os.MkdirAll(data, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(data, "install-scope"), []byte("user\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var out, errb bytes.Buffer
	if code := Main([]string{"init", "--name", "rack", "--payout", "0x52908400098527886e0f7030069857d2e4169ee7"}, &out, &errb); code != 0 {
		t.Fatal(errb.String())
	}
	if _, err := os.Stat(filepath.Join(data, "rack", "meta.json")); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "systemctl --user") {
		t.Fatal(out.String())
	}
	out.Reset()
	if code := Main([]string{"logs", "--name", "rack"}, &out, &errb); code != 0 || !strings.Contains(out.String(), "journalctl --user") {
		t.Fatalf("%d %s", code, out.String())
	}
}

func TestUpgradeNowNeedsRoot(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root")
	}
	var out, errb bytes.Buffer
	t.Setenv("SCDO_AGENT_MODE", "")
	t.Setenv("HOME", t.TempDir())
	code := Main([]string{"upgrade-now"}, &out, &errb)
	if code != 1 || !strings.Contains(errb.String(), "root") {
		t.Fatalf("code %d out %q err %q", code, out.String(), errb.String())
	}
	out.Reset()
	if code := Main([]string{"help"}, &out, &errb); code != 0 || !strings.Contains(out.String(), "upgrade-now") {
		t.Fatal(out.String())
	}
}

func TestWalletCommands(t *testing.T) {
	t.Setenv("SCDO_AGENT_PASSPHRASE_FILE", "")
	t.Setenv("SCDO_AGENT_LEDGER", "")
	dir := t.TempDir()
	ledgerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"summary":{"frozen":null}}`))
	}))
	defer ledgerSrv.Close()
	var out, errb bytes.Buffer
	if code := Main([]string{"--data-dir", dir, "init", "--name", "bot", "--payout", "0x52908400098527886e0f7030069857d2e4169ee7"}, &out, &errb); code != 0 {
		t.Fatal(errb.String())
	}
	out.Reset()
	errb.Reset()
	if code := Main([]string{"--data-dir", dir, "wallet", "create", "--bot", "bot", "--email", "Bot@Example.com", "--ledger", ledgerSrv.URL}, &out, &errb); code != 0 {
		t.Fatal(errb.String())
	}
	if !strings.Contains(out.String(), "Email commitment:") || strings.Contains(strings.ToLower(out.String()), "bot@example.com") {
		t.Fatal(out.String())
	}
	if !strings.Contains(out.String(), "Your keys stay on your machine") {
		t.Fatal(out.String())
	}
	out.Reset()
	if code := Main([]string{"--data-dir", dir, "wallet", "show", "--bot", "bot"}, &out, &errb); code != 0 || !strings.Contains(out.String(), "eip155:84532") {
		t.Fatal(out.String(), errb.String())
	}
	out.Reset()
	if code := Main([]string{"--data-dir", dir, "wallet", "limit", "--bot", "bot", "--per-payment", "0.000001", "--daily", "1", "--allow-domain", "api.example.com"}, &out, &errb); code != 0 {
		t.Fatal(errb.String())
	}
	if !strings.Contains(out.String(), "0.000001") {
		t.Fatal(out.String())
	}
	paySrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := []byte(`{"x402Version":2,"accepts":[{"scheme":"exact","network":"eip155:84532","amount":"10000","asset":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","payTo":"0xE3837fE309618AE075DbeF0A20735c0615a308E6","maxTimeoutSeconds":60,"extra":{"name":"USDC","version":"2"}}]}`)
		w.Header().Set("Payment-Required", base64.StdEncoding.EncodeToString(raw))
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write(raw)
	}))
	defer paySrv.Close()
	out.Reset()
	errb.Reset()
	code := Main([]string{"--data-dir", dir, "pay", paySrv.URL, "--bot", "bot", "--dry-run", "--ledger", ledgerSrv.URL}, &out, &errb)
	if code != 3 || !strings.Contains(errb.String(), "Payment stopped") && !strings.Contains(errb.String(), "per-payment") && !strings.Contains(errb.String(), "allowlist") {
		t.Fatalf("code %d out %q err %q", code, out.String(), errb.String())
	}
	pass := dir + "/export.pass"
	if err := os.WriteFile(pass, []byte("export-secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	errb.Reset()
	ks := dir + "/ks.json"
	if code := Main([]string{"--data-dir", dir, "wallet", "export", "--bot", "bot", "--out", ks, "--export-passphrase-file", pass}, &out, &errb); code != 0 {
		t.Fatal(errb.String())
	}
	blob, err := os.ReadFile(ks)
	if err != nil || !bytes.Contains(blob, []byte(`"crypto"`)) || bytes.Contains(bytes.ToLower(blob), []byte("privatekey")) {
		t.Fatal(string(blob), err)
	}
	out.Reset()
	errb.Reset()
	if code := Main([]string{"--data-dir", dir, "wallet", "export", "--bot", "bot", "--raw", "--i-understand-raw-key"}, &out, &errb); code == 0 || strings.Contains(out.String(), "0x") && len(strings.TrimSpace(out.String())) == 66 {
		t.Fatalf("raw key printed off a terminal: %q %q", out.String(), errb.String())
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
