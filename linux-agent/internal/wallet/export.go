package wallet

import (
	"crypto/ecdsa"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/ethereum/go-ethereum/accounts/keystore"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/google/uuid"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

const (
	defaultExportN = keystore.StandardScryptN
	defaultExportP = keystore.StandardScryptP
)

// exportN is the scrypt N used for a Web3 secret-storage keystore. The default is 2^18.
var exportN = defaultExportN

// exportP is the scrypt P used for a Web3 secret-storage keystore.
var exportP = defaultExportP

// ExportRequest writes an encrypted keystore, or a raw key when the caller has
// confirmed it and is on a terminal.
type ExportRequest struct {
	Root       string
	Name       string
	Passphrase []byte
	ExportPass []byte
	Raw        bool
	Understand bool
	TTY        bool
	OutPath    string
	Now        time.Time
}

// ExportResult is the public side of an export. It never contains a key.
type ExportResult struct {
	Address string
	Kind    string
	Path    string
	JSON    []byte
}

// ExportKey writes a Web3 Secret Storage v3 keystore, or the raw wallet key
// when Raw, Understand, and TTY are all set. Every completed export appends an
// audit line that does not contain the key.
func ExportKey(req ExportRequest) (ExportResult, error) {
	lay, _, _, walletKey, err := openPair(req.Root, req.Name, req.Passphrase)
	if err != nil {
		return ExportResult{}, err
	}
	defer wipeKey(walletKey)
	addr := walletKey.Address()
	now := req.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if req.Raw {
		if !req.Understand {
			return ExportResult{}, fmt.Errorf("raw export needs --i-understand-raw-key")
		}
		if !req.TTY {
			return ExportResult{}, fmt.Errorf("a raw key is only printed on a terminal")
		}
		scalar := walletKey.Scalar()
		defer ledger.Wipe(scalar)
		line := "0x" + hex.EncodeToString(scalar)
		if err := audit(lay.Dir, now, "raw", addr); err != nil {
			ledger.Wipe([]byte(line))
			return ExportResult{}, err
		}
		return ExportResult{Address: addr, Kind: "raw", JSON: []byte(line)}, nil
	}
	if len(req.ExportPass) == 0 {
		return ExportResult{}, fmt.Errorf("an export passphrase file is required")
	}
	blob, err := encryptKeystore(walletKey, string(req.ExportPass))
	if err != nil {
		return ExportResult{}, err
	}
	if req.OutPath != "" {
		if err := os.WriteFile(req.OutPath, append(blob, '\n'), 0o600); err != nil {
			return ExportResult{}, err
		}
		if err := os.Chmod(req.OutPath, 0o600); err != nil {
			return ExportResult{}, err
		}
	}
	if err := audit(lay.Dir, now, "keystore", addr); err != nil {
		return ExportResult{}, err
	}
	return ExportResult{Address: addr, Kind: "keystore", Path: req.OutPath, JSON: blob}, nil
}

func encryptKeystore(k *ledger.Key, pass string) ([]byte, error) {
	scalar := k.Scalar()
	defer ledger.Wipe(scalar)
	priv, err := crypto.ToECDSA(scalar)
	if err != nil {
		return nil, err
	}
	defer zeroECDSA(priv)
	id, err := uuid.NewRandom()
	if err != nil {
		return nil, err
	}
	key := &keystore.Key{
		Id:         id,
		Address:    crypto.PubkeyToAddress(priv.PublicKey),
		PrivateKey: priv,
	}
	return keystore.EncryptKey(key, pass, exportN, exportP)
}

func zeroECDSA(priv *ecdsa.PrivateKey) {
	if priv == nil || priv.D == nil {
		return
	}
	buf := make([]byte, 32)
	priv.D.FillBytes(buf)
	ledger.Wipe(buf)
	priv.D.SetInt64(0)
}

func audit(dir string, now time.Time, kind, addr string) error {
	path := filepath.Join(dir, "export-audit.log")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := os.Chmod(path, 0o600); err != nil {
		return err
	}
	_, err = fmt.Fprintf(f, "%s\t%s\t%s\n", now.UTC().Format(time.RFC3339), kind, addr)
	return err
}
