package wallet

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	x402 "github.com/x402-foundation/x402/go/v2"
	x402http "github.com/x402-foundation/x402/go/v2/http"
	evmclient "github.com/x402-foundation/x402/go/v2/mechanisms/evm/exact/client"
	evmsigners "github.com/x402-foundation/x402/go/v2/signers/evm"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/keys"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

// PayOptions pays one HTTP resource and records the settlement on the ledger.
type PayOptions struct {
	Root string
	Name string
	URL  string
	// MaxAtomic is a decimal cap for this one payment ("1", "0.10").
	// It is parsed with the selected asset's decimals and can only tighten the stored cap.
	MaxAtomic  string
	DryRun     bool
	Passphrase []byte
	LedgerURLs []string
	Now        func() time.Time
	HTTP       *http.Client
}

// Paid is a settled Base Sepolia payment.
type Paid struct {
	Agent    string
	Wallet   string
	Tx       string
	PayTo    string
	Amount   string
	Resource string
	Ledger   string
	Basescan string
}

// Pay uses the x402 SDK to sign an EIP-3009 exact payment and retry with
// PAYMENT-SIGNATURE. eip155:84532 (USDC) and eip155:5680 (WSCDO) are registered.
// Limits run before the signature. Base mainnet stays off.
func Pay(ctx context.Context, opt PayOptions) (Paid, error) {
	if opt.DryRun {
		return Preview(ctx, opt)
	}
	lay, doc, agentKey, walletKey, err := openPair(opt.Root, opt.Name, opt.Passphrase)
	if err != nil {
		return Paid{}, err
	}
	defer wipeKey(agentKey)
	defer wipeKey(walletKey)
	now := time.Now()
	if opt.Now != nil {
		now = opt.Now()
	}
	policyDoc := doc
	if doc.Killed {
		return Paid{}, policyf("wallet kill switch is on")
	}
	if err := rejectFrozen(ctx, opt.LedgerURLs, agentKey.Address()); err != nil {
		return Paid{}, err
	}

	raw := walletKey.Scalar()
	signer, err := evmsigners.NewClientSignerFromPrivateKey("0x" + hex.EncodeToString(raw))
	ledger.Wipe(raw)
	if err != nil {
		return Paid{}, err
	}
	var chosen Decision
	var authNonce string
	var reserveID string
	var policyErr error
	var settled *x402.SettleResponse
	client := x402.Newx402Client(
		x402.WithSpendControls(spendControls(policyDoc)),
	).Register(x402.Network(NetworkSepolia), evmclient.NewExactEvmScheme(signer, nil)).
		Register(x402.Network(NetworkShard0), evmclient.NewExactEvmScheme(signer, nil))
	client.OnBeforePaymentCreation(func(pc x402.PaymentCreationContext) (*x402.BeforePaymentCreationHookResult, error) {
		req := pc.SelectedRequirements
		chosen = decisionFrom(req, opt.URL, now)
		err := withSpendLock(lay.Dir, func(log *spendLog) error {
			seedHistory(doc, log, now)
			check, err := spentCheck(policyDoc, *log, chosen, opt.MaxAtomic, now)
			if err != nil {
				return err
			}
			if err := Allow(check, chosen); err != nil {
				return err
			}
			id, err := newID()
			if err != nil {
				return err
			}
			reserveID = id
			reservePending(log, id, chosen.Amount, chosen.Asset, now)
			return nil
		})
		if err != nil {
			if errors.Is(err, ErrPolicy) {
				policyErr = err
				return &x402.BeforePaymentCreationHookResult{Abort: true, Reason: err.Error()}, nil
			}
			return nil, err
		}
		return nil, nil
	})
	client.OnAfterPaymentCreation(func(pc x402.PaymentCreatedContext) error {
		auth, _ := pc.Payload.GetPayload()["authorization"].(map[string]any)
		if n, _ := auth["nonce"].(string); len(n) > 0 && len(n) <= 80 {
			authNonce = n
		}
		if reserveID != "" && authNonce != "" {
			_ = withSpendLock(lay.Dir, func(log *spendLog) error {
				noteNonce(log, reserveID, authNonce)
				return nil
			})
		}
		return nil
	})
	client.OnPaymentResponse(func(_ context.Context, pr x402.PaymentResponseContext) (x402.PaymentResponseResult, error) {
		if pr.SettleResponse != nil && pr.SettleResponse.Success && pr.SettleResponse.Transaction != "" {
			cp := *pr.SettleResponse
			settled = &cp
		}
		return x402.PaymentResponseResult{}, nil
	})

	base := &http.Client{Timeout: 90 * time.Second}
	if opt.HTTP != nil {
		base.Timeout = opt.HTTP.Timeout
		base.Transport = opt.HTTP.Transport
	}
	if base.Timeout == 0 {
		base.Timeout = 90 * time.Second
	}
	inner := base.Transport
	if inner == nil {
		inner = http.DefaultTransport
	}
	base.Transport = payTransport{base: inner}
	httpClient := x402http.WrapHTTPClientWithPayment(base, x402http.Newx402HTTPClient(client))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, opt.URL, nil)
	if err != nil {
		return Paid{}, err
	}
	req.Header.Set("accept", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return Paid{}, classifyPay(err, policyErr)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Paid{}, fmt.Errorf("payment HTTP %d", resp.StatusCode)
	}
	if settled == nil || !settled.Success || settled.Transaction == "" {
		return Paid{}, fmt.Errorf("payment response missing a transaction")
	}
	payTo, err := ledger.ChecksumAddress(chosen.PayTo)
	if err != nil {
		return Paid{}, err
	}
	resource := opt.URL
	if len(resource) > 512 {
		resource = ""
	}
	if doc.LastTx != settled.Transaction {
		doc.addSpent(chosen.Network, chosen.Amount, now)
		doc.LastNetwork = chosen.Network
		doc.LastTx = settled.Transaction
		doc.LastPayTo = payTo
		doc.LastAmount = chosen.Amount
		doc.LastResource = resource
		doc.LastNonce = authNonce
		doc.LastRecorded = false
		if reserveID != "" {
			_ = withSpendLock(lay.Dir, func(log *spendLog) error {
				noteSettled(log, reserveID, settled.Transaction, now)
				return nil
			})
		}
	}
	if err := saveDoc(lay.Dir, doc); err != nil {
		return Paid{}, err
	}
	ledgerURL, err := record(ctx, lay, agentKey, doc, opt.LedgerURLs, now)
	if err != nil {
		return Paid{
			Agent:    agentKey.Address(),
			Wallet:   walletKey.Address(),
			Tx:       settled.Transaction,
			PayTo:    payTo,
			Amount:   chosen.Amount,
			Resource: resource,
			Basescan: basescan(chosen.Network, settled.Transaction),
		}, err
	}
	doc.LastRecorded = true
	if err := saveDoc(lay.Dir, doc); err != nil {
		return Paid{}, err
	}
	return Paid{
		Agent:    agentKey.Address(),
		Wallet:   walletKey.Address(),
		Tx:       settled.Transaction,
		PayTo:    payTo,
		Amount:   chosen.Amount,
		Resource: resource,
		Ledger:   ledgerURL,
		Basescan: basescan(chosen.Network, settled.Transaction),
	}, nil
}

func spendControls(doc Doc) x402.SpendControls {
	return x402.SpendControls{
		MaxAmountPerPayment: USDCap(doc.MaxAtomic),
		AllowedAssets: []x402.SpendControlAsset{{
			Network:             x402.Network(NetworkShard0),
			Asset:               WSCDO,
			MaxAmountPerPayment: doc.maxWSCDO(),
		}},
	}
}

func decisionFrom(req x402.PaymentRequirementsView, resource string, now time.Time) Decision {
	d := Decision{
		Network:  req.GetNetwork(),
		Asset:    req.GetAsset(),
		PayTo:    req.GetPayTo(),
		Amount:   req.GetAmount(),
		Resource: resource,
		Now:      now,
	}
	extra := req.GetExtra()
	if extra != nil {
		d.Name, _ = extra["name"].(string)
		d.Version, _ = extra["version"].(string)
	}
	return d
}

func spentCheck(doc Doc, log spendLog, d Decision, maxDecimal string, now time.Time) (Doc, error) {
	check := doc
	day := now.UTC().Format("2006-01-02")
	if d.Network == NetworkShard0 && sameAddr(d.Asset, WSCDO) {
		check.SpentWSCDO = log.windowAsset(now, WSCDO).String()
		check.SpentWSCDODay = day
	} else {
		spent := enforcedSpent(doc, log, now)
		check.SpentAtomic = spent.String()
		check.SpentDay = day
	}
	if strings.TrimSpace(maxDecimal) == "" {
		return check, nil
	}
	decimals := USDCDecimals
	if d.Network == NetworkShard0 && sameAddr(d.Asset, WSCDO) {
		decimals = WSCDODecimals
	}
	atomic, err := ParseDecimal(maxDecimal, decimals)
	if err != nil {
		return Doc{}, err
	}
	if decimals == WSCDODecimals {
		check.MaxWSCDO, err = tighterCap(check.maxWSCDO(), atomic)
	} else {
		check.MaxAtomic, err = tighterCap(check.MaxAtomic, atomic)
	}
	if err != nil {
		return Doc{}, err
	}
	return check, nil
}

func basescan(network, tx string) string {
	if network != "" && network != NetworkSepolia {
		return ""
	}
	return "https://sepolia.basescan.org/tx/" + tx
}

// sepoliaOnly keeps the Base Sepolia refusal visible when the SDK drops an
// unregistered network before the spend-cap hook runs.
func tighterCap(current, requested string) (string, error) {
	req, ok := new(big.Int).SetString(requested, 10)
	if !ok || req.Sign() <= 0 {
		return "", policyf("bad amount")
	}
	cur, ok := new(big.Int).SetString(current, 10)
	if !ok {
		return requested, nil
	}
	if req.Cmp(cur) < 0 {
		return requested, nil
	}
	return current, nil
}

func newID() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

// payTransport caps a 402 challenge at 120 seconds and copies the v2 payment
// header onto X-PAYMENT. Signing stays inside the x402 SDK.
type payTransport struct {
	base http.RoundTripper
}

func (p payTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if sig := req.Header.Get("Payment-Signature"); sig != "" && req.Header.Get("X-Payment") == "" {
		req.Header.Set("X-Payment", sig)
	}
	resp, err := p.base.RoundTrip(req)
	if err != nil || resp == nil || resp.StatusCode != http.StatusPaymentRequired {
		return resp, err
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	_ = resp.Body.Close()
	if err != nil {
		return nil, err
	}
	body = capChallenge(body)
	if h := resp.Header.Get("Payment-Required"); h != "" {
		if decoded, err := base64.StdEncoding.DecodeString(h); err == nil {
			resp.Header.Set("Payment-Required", base64.StdEncoding.EncodeToString(capChallenge(decoded)))
		}
	}
	resp.Body = io.NopCloser(bytes.NewReader(body))
	resp.ContentLength = int64(len(body))
	resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(body)))
	return resp, nil
}

func capChallenge(raw []byte) []byte {
	var doc map[string]any
	if json.Unmarshal(raw, &doc) != nil {
		return raw
	}
	accepts, _ := doc["accepts"].([]any)
	changed := false
	for _, item := range accepts {
		m, _ := item.(map[string]any)
		if m == nil {
			continue
		}
		n, ok := m["maxTimeoutSeconds"].(float64)
		if ok && n > 120 {
			m["maxTimeoutSeconds"] = 120
			changed = true
		}
	}
	if !changed {
		return raw
	}
	out, err := json.Marshal(doc)
	if err != nil {
		return raw
	}
	return out
}

func classifyPay(err, policyErr error) error {
	if policyErr != nil {
		return policyErr
	}
	if err == nil {
		return nil
	}
	msg := err.Error()
	if strings.Contains(msg, "maxAmountPerPayment") || strings.Contains(msg, "spendControls") {
		return policyf("amount is above the per-payment cap")
	}
	return sepoliaOnly(err)
}

func sepoliaOnly(err error) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	if strings.Contains(msg, "no supported payment schemes") || strings.Contains(msg, "no client registered for network") {
		return policyf("only Base Sepolia USDC (eip155:84532) and Shard0 WSCDO (eip155:5680) are enabled")
	}
	return err
}

func openPair(root, name string, pass []byte) (*agent.Layout, Doc, *ledger.Key, *ledger.Key, error) {
	lay, err := agent.Open(root, name)
	if err != nil {
		return nil, Doc{}, nil, nil, err
	}
	doc, err := loadDoc(lay.Dir)
	if err != nil {
		return nil, Doc{}, nil, nil, err
	}
	agentKey, err := lay.OpenKey(pass)
	if err != nil {
		return nil, Doc{}, nil, nil, err
	}
	walletKey, err := (keys.Store{Dir: filepath.Join(lay.Dir, "keys")}).Open("wallet", pass)
	if err != nil {
		wipeKey(agentKey)
		return nil, Doc{}, nil, nil, err
	}
	return lay, doc, agentKey, walletKey, nil
}

func rejectFrozen(ctx context.Context, urls []string, agentAddr string) error {
	if len(urls) == 0 {
		urls = ledger.DefaultURLs()
	}
	res, err := (&ledger.Client{URLs: urls, Agent: "scdo-agent"}).Get(ctx, "/agents/"+agentAddr)
	if err != nil {
		return nil
	}
	sum, _ := res.Body["summary"].(map[string]any)
	if sum == nil {
		return nil
	}
	if frozen, ok := sum["frozen"]; ok && frozen != nil {
		return policyf("wallet is frozen on the ledger")
	}
	return nil
}
