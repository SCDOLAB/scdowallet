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
	"time"

	x402 "github.com/x402-foundation/x402/go/v2"
	x402http "github.com/x402-foundation/x402/go/v2/http"
	"github.com/x402-foundation/x402/go/v2/types"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
)

func TestPaywall402RoundTrip(t *testing.T) {
	if FacilitatorURL != "https://x402.org/facilitator" || x402http.DefaultFacilitatorURL != FacilitatorURL {
		t.Fatal(FacilitatorURL)
	}
	if WSCDOFacilitatorURL+"/settle" != "https://scdo.com.au/x402-scdo/settle" {
		t.Fatal(WSCDOFacilitatorURL)
	}
	root := t.TempDir()
	if _, err := agent.Create(root, "bot", "0x52908400098527886e0f7030069857d2e4169ee7", "TEST", agent.RoleLight, "", "test", nil); err != nil {
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

func TestPaywallWSCDO(t *testing.T) {
	root := t.TempDir()
	if _, err := agent.Create(root, "bot", "0x52908400098527886e0f7030069857d2e4169ee7", "TEST", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(context.Background(), CreateOptions{
		Root: root, Name: "bot", BotID: "bot", Asset: "wscdo", LedgerURLs: []string{stubLedger(t)},
	}); err != nil {
		t.Fatal(err)
	}
	h, err := Paywall(PaywallOptions{
		Root: root, Name: "bot", Price: "0.005", Path: "/answer",
		Facilitator: &mockFacilitator{network: NetworkShard0},
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
	decoded, err := base64.StdEncoding.DecodeString(rec.Header().Get("Payment-Required"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(decoded)
	if strings.Contains(text, `"eip155:8453"`) || strings.Contains(rec.Body.String(), `"eip155:8453"`) {
		t.Fatal(text)
	}
	for _, want := range []string{NetworkShard0, WSCDO, WSCDOName, "5000000000000000"} {
		if !strings.Contains(strings.ToLower(text), strings.ToLower(want)) {
			t.Fatalf("missing %s in %s", want, text)
		}
	}
	if !strings.Contains(text, `"version":"1"`) && !strings.Contains(text, `"version": "1"`) {
		t.Fatalf("version %s", text)
	}
}

func TestSettleAfterThirtySecondsIsBooked(t *testing.T) {
	if SettleTimeout < 120*time.Second {
		t.Fatal(SettleTimeout)
	}
	root := t.TempDir()
	if _, err := agent.Create(root, "bot", "0x52908400098527886e0f7030069857d2e4169ee7", "TEST", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	created, err := Create(context.Background(), CreateOptions{Root: root, Name: "bot", BotID: "bot", LedgerURLs: []string{stubLedger(t)}})
	if err != nil {
		t.Fatal(err)
	}
	var booked bool
	incomeSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ledger/income" {
			http.NotFound(w, r)
			return
		}
		booked = true
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer incomeSrv.Close()
	mock := &mockFacilitator{delay: 31 * time.Second}
	h, err := Paywall(PaywallOptions{
		Root: root, Name: "bot", Price: "0.01", Path: "/answer", Facilitator: mock,
		LedgerURLs: []string{incomeSrv.URL},
	})
	if err != nil {
		t.Fatal(err)
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
			Scheme: "exact", Network: NetworkSepolia, Asset: SepoliaUSDC,
			Amount: "10000", PayTo: created.Wallet, MaxTimeoutSeconds: 120,
			Extra: map[string]any{"name": "USDC", "version": "2"},
		},
	}
	blob, _ := json.Marshal(payload)
	paid := httptest.NewRequest(http.MethodGet, "http://paywall.test/answer", nil)
	paid.Header.Set("accept", "application/json")
	paid.Header.Set("Payment-Signature", base64.StdEncoding.EncodeToString(blob))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, paid)
	if rec.Code != http.StatusOK || !booked {
		t.Fatalf("status %d booked %v body %s", rec.Code, booked, rec.Body.String())
	}
	receipts, err := os.ReadFile(root + "/bot/receipts.jsonl")
	if err != nil || !strings.Contains(string(receipts), `"income":true`) {
		t.Fatal(string(receipts), err)
	}
}

type mockFacilitator struct {
	onSettle func()
	network  string
	amount   string
	delay    time.Duration
}

func (m *mockFacilitator) net() string {
	if m.network == "" {
		return NetworkSepolia
	}
	return m.network
}

func (m *mockFacilitator) amt() string {
	if m.amount == "" {
		return "10000"
	}
	return m.amount
}

func (m *mockFacilitator) GetSupported(context.Context) (x402.SupportedResponse, error) {
	return x402.SupportedResponse{
		Kinds: []x402.SupportedKind{{
			X402Version: 2,
			Scheme:      "exact",
			Network:     m.net(),
		}},
		Extensions: []string{},
		Signers:    map[string][]string{},
	}, nil
}

func (m *mockFacilitator) Verify(context.Context, []byte, []byte) (*x402.VerifyResponse, error) {
	return &x402.VerifyResponse{IsValid: true, Payer: "0x0000000000000000000000000000000000000001"}, nil
}

func (m *mockFacilitator) Settle(ctx context.Context, _ []byte, _ []byte) (*x402.SettleResponse, error) {
	if m.delay > 0 {
		timer := time.NewTimer(m.delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if m.onSettle != nil {
		m.onSettle()
	}
	return &x402.SettleResponse{
		Success: true, Transaction: "0x" + strings.Repeat("cd", 32), Network: x402.Network(m.net()),
		Payer: "0x0000000000000000000000000000000000000001", Amount: m.amt(),
	}, nil
}

// HEAD-bypass regression (x402 Go v2.28.0, fixed upstream in x402-foundation/x402 e95b0666):
// an unpaid HEAD, or any other unpaid method/path, must never reach the protected handler.
func TestPaywallUnpaidHeadAndOtherMethodsBlocked(t *testing.T) {
	root := t.TempDir()
	if _, err := agent.Create(root, "bot", "0x52908400098527886e0f7030069857d2e4169ee7", "TEST", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(context.Background(), CreateOptions{Root: root, Name: "bot", BotID: "bot", LedgerURLs: []string{stubLedger(t)}}); err != nil {
		t.Fatal(err)
	}
	settled := false
	h, err := Paywall(PaywallOptions{
		Root: root, Name: "bot", Price: "0.01", Path: "/answer",
		Facilitator: &mockFacilitator{onSettle: func() { settled = true }},
	})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		method, url string
		want        int
	}{
		{http.MethodHead, "http://paywall.test/answer", http.StatusPaymentRequired},
		{http.MethodGet, "http://paywall.test/answer", http.StatusPaymentRequired},
		{http.MethodPost, "http://paywall.test/answer", http.StatusMethodNotAllowed},
		{http.MethodPut, "http://paywall.test/answer", http.StatusMethodNotAllowed},
		{http.MethodOptions, "http://paywall.test/answer", http.StatusMethodNotAllowed},
		{http.MethodGet, "http://paywall.test/answer/x", http.StatusNotFound},
		{http.MethodHead, "http://paywall.test/other", http.StatusNotFound},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, c.url, nil)
		req.Header.Set("accept", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Fatalf("%s %s: status %d want %d body %s", c.method, c.url, rec.Code, c.want, rec.Body.String())
		}
		if strings.Contains(rec.Body.String(), `"ok":true`) {
			t.Fatalf("%s %s reached the protected handler", c.method, c.url)
		}
		if c.method == http.MethodHead && c.want == http.StatusPaymentRequired && rec.Header().Get("Payment-Required") == "" {
			t.Fatalf("HEAD without payment returned no Payment-Required header")
		}
	}
	if settled {
		t.Fatal("unpaid request settled")
	}
}
