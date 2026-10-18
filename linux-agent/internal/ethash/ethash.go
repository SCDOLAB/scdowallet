// Package ethash is ethash-light (cache and one hashimoto-light).
// It follows the Ethereum yellow-paper Ethash procedure so a result matches
// chfast/ethash and the Shard0 network. The search itself is not here.
package ethash

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"

	"golang.org/x/crypto/sha3"
)

const (
	epochLength = 30000
	hashBytes   = 64
	mixBytes    = 128
	accesses    = 64
	parents     = 256
	cacheRounds = 3
	wordBytes   = 4
	hashWords   = hashBytes / wordBytes
)

// CacheSize is the ethash cache size in bytes for an epoch.
func CacheSize(epoch uint64) uint64 {
	size := uint64(1<<24) + uint64(1<<17)*epoch - hashBytes
	for !prime(size / hashBytes) {
		size -= 2 * hashBytes
	}
	return size
}

// DatasetSize is the full ethash dataset size in bytes for an epoch.
func DatasetSize(epoch uint64) uint64 {
	size := uint64(1<<30) + uint64(1<<23)*epoch - mixBytes
	for !prime(size / mixBytes) {
		size -= 2 * mixBytes
	}
	return size
}

func prime(n uint64) bool {
	if n < 2 {
		return false
	}
	if n%2 == 0 {
		return n == 2
	}
	if n%3 == 0 {
		return n == 3
	}
	for i := uint64(5); i*i <= n; i += 6 {
		if n%i == 0 || n%(i+2) == 0 {
			return false
		}
	}
	return true
}

// Seed is the 32-byte epoch seed. Epoch 0 is 32 zero bytes.
func Seed(epoch uint64) []byte {
	s := make([]byte, 32)
	for i := uint64(0); i < epoch; i++ {
		h := sha3.NewLegacyKeccak256()
		_, _ = h.Write(s)
		s = h.Sum(s[:0])
	}
	return s
}

// GenerateCache fills a cache of size bytes. size must be a multiple of hashBytes.
// seed is the epoch seed (32 bytes). The returned slice is little-endian words.
func GenerateCache(size uint64, seed []byte) []uint32 {
	if size < hashBytes || size%hashBytes != 0 {
		return nil
	}
	raw := make([]byte, size)
	rows := int(size / hashBytes)
	keccak512(raw[:hashBytes], seed)
	for row := 1; row < rows; row++ {
		off := row * hashBytes
		keccak512(raw[off:off+hashBytes], raw[off-hashBytes:off])
	}
	temp := make([]byte, hashBytes)
	for range cacheRounds {
		for j := 0; j < rows; j++ {
			src := ((j - 1 + rows) % rows) * hashBytes
			dst := j * hashBytes
			pick := int(binary.LittleEndian.Uint32(raw[dst:dst+4]) % uint32(rows))
			xor := pick * hashBytes
			for i := 0; i < hashBytes; i++ {
				temp[i] = raw[src+i] ^ raw[xor+i]
			}
			keccak512(raw[dst:dst+hashBytes], temp)
		}
	}
	out := make([]uint32, size/4)
	for i := range out {
		out[i] = binary.LittleEndian.Uint32(raw[i*4:])
	}
	return out
}

// HashimotoLight runs one hashimoto over a light cache.
// datasetSize is the full dataset size in bytes. header is 32 bytes.
// It returns the 32-byte mix digest and the 32-byte final result.
func HashimotoLight(datasetSize uint64, cache []uint32, header []byte, nonce uint64) (mixDigest, result []byte) {
	rows := uint32(len(cache) / hashWords)
	lookup := func(index uint32) []uint32 {
		item := datasetItem(cache, rows, index)
		words := make([]uint32, hashWords)
		for i := range words {
			words[i] = binary.LittleEndian.Uint32(item[i*4:])
		}
		return words
	}
	return hashimoto(header, nonce, datasetSize, lookup)
}

func datasetItem(cache []uint32, rows, index uint32) []byte {
	mix := make([]byte, hashBytes)
	base := (index % rows) * hashWords
	binary.LittleEndian.PutUint32(mix[0:4], cache[base]^index)
	for i := uint32(1); i < hashWords; i++ {
		binary.LittleEndian.PutUint32(mix[i*4:], cache[base+i])
	}
	keccak512(mix, mix)
	words := make([]uint32, hashWords)
	for i := range words {
		words[i] = binary.LittleEndian.Uint32(mix[i*4:])
	}
	for j := uint32(0); j < parents; j++ {
		parent := fnv(index^j, words[j%16]) % rows
		off := parent * hashWords
		for i := range words {
			words[i] = fnv(words[i], cache[off+uint32(i)])
		}
	}
	for i := range words {
		binary.LittleEndian.PutUint32(mix[i*4:], words[i])
	}
	keccak512(mix, mix)
	return mix
}

func hashimoto(header []byte, nonce, datasetSize uint64, lookup func(uint32) []uint32) ([]byte, []byte) {
	rows := uint32(datasetSize / mixBytes)
	seed := make([]byte, 40)
	copy(seed, header)
	binary.LittleEndian.PutUint64(seed[32:], nonce)
	seed = keccak512Sum(seed)
	seedHead := binary.LittleEndian.Uint32(seed)

	mix := make([]uint32, mixBytes/4)
	for i := range mix {
		mix[i] = binary.LittleEndian.Uint32(seed[(i%16)*4:])
	}
	temp := make([]uint32, len(mix))
	for i := uint32(0); i < accesses; i++ {
		parent := fnv(i^seedHead, mix[i%uint32(len(mix))]) % rows
		for j := uint32(0); j < mixBytes/hashBytes; j++ {
			copy(temp[j*hashWords:(j+1)*hashWords], lookup(2*parent+j))
		}
		for k := range mix {
			mix[k] = fnv(mix[k], temp[k])
		}
	}
	compressed := make([]uint32, len(mix)/4)
	for i := 0; i < len(mix); i += 4 {
		compressed[i/4] = fnv(fnv(fnv(mix[i], mix[i+1]), mix[i+2]), mix[i+3])
	}
	digest := make([]byte, len(compressed)*4)
	for i, v := range compressed {
		binary.LittleEndian.PutUint32(digest[i*4:], v)
	}
	buf := make([]byte, len(seed)+len(digest))
	copy(buf, seed)
	copy(buf[len(seed):], digest)
	return digest, keccak256(buf)
}

func fnv(a, b uint32) uint32 { return a*0x01000193 ^ b }

func keccak512(dst, src []byte) {
	h := sha3.NewLegacyKeccak512()
	_, _ = h.Write(src)
	sum := h.Sum(nil)
	copy(dst, sum)
}

func keccak512Sum(src []byte) []byte {
	h := sha3.NewLegacyKeccak512()
	_, _ = h.Write(src)
	return h.Sum(nil)
}

func keccak256(src []byte) []byte {
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write(src)
	return h.Sum(nil)
}

// Verify checks one solution with ethash-light.
// header, mixHash and target are 32 bytes. target is compared as a big-endian integer.
func Verify(epoch uint64, header, mixHash, target []byte, nonce uint64) bool {
	if len(header) != 32 || len(mixHash) != 32 || len(target) != 32 {
		return false
	}
	cache := GenerateCache(CacheSize(epoch), Seed(epoch))
	if cache == nil {
		return false
	}
	mix, result := HashimotoLight(DatasetSize(epoch), cache, header, nonce)
	if !bytesEqual(mix, mixHash) {
		return false
	}
	return bytesCompare(result, target) <= 0
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	var d byte
	for i := range a {
		d |= a[i] ^ b[i]
	}
	return d == 0
}

// DecodeHex32 parses a 32-byte hex string with an optional 0x prefix.
func DecodeHex32(s string) ([]byte, error) {
	raw := strings.TrimPrefix(strings.TrimSpace(s), "0x")
	raw = strings.TrimPrefix(raw, "0X")
	b, err := hex.DecodeString(raw)
	if err != nil || len(b) != 32 {
		return nil, fmt.Errorf("want 32 bytes")
	}
	return b, nil
}

// DecodeNonce parses an ethash nonce. 0x + hex is the integer, not little-endian bytes.
func DecodeNonce(s string) (uint64, error) {
	raw := strings.TrimSpace(s)
	raw = strings.TrimPrefix(raw, "0x")
	raw = strings.TrimPrefix(raw, "0X")
	if raw == "" || len(raw) > 16 {
		return 0, fmt.Errorf("nonce")
	}
	var n uint64
	for _, c := range raw {
		n <<= 4
		switch {
		case c >= '0' && c <= '9':
			n |= uint64(c - '0')
		case c >= 'a' && c <= 'f':
			n |= uint64(c-'a') + 10
		case c >= 'A' && c <= 'F':
			n |= uint64(c-'A') + 10
		default:
			return 0, fmt.Errorf("nonce")
		}
	}
	return n, nil
}

// TargetFromDifficulty is 2^256 / difficulty, as 32 big-endian bytes.
func TargetFromDifficulty(difficulty uint64) []byte {
	if difficulty == 0 {
		return nil
	}
	two := new(big.Int).Lsh(big.NewInt(1), 256)
	q := new(big.Int).Div(two, new(big.Int).SetUint64(difficulty))
	b := q.Bytes()
	out := make([]byte, 32)
	copy(out[32-len(b):], b)
	return out
}

func bytesCompare(a, b []byte) int {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		if a[i] < b[i] {
			return -1
		}
		if a[i] > b[i] {
			return 1
		}
	}
	return 0
}
