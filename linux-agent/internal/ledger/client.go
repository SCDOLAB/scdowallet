package ledger

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	// DefaultLedger is the primary Agent Ledger base. The desktop client posts
	// to {base}/register and {base}/heartbeat.
	DefaultLedger = "https://scdo.com.au/agent-ledger/api"
	// FallbackLedger is used only when the primary base does not accept the post.
	FallbackLedger = "https://apeccapital.org/agent-ledger/api"
)

// DefaultURLs is scdo.com.au, then apeccapital.org. scdoscan.io is never used.
func DefaultURLs() []string {
	return []string{DefaultLedger, FallbackLedger}
}

// ResolveURLs returns the ledger bases for a run. An override (flag or
// SCDO_AGENT_LEDGER) pins a single base, matching the desktop wallet.
func ResolveURLs(override string) ([]string, error) {
	if strings.TrimSpace(override) == "" {
		return DefaultURLs(), nil
	}
	one, err := SanitizeBase(override)
	if err != nil {
		return nil, err
	}
	return []string{one}, nil
}

// SanitizeBase checks a ledger API base. http is only allowed for loopback tests.
func SanitizeBase(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("bad ledger url")
	}
	if u.User != nil {
		return "", fmt.Errorf("bad ledger url")
	}
	host := strings.ToLower(u.Hostname())
	if host == "scdoscan.io" || strings.HasSuffix(host, ".scdoscan.io") {
		return "", fmt.Errorf("ledger host is not used")
	}
	switch u.Scheme {
	case "https":
	case "http":
		if host != "127.0.0.1" && host != "localhost" {
			return "", fmt.Errorf("bad ledger url")
		}
	default:
		return "", fmt.Errorf("bad ledger url")
	}
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

// Summary is the public GET /agents/<address> summary.
type Summary struct {
	Agent    string `json:"agent"`
	Online   bool   `json:"online"`
	LastSeen int64  `json:"lastSeen"`
	Code     string `json:"code"`
	Platform string `json:"platform"`
	Payout   string `json:"payout"`
	Version  string `json:"version"`
}

// Result is one ledger HTTP response.
type Result struct {
	OK     bool
	Status int
	Error  string
	Ledger string
	Body   map[string]any
}

// ShouldRetry reports whether a failed post should be sent again.
// 400, 409 and 413 are final, matching agentService.shouldRetry.
func ShouldRetry(status int) bool {
	if status == 400 || status == 409 || status == 413 {
		return false
	}
	return true
}

// Client posts signed envelopes and reads agent status.
type Client struct {
	URLs  []string
	HTTP  *http.Client
	Agent string // User-Agent
}

func (c *Client) http() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 10 * time.Second, CheckRedirect: refuseRedirect}
}

func refuseRedirect(req *http.Request, via []*http.Request) error {
	return http.ErrUseLastResponse
}

// Post sends one envelope, trying each base until one accepts it.
// On success the accepting base moves to the front of URLs.
func (c *Client) Post(ctx context.Context, typ string, env Envelope) (Result, error) {
	if _, ok := types[typ]; !ok {
		return Result{}, fmt.Errorf("bad type")
	}
	payload, err := json.Marshal(env)
	if err != nil {
		return Result{}, err
	}
	var last Result
	var lastErr error
	for i, base := range c.URLs {
		res, err := c.postOne(ctx, base, typ, payload)
		if err == nil && res.OK {
			if i > 0 {
				c.promote(base)
			}
			return res, nil
		}
		last, lastErr = res, err
	}
	if lastErr == nil && last.Error != "" {
		lastErr = fmt.Errorf("%s", last.Error)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no ledger")
	}
	return last, lastErr
}

func (c *Client) promote(base string) {
	next := []string{base}
	for _, u := range c.URLs {
		if u != base {
			next = append(next, u)
		}
	}
	c.URLs = next
}

func (c *Client) postOne(ctx context.Context, base, typ string, payload []byte) (Result, error) {
	endpoint := strings.TrimRight(base, "/") + "/" + pathFor(typ)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return Result{Ledger: base}, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("content-length", fmt.Sprintf("%d", len(payload)))
	if c.Agent != "" {
		req.Header.Set("user-agent", c.Agent)
	}
	resp, err := c.http().Do(req)
	if err != nil {
		return Result{Ledger: base}, err
	}
	defer resp.Body.Close()
	return decode(base, resp)
}

// Lookup reads GET {base}/agents/<address>, trying each base.
func (c *Client) Lookup(ctx context.Context, address string) (Summary, string, error) {
	var lastErr error
	var saw404 bool
	for _, base := range c.URLs {
		sum, status, err := c.lookupOne(ctx, base, address)
		if err == nil {
			return sum, base, nil
		}
		if status == http.StatusNotFound {
			saw404 = true
		}
		lastErr = err
	}
	if saw404 {
		return Summary{}, "", fmt.Errorf("not registered")
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no ledger")
	}
	return Summary{}, "", lastErr
}

func (c *Client) lookupOne(ctx context.Context, base, address string) (Summary, int, error) {
	endpoint := strings.TrimRight(base, "/") + "/agents/" + address
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Summary{}, 0, err
	}
	req.Header.Set("accept", "application/json")
	if c.Agent != "" {
		req.Header.Set("user-agent", c.Agent)
	}
	resp, err := c.http().Do(req)
	if err != nil {
		return Summary{}, 0, err
	}
	defer resp.Body.Close()
	res, err := decode(base, resp)
	if err != nil && res.Status == 0 {
		return Summary{}, 0, err
	}
	if res.Status == http.StatusNotFound {
		return Summary{}, res.Status, fmt.Errorf("not registered")
	}
	if !res.OK {
		if err == nil {
			err = fmt.Errorf("ledger status %d", res.Status)
		}
		return Summary{}, res.Status, err
	}
	raw, _ := json.Marshal(res.Body["summary"])
	var sum Summary
	if err := json.Unmarshal(raw, &sum); err != nil {
		return Summary{}, res.Status, err
	}
	return sum, res.Status, nil
}

// pathFor is the URL path under the ledger API base for a signed type.
func pathFor(typ string) string {
	switch typ {
	case "spend":
		return "ledger/spend"
	case "xrevoke":
		return "bind/x/revoke"
	case "batch":
		return "operator/batch"
	case "emailconfirm":
		return "bind/email/confirm"
	case "gpuattest":
		return "gpu/attest"
	case "gpusolve":
		return "gpu/solve"
	case "gas_drip":
		return "gas/drip"
	default:
		return typ
	}
}

// PostRaw posts an unsigned JSON document. payload may hold a secret; the caller wipes it.
// 400, 409, 413, and 503 stop the fallback walk.
func (c *Client) PostRaw(ctx context.Context, path string, payload []byte) (Result, error) {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	var last Result
	var lastErr error
	for i, base := range c.URLs {
		res, err := c.postRawOne(ctx, base, path, payload)
		if err == nil && res.OK {
			if i > 0 {
				c.promote(base)
			}
			return res, nil
		}
		last, lastErr = res, err
		if res.Status == http.StatusBadRequest || res.Status == http.StatusConflict || res.Status == http.StatusRequestEntityTooLarge || res.Status == http.StatusServiceUnavailable {
			break
		}
	}
	if lastErr == nil && last.Error != "" {
		lastErr = fmt.Errorf("%s", last.Error)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no ledger")
	}
	return last, lastErr
}

func (c *Client) postRawOne(ctx context.Context, base, path string, payload []byte) (Result, error) {
	endpoint := strings.TrimRight(base, "/") + path
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return Result{Ledger: base}, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("content-length", fmt.Sprintf("%d", len(payload)))
	if c.Agent != "" {
		req.Header.Set("user-agent", c.Agent)
	}
	resp, err := c.http().Do(req)
	if err != nil {
		return Result{Ledger: base}, err
	}
	defer resp.Body.Close()
	return decode(base, resp)
}

// Get reads a JSON document under the ledger base, trying each URL.
func (c *Client) Get(ctx context.Context, pathQuery string) (Result, error) {
	if !strings.HasPrefix(pathQuery, "/") {
		pathQuery = "/" + pathQuery
	}
	var last Result
	var lastErr error
	for _, base := range c.URLs {
		res, err := c.getOne(ctx, base, pathQuery)
		if err == nil && res.OK {
			return res, nil
		}
		last, lastErr = res, err
		if res.Status == http.StatusBadRequest || res.Status == http.StatusNotFound || res.Status == http.StatusConflict {
			break
		}
	}
	if lastErr == nil && last.Error != "" {
		lastErr = fmt.Errorf("%s", last.Error)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no ledger")
	}
	return last, lastErr
}

func (c *Client) getOne(ctx context.Context, base, pathQuery string) (Result, error) {
	endpoint := strings.TrimRight(base, "/") + pathQuery
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Result{Ledger: base}, err
	}
	req.Header.Set("accept", "application/json")
	if c.Agent != "" {
		req.Header.Set("user-agent", c.Agent)
	}
	resp, err := c.http().Do(req)
	if err != nil {
		return Result{Ledger: base}, err
	}
	defer resp.Body.Close()
	return decode(base, resp)
}

// Agents reads GET /agents?platform=&operator=.
func (c *Client) Agents(ctx context.Context, platform, operator string) (Result, error) {
	q := url.Values{}
	if strings.TrimSpace(platform) != "" {
		q.Set("platform", platform)
	}
	if strings.TrimSpace(operator) != "" {
		addr, err := ChecksumAddress(operator)
		if err != nil {
			return Result{}, err
		}
		q.Set("operator", addr)
	}
	return c.Get(ctx, "/agents?"+q.Encode())
}

// OperatorAgents reads GET /operators/<addr>/agents.
func (c *Client) OperatorAgents(ctx context.Context, operator string) (Result, error) {
	addr, err := ChecksumAddress(operator)
	if err != nil {
		return Result{}, err
	}
	return c.Get(ctx, "/operators/"+url.PathEscape(addr)+"/agents")
}

func decode(base string, resp *http.Response) (Result, error) {
	buf, err := io.ReadAll(io.LimitReader(resp.Body, 8192))
	if err != nil {
		return Result{Ledger: base, Status: resp.StatusCode}, err
	}
	var body map[string]any
	_ = json.Unmarshal(buf, &body)
	res := Result{Ledger: base, Status: resp.StatusCode, Body: body}
	if body != nil {
		if ok, _ := body["ok"].(bool); ok && resp.StatusCode == http.StatusOK {
			res.OK = true
			return res, nil
		}
		if e, _ := body["error"].(string); e != "" {
			res.Error = e
		}
	}
	if res.Error == "" {
		res.Error = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return res, fmt.Errorf("%s", res.Error)
}
