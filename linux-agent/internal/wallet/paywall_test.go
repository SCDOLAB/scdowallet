package wallet

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	x402 "github.com/x402-foundation/x402/go/v2"
	x402http "github.com/x402-foundation/x402/go/v2/http"
	"github.com/x402-foundation/x402/go/v2/types"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
)

func TestPaywall402RoundTrip(t *testing.T) {
	if FacilitatorURL != "https://x402.org/facilitator" || x402http.DefaultFacilitatorURL != FacilitatorURL {
		t.Fatal(FacilitatorURL)
	}
	root := t.TempDir()
	if _, err := agent.Create(root, "bot", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "TEST", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	created, err := Create(context.Background(), CreateOptions{Root: root, Name: "bot", BotID: "bot", LedgerURLs: []string{stubLedger(t)}})
	if err != nil {
		t.Fatal(err)
	}
	var incomeBody []byte
	incomeSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		incomeBody, _ = io.ReadAll(r.Body)
		if r.URL.Path != "/ledger/income" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"duplicate":false}`))
	}))
	defer incomeSrv.Close()
	var settled bool
	mock := &mockFacilitator{
		onSettle: func() { settled = true },
	}
	h, err := Paywall(PaywallOptions{
		Root: root, Name: "bot", Price: "0.01", Path: "/answer", Facilitator: mock,
		LedgerURLs: []string{incomeSrv.URL},
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "http://paywall.test/answer", nil)
	req.Header.Set("accept", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	rawHeader := rec.Header().Get("Payment-Required")
	decoded, err := base64.StdEncoding.DecodeString(rawHeader)
	if err != nil {
		t.Fatal(err)
	}
	text := string(decoded)
	if strings.Contains(text, `"eip155:8453"`) || strings.Contains(rec.Body.String(), `"eip155:8453"`) {
		t.Fatalf("mainnet offered header %s body %s", text, rec.Body.String())
	}
	if !strings.Contains(text, NetworkSepolia) || !strings.Contains(strings.ToLower(text), strings.ToLower(SepoliaUSDC)) {
		t.Fatal(text)
	}
	if !strings.Contains(strings.ToLower(text), strings.ToLower(created.Wallet)) {
		t.Fatal("payTo")
	}
	payload := types.PaymentPayload{
		X402Version: 2,
		Payload: map[string]any{
			"signature": "0x" + strings.Repeat("ab", 65),
			"authorization": map[string]any{
				"from": "0x0000000000000000000000000000000000000001", "to": created.Wallet,
				"value": "10000", "validAfter": "0", "validBefore": "4000000000",
				"nonce": "0x" + strings.Repeat("11", 32),
			},
		},
		Accepted: types.PaymentRequirements{
			Scheme:            "exact",
			Network:           NetworkSepolia,
			Asset:             SepoliaUSDC,
			Amount:            "10000",
			PayTo:             created.Wallet,
			MaxTimeoutSeconds: 120,
			Extra:             map[string]any{"name": "USDC", "version": "2"},
		},
	}
	blob, _ := json.Marshal(payload)
	paid := httptest.NewRequest(http.MethodGet, "http://paywall.test/answer", nil)
	paid.Header.Set("accept", "application/json")
	paid.Header.Set("Payment-Signature", base64.StdEncoding.EncodeToString(blob))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, paid)
	if rec.Code != http.StatusOK || !settled {
		t.Fatalf("status %d settled %v body %s", rec.Code, settled, rec.Body.String())
	}
	receipts, err := os.ReadFile(root + "/bot/receipts.jsonl")
	if err != nil || !strings.Contains(string(receipts), "0x"+strings.Repeat("cd", 32)) || !strings.Contains(string(receipts), `"income":true`) {
		t.Fatal(string(receipts), err)
	}
	text = string(incomeBody)
	if !strings.Contains(text, `"paymentPayload"`) || !strings.Contains(text, `"authorization"`) || !strings.Contains(text, `"settlement"`) {
		t.Fatal("income body dropped the x402 payload")
	}
	if !strings.Contains(text, "0x"+strings.Repeat("cd", 32)) || !strings.Contains(text, created.Agent) {
		t.Fatal("income body")
	}
	if strings.Contains(text, `"eip155:8453"`) {
		t.Fatal("mainnet income")
	}
	if !strings.Contains(text, `"x402Version":2`) {
		t.Fatal("x402 version")
	}
}

type mockFacilitator struct {
	onSettle func()
}

func (m *mockFacilitator) GetSupported(context.Context) (x402.SupportedResponse, error) {
	return x402.SupportedResponse{
		Kinds: []x402.SupportedKind{{
			X402Version: 2,
			Scheme:      "exact",
			Network:     NetworkSepolia,
		}},
		Extensions: []string{},
		Signers:    map[string][]string{},
	}, nil
}

func (m *mockFacilitator) Verify(context.Context, []byte, []byte) (*x402.VerifyResponse, error) {
	return &x402.VerifyResponse{IsValid: true, Payer: "0x0000000000000000000000000000000000000001"}, nil
}

func (m *mockFacilitator) Settle(context.Context, []byte, []byte) (*x402.SettleResponse, error) {
	if m.onSettle != nil {
		m.onSettle()
	}
	return &x402.SettleResponse{
		Success: true, Transaction: "0x" + strings.Repeat("cd", 32), Network: NetworkSepolia,
		Payer: "0x0000000000000000000000000000000000000001", Amount: "10000",
	}, nil
}
