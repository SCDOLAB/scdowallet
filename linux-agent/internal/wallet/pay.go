package wallet

import (
	"context"
	"encoding/hex"
	"fmt"
	"io"
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
	Root       string
	Name       string
	URL        string
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
// PAYMENT-SIGNATURE. Only eip155:84532 is registered.
func Pay(ctx context.Context, opt PayOptions) (Paid, error) {
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
	if doc.Killed {
		return Paid{}, fmt.Errorf("wallet kill switch is on")
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
	var settled *x402.SettleResponse
	client := x402.Newx402Client(
		x402.WithSpendControls(x402.SpendControls{MaxAmountPerPayment: USDCap(doc.MaxAtomic)}),
	).Register(x402.Network(NetworkSepolia), evmclient.NewExactEvmScheme(signer, nil))
	client.OnBeforePaymentCreation(func(pc x402.PaymentCreationContext) (*x402.BeforePaymentCreationHookResult, error) {
		req := pc.SelectedRequirements
		chosen = Decision{
			Network: req.GetNetwork(),
			Asset:   req.GetAsset(),
			PayTo:   req.GetPayTo(),
			Amount:  req.GetAmount(),
			Now:     now,
		}
		if err := Allow(doc, chosen); err != nil {
			return &x402.BeforePaymentCreationHookResult{Abort: true, Reason: err.Error()}, nil
		}
		return nil, nil
	})
	client.OnAfterPaymentCreation(func(pc x402.PaymentCreatedContext) error {
		auth, _ := pc.Payload.GetPayload()["authorization"].(map[string]any)
		if n, _ := auth["nonce"].(string); len(n) > 0 && len(n) <= 80 {
			authNonce = n
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

	base := opt.HTTP
	if base == nil {
		base = &http.Client{Timeout: 90 * time.Second}
	}
	httpClient := x402http.WrapHTTPClientWithPayment(base, x402http.Newx402HTTPClient(client))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, opt.URL, nil)
	if err != nil {
		return Paid{}, err
	}
	req.Header.Set("accept", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return Paid{}, sepoliaOnly(err)
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
		doc.addSpent(chosen.Amount, now)
		doc.LastTx = settled.Transaction
		doc.LastPayTo = payTo
		doc.LastAmount = chosen.Amount
		doc.LastResource = resource
		doc.LastNonce = authNonce
		doc.LastRecorded = false
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
			Basescan: "https://sepolia.basescan.org/tx/" + settled.Transaction,
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
		Basescan: "https://sepolia.basescan.org/tx/" + settled.Transaction,
	}, nil
}

// sepoliaOnly keeps the Base Sepolia refusal visible when the SDK drops an
// unregistered network before the spend-cap hook runs.
func sepoliaOnly(err error) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	if strings.Contains(msg, "no supported payment schemes") || strings.Contains(msg, "no client registered for network") {
		return fmt.Errorf("only Base Sepolia (eip155:84532) payments are enabled: %w", err)
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
		return fmt.Errorf("wallet is frozen on the ledger")
	}
	return nil
}
