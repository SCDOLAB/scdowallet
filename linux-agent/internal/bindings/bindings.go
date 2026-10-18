// Package bindings reads /etc/scdo-agent/x-accounts.toml.
// A row maps an X handle and user id to an agent name.
package bindings

import (
	"fmt"
	"strings"
	"unicode"
)

// Account is one X account row.
type Account struct {
	Handle string
	UserID string
	Agent  string
}

// Parse reads a small TOML subset: [[account]] tables with handle, user_id, and agent.
func Parse(text string) ([]Account, error) {
	var out []Account
	var cur *Account
	flush := func() error {
		if cur == nil {
			return nil
		}
		if cur.Handle == "" || cur.UserID == "" || cur.Agent == "" {
			return fmt.Errorf("account row needs handle, user_id, and agent")
		}
		if err := check(*cur); err != nil {
			return err
		}
		out = append(out, *cur)
		cur = nil
		return nil
	}
	for i, line := range strings.Split(text, "\n") {
		s := strings.TrimSpace(line)
		if s == "" || strings.HasPrefix(s, "#") {
			continue
		}
		if s == "[[account]]" {
			if err := flush(); err != nil {
				return nil, fmt.Errorf("line %d: %w", i+1, err)
			}
			cur = &Account{}
			continue
		}
		if cur == nil {
			return nil, fmt.Errorf("line %d: expected [[account]]", i+1)
		}
		key, val, ok := splitKV(s)
		if !ok {
			return nil, fmt.Errorf("line %d: bad assignment", i+1)
		}
		switch key {
		case "handle":
			cur.Handle = strings.TrimPrefix(val, "@")
		case "user_id":
			cur.UserID = val
		case "agent":
			cur.Agent = val
		default:
			return nil, fmt.Errorf("line %d: unknown field", i+1)
		}
	}
	if err := flush(); err != nil {
		return nil, err
	}
	seenA := map[string]struct{}{}
	seenU := map[string]struct{}{}
	for _, a := range out {
		if _, ok := seenA[a.Agent]; ok {
			return nil, fmt.Errorf("duplicate agent %s", a.Agent)
		}
		if _, ok := seenU[a.UserID]; ok {
			return nil, fmt.Errorf("duplicate user id %s", a.UserID)
		}
		seenA[a.Agent] = struct{}{}
		seenU[a.UserID] = struct{}{}
	}
	return out, nil
}

func check(a Account) error {
	if len(a.Handle) < 1 || len(a.Handle) > 15 {
		return fmt.Errorf("handle length")
	}
	for _, r := range a.Handle {
		if r > unicode.MaxASCII || !(r == '_' || (r >= '0' && r <= '9') || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z')) {
			return fmt.Errorf("handle characters")
		}
	}
	if a.UserID == "" || len(a.UserID) > 32 {
		return fmt.Errorf("user id")
	}
	for _, r := range a.UserID {
		if r < '0' || r > '9' {
			return fmt.Errorf("user id")
		}
	}
	return nil
}

func splitKV(s string) (string, string, bool) {
	i := strings.IndexByte(s, '=')
	if i <= 0 {
		return "", "", false
	}
	key := strings.TrimSpace(s[:i])
	val := strings.TrimSpace(s[i+1:])
	if len(val) >= 2 && val[0] == '"' && val[len(val)-1] == '"' {
		val = val[1 : len(val)-1]
	}
	return key, val, key != "" && val != ""
}
