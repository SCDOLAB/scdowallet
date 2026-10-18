package ledger

import (
	"encoding/hex"
	"strings"
	"testing"

	"golang.org/x/crypto/sha3"
)

func TestMerkleRoot(t *testing.T) {
	a := "0x" + strings.Repeat("11", 32)
	b := "0x" + strings.Repeat("22", 32)
	c := "0x" + strings.Repeat("aa", 32)
	one, err := MerkleRoot([]string{strings.ToUpper(a)})
	if err != nil || one != a {
		t.Fatal(one, err)
	}
	pair, err := MerkleRoot([]string{b, a})
	if err != nil {
		t.Fatal(err)
	}
	rawA, _ := hex.DecodeString(strings.Repeat("11", 32))
	rawB, _ := hex.DecodeString(strings.Repeat("22", 32))
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write(rawA)
	_, _ = h.Write(rawB)
	want := "0x" + hex.EncodeToString(h.Sum(nil))
	if pair != want {
		t.Fatalf("pair %s want %s", pair, want)
	}
	three, err := MerkleRoot([]string{a, b, c})
	if err != nil {
		t.Fatal(err)
	}
	// odd leaf c is carried, then hashed with the pair in sorted order
	left, right := pair, c
	if right < left {
		left, right = right, left
	}
	lb, _ := hex.DecodeString(left[2:])
	rb, _ := hex.DecodeString(right[2:])
	h = sha3.NewLegacyKeccak256()
	_, _ = h.Write(lb)
	_, _ = h.Write(rb)
	if three != "0x"+hex.EncodeToString(h.Sum(nil)) {
		t.Fatal(three)
	}
	if _, err := MerkleRoot(nil); err == nil {
		t.Fatal("empty")
	}
}
