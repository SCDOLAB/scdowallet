package erc8004

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

// DefaultRPCs is Shard0 on scdo.com.au, then apeccapital.org.
func DefaultRPCs() []string {
	return []string{
		"https://scdo.com.au/rpc/0",
		"https://apeccapital.org/rpc/0",
	}
}

// SanitizeRPC checks a Shard0 endpoint. http is only allowed for loopback tests.
func SanitizeRPC(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || u.User != nil {
		return "", fmt.Errorf("bad shard0 rpc")
	}
	host := strings.ToLower(u.Hostname())
	if host == "scdoscan.io" || strings.HasSuffix(host, ".scdoscan.io") || host == "82.223.19.88" {
		return "", fmt.Errorf("shard0 rpc host is not used")
	}
	switch u.Scheme {
	case "https":
	case "http":
		if host != "127.0.0.1" && host != "localhost" {
			return "", fmt.Errorf("bad shard0 rpc")
		}
	default:
		return "", fmt.Errorf("bad shard0 rpc")
	}
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

type rpc struct {
	URLs []string
	HTTP *http.Client
	base string
}

type rpcResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Message string `json:"message"`
	} `json:"error"`
}

type logJSON struct {
	Topics          []string `json:"topics"`
	Data            string   `json:"data"`
	TransactionHash string   `json:"transactionHash"`
}

type mined struct {
	ok   bool
	logs []logJSON
}

func (c *rpc) http() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
}

func (c *rpc) dial(ctx context.Context) (*rpc, error) {
	var last error
	for _, raw := range c.URLs {
		one, err := SanitizeRPC(raw)
		if err != nil {
			last = err
			continue
		}
		next := &rpc{URLs: []string{one}, HTTP: c.HTTP, base: one}
		id, err := next.chainID(ctx)
		if err != nil {
			last = err
			continue
		}
		if id.Cmp(big.NewInt(ChainID)) != 0 {
			last = fmt.Errorf("shard0 rpc chain id %s", id.String())
			continue
		}
		return next, nil
	}
	if last == nil {
		last = fmt.Errorf("no shard0 rpc")
	}
	return nil, last
}

func (c *rpc) chainID(ctx context.Context) (*big.Int, error) {
	raw, err := c.call(ctx, "eth_chainId", []any{})
	if err != nil {
		return nil, err
	}
	return parseHex(raw)
}

func (c *rpc) registrations(ctx context.Context, address string) ([]foundReg, error) {
	params := []any{map[string]any{
		"address":   IdentityRegistry,
		"fromBlock": "0x0",
		"toBlock":   "latest",
		"topics":    []any{registeredTopic.Hex(), nil, topicAddress(address)},
	}}
	raw, err := c.call(ctx, "eth_getLogs", params)
	if err != nil {
		return nil, err
	}
	var logs []logJSON
	if err := json.Unmarshal(raw, &logs); err != nil {
		return nil, err
	}
	var out []foundReg
	for _, lg := range logs {
		if len(lg.Topics) < 3 || !strings.EqualFold(lg.Topics[0], registeredTopic.Hex()) {
			continue
		}
		if !strings.EqualFold(lg.Topics[2], topicAddress(address)) {
			continue
		}
		id := new(big.Int).SetBytes(common.FromHex(lg.Topics[1]))
		if id.Sign() == 0 {
			continue
		}
		out = append(out, foundReg{id: id, tx: lg.TransactionHash, uri: uriFromLog(lg.Data)})
	}
	return out, nil
}

func uriFromLog(data string) string {
	b := common.FromHex(data)
	if len(b) < 64 {
		return ""
	}
	decoded, err := registryABI.Events["Registered"].Inputs.NonIndexed().Unpack(b)
	if err != nil || len(decoded) == 0 {
		return ""
	}
	s, _ := decoded[0].(string)
	return s
}

func (c *rpc) ownerOf(ctx context.Context, id *big.Int) (string, error) {
	data, err := registryABI.Pack("ownerOf", id)
	if err != nil {
		return "", err
	}
	raw, err := c.call(ctx, "eth_call", []any{map[string]string{
		"to":   IdentityRegistry,
		"data": "0x" + hex.EncodeToString(data),
	}, "latest"})
	if err != nil {
		return "", err
	}
	var hexText string
	if err := json.Unmarshal(raw, &hexText); err != nil {
		return "", err
	}
	decoded, err := registryABI.Unpack("ownerOf", common.FromHex(hexText))
	if err != nil || len(decoded) == 0 {
		return "", err
	}
	addr, _ := decoded[0].(common.Address)
	return addr.Hex(), nil
}

func (c *rpc) metadata(ctx context.Context, id *big.Int) ([]byte, error) {
	data, err := registryABI.Pack("getMetadata", id, MetadataKey)
	if err != nil {
		return nil, err
	}
	raw, err := c.call(ctx, "eth_call", []any{map[string]string{
		"to":   IdentityRegistry,
		"data": "0x" + hex.EncodeToString(data),
	}, "latest"})
	if err != nil {
		return nil, err
	}
	var hexText string
	if err := json.Unmarshal(raw, &hexText); err != nil {
		return nil, err
	}
	decoded, err := registryABI.Unpack("getMetadata", common.FromHex(hexText))
	if err != nil || len(decoded) == 0 {
		return nil, err
	}
	b, _ := decoded[0].([]byte)
	return b, nil
}

func (c *rpc) balance(ctx context.Context, address string) (*big.Int, error) {
	raw, err := c.call(ctx, "eth_getBalance", []any{address, "latest"})
	if err != nil {
		return nil, err
	}
	return parseHex(raw)
}

func (c *rpc) nonce(ctx context.Context, address string) (uint64, error) {
	raw, err := c.call(ctx, "eth_getTransactionCount", []any{address, "pending"})
	if err != nil {
		return 0, err
	}
	n, err := parseHex(raw)
	if err != nil {
		return 0, err
	}
	return n.Uint64(), nil
}

func (c *rpc) gasPrice(ctx context.Context) (*big.Int, error) {
	raw, err := c.call(ctx, "eth_gasPrice", []any{})
	if err != nil {
		return nil, err
	}
	return parseHex(raw)
}

func (c *rpc) estimate(ctx context.Context, from string, data []byte) (uint64, error) {
	raw, err := c.call(ctx, "eth_estimateGas", []any{map[string]string{
		"from":  from,
		"to":    IdentityRegistry,
		"data":  "0x" + hex.EncodeToString(data),
		"value": "0x0",
	}})
	if err != nil {
		return 0, err
	}
	n, err := parseHex(raw)
	if err != nil {
		return 0, err
	}
	if !n.IsUint64() || n.Uint64() == 0 {
		return 0, fmt.Errorf("bad gas estimate")
	}
	gas := n.Uint64()
	extra := gas / 5
	if gas+extra >= gas {
		gas += extra
	}
	return gas, nil
}

func (c *rpc) send(ctx context.Context, raw []byte) (string, error) {
	body, err := c.call(ctx, "eth_sendRawTransaction", []any{"0x" + hex.EncodeToString(raw)})
	if err != nil {
		return "", err
	}
	var hash string
	if err := json.Unmarshal(body, &hash); err != nil {
		return "", err
	}
	if !strings.HasPrefix(hash, "0x") || len(hash) != 66 {
		return "", fmt.Errorf("bad transaction hash")
	}
	return hash, nil
}

func (c *rpc) wait(ctx context.Context, hash string) (mined, error) {
	deadline := time.Now().Add(receiptWait)
	for {
		raw, err := c.call(ctx, "eth_getTransactionReceipt", []any{hash})
		if err != nil {
			return mined{}, err
		}
		if string(raw) != "null" {
			var doc struct {
				Status string    `json:"status"`
				Logs   []logJSON `json:"logs"`
			}
			if err := json.Unmarshal(raw, &doc); err != nil {
				return mined{}, err
			}
			return mined{ok: doc.Status == "0x1" || doc.Status == "0x01", logs: doc.Logs}, nil
		}
		if time.Now().After(deadline) {
			return mined{}, fmt.Errorf("registration transaction was not mined")
		}
		select {
		case <-ctx.Done():
			return mined{}, ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

func (c *rpc) call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	if c.base == "" {
		return nil, fmt.Errorf("no shard0 rpc")
	}
	payload, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  method,
		"params":  params,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("user-agent", "scdo-agent")
	resp, err := c.http().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	buf, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	var doc rpcResponse
	if err := json.Unmarshal(buf, &doc); err != nil {
		return nil, fmt.Errorf("%s", method)
	}
	if doc.Error != nil && doc.Error.Message != "" {
		return nil, fmt.Errorf("%s", scrub(doc.Error.Message))
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("shard0 rpc HTTP %d", resp.StatusCode)
	}
	return doc.Result, nil
}

func parseHex(raw json.RawMessage) (*big.Int, error) {
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return nil, err
	}
	n := new(big.Int)
	if _, ok := n.SetString(strings.TrimPrefix(text, "0x"), 16); !ok {
		return nil, fmt.Errorf("bad hex")
	}
	return n, nil
}

var secretRE = regexp.MustCompile(`(?i)0x[0-9a-f]{64}`)

func scrub(s string) string {
	return secretRE.ReplaceAllString(strings.ReplaceAll(s, "\n", " "), "0x[key]")
}
