package wallet

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
)

// 0.5.8: wallet create --network base binds Base mainnet (and Base Sepolia with the same key);
// pay settles Base mainnet USDC (eip155:8453) and books /ledger/spend on eip155:8453.
func TestBaseMainnetCreateAndPay(t *testing.T) {
	var bindBody, spendBody map[string]any
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
		}
		w.Header().Set("content-type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/agents/") {
			_, _ = w.Write([]byte(`{"ok":true,"summary":{"frozen":null}}`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer ledgerSrv.Close()
	root := t.TempDir()
	if _, err := agent.Create(root, "bot", "0x52908400098527886e0f7030069857d2e4169ee7", "TEST", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	created, err := Create(context.Background(), CreateOptions{Root: root, Name: "bot", BotID: "dfa", Network: NetworkBase, LedgerURLs: []string{ledgerSrv.URL}})
	if err != nil {
		t.Fatal(err)
	}
	if created.Network != NetworkBase {
		t.Fatal(created.Network)
	}
	wallets, _ := bindBody["wallets"].(map[string]any)
	proofs, _ := bindBody["walletProofs"].(map[string]any)
	if wallets[NetworkBase] != created.Wallet || wallets[NetworkSepolia] != created.Wallet || proofs[NetworkBase] == nil || proofs[NetworkSepolia] == nil {
		t.Fatalf("wallets %#v proofs %#v", wallets, proofs)
	}

	tx := "0x" + strings.Repeat("cd", 32)
	cap := &payCapture{}
	srv := paymentServerOffer(t, tx, paymentOffer{network: NetworkBase, asset: BaseUSDC, amount: "100000", name: BaseUSDCName, version: BaseUSDCVersion, timeout: 60}, cap)
	defer srv.Close()
	paid, err := Pay(context.Background(), PayOptions{Root: root, Name: "bot", URL: srv.URL, LedgerURLs: []string{ledgerSrv.URL}})
	if err != nil {
		t.Fatal(err)
	}
	if paid.Basescan != "https://basescan.org/tx/"+tx || cap.network != NetworkBase {
		t.Fatalf("%+v %s", paid, cap.network)
	}
	if spendBody["network"] != NetworkBase || spendBody["amount"] != "100000" || spendBody["tx"] != tx {
		t.Fatalf("spend %#v", spendBody)
	}

	// A Base Sepolia challenge is refused while paying with the base wallet's default network.
	sep := paymentServer(t, tx, NetworkSepolia, "10000", 60, nil)
	defer sep.Close()
	if _, err := Pay(context.Background(), PayOptions{Root: root, Name: "bot", URL: sep.URL, LedgerURLs: []string{ledgerSrv.URL}}); err == nil || !errors.Is(err, ErrPolicy) {
		t.Fatal(err)
	}
	// --network base-sepolia selects Sepolia explicitly.
	if _, err := ParseNetwork("base-sepolia"); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseNetwork("ethereum"); err == nil {
		t.Fatal("unknown network accepted")
	}
}
