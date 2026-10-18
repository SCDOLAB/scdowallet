// Package keys stores one secp256k1 key file per purpose.
//
// The ledger identity is keys/ledger.key. A later per-bot wallet uses the same
// format at keys/wallet.key; this package does not speak to a chain or a
// payment network. Callers add a command group on top.
package keys

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
	"golang.org/x/crypto/scrypt"
)

const (
	fileVersion   = 1
	purposeLedger = "ledger"
	purposeWallet = "wallet"
	kdfNone       = "none"
	kdfScrypt     = "scrypt"
	cipherGCM     = "aes-256-gcm"
	scryptN       = 32768
	scryptR       = 8
	scryptP       = 1
)

// ErrExists means the purpose file is already there. It is never overwritten.
var ErrExists = errors.New("key file already exists")

// ErrPassphrase means the file is encrypted and the passphrase was refused.
var ErrPassphrase = errors.New("key passphrase was refused")

// Store is the keys directory of one agent.
type Store struct {
	Dir string
}

// Path is the file for a purpose. wallet is reserved for a second key.
func (s Store) Path(purpose string) (string, error) {
	switch purpose {
	case purposeLedger:
		return filepath.Join(s.Dir, "ledger.key"), nil
	case purposeWallet:
		return filepath.Join(s.Dir, "wallet.key"), nil
	default:
		return "", fmt.Errorf("unknown key purpose")
	}
}

// Create writes a new key. A non-nil passphrase encrypts it. An empty
// passphrase slice is refused so an empty file is not treated as encryption.
// passphrase nil stores a mode-0600 key file for unattended use.
func (s Store) Create(purpose string, passphrase []byte) (*ledger.Key, error) {
	path, err := s.Path(purpose)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(path); err == nil {
		return nil, ErrExists
	}
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(s.Dir, 0o700); err != nil {
		return nil, err
	}
	k, err := ledger.Generate()
	if err != nil {
		return nil, err
	}
	if err := s.write(path, purpose, k, passphrase); err != nil {
		return nil, err
	}
	return k, nil
}

// Open reads a key. passphrase is required when the file is encrypted.
func (s Store) Open(purpose string, passphrase []byte) (*ledger.Key, error) {
	path, err := s.Path(purpose)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var outer fileDoc
	if err := json.Unmarshal(raw, &outer); err != nil || outer.V != fileVersion || outer.Purpose != purpose {
		return nil, fmt.Errorf("key file is not a scdo-agent key")
	}
	if outer.KDF == kdfScrypt {
		if len(passphrase) == 0 {
			return nil, ErrPassphrase
		}
		plain, err := decrypt(outer, purpose, passphrase)
		if err != nil {
			return nil, ErrPassphrase
		}
		defer ledger.Wipe(plain)
		return keyFromPlain(plain, purpose)
	}
	if outer.KDF != kdfNone && outer.KDF != "" {
		return nil, fmt.Errorf("key file is not a scdo-agent key")
	}
	return ledger.KeyFromHex(outer.Key)
}

func (s Store) write(path, purpose string, k *ledger.Key, passphrase []byte) error {
	scalar := k.Scalar()
	defer ledger.Wipe(scalar)
	inner := innerDoc{V: fileVersion, Kind: "secp256k1", Purpose: purpose, Key: "0x" + hexEncode(scalar)}
	if passphrase == nil {
		doc := fileDoc{V: fileVersion, Kind: "secp256k1", Purpose: purpose, KDF: kdfNone, Key: inner.Key}
		return writeJSON(path, doc, 0o600)
	}
	if len(passphrase) == 0 {
		return fmt.Errorf("passphrase file is empty")
	}
	blob, err := json.Marshal(inner)
	if err != nil {
		return err
	}
	defer ledger.Wipe(blob)
	doc, err := encrypt(purpose, blob, passphrase)
	if err != nil {
		return err
	}
	doc.V = fileVersion
	doc.Kind = "secp256k1"
	doc.Purpose = purpose
	return writeJSON(path, doc, 0o600)
}

type innerDoc struct {
	V       int    `json:"v"`
	Kind    string `json:"kind"`
	Purpose string `json:"purpose"`
	Key     string `json:"key"`
}

type fileDoc struct {
	V       int    `json:"v"`
	Kind    string `json:"kind"`
	Purpose string `json:"purpose"`
	KDF     string `json:"kdf"`
	Cipher  string `json:"cipher,omitempty"`
	N       int    `json:"n,omitempty"`
	R       int    `json:"r,omitempty"`
	P       int    `json:"p,omitempty"`
	Salt    string `json:"salt,omitempty"`
	Nonce   string `json:"nonce,omitempty"`
	CT      string `json:"ct,omitempty"`
	Key     string `json:"key,omitempty"`
}

func encrypt(purpose string, plain, pass []byte) (fileDoc, error) {
	salt := make([]byte, 16)
	nonce := make([]byte, 12)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return fileDoc{}, err
	}
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return fileDoc{}, err
	}
	dk, err := scrypt.Key(pass, salt, scryptN, scryptR, scryptP, 32)
	if err != nil {
		return fileDoc{}, err
	}
	defer ledger.Wipe(dk)
	block, err := aes.NewCipher(dk)
	if err != nil {
		return fileDoc{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return fileDoc{}, err
	}
	ct := gcm.Seal(nil, nonce, plain, []byte("scdo-agent-key-v1:"+purpose))
	return fileDoc{
		KDF:    kdfScrypt,
		Cipher: cipherGCM,
		N:      scryptN,
		R:      scryptR,
		P:      scryptP,
		Salt:   base64.StdEncoding.EncodeToString(salt),
		Nonce:  base64.StdEncoding.EncodeToString(nonce),
		CT:     base64.StdEncoding.EncodeToString(ct),
	}, nil
}

func decrypt(doc fileDoc, purpose string, pass []byte) ([]byte, error) {
	if doc.Cipher != cipherGCM || doc.N == 0 {
		return nil, ErrPassphrase
	}
	salt, err := base64.StdEncoding.DecodeString(doc.Salt)
	if err != nil {
		return nil, err
	}
	nonce, err := base64.StdEncoding.DecodeString(doc.Nonce)
	if err != nil {
		return nil, err
	}
	ct, err := base64.StdEncoding.DecodeString(doc.CT)
	if err != nil {
		return nil, err
	}
	dk, err := scrypt.Key(pass, salt, doc.N, doc.R, doc.P, 32)
	if err != nil {
		return nil, err
	}
	defer ledger.Wipe(dk)
	block, err := aes.NewCipher(dk)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, nonce, ct, []byte("scdo-agent-key-v1:"+purpose))
}

func keyFromPlain(plain []byte, purpose string) (*ledger.Key, error) {
	var inner innerDoc
	if err := json.Unmarshal(plain, &inner); err != nil || inner.Purpose != purpose || inner.Key == "" {
		return nil, fmt.Errorf("key file is not a scdo-agent key")
	}
	return ledger.KeyFromHex(inner.Key)
}

func writeJSON(path string, v any, mode os.FileMode) error {
	blob, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	blob = append(blob, '\n')
	return writeAtomic(path, blob, mode)
}

func writeAtomic(path string, data []byte, mode os.FileMode) error {
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
	if _, err := tmp.Write(data); err != nil {
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

func hexEncode(b []byte) string {
	const hexdigits = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, c := range b {
		out[i*2] = hexdigits[c>>4]
		out[i*2+1] = hexdigits[c&0x0f]
	}
	return string(out)
}

// ReadPassphraseFile reads a passphrase. A single trailing newline is removed.
func ReadPassphraseFile(path string) ([]byte, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("passphrase file is empty")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(b) > 4096 {
		return nil, fmt.Errorf("passphrase file is too large")
	}
	b = bytesTrimNL(b)
	if len(b) == 0 {
		return nil, fmt.Errorf("passphrase file is empty")
	}
	return b, nil
}

func bytesTrimNL(b []byte) []byte {
	if len(b) > 0 && b[len(b)-1] == '\n' {
		b = b[:len(b)-1]
	}
	if len(b) > 0 && b[len(b)-1] == '\r' {
		b = b[:len(b)-1]
	}
	return b
}
