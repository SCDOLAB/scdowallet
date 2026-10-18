package wallet

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
)

func TestEmailAndXBinding(t *testing.T) {
	var startBody map[string]any
	var confirmBody map[string]any
	var xBody map[string]any
	confirms := 0
	var xStatus atomic.Int32
	xStatus.Store(http.StatusServiceUnavailable)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		w.Header().Set("content-type", "application/json")
		switch r.URL.Path {
		case "/bind/email/start":
			_ = json.Unmarshal(raw, &startBody)
			_, _ = w.Write([]byte(`{"ok":true,"delivery":"todo_no_sender","nonce":"n-email"}`))
		case "/bind/email/confirm":
			confirms++
			var env map[string]any
			_ = json.Unmarshal(raw, &env)
			confirmBody, _ = env["payload"].(map[string]any)
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"ok":false,"error":"code"}`))
		case "/bind/x/start":
			_ = json.Unmarshal(raw, &xBody)
			status := int(xStatus.Load())
			w.WriteHeader(status)
			if status == http.StatusOK {
				_, _ = w.Write([]byte(`{"ok":true,"authUrl":"https://x.example/oauth?state=1"}`))
				return
			}
			_, _ = w.Write([]byte(`{"ok":false,"error":"not configured"}`))
		default:
			if strings.HasPrefix(r.URL.Path, "/agents/") {
				_, _ = w.Write([]byte(`{"ok":true,"summary":{"frozen":null}}`))
				return
			}
			_, _ = w.Write([]byte(`{"ok":true}`))
		}
	}))
	defer srv.Close()

	root := t.TempDir()
	if _, err := agent.Create(root, "bot", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "TEST", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(context.Background(), CreateOptions{
		Root: root, Name: "bot", BotID: "bot", Email: " Bot@Example.com ", LedgerURLs: []string{srv.URL},
	}); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(root + "/bot/email.txt")
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("email file %v", err)
	}
	salt, err := os.ReadFile(root + "/bot/email.salt")
	if err != nil || len(salt) != 32 {
		t.Fatal("salt")
	}

	started, err := BindEmail(context.Background(), EmailOptions{Root: root, Name: "bot", LedgerURLs: []string{srv.URL}})
	if err != nil {
		t.Fatal(err)
	}
	if !started.NoSender || started.Delivery != "todo_no_sender" || started.Nonce != "n-email" {
		t.Fatalf("%+v", started)
	}
	if startBody["email"] != "bot@example.com" {
		t.Fatal("email")
	}
	gotSalt, _ := startBody["salt"].(string)
	if len(gotSalt) != 66 || !strings.HasPrefix(gotSalt, "0x") {
		t.Fatal("salt shape")
	}
	if !strings.EqualFold(gotSalt, "0x"+encodeHex(salt)) {
		t.Fatal("salt mismatch")
	}
	if strings.Contains(started.Ledger, gotSalt) || strings.Contains(started.Delivery, "bot@example.com") {
		t.Fatal("result leaked")
	}

	if _, err := BindEmail(context.Background(), EmailOptions{
		Root: root, Name: "bot", Email: "other@example.com", LedgerURLs: []string{srv.URL},
	}); err == nil || strings.Contains(err.Error(), gotSalt) {
		t.Fatal(err)
	}

	for i := 1; i <= 5; i++ {
		_, err := ConfirmEmail(context.Background(), EmailOptions{
			Root: root, Name: "bot", Code: "000001", LedgerURLs: []string{srv.URL},
		})
		if err == nil || confirms != i {
			t.Fatalf("try %d err %v confirms %d", i, err, confirms)
		}
	}
	body, _ := confirmBody["body"].(map[string]any)
	if confirmBody["type"] != "emailconfirm" || body["nonce"] != "n-email" || body["code"] != "000001" {
		t.Fatalf("%#v", confirmBody)
	}
	if _, err := ConfirmEmail(context.Background(), EmailOptions{
		Root: root, Name: "bot", Code: "000002", LedgerURLs: []string{srv.URL},
	}); !errors.Is(err, ErrEmailTries) || confirms != 5 {
		t.Fatalf("sixth %v confirms %d", err, confirms)
	}
	if _, err := ConfirmEmail(context.Background(), EmailOptions{
		Root: root, Name: "bot", Code: "12", LedgerURLs: []string{srv.URL},
	}); err == nil || confirms != 5 {
		t.Fatal("short code posted")
	}

	if _, err := BindX(context.Background(), EmailOptions{Root: root, Name: "bot", LedgerURLs: []string{srv.URL}}); !errors.Is(err, ErrXNotEnabled) {
		t.Fatal(err)
	}
	if xBody["agent"] == "" {
		t.Fatal("x agent")
	}
	xStatus.Store(http.StatusOK)
	got, err := BindX(context.Background(), EmailOptions{Root: root, Name: "bot", LedgerURLs: []string{srv.URL}})
	if err != nil || got.AuthURL != "https://x.example/oauth?state=1" {
		t.Fatal(err, got.AuthURL)
	}
}

func encodeHex(b []byte) string {
	const hexdigits = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, c := range b {
		out[i*2] = hexdigits[c>>4]
		out[i*2+1] = hexdigits[c&0x0f]
	}
	return string(out)
}
