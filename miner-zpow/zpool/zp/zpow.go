// Package zp is a cgo-free port of the CPU path of go-scdo consensus/zpow
// (engine.go: generateRandomMat, getMiningTarget, verifyTarget) plus the
// pool <-> miner wire protocol. It deliberately does NOT import core/types
// (which pulls cgo secp256k1) so the miner cross-compiles to Windows with
// CGO_ENABLED=0. Header mirrors core/types.BlockHeader field-for-field, so
// its RLP/Keccak hash is identical (checked in tests against real blocks
// and against core/types in the pool's cgo test).
package zp

import (
	"encoding/binary"
	"math/big"
	"strconv"

	"github.com/scdoproject/go-scdo/common"
	"github.com/scdoproject/go-scdo/consensus/scdorand"
	"github.com/scdoproject/go-scdo/crypto/sha3"
	"gonum.org/v1/gonum/mat"
)

// Header mirrors go-scdo core/types.BlockHeader (same field order and types).
type Header struct {
	PreviousBlockHash common.Hash
	Creator           common.Address
	StateHash         common.Hash
	TxHash            common.Hash
	ReceiptHash       common.Hash
	TxDebtHash        common.Hash
	DebtHash          common.Hash
	Difficulty        *big.Int
	Height            uint64
	CreateTimestamp   *big.Int
	Witness           []byte
	SecondWitness     []byte
	Consensus         uint
	ExtraData         []byte
}

const MatrixDim = 30

var (
	maxDet30x30 = new(big.Int).Mul(big.NewInt(2), new(big.Int).Exp(big.NewInt(10), big.NewInt(30), nil))
	multiplier  = big.NewInt(3000000000)
)

// MiningTarget = difficulty * 3e9, capped at 2e30 (consensus/zpow getMiningTarget).
func MiningTarget(difficulty *big.Int) *big.Int {
	t := new(big.Int).Mul(difficulty, multiplier)
	if t.Cmp(maxDet30x30) > 0 {
		return new(big.Int).Set(maxDet30x30)
	}
	return t
}

// Hash returns keccak256(rlp(header)) exactly like core/types BlockHeader.Hash for PoW headers.
func (h *Header) Hash() common.Hash {
	b := common.SerializePanic(h)
	d := sha3.NewKeccak256()
	d.Write(b)
	return common.BytesToHash(d.Sum(nil))
}

// HashWithNonce sets Witness = decimal(nonce) (as the node does) and hashes.
func (h *Header) HashWithNonce(nonce uint64) common.Hash {
	h.Witness = []byte(strconv.FormatUint(nonce, 10))
	return h.Hash()
}

func bytesToInt64(buf []byte) int64 { return int64(binary.BigEndian.Uint64(buf)) }

// Det computes the zpow determinant for a header hash (generateRandomMat + mat.Det).
func Det(hash common.Hash, height uint64, m *mat.Dense) float64 {
	if m == nil {
		m = mat.NewDense(MatrixDim, MatrixDim, nil)
	}
	hb := hash.Bytes()
	var seed [4]int64
	seed[0] = bytesToInt64(hb[:8])
	seed[1] = bytesToInt64(hb[8:16])
	seed[2] = bytesToInt64(hb[16:24])
	seed[3] = bytesToInt64(hb[24:32])
	cur := int64(0)
	for i := 0; i < MatrixDim; i++ {
		cur ^= seed[i%4]
		var r *scdorand.RandObj
		if height >= common.EmeryForkHeight {
			r = scdorand.NewRandObj(scdorand.NewSource_EmeryFork(cur))
		} else {
			r = scdorand.NewRandObj(scdorand.NewSource(cur))
		}
		for j := 0; j < MatrixDim; j++ {
			cur = r.Int63n(1<<63 - 1)
			m.Set(i, j, float64(r.Int63n(3)))
		}
	}
	return mat.Det(m)
}

// DetMeets reports det >= target using the same big.Float comparison as the node.
func DetMeets(det float64, target *big.Int) bool {
	return big.NewFloat(det).Cmp(new(big.Float).SetInt(target)) >= 0
}

// Check computes the det of header+nonce and returns it (header is modified: Witness set).
func Check(h *Header, nonce uint64, m *mat.Dense) (common.Hash, float64) {
	hash := h.HashWithNonce(nonce)
	return hash, Det(hash, h.Height, m)
}

// VerifyBlock reports whether header (with its own Witness) satisfies its own difficulty.
func VerifyBlock(h *Header) bool {
	c := *h
	hash := c.Hash()
	return DetMeets(Det(hash, c.Height, nil), MiningTarget(c.Difficulty))
}
