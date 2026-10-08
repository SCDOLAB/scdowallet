package gpu

// RNG is the scdorand generator used to fill a zpow matrix.
//
// scdorand is a binary-only fork of Go 1.12 math/rand. Both Seed and
// Seed_EmeryFork were checked against that package (see rng_test.go):
// the LCG is Schrage's method with modulus 2^48, multiplier
// 0x2875a2e7b175 and remainder 0xd3e2e91d742, 30 warmup steps, then the
// usual 40/20-bit mix xored with rngCooked. EmeryFork additionally xors
// every LCG output with the adjusted seed. Int63 stores the unmasked
// 64-bit sum back into the register and returns the low 63 bits, matching
// scdorand.(*rngSource).Uint64 / Int63.

const (
	rngLen  = 607
	rngTap  = 273
	rngMask = int64(^uint64(0) >> 1) // 2^63-1

	emeryA   = int64(0x2875a2e7b175)
	emeryR   = int64(0xd3e2e91d742)
	emeryM   = int64(1) << 48
	zeroSeed = int64(0x5556447) // 89482311
)

// Rng is a single lagged-Fibonacci generator. It is not safe for
// concurrent use.
type Rng struct {
	tap  int
	feed int
	vec  [rngLen]int64
}

// seedrand48 is x = (A*x) mod 2^48 via Schrage, with wrapping int64
// multiply matching the scdorand binary.
func seedrand48(x int64) int64 {
	hi := x / 6
	lo := x % 6
	y := emeryA*lo - emeryR*hi
	if y < 0 {
		y += emeryM
	}
	return y
}

// Seed resets the generator. emery selects Seed_EmeryFork.
func (r *Rng) Seed(seed int64, emery bool) {
	r.tap = 0
	r.feed = rngLen - rngTap
	if seed < 0 {
		seed += int64(0x7fffffffffffffff)
	}
	if seed == 0 {
		seed = zeroSeed
	}
	xor := int64(0)
	if emery {
		xor = seed
	}
	x := seed
	for i := -30; i < rngLen; i++ {
		x = seedrand48(x) ^ xor
		if i >= 0 {
			x1 := x
			x = seedrand48(x) ^ xor
			x2 := x
			x = seedrand48(x) ^ xor
			r.vec[i] = (x1 << 40) ^ (x2 << 20) ^ x ^ rngCooked[i]
		}
	}
}

// Int63 returns a value in [0, 2^63-1].
func (r *Rng) Int63() int64 {
	r.tap--
	if r.tap < 0 {
		r.tap += rngLen
	}
	r.feed--
	if r.feed < 0 {
		r.feed += rngLen
	}
	x := r.vec[r.feed] + r.vec[r.tap]
	r.vec[r.feed] = x
	return int64(uint64(x) & uint64(rngMask))
}

// Int63n matches math/rand.Int63n, which scdorand copies.
func (r *Rng) Int63n(n int64) int64 {
	if n&(n-1) == 0 {
		return r.Int63() & (n - 1)
	}
	max := int64((1 << 63) - 1 - (1<<63)%uint64(n))
	v := r.Int63()
	for v > max {
		v = r.Int63()
	}
	return v % n
}
