package wallet

import (
	"encoding/hex"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/math"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/signer/core/apitypes"
)

// The vector is an EIP-3009 authorization over Base Sepolia USDC (name USDC,
// version 2). The pay path does not use this signer. It only checks the vector.
func TestSepoliaUSDCAuthorizationVector(t *testing.T) {
	const (
		sigHex = "0x61b225fe5b9b4aab3288eb09f25556cc5878142107bc7d589caab7dce80d630d1d7d1be6c0b0705daeafa401a4bfe5f33cbe1e1d66dc916f93015acfc504cb911b"
		from   = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
	)
	nonce := "0x" + strings.Repeat("11", 32)
	hash, err := authorizationDigest(from, "0xE3837fE309618AE075DbeF0A20735c0615a308E6", "10000", "0", "1800000000", nonce)
	if err != nil {
		t.Fatal(err)
	}
	addr, err := recoverSig(hash, sigHex)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.EqualFold(addr.Hex(), from) {
		t.Fatalf("recovered %s", addr.Hex())
	}
}

func authorizationDigest(from, to, value, validAfter, validBefore, nonce string) ([]byte, error) {
	return domainDigest("USDC", "2", 84532, SepoliaUSDC, from, to, value, validAfter, validBefore, nonce)
}

func domainDigest(name, version string, chainID int64, verifying, from, to, value, validAfter, validBefore, nonce string) ([]byte, error) {
	typed := apitypes.TypedData{
		Types: apitypes.Types{
			"EIP712Domain": {
				{Name: "name", Type: "string"},
				{Name: "version", Type: "string"},
				{Name: "chainId", Type: "uint256"},
				{Name: "verifyingContract", Type: "address"},
			},
			"TransferWithAuthorization": {
				{Name: "from", Type: "address"},
				{Name: "to", Type: "address"},
				{Name: "value", Type: "uint256"},
				{Name: "validAfter", Type: "uint256"},
				{Name: "validBefore", Type: "uint256"},
				{Name: "nonce", Type: "bytes32"},
			},
		},
		PrimaryType: "TransferWithAuthorization",
		Domain: apitypes.TypedDataDomain{
			Name:              name,
			Version:           version,
			ChainId:           math.NewHexOrDecimal256(chainID),
			VerifyingContract: verifying,
		},
		Message: apitypes.TypedDataMessage{
			"from":        from,
			"to":          to,
			"value":       value,
			"validAfter":  validAfter,
			"validBefore": validBefore,
			"nonce":       nonce,
		},
	}
	hash, _, err := apitypes.TypedDataAndHash(typed)
	return hash, err
}

func recoverSig(hash []byte, sigHex string) (common.Address, error) {
	raw, err := hex.DecodeString(strings.TrimPrefix(sigHex, "0x"))
	if err != nil {
		return common.Address{}, err
	}
	if raw[64] >= 27 {
		raw[64] -= 27
	}
	pub, err := crypto.SigToPub(hash, raw)
	if err != nil {
		return common.Address{}, err
	}
	return crypto.PubkeyToAddress(*pub), nil
}
