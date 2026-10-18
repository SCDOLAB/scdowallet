// Package wallet is the per-bot Base Sepolia wallet.
//
// Payment signing and the PAYMENT-SIGNATURE header come from the open-source
// x402 SDK (https://github.com/coinbase/x402, Apache-2.0). This package adds
// the SCDO ledger bind, spend caps, payee allowlist, kill switch, and freeze.
package wallet

import (
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
)

const (
	// NetworkSepolia is the only network this agent pays.
	NetworkSepolia = "eip155:84532"
	// SepoliaUSDC is the Base Sepolia USDC contract the x402 SDK already lists
	// with EIP-712 name "USDC" and version "2".
	SepoliaUSDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
	fileName    = "wallet.json"
)

// Doc is the public wallet record. It never contains a private key.
type Doc struct {
	V            int      `json:"v"`
	BotID        string   `json:"botId"`
	Network      string   `json:"network"`
	Address      string   `json:"address"`
	MaxAtomic    string   `json:"maxAtomic"`
	DailyAtomic  string   `json:"dailyAtomic"`
	SpentAtomic  string   `json:"spentAtomic"`
	SpentDay     string   `json:"spentDay,omitempty"`
	Payees       []string `json:"payees,omitempty"`
	Domains      []string `json:"domains,omitempty"`
	EmailCommit  string   `json:"emailCommit,omitempty"`
	LimitsCommit string   `json:"limitsCommit,omitempty"`
	Killed       bool     `json:"killed"`
	LastTx       string   `json:"lastTx,omitempty"`
	LastPayTo    string   `json:"lastPayTo,omitempty"`
	LastAmount   string   `json:"lastAmount,omitempty"`
	LastResource string   `json:"lastResource,omitempty"`
	LastNonce    string   `json:"lastNonce,omitempty"`
	LastRecorded bool     `json:"lastRecorded,omitempty"`
}

func docPath(dir string) string {
	return filepath.Join(dir, fileName)
}

func loadDoc(dir string) (Doc, error) {
	b, err := os.ReadFile(docPath(dir))
	if err != nil {
		if os.IsNotExist(err) {
			return Doc{V: 1, Network: NetworkSepolia, MaxAtomic: "1000000", DailyAtomic: "5000000", SpentAtomic: "0"}, nil
		}
		return Doc{}, err
	}
	var doc Doc
	if err := json.Unmarshal(b, &doc); err != nil {
		return Doc{}, err
	}
	if doc.Network == "" {
		doc.Network = NetworkSepolia
	}
	if doc.MaxAtomic == "" {
		doc.MaxAtomic = "1000000"
	}
	if doc.DailyAtomic == "" {
		doc.DailyAtomic = "5000000"
	}
	if doc.SpentAtomic == "" {
		doc.SpentAtomic = "0"
	}
	return doc, nil
}

func saveDoc(dir string, doc Doc) error {
	doc.V = 1
	b, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(docPath(dir), append(b, '\n'), 0o600)
}

func (d Doc) spentToday(now time.Time) *big.Int {
	day := now.UTC().Format("2006-01-02")
	if d.SpentDay != day {
		return big.NewInt(0)
	}
	n, ok := new(big.Int).SetString(d.SpentAtomic, 10)
	if !ok {
		return big.NewInt(0)
	}
	return n
}

func (d *Doc) addSpent(amount string, now time.Time) {
	day := now.UTC().Format("2006-01-02")
	spent := d.spentToday(now)
	add, ok := new(big.Int).SetString(amount, 10)
	if !ok {
		return
	}
	d.SpentDay = day
	d.SpentAtomic = spent.Add(spent, add).String()
}

// LayoutDir is the agent directory that holds wallet.json.
func LayoutDir(lay *agent.Layout) string {
	return lay.Dir
}

func sameAddr(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}
