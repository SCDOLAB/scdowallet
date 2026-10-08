package gpu

import (
	"encoding/binary"
	"math"

	"github.com/scdoproject/go-scdo/common"
)

// Dim is the zpow matrix order (consensus/zpow matrixDim).
const Dim = 30

// sfmin is LAPACK dlamchS, the smallest positive normal float64.
// gonum uses it to choose a scale path in Dgetf2. Subnormal pivots are
// not expected for a {0,1,2} matrix; the branch is still matched.
var sfmin = math.Float64frombits(0x0010000000000000)

// Fill writes the 30x30 zpow matrix for hash at height into m, which
// must have length Dim*Dim. Entries are 0, 1 or 2. This is generateRandomMat
// from consensus/zpow/engine.go, including the EmeryFork source switch at
// common.EmeryForkHeight.
func Fill(hash common.Hash, height uint64, m []float64) {
	if len(m) < Dim*Dim {
		panic("gpu: matrix buffer is short")
	}
	hb := hash.Bytes()
	var seed [4]int64
	seed[0] = int64(binary.BigEndian.Uint64(hb[0:8]))
	seed[1] = int64(binary.BigEndian.Uint64(hb[8:16]))
	seed[2] = int64(binary.BigEndian.Uint64(hb[16:24]))
	seed[3] = int64(binary.BigEndian.Uint64(hb[24:32]))
	emery := height >= common.EmeryForkHeight
	var rng Rng
	cur := int64(0)
	for i := 0; i < Dim; i++ {
		cur ^= seed[i%4]
		rng.Seed(cur, emery)
		for j := 0; j < Dim; j++ {
			// Int63n(2^63-1) is what the node calls; it is not the matrix entry.
			cur = rng.Int63n(1<<63 - 1)
			m[i*Dim+j] = float64(rng.Int63n(3))
		}
	}
}

// Det is the CPU reference determinant: Fill plus the same LU/log-det
// gonum.org/v1/gonum/mat.Det uses for a 30x30 matrix (unblocked Dgetf2,
// because Ilaenv's DGETRF block size is 64).
func Det(hash common.Hash, height uint64) float64 {
	var m [Dim * Dim]float64
	Fill(hash, height, m[:])
	return detOf(m[:])
}

func detOf(m []float64) float64 {
	a := append([]float64(nil), m...)
	diag, swapSign := factor(a)
	return detFrom(diag, swapSign)
}

// factor is gonum lapack/gonum.Dgetf2 for an n×n row-major matrix with
// n <= 64 (so Dgetrf does not block). a is overwritten. swapSign is the
// contribution of row swaps only (+1 or -1); diagonal signs are applied
// in detFrom, matching lu.LogDet.
func factor(a []float64) (diag [Dim]float64, swapSign float64) {
	const n = Dim
	swapSign = 1
	var piv [n]int
	for j := 0; j < n; j++ {
		jp := j + idamax(n-j, a, j, j)
		piv[j] = jp
		if a[jp*n+j] != 0 {
			if jp != j {
				for c := 0; c < n; c++ {
					a[j*n+c], a[jp*n+c] = a[jp*n+c], a[j*n+c]
				}
			}
			if j < n-1 {
				aj := a[j*n+j]
				if math.Abs(aj) >= sfmin {
					inv := 1 / aj
					for i := j + 1; i < n; i++ {
						a[i*n+j] *= inv
					}
				} else {
					// gonum's subnormal path divides the same element
					// m-j-1 times and does not walk i. Match it.
					for i := 0; i < n-j-1; i++ {
						a[(j+1)*n+j] = a[(j+1)*n+j] / a[n*j+j]
					}
				}
			}
		}
		if j < n-1 {
			for row := j + 1; row < n; row++ {
				// alpha * x with alpha = -1, then a = a + t*y.
				// A multiply, not a negation, so signed zero matches Dger.
				t := (-1.0) * a[row*n+j]
				for col := j + 1; col < n; col++ {
					a[row*n+col] = a[row*n+col] + t*a[j*n+col]
				}
			}
		}
	}
	for i := 0; i < n; i++ {
		diag[i] = a[i*n+i]
		if piv[i] != i {
			swapSign = -swapSign
		}
	}
	return diag, swapSign
}

// idamax is gonum blas Idamax on a column: first index of the strictly
// largest absolute value. row0 is the first row and col is the column.
func idamax(n int, a []float64, col, row0 int) int {
	if n < 2 {
		return 0
	}
	idx := 0
	max := math.Abs(a[row0*Dim+col])
	for i := 1; i < n; i++ {
		v := math.Abs(a[(row0+i)*Dim+col])
		if v > max {
			max = v
			idx = i
		}
	}
	return idx
}

// detFrom finishes a factorization the way gonum mat.Det does:
// exp(sum(log|diag|)) * sign. sumLogs follows gonum's amd64 Sum for a
// 16-byte-aligned length-30 slice, which is what getFloats returns.
func detFrom(diag [Dim]float64, swapSign float64) float64 {
	sign := swapSign
	var logs [Dim]float64
	for i := 0; i < Dim; i++ {
		v := diag[i]
		if v < 0 {
			sign = -sign
		}
		logs[i] = math.Log(math.Abs(v))
	}
	return math.Exp(sumLogs(logs[:])) * sign
}

// sumLogs matches gonum.org/v1/gonum/internal/asm/f64.Sum (sum_amd64.s)
// for len==30 and a 16-byte-aligned base. Four pairwise accumulators,
// then the 8/4/2 tails and HADDPD.
func sumLogs(x []float64) float64 {
	var s0a, s0b float64
	var s1a, s1b float64
	var s2a, s2b float64
	var s3a, s3b float64
	add := func(i int, a, b *float64) {
		*a += x[i]
		*b += x[i+1]
	}
	// 16-wide body, one iteration (floor(30/16) == 1).
	add(0, &s0a, &s0b)
	add(2, &s1a, &s1b)
	add(4, &s2a, &s2b)
	add(6, &s3a, &s3b)
	add(8, &s0a, &s0b)
	add(10, &s1a, &s1b)
	add(12, &s2a, &s2b)
	add(14, &s3a, &s3b)
	// tail bit 8: elements 16..23
	add(16, &s0a, &s0b)
	add(18, &s1a, &s1b)
	add(20, &s2a, &s2b)
	add(22, &s3a, &s3b)
	s0a += s3a
	s0b += s3b
	s1a += s2a
	s1b += s2b
	// tail bit 4: elements 24..27
	add(24, &s0a, &s0b)
	add(26, &s1a, &s1b)
	s0a += s1a
	s0b += s1b
	// tail bit 2: elements 28..29
	add(28, &s0a, &s0b)
	// HADDPD
	return s0a + s0b
}
