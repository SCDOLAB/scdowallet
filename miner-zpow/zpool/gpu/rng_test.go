package gpu

import (
	"testing"

	"github.com/scdoproject/go-scdo/consensus/scdorand"
)

func scdStream(seed int64, emery bool, n int) []int64 {
	var src scdorand.Source
	if emery {
		src = scdorand.NewSource_EmeryFork(seed)
	} else {
		src = scdorand.NewSource(seed)
	}
	r := scdorand.NewRandObj(src)
	out := make([]int64, n)
	for i := 0; i < n; i++ {
		out[i] = r.Int63()
	}
	return out
}

func TestRngMatchesScdorand(t *testing.T) {
	seeds := []int64{1, 0, -1, 42, 89482311, 2979594, 1234567890123, 1<<62 + 7, -99, 1<<48 + 3, -1 << 62}
	for _, seed := range seeds {
		for _, emery := range []bool{false, true} {
			want := scdStream(seed, emery, 64)
			var got Rng
			got.Seed(seed, emery)
			for i, w := range want {
				g := got.Int63()
				if g != w {
					t.Fatalf("emery=%v seed=%d i=%d got %d want %d", emery, seed, i, g, w)
				}
			}
		}
	}
}

func TestInt63nMatchesScdorand(t *testing.T) {
	seeds := []int64{1, -7, 99, 1 << 40}
	for _, seed := range seeds {
		want := scdorand.NewRandObj(scdorand.NewSource_EmeryFork(seed))
		var got Rng
		got.Seed(seed, true)
		for i := 0; i < 400; i++ {
			a, b := want.Int63n(3), got.Int63n(3)
			if a != b {
				t.Fatalf("Int63n(3) seed %d i %d got %d want %d", seed, i, b, a)
			}
		}
		want = scdorand.NewRandObj(scdorand.NewSource_EmeryFork(seed))
		got.Seed(seed, true)
		max := int64(1<<63 - 1)
		for i := 0; i < 40; i++ {
			a, b := want.Int63n(max), got.Int63n(max)
			if a != b {
				t.Fatalf("Int63n(2^63-1) seed %d i %d got %d want %d", seed, i, b, a)
			}
		}
	}
}

func TestCookedTable(t *testing.T) {
	if len(rngCooked) != rngLen {
		t.Fatalf("rngCooked len %d, want %d", len(rngCooked), rngLen)
	}
	// First word of Go 1.12 math/rand rngCooked. cuda/cooked.cuh must match.
	if rngCooked[0] != -4181792142133755926 {
		t.Fatalf("rngCooked[0] = %d", rngCooked[0])
	}
}
