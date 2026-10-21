package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

func TestNodeSampler(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var q struct{ Method string }
		_ = json.NewDecoder(r.Body).Decode(&q)
		res := map[string]any{"eth_chainId": "0x1630", "net_peerCount": "0x3",
			"eth_getBlockByNumber": map[string]any{"number": "0x10", "hash": "0xAB"},
			"admin_nodeInfo":       map[string]any{"id": "abc"}}[q.Method]
		_ = json.NewEncoder(w).Encode(map[string]any{"result": res})
	}))
	defer srv.Close()
	n := newNodeSampler()
	n.urls = []string{srv.URL}
	n.sample(context.Background(), 1000)
	b := map[string]any{}
	n.addTo(b)
	if b["head_block"] != int64(16) || b["head_hash"] != "0xab" || b["peer_count"] != 3 || b["enode"] != "abc" {
		t.Fatalf("%v", b)
	}
	if _, err := ledger.Canonical(b); err != nil {
		t.Fatal(err)
	}
	n.sample(context.Background(), 2000)
	n.clear()
	if len(n.samples) != 1 {
		t.Fatal(len(n.samples))
	}
	none := newNodeSampler()
	none.urls = []string{"http://127.0.0.1:1"}
	none.sample(context.Background(), 1)
	e := map[string]any{}
	none.addTo(e)
	if len(e) != 0 {
		t.Fatal(e)
	}
}
