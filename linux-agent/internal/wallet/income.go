package wallet

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
	x402 "github.com/x402-foundation/x402/go/v2"
	"github.com/x402-foundation/x402/go/v2/types"
)

// Income is one settled Base Sepolia payment posted to /ledger/income.
type Income struct {
	Agent        string
	Payload      *types.PaymentPayload
	Requirements *types.PaymentRequirements
	Settlement   *x402.SettleResponse
}

// ReportIncome posts the full x402 payload and the settlement response.
// A bare transaction hash is not sent. settlementPending is retried until the receipt is visible.
func ReportIncome(ctx context.Context, urls []string, in Income) (ledger.Result, error) {
	body, err := incomeBody(in)
	if err != nil {
		return ledger.Result{}, err
	}
	if len(urls) == 0 {
		urls = ledger.DefaultURLs()
	}
	client := &ledger.Client{URLs: urls, Agent: "scdo-agent", HTTP: longClient()}
	var last ledger.Result
	var lastErr error
	for attempt := 0; attempt < 6; attempt++ {
		payload, err := json.Marshal(body)
		if err != nil {
			return ledger.Result{}, err
		}
		last, lastErr = client.PostRaw(ctx, "/ledger/income", payload)
		if lastErr == nil && last.OK {
			return last, nil
		}
		if !retryIncome(last) {
			break
		}
		wait := time.Duration(attempt+1) * 2 * time.Second
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return last, ctx.Err()
		case <-timer.C:
		}
	}
	if lastErr == nil && last.Error != "" {
		lastErr = fmt.Errorf("%s", last.Error)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("ledger")
	}
	return last, lastErr
}

func incomeBody(in Income) (map[string]any, error) {
	if strings.TrimSpace(in.Agent) == "" || in.Payload == nil || in.Settlement == nil {
		return nil, fmt.Errorf("income payload")
	}
	if !in.Settlement.Success || !strings.HasPrefix(in.Settlement.Transaction, "0x") || len(in.Settlement.Transaction) != 66 {
		return nil, fmt.Errorf("income payload")
	}
	reqs := in.Requirements
	if reqs == nil {
		copied := in.Payload.Accepted
		reqs = &copied
	}
	if reqs.Network != "" && reqs.Network != NetworkSepolia {
		return nil, fmt.Errorf("income network")
	}
	version := in.Payload.X402Version
	if version == 0 {
		version = 2
	}
	network := string(in.Settlement.Network)
	if network == "" {
		network = NetworkSepolia
	}
	settlement := map[string]any{
		"success":     true,
		"transaction": in.Settlement.Transaction,
		"network":     network,
		"payer":       in.Settlement.Payer,
	}
	if in.Settlement.Amount != "" {
		settlement["amount"] = in.Settlement.Amount
	}
	return map[string]any{
		"agent":               in.Agent,
		"x402Version":         version,
		"paymentPayload":      in.Payload,
		"paymentRequirements": reqs,
		"settlement":          settlement,
	}, nil
}

func retryIncome(res ledger.Result) bool {
	if res.Error == "settlementPending" || strings.Contains(res.Error, "settlementPending") {
		return true
	}
	switch res.Status {
	case 0, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func longClient() *http.Client {
	return &http.Client{Timeout: 45 * time.Second}
}
