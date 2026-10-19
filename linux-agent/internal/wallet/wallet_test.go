package wallet

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
)

func stubLedger(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/agents/") {
			_, _ = w.Write([]byte(`{"ok":true,"summary":{"frozen":null}}`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestCreateStoresDecimalCaps(t *testing.T) {
	root := t.TempDir()
	if _, err := agent.Create(root, "bot", "0x52908400098527886e0f7030069857d2e4169ee7", "TEST", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(context.Background(), CreateOptions{
		Root: root, Name: "bot", BotID: "bot", MaxAtomic: "nope", Daily: "5", LedgerURLs: []string{stubLedger(t)},
	}); err == nil {
		t.Fatal("a non-decimal --max was accepted")
	}
	if _, err := Create(context.Background(), CreateOptions{
		Root: root, Name: "bot", BotID: "bot", MaxAtomic: "1.00", Daily: "5", LedgerURLs: []string{stubLedger(t)},
	}); err != nil {
		t.Fatal(err)
	}
	doc, _, err := Export(root, "bot")
	if err != nil {
		t.Fatal(err)
	}
	if doc.MaxAtomic != "1000000" || doc.DailyAtomic != "5000000" {
		t.Fatalf("caps max %q daily %q", doc.MaxAtomic, doc.DailyAtomic)
	}
	if FormatUSDC(doc.MaxAtomic) != "1.000000" || FormatUSDC(doc.DailyAtomic) != "5.000000" {
		t.Fatalf("display %s %s", FormatUSDC(doc.MaxAtomic), FormatUSDC(doc.DailyAtomic))
	}
	pay := Decision{
		Network: NetworkSepolia, Asset: SepoliaUSDC,
		PayTo: "0xE3837fE309618AE075DbeF0A20735c0615a308E6", Amount: "10000",
		Resource: "https://example.com/paid", Now: time.Unix(1_800_000_000, 0),
	}
	if err := Allow(doc, pay); err != nil {
		t.Fatal(err)
	}
	pay.Amount = "1000001"
	if err := Allow(doc, pay); err == nil || !errors.Is(err, ErrPolicy) {
		t.Fatal(err)
	}
}

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
	if _, err := agent.Create(root, "bot", "0x52908400098527886e0f7030069857d2e4169ee7", "TEST", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	created, err := Create(context.Background(), CreateOptions{
		Root: root, Name: "bot", BotID: "m1-bot", Email: " Bot@Example.com ", LedgerURLs: []string{ledgerSrv.URL}, Now: func() time.Time { return time.UnixMilli(1_800_000_000_000) },
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
	if bindBody["emailCommit"] == "" || bindBody["emailCommit"] == nil {
		t.Fatal("emailCommit missing")
	}
	rawBind, _ := json.Marshal(bindBody)
	if strings.Contains(strings.ToLower(string(rawBind)), "bot@example.com") {
		t.Fatal("plaintext email was sent")
	}
	salt, err := os.ReadFile(root + "/bot/email.salt")
	if err != nil || len(salt) != 32 {
		t.Fatal(err)
	}
	if bytes.Contains(rawBind, salt) {
		t.Fatal("salt was sent")
	}

	tx := "0x" + strings.Repeat("ab", 32)
	cap := &payCapture{}
	paySrv := paymentServer(t, tx, NetworkSepolia, "10000", 300, cap)
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
	if cap.sig == "" || cap.sig != cap.xpay {
		t.Fatalf("headers sig %d xpay %d", len(cap.sig), len(cap.xpay))
	}
	if !strings.EqualFold(cap.from, created.Wallet) || cap.value != "10000" || !strings.EqualFold(cap.to, "0xE3837fE309618AE075DbeF0A20735c0615a308E6") {
		t.Fatalf("authorization %+v", cap)
	}
	if cap.network != NetworkSepolia {
		t.Fatal(cap.network)
	}
	now := time.Now().Unix()
	if cap.validBefore < now || cap.validBefore > now+125 {
		t.Fatalf("validBefore %d now %d", cap.validBefore, now)
	}
	addr, err := recoverSig(cap.digest, cap.signature)
	if err != nil || !strings.EqualFold(addr.Hex(), created.Wallet) {
		t.Fatalf("signature %v %s", err, addr.Hex())
	}

	mainnet := paymentServer(t, tx, "eip155:8453", "10000", 60, nil)
	defer mainnet.Close()
	if _, err := Pay(context.Background(), PayOptions{Root: root, Name: "bot", URL: mainnet.URL, LedgerURLs: []string{ledgerSrv.URL}}); err == nil || !errors.Is(err, ErrPolicy) || !strings.Contains(err.Error(), "eip155:84532") {
		t.Fatal(err)
	}
	if _, err := ApplyLimit(root, "bot", LimitUpdate{PerPayment: "0.000001", Domains: []string{"example.com"}}); err != nil {
		t.Fatal(err)
	}
	blocked := paymentServer(t, tx, NetworkSepolia, "10000", 60, nil)
	defer blocked.Close()
	if _, err := Pay(context.Background(), PayOptions{Root: root, Name: "bot", URL: blocked.URL, LedgerURLs: []string{ledgerSrv.URL}}); err == nil || !errors.Is(err, ErrPolicy) {
		t.Fatal(err)
	}
}

func TestCreateWSCDOCapsAndPay(t *testing.T) {
	var spendBody map[string]any
	ledgerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var env map[string]any
		_ = json.Unmarshal(b, &env)
		payload, _ := env["payload"].(map[string]any)
		if r.URL.Path == "/ledger/spend" {
			spendBody, _ = payload["body"].(map[string]any)
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
	if _, err := agent.Create(root, "bot", "0x52908400098527886e0f7030069857d2e4169ee7", "TEST", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(context.Background(), CreateOptions{
		Root: root, Name: "bot", BotID: "bot", Asset: "wscdo3009", MaxAtomic: "1", Daily: "5",
		LedgerURLs: []string{ledgerSrv.URL},
	}); err != nil {
		t.Fatal(err)
	}
	doc, _, err := Export(root, "bot")
	if err != nil {
		t.Fatal(err)
	}
	if doc.Asset != AssetWSCDO || doc.MaxWSCDO != "1000000000000000000" || doc.DailyWSCDO != "5000000000000000000" {
		t.Fatalf("asset %s max %s daily %s", doc.Asset, doc.MaxWSCDO, doc.DailyWSCDO)
	}
	if FormatDecimal(doc.MaxWSCDO, WSCDODecimals) != "1.000000000000000000" || FormatDecimal(doc.DailyWSCDO, WSCDODecimals) != "5.000000000000000000" {
		t.Fatal(FormatDecimal(doc.MaxWSCDO, WSCDODecimals))
	}
	now := time.Unix(1_800_000_000, 0)
	wscdo := Decision{
		Network: NetworkShard0, Asset: WSCDO, Name: WSCDOName, Version: WSCDOVersion,
		PayTo: "0xE3837fE309618AE075DbeF0A20735c0615a308E6", Amount: "5000000000000000",
		Resource: "https://example.com/paid", Now: now,
	}
	if err := Allow(doc, wscdo); err != nil {
		t.Fatal(err)
	}
	wscdo.Amount = "1000000000000000001"
	if err := Allow(doc, wscdo); err == nil || !errors.Is(err, ErrPolicy) {
		t.Fatal(err)
	}
	wscdo.Amount = "5000000000000000"
	wscdo.Name = "Unknown Token"
	if err := Allow(doc, wscdo); err == nil || !errors.Is(err, ErrPolicy) {
		t.Fatal(err)
	}
	if err := Allow(doc, Decision{Network: "eip155:8453", Asset: SepoliaUSDC, PayTo: wscdo.PayTo, Amount: "1", Now: now}); err == nil || !strings.Contains(err.Error(), "eip155:84532") {
		t.Fatal(err)
	}
	if err := Allow(doc, Decision{Network: NetworkSepolia, Asset: SepoliaUSDC, PayTo: wscdo.PayTo, Amount: "10000", Now: now}); err != nil {
		t.Fatal(err)
	}

	tx := "0x" + strings.Repeat("cd", 32)
	cap := &payCapture{}
	paySrv := paymentServerOffer(t, tx, paymentOffer{
		network: NetworkShard0, asset: WSCDO, amount: "5000000000000000",
		name: WSCDOName, version: WSCDOVersion, timeout: 60,
	}, cap)
	defer paySrv.Close()
	paid, err := Pay(context.Background(), PayOptions{Root: root, Name: "bot", URL: paySrv.URL, LedgerURLs: []string{ledgerSrv.URL}})
	if err != nil {
		t.Fatal(err)
	}
	if paid.Tx != tx || paid.Basescan != "" || paid.Amount != "5000000000000000" {
		t.Fatalf("%+v", paid)
	}
	if spendBody["network"] != NetworkShard0 || spendBody["amount"] != "5000000000000000" {
		t.Fatalf("spend %#v", spendBody)
	}
	if cap.network != NetworkShard0 || cap.value != "5000000000000000" {
		t.Fatalf("authorization %+v", cap)
	}
	addr, err := recoverSig(cap.digest, cap.signature)
	if err != nil || !strings.EqualFold(addr.Hex(), paid.Wallet) {
		t.Fatalf("signature %v %s", err, addr)
	}
	saved, _, err := Export(root, "bot")
	if err != nil {
		t.Fatal(err)
	}
	if saved.SpentWSCDO != "5000000000000000" || saved.SpentAtomic != "0" {
		t.Fatalf("spent wscdo %s usdc %s", saved.SpentWSCDO, saved.SpentAtomic)
	}
	if err := Allow(saved, Decision{Network: NetworkSepolia, Asset: SepoliaUSDC, PayTo: wscdo.PayTo, Amount: "10000", Now: time.Now()}); err != nil {
		t.Fatal(err)
	}

	wrong := paymentServerOffer(t, tx, paymentOffer{
		network: NetworkShard0, asset: WSCDO, amount: "5000000000000000",
		name: "Unknown Token", version: "1", timeout: 60,
	}, nil)
	defer wrong.Close()
	if _, err := Pay(context.Background(), PayOptions{Root: root, Name: "bot", URL: wrong.URL, LedgerURLs: []string{ledgerSrv.URL}}); err == nil || !errors.Is(err, ErrPolicy) {
		t.Fatal(err)
	}
	mainnet := paymentServer(t, tx, "eip155:8453", "10000", 60, nil)
	defer mainnet.Close()
	if _, err := Pay(context.Background(), PayOptions{Root: root, Name: "bot", URL: mainnet.URL, LedgerURLs: []string{ledgerSrv.URL}}); err == nil || !errors.Is(err, ErrPolicy) || !strings.Contains(err.Error(), "eip155:84532") {
		t.Fatal(err)
	}
	over := paymentServerOffer(t, tx, paymentOffer{
		network: NetworkShard0, asset: WSCDO, amount: "1500000000000000000",
		name: WSCDOName, version: WSCDOVersion, timeout: 60,
	}, nil)
	defer over.Close()
	if _, err := Pay(context.Background(), PayOptions{
		Root: root, Name: "bot", URL: over.URL, MaxAtomic: "2", LedgerURLs: []string{ledgerSrv.URL},
	}); err == nil || !errors.Is(err, ErrPolicy) {
		t.Fatal(err)
	}
}

type payCapture struct {
	sig, xpay, from, to, value, network, signature string
	validBefore                                    int64
	digest                                         []byte
}

type paymentOffer struct {
	network, asset, amount, name, version string
	timeout                               int
}

func paymentServer(t *testing.T, tx, network, amount string, timeout int, cap *payCapture) *httptest.Server {
	t.Helper()
	return paymentServerOffer(t, tx, paymentOffer{
		network: network, asset: SepoliaUSDC, amount: amount,
		name: "USDC", version: "2", timeout: timeout,
	}, cap)
}

func paymentServerOffer(t *testing.T, tx string, offer paymentOffer, cap *payCapture) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Payment-Signature") == "" {
			raw, _ := json.Marshal(map[string]any{
				"x402Version": 2,
				"resource":    map[string]any{"url": srv.URL, "mimeType": "application/json"},
				"accepts": []any{map[string]any{
					"scheme": "exact", "network": offer.network, "amount": offer.amount,
					"asset": offer.asset, "payTo": "0xE3837fE309618AE075DbeF0A20735c0615a308E6",
					"maxTimeoutSeconds": offer.timeout,
					"extra":             map[string]any{"name": offer.name, "version": offer.version},
				}},
			})
			w.Header().Set("Payment-Required", base64.StdEncoding.EncodeToString(raw))
			w.WriteHeader(http.StatusPaymentRequired)
			_, _ = w.Write(raw)
			return
		}
		if cap != nil {
			cap.sig = r.Header.Get("Payment-Signature")
			cap.xpay = r.Header.Get("X-Payment")
			notePayment(t, cap)
		}
		raw, _ := json.Marshal(map[string]any{
			"success": true, "transaction": tx, "network": offer.network, "payer": "0x0000000000000000000000000000000000000001",
		})
		w.Header().Set("Payment-Response", base64.StdEncoding.EncodeToString(raw))
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	return srv
}

func notePayment(t *testing.T, cap *payCapture) {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(cap.sig)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Accepted struct {
			Network string `json:"network"`
		} `json:"accepted"`
		Payload struct {
			Signature     string `json:"signature"`
			Authorization struct {
				From        string `json:"from"`
				To          string `json:"to"`
				Value       string `json:"value"`
				ValidAfter  string `json:"validAfter"`
				ValidBefore string `json:"validBefore"`
				Nonce       string `json:"nonce"`
			} `json:"authorization"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	auth := payload.Payload.Authorization
	cap.from = auth.From
	cap.to = auth.To
	cap.value = auth.Value
	cap.network = payload.Accepted.Network
	cap.signature = payload.Payload.Signature
	cap.validBefore, _ = strconvParse(auth.ValidBefore)
	var digest []byte
	if payload.Accepted.Network == NetworkShard0 {
		digest, err = domainDigest(WSCDOName, WSCDOVersion, 5680, WSCDO, auth.From, auth.To, auth.Value, auth.ValidAfter, auth.ValidBefore, auth.Nonce)
	} else {
		digest, err = authorizationDigest(auth.From, auth.To, auth.Value, auth.ValidAfter, auth.ValidBefore, auth.Nonce)
	}
	if err != nil {
		t.Fatal(err)
	}
	cap.digest = digest
}

func strconvParse(s string) (int64, error) {
	return strconv.ParseInt(s, 10, 64)
}
