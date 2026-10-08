package gpu

import (
	"encoding/json"
	"io/ioutil"
	"math"
	"strconv"
	"testing"

	"github.com/scdoproject/go-scdo/common"
	"github.com/scdoproject/go-scdo/zpool/zp"
	"gonum.org/v1/gonum/mat"
)

func TestEmeryForkHeight(t *testing.T) {
	// cuda/zpowdet.cu does not hardcode this. Go passes the flag.
	// Pin the value the rest of Classic uses so a silent change is visible.
	if common.EmeryForkHeight != 2979594 {
		t.Fatalf("EmeryForkHeight = %d, zpow matrix source switch moved", common.EmeryForkHeight)
	}
	if zp.MatrixDim != Dim {
		t.Fatalf("zp.MatrixDim %d != gpu.Dim %d", zp.MatrixDim, Dim)
	}
}

func TestLogDetMatchesGonum(t *testing.T) {
	// Same matrix, two determinant implementations. This isolates LU and
	// the log-sum from the RNG.
	var m [Dim * Dim]float64
	for i := range m {
		m[i] = float64((i*17 + 3) % 3)
	}
	// A singular-ish pattern plus a few larger values so pivots move.
	m[0] = 2
	m[Dim+1] = 0
	m[2*Dim+2] = 1
	ours := detOf(m[:])
	gon := mat.Det(mat.NewDense(Dim, Dim, append([]float64(nil), m[:]...)))
	if math.Float64bits(ours) != math.Float64bits(gon) {
		t.Fatalf("LU det bits differ ours %x (%g) gonum %x (%g)", math.Float64bits(ours), ours, math.Float64bits(gon), gon)
	}
}

func TestIdentityDet(t *testing.T) {
	var m [Dim * Dim]float64
	for i := 0; i < Dim; i++ {
		m[i*Dim+i] = 1
	}
	got := detOf(m[:])
	if got != 1 {
		t.Fatalf("identity det = %g", got)
	}
}

func TestDetMatchesZP(t *testing.T) {
	raw, err := ioutil.ReadFile("../zp/testdata/shard1_blocks.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Header json.RawMessage `json:"header"`
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	if len(fixtures) < 1 {
		t.Fatal("no fixtures")
	}
	checked := 0
	for _, fx := range fixtures {
		h, err := zp.ParseHeader(fx.Header)
		if err != nil {
			t.Fatal(err)
		}
		nonce, err := strconv.ParseUint(string(h.Witness), 10, 64)
		if err != nil {
			t.Fatal(err)
		}
		// The real nonce, a few neighbours, and both RNG eras.
		nonces := []uint64{nonce, nonce + 1, nonce + 2, nonce + 100003, 0, 1, 42}
		heights := []uint64{h.Height, 1, common.EmeryForkHeight - 1, common.EmeryForkHeight}
		for _, height := range heights {
			hdr := *h
			hdr.Height = height
			for _, n := range nonces {
				c := hdr
				hash, cpu := zp.Check(&c, n, nil)
				gpu := Det(hash, height)
				if math.Float64bits(gpu) != math.Float64bits(cpu) {
					t.Fatalf("height %d nonce %d cpu %x (%g) gpu-port %x (%g)", height, n, math.Float64bits(cpu), cpu, math.Float64bits(gpu), gpu)
				}
				checked++
			}
		}
	}
	t.Logf("matched %d header/nonce determinants against zp.Det", checked)
}

func TestMatrixEntriesAre012(t *testing.T) {
	var m [Dim * Dim]float64
	var h common.Hash
	h[0] = 1
	h[31] = 9
	Fill(h, common.EmeryForkHeight, m[:])
	for i, v := range m {
		if v != 0 && v != 1 && v != 2 {
			t.Fatalf("m[%d]=%g", i, v)
		}
	}
}
