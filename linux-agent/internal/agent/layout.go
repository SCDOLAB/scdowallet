// Package agent is one bookkeeping identity on a machine.
//
// Directory layout (default root /var/lib/scdo-agent):
//
//	<root>/<name>/meta.json          public record
//	<root>/<name>/state.json         monotonic ledger seq
//	<root>/<name>/run.lock           process lock
//	<root>/<name>/keys/ledger.key    secp256k1 identity, mode 0600
//	<root>/<name>/keys/wallet.key    reserved for a second key; not created here
//
// The key store is one file per purpose, so another key can sit beside
// ledger.key without sharing its scalar or this seq counter.
package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/keys"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

const (
	DefaultRoot = "/var/lib/scdo-agent"
	Platform    = "linux"
	RoleLight   = "light-node"
	RoleServer  = "server-node"
	CodeLight   = "light"
	CodeServer  = "server"
)

var (
	nameRe  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`)
	tokenRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)
	// ErrExists means init already created this name.
	ErrExists = errors.New("agent already exists")
	// ErrRunning means another run holds the lock.
	ErrRunning = errors.New("agent is already running")
)

// Meta is safe to print. It never contains a private key.
type Meta struct {
	V          int    `json:"v"`
	Name       string `json:"name"`
	Address    string `json:"address"`
	Payout     string `json:"payout"`
	Label      string `json:"label"`
	Role       string `json:"role"`
	Code       string `json:"code"`
	Platform   string `json:"platform"`
	Ref        string `json:"ref,omitempty"`
	Src        string `json:"src,omitempty"`
	CreatedAt  string `json:"createdAt"`
	KeyPurpose string `json:"keyPurpose"`
}

type stateDoc struct {
	V   int   `json:"v"`
	Seq int64 `json:"seq"`
}

// Layout is one named agent directory.
type Layout struct {
	Root string
	Name string
	Dir  string
	Meta Meta
}

// ValidateName checks a systemd instance name.
func ValidateName(name string) error {
	if !nameRe.MatchString(name) {
		return fmt.Errorf("name must match %s", nameRe.String())
	}
	return nil
}

// NormalizeRole maps a role to the heartbeat code the ledger should see.
func NormalizeRole(role string) (string, string, error) {
	if role == "" {
		role = RoleLight
	}
	switch role {
	case RoleLight:
		return RoleLight, CodeLight, nil
	case RoleServer:
		return RoleServer, CodeServer, nil
	default:
		return "", "", fmt.Errorf("role must be light-node or server-node")
	}
}

// CleanToken applies the desktop join token rule. Empty is allowed.
func CleanToken(v string) (string, error) {
	s := strings.TrimSpace(v)
	if s == "" {
		return "", nil
	}
	if !tokenRe.MatchString(s) {
		return "", fmt.Errorf("token must be 1-64 characters of letters, digits, dot, underscore or hyphen")
	}
	return s, nil
}

// CutLabel limits a label to 40 Unicode code points, matching the desktop slice for BMP text.
func CutLabel(name, label string) string {
	s := strings.TrimSpace(label)
	if s == "" {
		s = name
	}
	if utf8.RuneCountInString(s) <= 40 {
		return s
	}
	r := []rune(s)
	return string(r[:40])
}

// Create initialises a new agent. It does not replace an existing key.
func Create(root, name, payout, label, role, ref, src string, passphrase []byte) (*Layout, error) {
	if err := ValidateName(name); err != nil {
		return nil, err
	}
	sum, err := ledger.ChecksumAddress(payout)
	if err != nil {
		return nil, err
	}
	role, code, err := NormalizeRole(role)
	if err != nil {
		return nil, err
	}
	ref, err = CleanToken(ref)
	if err != nil {
		return nil, err
	}
	src, err = CleanToken(src)
	if err != nil {
		return nil, err
	}
	if root == "" {
		root = DefaultRoot
	}
	dir := filepath.Join(root, name)
	if _, err := os.Stat(filepath.Join(dir, "meta.json")); err == nil {
		return nil, ErrExists
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	_ = os.Chmod(root, 0o755)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	keyDir := filepath.Join(dir, "keys")
	if err := os.MkdirAll(keyDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(keyDir, 0o700); err != nil {
		return nil, err
	}
	store := keys.Store{Dir: keyDir}
	k, err := store.Create("ledger", passphrase)
	if err != nil {
		return nil, err
	}
	meta := Meta{
		V:          1,
		Name:       name,
		Address:    k.Address(),
		Payout:     sum,
		Label:      CutLabel(name, label),
		Role:       role,
		Code:       code,
		Platform:   Platform,
		Ref:        ref,
		Src:        src,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
		KeyPurpose: "ledger",
	}
	if err := writeJSON(filepath.Join(dir, "meta.json"), meta, 0o644); err != nil {
		return nil, err
	}
	if err := writeJSON(filepath.Join(dir, "state.json"), stateDoc{V: 1, Seq: 0}, 0o600); err != nil {
		return nil, err
	}
	chownTree(dir)
	return &Layout{Root: root, Name: name, Dir: dir, Meta: meta}, nil
}

// Open loads meta. It does not read the private key.
func Open(root, name string) (*Layout, error) {
	if err := ValidateName(name); err != nil {
		return nil, err
	}
	if root == "" {
		root = DefaultRoot
	}
	dir := filepath.Join(root, name)
	var meta Meta
	if err := readJSON(filepath.Join(dir, "meta.json"), &meta); err != nil {
		return nil, fmt.Errorf("agent %s is not initialised", name)
	}
	if meta.Name == "" {
		meta.Name = name
	}
	return &Layout{Root: root, Name: name, Dir: dir, Meta: meta}, nil
}

// OpenKey loads the ledger identity. The scalar stays inside the returned key.
func (l *Layout) OpenKey(passphrase []byte) (*ledger.Key, error) {
	return (keys.Store{Dir: filepath.Join(l.Dir, "keys")}).Open("ledger", passphrase)
}

// List returns agent names that have a meta.json, in directory order.
func List(root string) ([]Meta, error) {
	if root == "" {
		root = DefaultRoot
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []Meta
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		var meta Meta
		if err := readJSON(filepath.Join(root, e.Name(), "meta.json"), &meta); err != nil {
			continue
		}
		if meta.Name == "" {
			meta.Name = e.Name()
		}
		out = append(out, meta)
	}
	return out, nil
}

// NextSeq persists the next ledger sequence number before it is signed.
func (l *Layout) NextSeq() (int64, error) {
	path := filepath.Join(l.Dir, "state.json")
	var st stateDoc
	if err := readJSON(path, &st); err != nil {
		if !os.IsNotExist(err) {
			return 0, fmt.Errorf("seq file is unreadable")
		}
		st = stateDoc{V: 1, Seq: 0}
	}
	if st.Seq < 0 {
		return 0, fmt.Errorf("seq file is unreadable")
	}
	st.V = 1
	st.Seq++
	if err := writeJSON(path, st, 0o600); err != nil {
		return 0, err
	}
	return st.Seq, nil
}

// LockRun takes a non-blocking exclusive lock for the life of the process.
func (l *Layout) LockRun() (func(), error) {
	f, err := os.OpenFile(filepath.Join(l.Dir, "run.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, ErrRunning
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
	}, nil
}

func chownTree(root string) {
	if os.Geteuid() != 0 {
		return
	}
	u, err := user.Lookup("scdo-agent")
	if err != nil {
		return
	}
	uid, err1 := strconv.Atoi(u.Uid)
	gid, err2 := strconv.Atoi(u.Gid)
	if err1 != nil || err2 != nil {
		return
	}
	_ = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err == nil {
			_ = os.Chown(p, uid, gid)
		}
		return nil
	})
}

func writeJSON(path string, v any, mode os.FileMode) error {
	blob, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	blob = append(blob, '\n')
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			os.Remove(name)
		}
	}()
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(blob); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(name, path); err != nil {
		return err
	}
	cleanup = false
	return os.Chmod(path, mode)
}

func readJSON(path string, dest any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, dest)
}
