package ledger

import (
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

const (
	Version = 1
	ChainID = 5680
)

var types = map[string]struct{}{
	"register":  {},
	"heartbeat": {},
	"heal":      {},
	"report":    {},
	"bind":      {},
	"xrevoke":   {},
	"freeze":    {},
	"unfreeze":  {},
	"spend":     {},
	"batch":     {},
}

// Envelope is the POST body: { payload, sig }.
type Envelope struct {
	Payload Payload `json:"payload"`
	Sig     string  `json:"sig"`
}

// Payload is the signed document. Field order here is the wire order; the
// signature is over the canonical form, which sorts keys.
type Payload struct {
	V       int            `json:"v"`
	ChainID int            `json:"chainId"`
	Type    string         `json:"type"`
	Agent   string         `json:"agent"`
	Seq     int64          `json:"seq"`
	TS      int64          `json:"ts"`
	Body    map[string]any `json:"body"`
}

// Key is a secp256k1 agent identity. The raw scalar is never formatted into errors or logs.
type Key struct {
	priv *secp256k1.PrivateKey
}

// KeyFromHex parses a 32-byte secp256k1 scalar, with or without a 0x prefix.
func KeyFromHex(s string) (*Key, error) {
	h := strings.TrimPrefix(strings.TrimSpace(s), "0x")
	b, err := hex.DecodeString(h)
	if err != nil || len(b) != 32 {
		return nil, fmt.Errorf("agent key is not a 32-byte scalar")
	}
	priv := secp256k1.PrivKeyFromBytes(b)
	for i := range b {
		b[i] = 0
	}
	return &Key{priv: priv}, nil
}

// Generate creates a new secp256k1 identity.
func Generate() (*Key, error) {
	priv, err := secp256k1.GeneratePrivateKey()
	if err != nil {
		return nil, err
	}
	return &Key{priv: priv}, nil
}

// Scalar returns a copy of the 32-byte private key. The caller must wipe it.
func (k *Key) Scalar() []byte {
	if k == nil || k.priv == nil {
		return nil
	}
	return k.priv.Serialize()
}

// Address is the EIP-55 checksummed agent id.
func (k *Key) Address() string {
	return AddressOf(k.priv)
}

// AddressOf derives the EIP-55 address from a private key.
func AddressOf(priv *secp256k1.PrivateKey) string {
	pub := priv.PubKey().SerializeUncompressed()
	sum := keccak256(pub[1:])
	return checksum(sum[12:])
}

func checksum(addr []byte) string {
	hexed := hex.EncodeToString(addr)
	sum := keccak256([]byte(hexed))
	var b strings.Builder
	b.Grow(42)
	b.WriteString("0x")
	for i := 0; i < len(hexed); i++ {
		c := hexed[i]
		nibble := sum[i/2]
		if i%2 == 0 {
			nibble >>= 4
		} else {
			nibble &= 0x0f
		}
		if c >= 'a' && c <= 'f' && nibble >= 8 {
			c = c - 'a' + 'A'
		}
		b.WriteByte(c)
	}
	return b.String()
}

// ChecksumAddress returns the EIP-55 form of a 0x address.
// All-lowercase and all-uppercase hex are accepted. Mixed case must already be valid EIP-55.
func ChecksumAddress(s string) (string, error) {
	raw := strings.TrimSpace(s)
	if len(raw) != 42 || !strings.HasPrefix(raw, "0x") {
		return "", fmt.Errorf("payout must be a 0x address")
	}
	body := raw[2:]
	if _, err := hex.DecodeString(body); err != nil {
		return "", fmt.Errorf("payout must be a 0x address")
	}
	lower := strings.ToLower(body)
	sum := checksum(mustDecode(lower))
	if body != lower && body != strings.ToUpper(body) && "0x"+body != sum {
		return "", fmt.Errorf("payout checksum does not match")
	}
	return sum, nil
}

func mustDecode(h string) []byte {
	b, err := hex.DecodeString(h)
	if err != nil {
		return nil
	}
	return b
}

// Sign builds a v1 envelope and an EIP-191 personal_sign signature.
// body nil is signed as {}.
func Sign(k *Key, typ string, seq int64, body map[string]any, ts int64) (Envelope, string, error) {
	if k == nil || k.priv == nil {
		return Envelope{}, "", fmt.Errorf("no agent key")
	}
	if _, ok := types[typ]; !ok {
		return Envelope{}, "", fmt.Errorf("bad type")
	}
	if seq < 1 {
		return Envelope{}, "", fmt.Errorf("seq")
	}
	if body == nil {
		body = map[string]any{}
	}
	addr := k.Address()
	payload := Payload{
		V:       Version,
		ChainID: ChainID,
		Type:    typ,
		Agent:   addr,
		Seq:     seq,
		TS:      ts,
		Body:    body,
	}
	msg, err := messageOf(payload)
	if err != nil {
		return Envelope{}, "", err
	}
	sig, err := personalSign(k.priv, msg)
	if err != nil {
		return Envelope{}, "", err
	}
	return Envelope{Payload: payload, Sig: sig}, msg, nil
}

func messageOf(p Payload) (string, error) {
	m := map[string]any{
		"v":       p.V,
		"chainId": p.ChainID,
		"type":    p.Type,
		"agent":   p.Agent,
		"seq":     p.Seq,
		"ts":      p.TS,
		"body":    p.Body,
	}
	c, err := Canonical(m)
	if err != nil {
		return "", err
	}
	return Prefix + c, nil
}

// SignPersonal is an EIP-191 personal_sign over message.
func (k *Key) SignPersonal(message string) (string, error) {
	if k == nil || k.priv == nil {
		return "", fmt.Errorf("no agent key")
	}
	return personalSign(k.priv, message)
}

// SignDigest signs a 32-byte digest. EIP-712 uses this on the typed-data hash.
// The recovery byte matches ethers (27 or 28).
func (k *Key) SignDigest(hash []byte) (string, error) {
	if k == nil || k.priv == nil || len(hash) != 32 {
		return "", fmt.Errorf("digest")
	}
	compact := ecdsa.SignCompact(k.priv, hash, false)
	return compactHex(compact)
}

func personalSign(priv *secp256k1.PrivateKey, message string) (string, error) {
	compact := ecdsa.SignCompact(priv, textHash([]byte(message)), false)
	return compactHex(compact)
}

func compactHex(compact []byte) (string, error) {
	if len(compact) != 65 {
		return "", fmt.Errorf("bad signature length")
	}
	// decred: header || R || S, header = 27 + recid. ethers: R || S || V.
	out := make([]byte, 65)
	copy(out[0:32], compact[1:33])
	copy(out[32:64], compact[33:65])
	out[64] = compact[0]
	return "0x" + hex.EncodeToString(out), nil
}

// WalletProofMessage is the EIP-191 text a wallet signs.
// botID nil is JSON null, which register.usdcWalletProof requires.
func WalletProofMessage(agent string, botID *string, network, nonce string) (string, error) {
	var bot any
	if botID != nil {
		bot = *botID
	}
	c, err := Canonical(map[string]any{
		"type":    "wallet-proof",
		"agent":   agent,
		"botId":   bot,
		"network": network,
		"nonce":   nonce,
	})
	if err != nil {
		return "", err
	}
	return Prefix + c, nil
}

// WalletProof signs WalletProofMessage with the wallet key.
func WalletProof(k *Key, agent string, botID *string, network, nonce string) (string, string, error) {
	msg, err := WalletProofMessage(agent, botID, network, nonce)
	if err != nil {
		return "", "", err
	}
	sig, err := k.SignPersonal(msg)
	if err != nil {
		return "", "", err
	}
	return msg, sig, nil
}

func textHash(data []byte) []byte {
	prefix := []byte(fmt.Sprintf("\x19Ethereum Signed Message:\n%d", len(data)))
	h := sha3.NewLegacyKeccak256()
	h.Write(prefix)
	h.Write(data)
	return h.Sum(nil)
}

func keccak256(data []byte) []byte {
	h := sha3.NewLegacyKeccak256()
	h.Write(data)
	return h.Sum(nil)
}

// Wipe zeroes a buffer.
func Wipe(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
