package reconcile

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
)

type sys struct {
	enabled []string
	stopped []string
}

func (s *sys) EnableNow(name string) error {
	s.enabled = append(s.enabled, name)
	return nil
}
func (s *sys) Stop(name string) error {
	s.stopped = append(s.stopped, name)
	return nil
}

type probe struct {
	have map[string]bool
	out  map[string]string
	fail map[string]bool
}

func (p probe) Look(name string) bool { return p.have[name] }
func (p probe) Run(name string, args ...string) ([]byte, error) {
	key := name + " " + strings.Join(args, " ")
	if p.fail[key] || p.fail[name] {
		return []byte("failed"), errors.New("failed")
	}
	if s, ok := p.out[key]; ok {
		return []byte(s), nil
	}
	if s, ok := p.out[name]; ok {
		return []byte(s), nil
	}
	return nil, errors.New("missing")
}

func TestBindingsAreIdempotent(t *testing.T) {
	root := t.TempDir()
	cfg := t.TempDir()
	if _, err := agent.Create(root, "alice", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "TEST", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	toml := "[[account]]\nhandle = \"alice\"\nuser_id = \"42\"\nagent = \"alice\"\n"
	if err := os.WriteFile(filepath.Join(cfg, "x-accounts.toml"), []byte(toml), 0o644); err != nil {
		t.Fatal(err)
	}
	none := probe{have: map[string]bool{"lspci": true}, out: map[string]string{"lspci -nn": "00:00.0 Host bridge: Intel\n"}}
	host := &sys{}
	opt := Options{DataRoot: root, ConfigDir: cfg, Probe: none, System: host}
	if err := Run(context.Background(), opt); err != nil {
		t.Fatal(err)
	}
	key := readFile(t, filepath.Join(root, "alice", "keys", "ledger.key"))
	if err := Run(context.Background(), opt); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(key, readFile(t, filepath.Join(root, "alice", "keys", "ledger.key"))) {
		t.Fatal("ledger key rewritten")
	}
	if len(host.enabled) != 0 {
		t.Fatalf("upgrade started an agent: %v", host.enabled)
	}
	toml = "[[account]]\nhandle = \"alice2\"\nuser_id = \"42\"\nagent = \"alice\"\n"
	if err := os.WriteFile(filepath.Join(cfg, "x-accounts.toml"), []byte(toml), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Run(context.Background(), opt); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(key, readFile(t, filepath.Join(root, "alice", "keys", "ledger.key"))) {
		t.Fatal("key changed when the handle changed")
	}
	meta := string(readFile(t, filepath.Join(root, "alice", "meta.json")))
	if !strings.Contains(meta, "alice2") {
		t.Fatal(meta)
	}
}

func TestUpgradeDoesNotCreateAgents(t *testing.T) {
	root := t.TempDir()
	cfg := t.TempDir()
	if err := os.WriteFile(filepath.Join(cfg, "config.toml"), []byte("payout = \"0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	toml := "[[account]]\nhandle = \"alice\"\nuser_id = \"42\"\nagent = \"alice\"\n"
	if err := os.WriteFile(filepath.Join(cfg, "x-accounts.toml"), []byte(toml), 0o644); err != nil {
		t.Fatal(err)
	}
	withCard := probe{
		have: map[string]bool{"nvidia-smi": true},
		out:  map[string]string{"nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader,nounits": "0, NVIDIA GeForce 940MX, 2048\n"},
	}
	host := &sys{}
	var logs []string
	opt := Options{DataRoot: root, ConfigDir: cfg, Probe: withCard, System: host, Log: func(s string) { logs = append(logs, s) }}
	if err := Run(context.Background(), opt); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "gpu0")); !os.IsNotExist(err) {
		t.Fatal("gpu0 was created")
	}
	if _, err := os.Stat(filepath.Join(root, "alice")); !os.IsNotExist(err) {
		t.Fatal("x-account agent was created")
	}
	if len(host.enabled) != 0 {
		t.Fatalf("started %v", host.enabled)
	}
	text := strings.Join(logs, "\n")
	if !strings.Contains(text, "gpu0") || !strings.Contains(text, "does not create agents") || !strings.Contains(text, "alice") {
		t.Fatal(text)
	}
}

func TestGPUGoneKeepsDirectory(t *testing.T) {
	root := t.TempDir()
	cfg := t.TempDir()
	if err := os.WriteFile(filepath.Join(cfg, "config.toml"), []byte("payout = \"0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var reported int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/report" {
			http.NotFound(w, r)
			return
		}
		reported++
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	if _, err := agent.Create(root, "gpu0", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "old", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	withCard := probe{
		have: map[string]bool{"nvidia-smi": true},
		out:  map[string]string{"nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader,nounits": "0, NVIDIA GeForce 940MX, 2048\n"},
	}
	host := &sys{}
	opt := Options{DataRoot: root, ConfigDir: cfg, Probe: withCard, System: host, LedgerURLs: []string{srv.URL}}
	if err := Run(context.Background(), opt); err != nil {
		t.Fatal(err)
	}
	if len(host.enabled) != 0 {
		t.Fatalf("existing adapter was started by upgrade: %v", host.enabled)
	}
	key := readFile(t, filepath.Join(root, "gpu0", "keys", "ledger.key"))
	if !strings.Contains(string(readFile(t, filepath.Join(root, "gpu0", "meta.json"))), "940MX") {
		t.Fatal("model not recorded")
	}
	empty := probe{have: map[string]bool{"lspci": true}, out: map[string]string{"lspci -nn": "00:00.0 Host bridge: Intel\n"}}
	opt.Probe = empty
	if err := Run(context.Background(), opt); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(key, readFile(t, filepath.Join(root, "gpu0", "keys", "ledger.key"))) {
		t.Fatal("key removed or changed")
	}
	if len(host.stopped) != 1 || host.stopped[0] != "gpu0" {
		t.Fatalf("stopped %v", host.stopped)
	}
	if reported != 1 {
		t.Fatalf("reports %d", reported)
	}
	failed := probe{have: map[string]bool{"nvidia-smi": true}, fail: map[string]bool{
		"nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader,nounits": true,
		"nvidia-smi -L": true,
	}}
	opt.Probe = failed
	if err := Run(context.Background(), opt); err != nil {
		t.Fatal(err)
	}
	if len(host.stopped) != 1 {
		t.Fatalf("probe failure stopped again: %v", host.stopped)
	}
}

func TestIntelDoesNotCreateOrRewriteGPU(t *testing.T) {
	root := t.TempDir()
	cfg := t.TempDir()
	if _, err := agent.Create(root, "gpu0", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "old", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	before := readFile(t, filepath.Join(root, "gpu0", "meta.json"))
	key := readFile(t, filepath.Join(root, "gpu0", "keys", "ledger.key"))
	intel := probe{
		have: map[string]bool{"lspci": true},
		out:  map[string]string{"lspci -nn": "00:02.0 VGA compatible controller [0300]: Intel Corporation UHD Graphics 610\n"},
	}
	host := &sys{}
	var logs []string
	opt := Options{DataRoot: root, ConfigDir: cfg, Probe: intel, System: host, Log: func(s string) { logs = append(logs, s) }}
	if err := Run(context.Background(), opt); err != nil {
		t.Fatal(err)
	}
	if len(host.stopped) != 0 || len(host.enabled) != 0 {
		t.Fatalf("stopped %v enabled %v", host.stopped, host.enabled)
	}
	if !bytes.Equal(key, readFile(t, filepath.Join(root, "gpu0", "keys", "ledger.key"))) {
		t.Fatal("key changed")
	}
	if !bytes.Equal(before, readFile(t, filepath.Join(root, "gpu0", "meta.json"))) {
		t.Fatal("intel probe rewrote meta.json")
	}
	text := strings.Join(logs, "\n")
	if strings.Contains(text, "init --name gpu0") {
		t.Fatal(text)
	}
	empty := probe{have: map[string]bool{"lspci": true}, out: map[string]string{"lspci -nn": "00:00.0 Host bridge: Intel\n"}}
	opt.Probe = empty
	opt.Log = func(string) {}
	if _, err := os.Stat(filepath.Join(root, "gpu0")); err != nil {
		t.Fatal(err)
	}
	_ = Run(context.Background(), Options{DataRoot: t.TempDir(), ConfigDir: cfg, Probe: intel, Log: func(s string) { text = s }})
	if strings.Contains(text, "init --name") {
		t.Fatal(text)
	}
}

func readFile(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
