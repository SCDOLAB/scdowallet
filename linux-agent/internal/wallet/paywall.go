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

// FacilitatorURL is the public Base Sepolia facilitator. It needs no API key.
const FacilitatorURL = x402http.DefaultFacilitatorURL

// PaywallOptions is a minimal exact-scheme receiver for one bot.
type PaywallOptions struct {
	Root        string
	Name        string
	Price       string
	Path        string
	Addr        string
	Passphrase  []byte
	Facilitator x402.FacilitatorClient
	LedgerURLs  []string
	Log         io.Writer
	Now         func() time.Time
}

// Paywall builds an HTTP handler that answers 402 for Path and settles through
// the x402.org testnet facilitator. Only eip155:84532 is registered.
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
	facilitator := opt.Facilitator
	if facilitator == nil {
		facilitator = x402http.NewHTTPFacilitatorClient(&x402http.FacilitatorConfig{URL: FacilitatorURL})
	}
	routes := x402http.RoutesConfig{
		"GET " + path: {
			Accepts: x402http.PaymentOptions{{
				Scheme:            "exact",
				PayTo:             payTo,
				Price:             price,
				Network:           x402.Network(NetworkSepolia),
				MaxTimeoutSeconds: 120,
			}},
			Description: "SCDO bot answer",
			MimeType:    "application/json",
		},
	}
	dir := lay.Dir
	now := opt.Now
	urls := append([]string(nil), opt.LedgerURLs...)
	log := opt.Log
	mw := nethttp.PaymentMiddlewareFromConfig(routes,
		nethttp.WithFacilitatorClient(facilitator),
		nethttp.WithScheme(x402.Network(NetworkSepolia), evmserver.NewExactEvmScheme()),
		nethttp.WithSyncFacilitatorOnStart(true),
		nethttp.WithSettlementHandler(func(_ http.ResponseWriter, r *http.Request, resp *x402.SettleResponse) {
			if resp == nil || !resp.Success {
				return
			}
			network := string(resp.Network)
			if network == "" {
				network = NetworkSepolia
			}
			rec := receipt{
				At:       stamp(now),
				Network:  network,
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
	return mw(next), nil
}

// ServePaywall listens until ctx is cancelled. The facilitator is https://x402.org/facilitator.
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

func stamp(now func() time.Time) string {
	if now == nil {
		return time.Now().UTC().Format(time.RFC3339)
	}
	return now().UTC().Format(time.RFC3339)
}
