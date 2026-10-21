// Package wallet is the per-bot Base wallet (Base mainnet or Base Sepolia).
//
// Payment signing and the PAYMENT-SIGNATURE header come from the open-source
// x402 SDK (https://github.com/coinbase/x402, Apache-2.0). This package adds
// the SCDO ledger bind, spend caps, payee allowlist, kill switch, and freeze.
package wallet

import (
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
)

const (
	// NetworkSepolia is Base Sepolia (--network base-sepolia).
	NetworkSepolia = "eip155:84532"
	// NetworkBase is Base mainnet (--network base, chain 8453).
	NetworkBase = "eip155:8453"
	// BaseUSDC is native USDC on Base mainnet: EIP-712 name "USD Coin", version "2", 6 decimals.
	BaseUSDC        = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
	BaseUSDCName    = "USD Coin"
	BaseUSDCVersion = "2"
	// NetworkShard0 is SCDO Shard0.
	NetworkShard0 = "eip155:5680"
	// SepoliaUSDC is the Base Sepolia USDC contract the x402 SDK already lists
	// with EIP-712 name "USDC" and version "2". It has 6 decimals.
	SepoliaUSDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
	// WSCDO is Wrapped SCDO (WSCDO3009) on Shard0. eip712Domain() and the
	// published x402 manifest both use name "Wrapped SCDO" and version "1".
	// The contract has 18 decimals. The facilitator is WSCDOFacilitatorURL.
	WSCDO        = "0xea830FF078410C22342a39e8985E439dc0035cf5"
	WSCDOName    = "Wrapped SCDO"
	WSCDOVersion = "1"
	// AssetUSDC and AssetWSCDO are the wallet create --asset names.
	AssetUSDC     = "usdc"
	AssetWSCDO    = "wscdo"
	USDCDecimals  = 6
	WSCDODecimals = 18
	fileName      = "wallet.json"
)

// Doc is the public wallet record. It never contains a private key.
type Doc struct {
	V       int    `json:"v"`
	BotID   string `json:"botId"`
	Network string `json:"network"`
	Address string `json:"address"`
	// Asset is the serve-paywall asset: usdc or wscdo. Empty means usdc.
	Asset       string `json:"asset,omitempty"`
	MaxAtomic   string `json:"maxAtomic"`
	DailyAtomic string `json:"dailyAtomic"`
	SpentAtomic string `json:"spentAtomic"`
	SpentDay    string `json:"spentDay,omitempty"`
	// WSCDO caps are 18-decimal atomic units. Empty means the default of 1 and 5.
	MaxWSCDO      string   `json:"maxWscdo,omitempty"`
	DailyWSCDO    string   `json:"dailyWscdo,omitempty"`
	SpentWSCDO    string   `json:"spentWscdo,omitempty"`
	SpentWSCDODay string   `json:"spentWscdoDay,omitempty"`
	LastNetwork   string   `json:"lastNetwork,omitempty"`
	Payees        []string `json:"payees,omitempty"`
	Domains       []string `json:"domains,omitempty"`
	EmailCommit   string   `json:"emailCommit,omitempty"`
	BindHash      string   `json:"bindHash,omitempty"`
	LimitsCommit  string   `json:"limitsCommit,omitempty"`
	Killed        bool     `json:"killed"`
	LastTx        string   `json:"lastTx,omitempty"`
	LastPayTo     string   `json:"lastPayTo,omitempty"`
	LastAmount    string   `json:"lastAmount,omitempty"`
	LastResource  string   `json:"lastResource,omitempty"`
	LastNonce     string   `json:"lastNonce,omitempty"`
	LastRecorded  bool     `json:"lastRecorded,omitempty"`
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

func (d *Doc) addSpent(network, amount string, now time.Time) {
	if network == NetworkShard0 {
		day := now.UTC().Format("2006-01-02")
		spent := d.spentWSCDO(now)
		add, ok := new(big.Int).SetString(amount, 10)
		if !ok {
			return
		}
		d.SpentWSCDODay = day
		d.SpentWSCDO = spent.Add(spent, add).String()
		return
	}
	day := now.UTC().Format("2006-01-02")
	spent := d.spentToday(now)
	add, ok := new(big.Int).SetString(amount, 10)
	if !ok {
		return
	}
	d.SpentDay = day
	d.SpentAtomic = spent.Add(spent, add).String()
}

func (d Doc) spentWSCDO(now time.Time) *big.Int {
	day := now.UTC().Format("2006-01-02")
	if d.SpentWSCDODay != day {
		return big.NewInt(0)
	}
	n, ok := new(big.Int).SetString(d.SpentWSCDO, 10)
	if !ok {
		return big.NewInt(0)
	}
	return n
}

func (d Doc) maxWSCDO() string {
	if strings.TrimSpace(d.MaxWSCDO) == "" {
		return "1000000000000000000"
	}
	return d.MaxWSCDO
}

func (d Doc) dailyWSCDO() string {
	if strings.TrimSpace(d.DailyWSCDO) == "" {
		return "5000000000000000000"
	}
	return d.DailyWSCDO
}

// NormalizeAsset accepts usdc, wscdo, and the manifest symbol wscdo3009.
func NormalizeAsset(s string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", AssetUSDC:
		return AssetUSDC, nil
	case AssetWSCDO, "wscdo3009":
		return AssetWSCDO, nil
	default:
		return "", fmt.Errorf("asset")
	}
}

// ParseNetwork maps the --network flag to a CAIP-2 id. "base" is Base mainnet.
func ParseNetwork(s string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "base", "base-mainnet", "mainnet", NetworkBase, "8453":
		return NetworkBase, nil
	case "base-sepolia", "sepolia", NetworkSepolia, "84532":
		return NetworkSepolia, nil
	default:
		return "", fmt.Errorf("network must be base or base-sepolia")
	}
}

// USDCFor is the USDC contract on a Base network, or "" for other networks.
func USDCFor(network string) string {
	switch network {
	case NetworkBase:
		return BaseUSDC
	case NetworkSepolia:
		return SepoliaUSDC
	}
	return ""
}

// isUSDC reports a Base mainnet or Base Sepolia USDC requirement.
func isUSDC(network, asset string) bool {
	u := USDCFor(network)
	return u != "" && sameAddr(asset, u)
}

// NetworkLabel is the --network name for a CAIP-2 id.
func NetworkLabel(network string) string {
	switch network {
	case NetworkBase:
		return "base"
	case NetworkSepolia:
		return "base-sepolia"
	case NetworkShard0:
		return "scdo-shard0"
	}
	return network
}

// LayoutDir is the agent directory that holds wallet.json.
func LayoutDir(lay *agent.Layout) string {
	return lay.Dir
}

func sameAddr(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}
