package ethash

import (
	"encoding/hex"
	"testing"
)

func TestSizes(t *testing.T) {
	if CacheSize(0) != 16776896 {
		t.Fatalf("cache %d", CacheSize(0))
	}
	if DatasetSize(0) != 1073739904 {
		t.Fatalf("dataset %d", DatasetSize(0))
	}
	if len(Seed(0)) != 32 {
		t.Fatal("seed")
	}
	for _, b := range Seed(0) {
		if b != 0 {
			t.Fatal("epoch 0 seed")
		}
	}
}

func TestCachePrefix(t *testing.T) {
	// First cache row for a 1024-byte cache at epoch 0. The epoch-0 seed is 32 zero bytes.
	cache := GenerateCache(1024, Seed(0))
	if cache == nil {
		t.Fatal("cache")
	}
	raw := make([]byte, 64)
	for i := 0; i < 16; i++ {
		raw[i*4] = byte(cache[i])
		raw[i*4+1] = byte(cache[i] >> 8)
		raw[i*4+2] = byte(cache[i] >> 16)
		raw[i*4+3] = byte(cache[i] >> 24)
	}
	want, _ := hex.DecodeString("7ce2991c951f7bf4c4c1bb119887ee07871eb5339d7b97b8588e85c742de90e5bafd5bbe6ce93a134fb6be9ad3e30db99d9528a2ea7846833f52e9ca119b6b54")
	if hex.EncodeToString(raw) != hex.EncodeToString(want) {
		t.Fatalf("prefix %x", raw)
	}
}

func TestHashimotoLightVector(t *testing.T) {
	cache := GenerateCache(1024, make([]byte, 32))
	header, _ := hex.DecodeString("c9149cc0386e689d789a1c2f3d5d169a61a6218ed30e74414dc736e442ef3d1f")
	mix, result := HashimotoLight(32*1024, cache, header, 0)
	wantMix := "e4073cffaef931d37117cefd9afd27ea0f1cad6a981dd2605c4a1ac97c519800"
	wantResult := "d3539235ee2e6f8db665c0a72169f55b7f6c605712330b778ec3944f0eb5a557"
	if hex.EncodeToString(mix) != wantMix {
		t.Fatalf("mix %x", mix)
	}
	if hex.EncodeToString(result) != wantResult {
		t.Fatalf("result %x", result)
	}
}
