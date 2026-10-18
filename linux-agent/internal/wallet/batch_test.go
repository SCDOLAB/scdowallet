package wallet

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

func TestOperatorBatchSendsBindHashes(t *testing.T) {
	var got map[string]any
	var path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		var env map[string]any
		_ = json.Unmarshal(raw, &env)
		got, _ = env["payload"].(map[string]any)
		body, _ := got["body"].(map[string]any)
		echo, _ := body["merkleRoot"].(string)
		w.Header().Set("content-type", "application/json")
		out, _ := json.Marshal(map[string]any{"ok": true, "merkleRoot": echo})
		_, _ = w.Write(out)
	}))
	defer srv.Close()

	root := t.TempDir()
	if _, err := agent.Create(root, "op", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "TEST", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Create(root, "bot", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "TEST", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	op, err := agent.Open(root, "op")
	if err != nil {
		t.Fatal(err)
	}
	created, err := Create(context.Background(), CreateOptions{
		Root: root, Name: "bot", BotID: "bot", Operator: op.Meta.Address, LedgerURLs: []string{srv.URL},
	})
	if err != nil {
		t.Fatal(err)
	}
	doc, _, err := Export(root, "bot")
	if err != nil || len(doc.BindHash) != 66 || !strings.HasPrefix(doc.BindHash, "0x") {
		t.Fatal(doc.BindHash, err)
	}
	res, err := ConfirmBatch(context.Background(), BatchOptions{
		Root: root, Name: "op", Bots: []string{"bot"}, LedgerURLs: []string{srv.URL},
	})
	if err != nil || !res.OK {
		t.Fatal(err, res)
	}
	if path != "/operator/batch" || got["type"] != "batch" {
		t.Fatalf("path %s type %v", path, got["type"])
	}
	body, _ := got["body"].(map[string]any)
	agents, _ := body["agents"].([]any)
	if len(agents) != 1 || agents[0] != created.Agent {
		t.Fatalf("agents %#v", agents)
	}
	rootHash, err := ledger.MerkleRoot([]string{doc.BindHash})
	if err != nil || body["merkleRoot"] != rootHash || body["merkleRoot"] != doc.BindHash {
		t.Fatalf("root %v hash %s err %v", body["merkleRoot"], doc.BindHash, err)
	}
	if res.MerkleRoot != rootHash || !strings.Contains(res.Receipt, rootHash) {
		t.Fatalf("printed root %s receipt %s", res.MerkleRoot, res.Receipt)
	}
}
