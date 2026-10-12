package zp

import (
	"encoding/json"
	"io/ioutil"
	"strconv"
	"testing"
)

type fixture struct {
	Hash   string          `json:"hash"`
	Header json.RawMessage `json:"header"`
}

func load(t *testing.T) []fixture {
	b, err := ioutil.ReadFile("testdata/shard1_blocks.json")
	if err != nil {
		t.Fatal(err)
	}
	var f []fixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	if len(f) < 3 {
		t.Fatal("need >=3 fixtures")
	}
	return f
}

// Real historical shard1 blocks: header hash must match the chain, the real
// nonce must satisfy the block target, and a tampered nonce must fail.
func TestRealShard1Blocks(t *testing.T) {
	for _, fx := range load(t) {
		h, err := ParseHeader(fx.Header)
		if err != nil {
			t.Fatal(err)
		}
		if got := h.Hash().Hex(); got != fx.Hash {
			t.Fatalf("height %d: hash mismatch %s != %s", h.Height, got, fx.Hash)
		}
		nonce, err := strconv.ParseUint(string(h.Witness), 10, 64)
		if err != nil {
			t.Fatalf("witness not a nonce: %q", h.Witness)
		}
		target := MiningTarget(h.Difficulty)
		c := *h
		_, det := Check(&c, nonce, nil)
		if !DetMeets(det, target) {
			t.Fatalf("height %d: real nonce rejected det=%e target=%s", h.Height, det, target)
		}
		if !VerifyBlock(h) {
			t.Fatalf("height %d: VerifyBlock false", h.Height)
		}
		// tampered nonces: all must be rejected (P(false accept) ~ 1/difficulty-ish)
		for _, d := range []uint64{1, 2, 3, 1000003} {
			c2 := *h
			_, det2 := Check(&c2, nonce+d, nil)
			if DetMeets(det2, target) {
				t.Fatalf("height %d: tampered nonce +%d accepted (det=%e)", h.Height, d, det2)
			}
		}
		t.Logf("height %d ok: det=%.3e target=%s creator=%s", h.Height, det, target, h.Creator.Hex())
	}
}

func BenchmarkCheck(b *testing.B) {
	f := []fixture{}
	raw, _ := ioutil.ReadFile("testdata/shard1_blocks.json")
	json.Unmarshal(raw, &f)
	h, _ := ParseHeader(f[0].Header)
	for i := 0; i < b.N; i++ {
		Check(h, uint64(i), nil)
	}
}

func TestSelfTest(t *testing.T) {
	if err := SelfTest(); err != nil {
		t.Fatal(err)
	}
}
