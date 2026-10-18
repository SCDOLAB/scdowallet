// Command scdo-ethash-verify checks one ethash solution with the light cache.
// It holds no keys. The ledger runs it as LEDGER_GPU_CHALLENGE_VERIFY.
//
// stdin JSON:
//
//	{"epoch":0,"header":"0x<64 hex>","target":"0x<64 hex>","nonce":"0x<1-16 hex>","mixHash":"0x<64 hex>"}
//
// stdout JSON, and exit 0 when the check ran:
//
//	{"ok":true} or {"ok":false}
//
// epoch is the ethash epoch. header is the 32-byte challenge header.
// nonce is the integer (0x plus hex), not the little-endian byte string.
// mixHash is the 32-byte mix digest. target is the 32-byte threshold.
// A solution is ok when hashimoto-light reproduces mixHash and the digest is
// less than or equal to target. Exit 2 is malformed input.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ethash"
)

type request struct {
	Epoch   uint64 `json:"epoch"`
	Header  string `json:"header"`
	Target  string `json:"target"`
	Nonce   string `json:"nonce"`
	MixHash string `json:"mixHash"`
}

func main() {
	os.Exit(run(os.Stdin, os.Stdout, os.Stderr))
}

func run(in io.Reader, out, errOut io.Writer) int {
	body, err := io.ReadAll(io.LimitReader(in, 1<<20))
	if err != nil {
		fmt.Fprintln(errOut, "read")
		return 2
	}
	var req request
	if json.Unmarshal(body, &req) != nil {
		fmt.Fprintln(errOut, "json")
		return 2
	}
	header, err := ethash.DecodeHex32(req.Header)
	if err != nil {
		fmt.Fprintln(errOut, "header")
		return 2
	}
	target, err := ethash.DecodeHex32(req.Target)
	if err != nil {
		fmt.Fprintln(errOut, "target")
		return 2
	}
	mix, err := ethash.DecodeHex32(req.MixHash)
	if err != nil {
		fmt.Fprintln(errOut, "mixHash")
		return 2
	}
	nonce, err := ethash.DecodeNonce(req.Nonce)
	if err != nil {
		fmt.Fprintln(errOut, "nonce")
		return 2
	}
	ok := ethash.Verify(req.Epoch, header, mix, target, nonce)
	enc := json.NewEncoder(out)
	if err := enc.Encode(map[string]bool{"ok": ok}); err != nil {
		return 2
	}
	return 0
}
