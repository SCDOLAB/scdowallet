package wallet

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/sha3"
)

const emailLabel = "scdo-bot-email-v1"

func emailSaltPath(dir string) string {
	return filepath.Join(dir, "email.salt")
}

// loadOrCreateSalt returns the 32-byte email salt. It is created once and never replaced.
// The salt is not sent to the ledger.
func loadOrCreateSalt(dir string) ([]byte, error) {
	path := emailSaltPath(dir)
	b, err := os.ReadFile(path)
	if err == nil {
		if len(b) != 32 {
			return nil, fmt.Errorf("email salt")
		}
		return b, nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	b = make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, b, 0o600); err != nil {
		return nil, err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return nil, err
	}
	return b, nil
}

func normalizeEmail(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	if len(s) < 3 || len(s) > 254 || strings.ContainsAny(s, " \t\r\n") {
		return "", fmt.Errorf("email")
	}
	at := strings.IndexByte(s, '@')
	if at <= 0 || at != strings.LastIndexByte(s, '@') || at == len(s)-1 {
		return "", fmt.Errorf("email")
	}
	return s, nil
}

// EmailCommit is keccak256("scdo-bot-email-v1" ‖ salt32 ‖ lower(trim(email))).
func EmailCommit(salt []byte, email string) (string, error) {
	if len(salt) != 32 {
		return "", fmt.Errorf("email salt")
	}
	norm, err := normalizeEmail(email)
	if err != nil {
		return "", err
	}
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write([]byte(emailLabel))
	_, _ = h.Write(salt)
	_, _ = h.Write([]byte(norm))
	return "0x" + hex.EncodeToString(h.Sum(nil)), nil
}

func emailFile(dir string) string {
	return filepath.Join(dir, "email.txt")
}

// saveEmail stores the normalised address locally so bind-email can send it later.
// The ledger bind still receives only the commitment.
func saveEmail(dir, email string) error {
	norm, err := normalizeEmail(email)
	if err != nil {
		return err
	}
	path := emailFile(dir)
	if err := os.WriteFile(path, []byte(norm), 0o600); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

func loadEmail(dir string) (string, error) {
	b, err := os.ReadFile(emailFile(dir))
	if err != nil {
		return "", fmt.Errorf("email")
	}
	return normalizeEmail(string(b))
}

// readSalt reads email.salt and does not create a new one.
func readSalt(dir string) ([]byte, error) {
	b, err := os.ReadFile(emailSaltPath(dir))
	if err != nil || len(b) != 32 {
		return nil, fmt.Errorf("email salt")
	}
	return b, nil
}
