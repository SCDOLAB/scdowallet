package ledger

import (
	"encoding/hex"
	"fmt"
	"strings"

	"golang.org/x/crypto/sha3"
)

// EnvelopeHash is keccak256 of the canonical {payload, sig} envelope.
// The ledger stores this as the agent's bindHash.
func EnvelopeHash(env Envelope) (string, error) {
	payload := map[string]any{
		"v":       env.Payload.V,
		"chainId": env.Payload.ChainID,
		"type":    env.Payload.Type,
		"agent":   env.Payload.Agent,
		"seq":     env.Payload.Seq,
		"ts":      env.Payload.TS,
		"body":    env.Payload.Body,
	}
	c, err := Canonical(map[string]any{"payload": payload, "sig": env.Sig})
	if err != nil {
		return "", err
	}
	return keccakHex([]byte(c)), nil
}

// MerkleRoot is the ledger batch root. Leaves stay in the given order.
// Each pair is sorted as lowercase hex, then keccak256 of the raw bytes.
// An odd node is carried up unchanged.
func MerkleRoot(leaves []string) (string, error) {
	if len(leaves) == 0 {
		return "", fmt.Errorf("agents")
	}
	level := make([]string, len(leaves))
	for i, leaf := range leaves {
		leaf = strings.ToLower(strings.TrimSpace(leaf))
		if !isHex32(leaf) {
			return "", fmt.Errorf("bind hash")
		}
		level[i] = leaf
	}
	for len(level) > 1 {
		next := make([]string, 0, (len(level)+1)/2)
		for i := 0; i < len(level); i += 2 {
			if i+1 >= len(level) {
				next = append(next, level[i])
				continue
			}
			lo, hi := level[i], level[i+1]
			if hi < lo {
				lo, hi = hi, lo
			}
			sum, err := hashPair(lo, hi)
			if err != nil {
				return "", err
			}
			next = append(next, sum)
		}
		level = next
	}
	return level[0], nil
}

func hashPair(lo, hi string) (string, error) {
	a, err := hex.DecodeString(strings.TrimPrefix(lo, "0x"))
	if err != nil {
		return "", err
	}
	b, err := hex.DecodeString(strings.TrimPrefix(hi, "0x"))
	if err != nil {
		return "", err
	}
	buf := make([]byte, 0, len(a)+len(b))
	buf = append(buf, a...)
	buf = append(buf, b...)
	return keccakHex(buf), nil
}

func keccakHex(b []byte) string {
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write(b)
	return "0x" + hex.EncodeToString(h.Sum(nil))
}

func isHex32(s string) bool {
	if !strings.HasPrefix(s, "0x") || len(s) != 66 {
		return false
	}
	_, err := hex.DecodeString(s[2:])
	return err == nil
}
