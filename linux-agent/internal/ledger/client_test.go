package ledger

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSanitizeBase(t *testing.T) {
	got, err := SanitizeBase("https://scdo.com.au/agent-ledger/api/")
	if err != nil || got != "https://scdo.com.au/agent-ledger/api" {
		t.Fatalf("%s %v", got, err)
	}
	if _, err := SanitizeBase("https://scdoscan.io/agent-ledger/api"); err == nil {
		t.Fatal("scdoscan.io must be refused")
	}
	if _, err := SanitizeBase("https://evil.scdoscan.io/api"); err == nil {
		t.Fatal("subdomain must be refused")
	}
	if _, err := SanitizeBase("http://example.com/api"); err == nil {
		t.Fatal("plain http must be refused")
	}
	if _, err := SanitizeBase("https://user:pass@scdo.com.au/api"); err == nil {
		t.Fatal("userinfo must be refused")
	}
	urls, err := ResolveURLs("")
	if err != nil || len(urls) != 2 || urls[0] != DefaultLedger || urls[1] != FallbackLedger {
		t.Fatalf("%v %v", urls, err)
	}
	if !ShouldRetry(500) || !ShouldRetry(0) || ShouldRetry(400) || ShouldRetry(409) || ShouldRetry(413) {
		t.Fatal("retry policy")
	}
}

func TestPostFallback(t *testing.T) {
	var hits []string
	okSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, "ok"+r.URL.Path)
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "agent": "0xabc", "seq": 1})
	}))
	defer okSrv.Close()
	badSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, "bad"+r.URL.Path)
		http.Error(w, "nope", 500)
	}))
	defer badSrv.Close()
	c := &Client{URLs: []string{badSrv.URL, okSrv.URL}}
	key, err := KeyFromHex("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
	if err != nil {
		t.Fatal(err)
	}
	env, _, err := Sign(key, "heartbeat", 1, map[string]any{"version": "0.1.0", "code": "light"}, 1700000000000)
	if err != nil {
		t.Fatal(err)
	}
	res, err := c.Post(context.Background(), "heartbeat", env)
	if err != nil || !res.OK {
		t.Fatalf("%+v %v", res, err)
	}
	if !strings.HasPrefix(res.Ledger, okSrv.URL) {
		t.Fatalf("ledger %s", res.Ledger)
	}
	if c.URLs[0] != okSrv.URL {
		t.Fatalf("promote %v", c.URLs)
	}
	if len(hits) != 2 || !strings.Contains(hits[0], "/heartbeat") {
		t.Fatalf("hits %v", hits)
	}
}

func TestV21Paths(t *testing.T) {
	if pathFor("spend") != "ledger/spend" || pathFor("xrevoke") != "bind/x/revoke" || pathFor("batch") != "operator/batch" || pathFor("bind") != "bind" {
		t.Fatal("paths")
	}
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.URL.RequestURI()
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	c := &Client{URLs: []string{srv.URL}}
	if _, err := c.OperatorAgents(context.Background(), "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"); err != nil {
		t.Fatal(err)
	}
	if got != "/operators/0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266/agents" {
		t.Fatal(got)
	}
	if _, err := c.Agents(context.Background(), "linux", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "platform=linux") || !strings.Contains(got, "operator=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266") {
		t.Fatal(got)
	}
}
