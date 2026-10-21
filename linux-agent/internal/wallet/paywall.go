package wallet

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	x402 "github.com/x402-foundation/x402/go/v2"
	x402http "github.com/x402-foundation/x402/go/v2/http"
	nethttp "github.com/x402-foundation/x402/go/v2/http/nethttp"
	evmserver "github.com/x402-foundation/x402/go/v2/mechanisms/evm/exact/server"
)

// WSCDOFacilitatorURL is the Shard0 EIP-3009 facilitator from
// https://scdo.com.au/.well-known/x402.json (id scdo-wscdo3009).
// The client appends /supported, /verify, and /settle.
const WSCDOFacilitatorURL = "https://scdo.com.au/x402-scdo"

// FacilitatorURL is the public Base Sepolia facilitator. It needs no API key.
const FacilitatorURL = x402http.DefaultFacilitatorURL

// BaseFacilitatorURL is the SCDO relay to the Coinbase CDP x402 facilitator for Base
// mainnet (eip155:8453) USDC. CDP verifies and settles the EIP-3009 authorization and
// pays the gas. The relay only settles to the Base wallet the ledger lists for the
// agent named in extra.scdoAgent.
const BaseFacilitatorURL = "https://scdo.com.au/x402-base"

// PaywallOptions is a minimal exact-scheme receiver for one bot.
type PaywallOptions struct {
	Root  string
	Name  string
	Price string
	// Network overrides the wallet's USDC network: NetworkBase or NetworkSepolia.
	Network     string
	Path        string
	Addr        string
	Passphrase  []byte
	Facilitator x402.FacilitatorClient
	LedgerURLs  []string
	Log         io.Writer
	Now         func() time.Time
}

// Paywall builds an HTTP handler that answers 402 for Path and settles through
// the facilitator for the wallet asset. USDC uses the wallet network (eip155:8453
// through BaseFacilitatorURL, or eip155:84532). WSCDO uses eip155:5680.
func Paywall(opt PaywallOptions) (http.Handler, error) {
	lay, doc, agentKey, walletKey, err := openPair(opt.Root, opt.Name, opt.Passphrase)
	if err != nil {
		return nil, err
	}
	defer wipeKey(agentKey)
	defer wipeKey(walletKey)
	agentAddr := agentKey.Address()
	payTo := doc.Address
	if payTo == "" {
		payTo = walletKey.Address()
	}
	path := opt.Path
	if path == "" {
		path = "/answer"
	}
	if !strings.HasPrefix(path, "/") || strings.Contains(path, " ") {
		return nil, fmt.Errorf("path")
	}
	price := strings.TrimSpace(opt.Price)
	if price == "" {
		return nil, fmt.Errorf("price")
	}
	if !strings.HasPrefix(price, "$") {
		price = "$" + price
	}
	asset, err := NormalizeAsset(doc.Asset)
	if err != nil {
		return nil, err
	}
	usdcNet := doc.Network
	if strings.TrimSpace(opt.Network) != "" {
		if usdcNet, err = ParseNetwork(opt.Network); err != nil {
			return nil, err
		}
	}
	network := x402.Network(NetworkSepolia)
	facilitatorURL := FacilitatorURL
	var extra map[string]any
	scheme := evmserver.NewExactEvmScheme()
	if asset == AssetUSDC && usdcNet == NetworkBase {
		network = x402.Network(NetworkBase)
		facilitatorURL = BaseFacilitatorURL
		extra = map[string]any{"name": BaseUSDCName, "version": BaseUSDCVersion, "scdoAgent": agentAddr}
	}
	if asset == AssetWSCDO {
		network = x402.Network(NetworkShard0)
		facilitatorURL = WSCDOFacilitatorURL
		extra = map[string]any{"name": WSCDOName, "version": WSCDOVersion}
		scheme.RegisterMoneyParser(wscdoMoney)
	}
	facilitator := opt.Facilitator
	if facilitator == nil {
		facilitator = x402http.NewHTTPFacilitatorClient(&x402http.FacilitatorConfig{
			URL:     facilitatorURL,
			Timeout: SettleTimeout,
		})
	}
	paid := x402http.RouteConfig{
		Accepts: x402http.PaymentOptions{{
			Scheme:            "exact",
			PayTo:             payTo,
			Price:             price,
			Network:           network,
			MaxTimeoutSeconds: 120,
			Extra:             extra,
		}},
		Description: "SCDO bot answer",
		MimeType:    "application/json",
	}
	// HEAD must carry the same payment requirement as GET. x402 Go <= v2.28.0 matches routes
	// by exact method, so a GET-only route let an unpaid HEAD reach the protected handler
	// (fixed upstream in x402-foundation/x402 e95b0666, go/http/server.go).
	routes := x402http.RoutesConfig{
		"GET " + path:  paid,
		"HEAD " + path: paid,
	}
	dir := lay.Dir
	now := opt.Now
	urls := append([]string(nil), opt.LedgerURLs...)
	log := opt.Log
	mw := nethttp.PaymentMiddlewareFromConfig(routes,
		nethttp.WithFacilitatorClient(facilitator),
		nethttp.WithScheme(network, scheme),
		nethttp.WithTimeout(SettleTimeout),
		nethttp.WithSyncFacilitatorOnStart(true),
		nethttp.WithSettlementHandler(func(_ http.ResponseWriter, r *http.Request, resp *x402.SettleResponse) {
			if resp == nil || !resp.Success {
				return
			}
			paidNet := string(resp.Network)
			if paidNet == "" {
				paidNet = string(network)
			}
			rec := receipt{
				At:       stamp(now),
				Network:  paidNet,
				Tx:       resp.Transaction,
				Payer:    resp.Payer,
				Amount:   resp.Amount,
				Resource: path,
			}
			payload, _ := nethttp.PayloadFromContext(r.Context())
			reqs, _ := nethttp.RequirementsFromContext(r.Context())
			incomeCtx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			defer cancel()
			_, err := ReportIncome(incomeCtx, urls, Income{
				Agent:        agentAddr,
				Payload:      payload,
				Requirements: reqs,
				Settlement:   resp,
			})
			if err != nil {
				rec.IncomeError = err.Error()
				if log != nil {
					fmt.Fprintf(log, "Income was not booked: %s\n", err.Error())
				}
			} else {
				rec.Income = true
				if log != nil {
					fmt.Fprintf(log, "Income booked for %s tx %s\n", agentAddr, resp.Transaction)
				}
			}
			_ = appendReceipt(dir, rec)
		}),
	)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	return guardPaidRoute(path, mw(next)), nil
}

// guardPaidRoute is defence in depth for the paywall: only GET and HEAD on the paid path ever
// reach the x402 middleware (both registered as paid routes). Any other method gets 405 and
// any other path 404, so nothing unmatched by the middleware can fall through to the handler.
func guardPaidRoute(path string, paid http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != path {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		paid.ServeHTTP(w, r)
	})
}

// ServePaywall listens until ctx is cancelled. USDC uses FacilitatorURL.
// WSCDO uses WSCDOFacilitatorURL.
func ServePaywall(ctx context.Context, opt PaywallOptions) error {
	h, err := Paywall(opt)
	if err != nil {
		return err
	}
	addr := opt.Addr
	if addr == "" {
		addr = ":8410"
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	srv := &http.Server{Handler: h}
	go func() {
		<-ctx.Done()
		shut, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(shut)
	}()
	err = srv.Serve(ln)
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}

type receipt struct {
	At          string `json:"at"`
	Network     string `json:"network"`
	Tx          string `json:"tx"`
	Payer       string `json:"payer,omitempty"`
	Amount      string `json:"amount,omitempty"`
	Resource    string `json:"resource,omitempty"`
	Income      bool   `json:"income,omitempty"`
	IncomeError string `json:"incomeError,omitempty"`
}

func appendReceipt(dir string, rec receipt) error {
	if rec.At == "" {
		rec.At = time.Now().UTC().Format(time.RFC3339)
	}
	b, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "receipts.jsonl")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := os.Chmod(path, 0o600); err != nil {
		return err
	}
	_, err = f.Write(append(b, '\n'))
	return err
}

func wscdoMoney(amount string, network x402.Network) (*x402.AssetAmount, error) {
	if string(network) != NetworkShard0 {
		return nil, nil
	}
	atomic, err := x402.ConvertToTokenAmount(amount, WSCDODecimals)
	if err != nil {
		return nil, err
	}
	return &x402.AssetAmount{
		Asset:  WSCDO,
		Amount: atomic,
		Extra:  map[string]any{"name": WSCDOName, "version": WSCDOVersion},
	}, nil
}

func stamp(now func() time.Time) string {
	if now == nil {
		return time.Now().UTC().Format(time.RFC3339)
	}
	return now().UTC().Format(time.RFC3339)
}
