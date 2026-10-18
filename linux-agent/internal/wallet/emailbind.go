package wallet

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

const maxEmailTries = 5

// ErrEmailTries is returned when confirm-email has already been sent five times.
var ErrEmailTries = errors.New("email confirmation stopped after 5 tries")

// ErrXNotEnabled is the ledger response while no X app is configured.
var ErrXNotEnabled = errors.New("X binding not yet enabled on the ledger")

// EmailOptions starts or confirms an email binding.
type EmailOptions struct {
	Root       string
	Name       string
	Email      string
	Code       string
	Nonce      string
	Passphrase []byte
	LedgerURLs []string
	Now        func() time.Time
}

// EmailStart is the public result of POST /bind/email/start.
// Salt and the email address are not included.
type EmailStart struct {
	Delivery string
	Nonce    string
	NoSender bool
	Ledger   string
}

// EmailConfirm is the public result of POST /bind/email/confirm.
type EmailConfirm struct {
	Verified bool
	Attempts int
	Ledger   string
}

// XStart is the public result of POST /bind/x/start.
type XStart struct {
	AuthURL string
	Ledger  string
}

type emailPending struct {
	Nonce    string `json:"nonce,omitempty"`
	Attempts int    `json:"attempts"`
}

// BindEmail posts {agent, email, salt} to /bind/email/start.
// The salt is read from email.salt and is not written to the result or to errors.
// delivery "todo_no_sender" is success: the ledger has no mail sender yet.
func BindEmail(ctx context.Context, opt EmailOptions) (EmailStart, error) {
	lay, doc, agentKey, walletKey, err := openPair(opt.Root, opt.Name, opt.Passphrase)
	if err != nil {
		return EmailStart{}, err
	}
	defer wipeKey(agentKey)
	defer wipeKey(walletKey)
	if doc.EmailCommit == "" {
		return EmailStart{}, fmt.Errorf("no email commitment on this bot")
	}
	email := strings.TrimSpace(opt.Email)
	if email == "" {
		email, err = loadEmail(lay.Dir)
		if err != nil {
			return EmailStart{}, fmt.Errorf("email")
		}
	}
	salt, err := readSalt(lay.Dir)
	if err != nil {
		return EmailStart{}, err
	}
	commit, err := EmailCommit(salt, email)
	if err != nil {
		wipe(salt)
		return EmailStart{}, err
	}
	if !strings.EqualFold(commit, doc.EmailCommit) {
		wipe(salt)
		return EmailStart{}, fmt.Errorf("email does not match the stored commitment")
	}
	if strings.TrimSpace(opt.Email) != "" {
		if err := saveEmail(lay.Dir, email); err != nil {
			wipe(salt)
			return EmailStart{}, err
		}
	}
	body := map[string]any{
		"agent": agentKey.Address(),
		"email": email,
		"salt":  "0x" + hex.EncodeToString(salt),
	}
	wipe(salt)
	payload, err := json.Marshal(body)
	if err != nil {
		return EmailStart{}, err
	}
	defer wipe(payload)
	// Drop the only other copy of the salt hex.
	body["salt"] = ""
	body["email"] = ""
	urls := opt.LedgerURLs
	if len(urls) == 0 {
		urls = ledger.DefaultURLs()
	}
	res, err := (&ledger.Client{URLs: urls, Agent: "scdo-agent", HTTP: longClient()}).PostRaw(ctx, "/bind/email/start", payload)
	if err != nil || !res.OK {
		if res.Error != "" {
			return EmailStart{}, fmt.Errorf("%s", res.Error)
		}
		if err != nil {
			return EmailStart{}, err
		}
		return EmailStart{}, fmt.Errorf("ledger")
	}
	out := EmailStart{Ledger: strings.TrimRight(res.Ledger, "/") + "/agents/" + agentKey.Address()}
	if res.Body != nil {
		out.Delivery, _ = res.Body["delivery"].(string)
		out.Nonce = firstString(res.Body, "nonce", "emailNonce")
	}
	out.NoSender = out.Delivery == "todo_no_sender"
	pending := emailPending{Nonce: out.Nonce}
	if err := savePending(lay.Dir, pending); err != nil {
		return EmailStart{}, err
	}
	return out, nil
}

// ConfirmEmail posts a bot-signed emailconfirm envelope. The body is {nonce, code}.
// A sixth try is refused locally and is not sent.
func ConfirmEmail(ctx context.Context, opt EmailOptions) (EmailConfirm, error) {
	if !sixDigits(opt.Code) {
		return EmailConfirm{}, fmt.Errorf("code")
	}
	lay, _, agentKey, walletKey, err := openPair(opt.Root, opt.Name, opt.Passphrase)
	if err != nil {
		return EmailConfirm{}, err
	}
	defer wipeKey(agentKey)
	defer wipeKey(walletKey)
	pending, err := loadPending(lay.Dir)
	if err != nil {
		pending = emailPending{}
	}
	nonce := strings.TrimSpace(opt.Nonce)
	if nonce == "" {
		nonce = pending.Nonce
	}
	if nonce == "" {
		return EmailConfirm{}, fmt.Errorf("nonce")
	}
	if pending.Attempts >= maxEmailTries {
		return EmailConfirm{}, ErrEmailTries
	}
	pending.Nonce = nonce
	pending.Attempts++
	if err := savePending(lay.Dir, pending); err != nil {
		return EmailConfirm{}, err
	}
	now := time.Now()
	if opt.Now != nil {
		now = opt.Now()
	}
	urls := opt.LedgerURLs
	if len(urls) == 0 {
		urls = ledger.DefaultURLs()
	}
	seq, err := lay.NextSeq()
	if err != nil {
		return EmailConfirm{}, err
	}
	env, _, err := ledger.Sign(agentKey, "emailconfirm", seq, map[string]any{
		"nonce": nonce,
		"code":  opt.Code,
	}, now.UnixMilli())
	if err != nil {
		return EmailConfirm{}, err
	}
	res, err := (&ledger.Client{URLs: urls, Agent: "scdo-agent"}).Post(ctx, "emailconfirm", env)
	if err != nil || !res.OK {
		if res.Error != "" {
			return EmailConfirm{Attempts: pending.Attempts}, fmt.Errorf("%s", res.Error)
		}
		if err != nil {
			return EmailConfirm{Attempts: pending.Attempts}, err
		}
		return EmailConfirm{Attempts: pending.Attempts}, fmt.Errorf("ledger")
	}
	verified := true
	if res.Body != nil {
		if v, ok := res.Body["emailVerified"].(bool); ok {
			verified = v
		}
	}
	if !verified {
		return EmailConfirm{Attempts: pending.Attempts, Ledger: strings.TrimRight(res.Ledger, "/") + "/agents/" + agentKey.Address()}, fmt.Errorf("email")
	}
	return EmailConfirm{
		Verified: true,
		Attempts: pending.Attempts,
		Ledger:   strings.TrimRight(res.Ledger, "/") + "/agents/" + agentKey.Address(),
	}, nil
}

// BindX posts {agent} to /bind/x/start.
// A 503, or error "not configured", is ErrXNotEnabled. The xbind attestation is not sent.
func BindX(ctx context.Context, opt EmailOptions) (XStart, error) {
	_, _, agentKey, walletKey, err := openPair(opt.Root, opt.Name, opt.Passphrase)
	if err != nil {
		return XStart{}, err
	}
	defer wipeKey(agentKey)
	defer wipeKey(walletKey)
	urls := opt.LedgerURLs
	if len(urls) == 0 {
		urls = ledger.DefaultURLs()
	}
	payload, err := json.Marshal(map[string]any{"agent": agentKey.Address()})
	if err != nil {
		return XStart{}, err
	}
	res, err := (&ledger.Client{URLs: urls, Agent: "scdo-agent"}).PostRaw(ctx, "/bind/x/start", payload)
	if res.Status == 503 || res.Error == "not configured" {
		return XStart{}, ErrXNotEnabled
	}
	if err != nil || !res.OK {
		if res.Error != "" {
			return XStart{}, fmt.Errorf("%s", res.Error)
		}
		if err != nil {
			return XStart{}, err
		}
		return XStart{}, fmt.Errorf("ledger")
	}
	auth := authURL(res.Body)
	if auth == "" {
		return XStart{}, fmt.Errorf("the ledger did not return an X auth URL")
	}
	return XStart{AuthURL: auth, Ledger: res.Ledger}, nil
}

func sixDigits(code string) bool {
	if len(code) != 6 {
		return false
	}
	for _, c := range code {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func firstString(body map[string]any, keys ...string) string {
	for _, k := range keys {
		if s, ok := body[k].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func authURL(body map[string]any) string {
	for _, k := range []string{"url", "authUrl", "authorizationUrl", "authorizeUrl"} {
		s := firstString(body, k)
		if strings.HasPrefix(s, "https://") {
			return s
		}
	}
	return ""
}

func pendingPath(dir string) string {
	return filepath.Join(dir, "email-pending.json")
}

func loadPending(dir string) (emailPending, error) {
	b, err := os.ReadFile(pendingPath(dir))
	if err != nil {
		return emailPending{}, err
	}
	var p emailPending
	if err := json.Unmarshal(b, &p); err != nil {
		return emailPending{}, err
	}
	return p, nil
}

func savePending(dir string, p emailPending) error {
	b, err := json.Marshal(p)
	if err != nil {
		return err
	}
	path := pendingPath(dir)
	if err := os.WriteFile(path, b, 0o600); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

func wipe(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
