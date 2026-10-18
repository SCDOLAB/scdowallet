package agent

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

func TestSeqPersistsAndAgentsStayIsolated(t *testing.T) {
	root := t.TempDir()
	payout := "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
	a, err := Create(root, "alpha", payout, "alpha", "", "ref-a", "src-a", nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := Create(root, "beta", payout, "beta", RoleServer, "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if a.Meta.Address == b.Meta.Address {
		t.Fatal("agents share an address")
	}
	if a.Meta.Code != CodeLight || b.Meta.Code != CodeServer {
		t.Fatalf("codes %s %s", a.Meta.Code, b.Meta.Code)
	}
	if a.Meta.Role != RoleLight || a.Meta.Platform != Platform {
		t.Fatalf("meta %+v", a.Meta)
	}
	keyPath := filepath.Join(a.Dir, "keys", "ledger.key")
	st, err := os.Stat(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("key mode %o", st.Mode().Perm())
	}
	if mode(filepath.Join(a.Dir, "keys")) != 0o700 {
		t.Fatalf("keys dir mode %o", mode(filepath.Join(a.Dir, "keys")))
	}
	seq1, err := a.NextSeq()
	if err != nil || seq1 != 1 {
		t.Fatalf("seq %d %v", seq1, err)
	}
	re, err := Open(root, "alpha")
	if err != nil {
		t.Fatal(err)
	}
	seq2, err := re.NextSeq()
	if err != nil || seq2 != 2 {
		t.Fatalf("reloaded seq %d %v", seq2, err)
	}
	bseq, err := b.NextSeq()
	if err != nil || bseq != 1 {
		t.Fatalf("beta seq %d %v", bseq, err)
	}
	aKey, err := os.ReadFile(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := filepath.Walk(b.Dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		blob, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.Contains(string(blob), string(aKey)) {
			t.Fatalf("beta file %s contains alpha key", path)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(root, "alpha", payout, "", "", "", "", nil); err != ErrExists {
		t.Fatalf("second init %v", err)
	}
	metaBlob, _ := os.ReadFile(filepath.Join(a.Dir, "meta.json"))
	if strings.Contains(string(metaBlob), `"key"`) {
		t.Fatal("meta contains a key field")
	}
}

func TestServiceRegisterAndHeartbeat(t *testing.T) {
	root := t.TempDir()
	lay, err := Create(root, "node1", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "lab", "", "ref1", "src1", nil)
	if err != nil {
		t.Fatal(err)
	}
	key, err := lay.OpenKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	var seen []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var env map[string]any
		if err := json.Unmarshal(body, &env); err != nil {
			http.Error(w, "json", 400)
			return
		}
		env["_path"] = r.URL.Path
		seen = append(seen, env)
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}))
	defer srv.Close()
	var logs []string
	svc := &Service{
		Layout:     lay,
		Key:        key,
		Version:    "0.1.0",
		Interval:   time.Hour,
		RetryEvery: time.Millisecond,
		Client:     &ledger.Client{URLs: []string{srv.URL + "/agent-ledger/api"}},
		Now:        func() int64 { return 1700000000000 },
		Sleep:      func(time.Duration) {},
		Log:        func(s string) { logs = append(logs, s) },
	}
	if !svc.Tick(context.Background()) || !svc.Tick(context.Background()) {
		t.Fatalf("ticks failed, logs %v", logs)
	}
	if len(seen) != 3 {
		t.Fatalf("posts %d", len(seen))
	}
	if seen[0]["_path"] != "/agent-ledger/api/register" || seen[1]["_path"] != "/agent-ledger/api/heartbeat" || seen[2]["_path"] != "/agent-ledger/api/heartbeat" {
		t.Fatalf("paths %v %v %v", seen[0]["_path"], seen[1]["_path"], seen[2]["_path"])
	}
	reg := payloadOf(t, seen[0])
	if reg["type"] != "register" || reg["chainId"] != float64(5680) || reg["seq"] != float64(1) {
		t.Fatalf("register payload %#v", reg)
	}
	body := reg["body"].(map[string]any)
	if body["platform"] != "linux" || body["role"] != "light-node" || body["code"] != nil {
		t.Fatalf("register body %#v", body)
	}
	if body["ref"] != "ref1" || body["src"] != "src1" || body["payout"] == "" {
		t.Fatalf("register extras %#v", body)
	}
	hb := payloadOf(t, seen[1])["body"].(map[string]any)
	if hb["code"] != "light" || hb["version"] != "0.1.0" {
		t.Fatalf("heartbeat %#v", hb)
	}
	if payloadOf(t, seen[2])["seq"] != float64(3) {
		t.Fatal("seq did not advance")
	}
	joined := strings.Join(logs, "\n")
	raw, _ := os.ReadFile(filepath.Join(lay.Dir, "keys", "ledger.key"))
	var doc struct {
		Key string `json:"key"`
	}
	_ = json.Unmarshal(raw, &doc)
	if doc.Key != "" && strings.Contains(joined, strings.TrimPrefix(doc.Key, "0x")) {
		t.Fatal("log contains key")
	}
}

func payloadOf(t *testing.T, env map[string]any) map[string]any {
	t.Helper()
	p, ok := env["payload"].(map[string]any)
	if !ok {
		t.Fatalf("no payload %#v", env)
	}
	return p
}

func mode(path string) os.FileMode {
	st, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return st.Mode().Perm()
}

func TestLockAndLabel(t *testing.T) {
	root := t.TempDir()
	lay, err := Create(root, "lock1", "0x0000000000000000000000000000000000000001", "", "", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if lay.Meta.Label != "lock1" {
		t.Fatal(lay.Meta.Label)
	}
	long := CutLabel("n", strings.Repeat("字", 50))
	if len([]rune(long)) != 40 {
		t.Fatal(long)
	}
	unlock, err := lay.LockRun()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lay.LockRun(); err != ErrRunning {
		t.Fatalf("second lock %v", err)
	}
	unlock()
}
