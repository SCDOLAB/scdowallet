package wallet

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
)

func TestBindPayAndRefuseMainnet(t *testing.T) {
	var bindBody map[string]any
	var spendBody map[string]any
	ledgerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var env map[string]any
		_ = json.Unmarshal(b, &env)
		payload, _ := env["payload"].(map[string]any)
		switch r.URL.Path {
		case "/bind":
			bindBody, _ = payload["body"].(map[string]any)
		case "/ledger/spend":
			spendBody, _ = payload["body"].(map[string]any)
		case "/agents/x":
		}
		if strings.HasPrefix(r.URL.Path, "/agents/") {
			w.Header().Set("content-type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"summary":{"frozen":null}}`))
			return
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer ledgerSrv.Close()

	root := t.TempDir()
	if _, err := agent.Create(root, "bot", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "TEST", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	created, err := Create(context.Background(), CreateOptions{
		Root: root, Name: "bot", BotID: "m1-bot", LedgerURLs: []string{ledgerSrv.URL}, Now: func() time.Time { return time.UnixMilli(1_800_000_000_000) },
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Wallet == "" || created.Wallet == created.Agent {
		t.Fatalf("wallet %s agent %s", created.Wallet, created.Agent)
	}
	wallets, _ := bindBody["wallets"].(map[string]any)
	if wallets[NetworkSepolia] != created.Wallet {
		t.Fatalf("wallets %#v", wallets)
	}
	if _, ok := wallets["eip155:8453"]; ok {
		t.Fatal("mainnet wallet must stay unbound")
	}
	proofs, _ := bindBody["walletProofs"].(map[string]any)
	if proofs[NetworkSepolia] == nil {
		t.Fatal("missing wallet proof")
	}
	if bindBody["botId"] != "m1-bot" {
		t.Fatal(bindBody["botId"])
	}

	tx := "0x" + strings.Repeat("ab", 32)
	paySrv := paymentServer(t, tx, NetworkSepolia, "10000")
	defer paySrv.Close()
	paid, err := Pay(context.Background(), PayOptions{
		Root: root, Name: "bot", URL: paySrv.URL, LedgerURLs: []string{ledgerSrv.URL},
	})
	if err != nil {
		t.Fatal(err)
	}
	if paid.Tx != tx || paid.Basescan != "https://sepolia.basescan.org/tx/"+tx {
		t.Fatalf("%+v", paid)
	}
	if spendBody["network"] != NetworkSepolia || spendBody["tx"] != tx || spendBody["amount"] != "10000" {
		t.Fatalf("spend %#v", spendBody)
	}
	if !strings.Contains(paid.Ledger, "/agents/"+created.Agent) {
		t.Fatal(paid.Ledger)
	}

	mainnet := paymentServer(t, tx, "eip155:8453", "10000")
	defer mainnet.Close()
	if _, err := Pay(context.Background(), PayOptions{Root: root, Name: "bot", URL: mainnet.URL, LedgerURLs: []string{ledgerSrv.URL}}); err == nil || !strings.Contains(err.Error(), "eip155:84532") {
		t.Fatal(err)
	}
}

func paymentServer(t *testing.T, tx, network, amount string) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Payment-Signature") == "" {
			raw, _ := json.Marshal(map[string]any{
				"x402Version": 2,
				"resource":    map[string]any{"url": srv.URL, "mimeType": "application/json"},
				"accepts": []any{map[string]any{
					"scheme": "exact", "network": network, "amount": amount,
					"asset": SepoliaUSDC, "payTo": "0xE3837fE309618AE075DbeF0A20735c0615a308E6",
					"maxTimeoutSeconds": 60,
					"extra":             map[string]any{"name": "USDC", "version": "2"},
				}},
			})
			w.Header().Set("Payment-Required", base64.StdEncoding.EncodeToString(raw))
			w.WriteHeader(http.StatusPaymentRequired)
			_, _ = w.Write(raw)
			return
		}
		raw, _ := json.Marshal(map[string]any{
			"success": true, "transaction": tx, "network": network, "payer": "0x0000000000000000000000000000000000000001",
		})
		w.Header().Set("Payment-Response", base64.StdEncoding.EncodeToString(raw))
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	return srv
}
