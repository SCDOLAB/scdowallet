// zpow determinant for the Classic pool miner.
//
// libgoGpuDet.a (go-scdo consensus/zpow) is not used here. That archive is a
// Linux ELF sm_30 cubin with no PTX, and its host code calls the legacy
// cudaConfigureCall / cudaLaunch API. It does not link into a Windows exe and
// it does not run on an RTX 5060 Ti (sm_120). This file is the same zpow
// math — scdorand matrix fill plus gonum's unblocked Dgetf2 — compiled by
// whatever nvcc the machine has. Keep the device functions in lockstep with
// gpu/rng.go and gpu/det.go. The build must pass -fmad=false --prec-div=true
// --prec-sqrt=true --ftz=false. gonum's Dger and Dscal are separate mul and
// add, and a contracted FMA or a fast division would not match zp.Det.
//
// The kernel returns LU diagonals and the row-swap sign. Go finishes
// exp(sum(log|diag|))*sign with the same sum as gonum's amd64 LogDet, so the
// float64 result matches zp.Det.

#include <stdio.h>
#include <string.h>
#include <cuda_runtime.h>
#include "cooked.cuh"

// Macros so device code can see them on older nvcc (a file-scope const is host-only).
#define ZPOW_DIM 30
#define ZPOW_RNG_LEN 607
#define ZPOW_RNG_TAP 273
#define ZPOW_EMERY_A 0x2875a2e7b175LL
#define ZPOW_EMERY_R 0xd3e2e91d742LL
#define ZPOW_EMERY_M (1LL << 48)
#define ZPOW_ZERO_SEED 0x5556447LL
#define ZPOW_RNG_MASK 0x7fffffffffffffffLL

// 2^-1022, gonum dlamchS. The bits match Go's math.Float64frombits.
__device__ double sfmin() {
    union {
        unsigned long long u;
        double d;
    } v;
    v.u = 0x0010000000000000ULL;
    return v.d;
}

static char g_err[512];
int g_cooked = 0;
unsigned char* g_hash = 0;
double* g_diag = 0;
int* g_sign = 0;
int g_cap = 0;
__constant__ long long c_cooked[607];

static void set_err(const char* msg) {
    snprintf(g_err, sizeof(g_err), "%s", msg ? msg : "");
}

static void set_cuda(cudaError_t e) {
    set_err(cudaGetErrorString(e));
}

static void free_bufs() {
    if (g_hash) cudaFree(g_hash);
    if (g_diag) cudaFree(g_diag);
    if (g_sign) cudaFree(g_sign);
    g_hash = 0;
    g_diag = 0;
    g_sign = 0;
    g_cap = 0;
}

__device__ long long wmul(long long a, long long b) {
    return (long long)((unsigned long long)a * (unsigned long long)b);
}

__device__ long long wsub(long long a, long long b) {
    return (long long)((unsigned long long)a - (unsigned long long)b);
}

__device__ long long seedrand48(long long x) {
    long long hi = x / 6;
    long long lo = x % 6;
    long long y = wsub(wmul(ZPOW_EMERY_A, lo), wmul(ZPOW_EMERY_R, hi));
    if (y < 0) y += ZPOW_EMERY_M;
    return y;
}

struct Rng {
    int tap;
    int feed;
    long long* vec;
};

__device__ void rng_seed(Rng* r, long long seed, int emery) {
    r->tap = 0;
    r->feed = ZPOW_RNG_LEN - ZPOW_RNG_TAP;
    if (seed < 0) seed += 0x7fffffffffffffffLL;
    if (seed == 0) seed = ZPOW_ZERO_SEED;
    long long xr = emery ? seed : 0;
    long long x = seed;
    for (int i = -30; i < ZPOW_RNG_LEN; i++) {
        x = seedrand48(x) ^ xr;
        if (i >= 0) {
            long long x1 = x;
            x = seedrand48(x) ^ xr;
            long long x2 = x;
            x = seedrand48(x) ^ xr;
            unsigned long long u =
                ((unsigned long long)x1 << 40) ^
                ((unsigned long long)x2 << 20) ^
                (unsigned long long)x ^
                (unsigned long long)c_cooked[i];
            r->vec[i] = (long long)u;
        }
    }
}

__device__ long long rng_int63(Rng* r) {
    r->tap--;
    if (r->tap < 0) r->tap += ZPOW_RNG_LEN;
    r->feed--;
    if (r->feed < 0) r->feed += ZPOW_RNG_LEN;
    unsigned long long x = (unsigned long long)r->vec[r->feed] + (unsigned long long)r->vec[r->tap];
    r->vec[r->feed] = (long long)x;
    return (long long)(x & (unsigned long long)ZPOW_RNG_MASK);
}

__device__ long long rng_int63n(Rng* r, long long n) {
    if ((n & (n - 1)) == 0) return rng_int63(r) & (n - 1);
    unsigned long long un = (unsigned long long)n;
    long long max = (long long)(0x7fffffffffffffffULL - ((1ULL << 63) % un));
    long long v = rng_int63(r);
    while (v > max) v = rng_int63(r);
    return v % n;
}

__device__ long long load_be64(const unsigned char* p) {
    unsigned long long v = 0;
    for (int i = 0; i < 8; i++) v = (v << 8) | p[i];
    return (long long)v;
}

__device__ void fill_matrix(const unsigned char* hash, int emery, double* m) {
    long long seed[4];
    for (int i = 0; i < 4; i++) seed[i] = load_be64(hash + 8 * i);
    long long vec[607];
    Rng rng;
    rng.vec = vec;
    long long cur = 0;
    for (int i = 0; i < ZPOW_DIM; i++) {
        cur ^= seed[i % 4];
        rng_seed(&rng, cur, emery);
        for (int j = 0; j < ZPOW_DIM; j++) {
            cur = rng_int63n(&rng, 0x7fffffffffffffffLL);
            m[i * ZPOW_DIM + j] = (double)rng_int63n(&rng, 3);
        }
    }
}

__device__ int idamax(const double* a, int n, int col, int row0) {
    if (n < 2) return 0;
    int idx = 0;
    double maxv = fabs(a[row0 * ZPOW_DIM + col]);
    for (int i = 1; i < n; i++) {
        double v = fabs(a[(row0 + i) * ZPOW_DIM + col]);
        if (v > maxv) {
            maxv = v;
            idx = i;
        }
    }
    return idx;
}

__device__ void factor(double* a, double* diag, int* swapSign) {
    int piv[30];
    for (int j = 0; j < ZPOW_DIM; j++) {
        int jp = j + idamax(a, ZPOW_DIM - j, j, j);
        piv[j] = jp;
        if (a[jp * ZPOW_DIM + j] != 0.0) {
            if (jp != j) {
                for (int c = 0; c < ZPOW_DIM; c++) {
                    double tmp = a[j * ZPOW_DIM + c];
                    a[j * ZPOW_DIM + c] = a[jp * ZPOW_DIM + c];
                    a[jp * ZPOW_DIM + c] = tmp;
                }
            }
            if (j < ZPOW_DIM - 1) {
                double aj = a[j * ZPOW_DIM + j];
                if (fabs(aj) >= sfmin()) {
                    double inv = 1.0 / aj;
                    for (int i = j + 1; i < ZPOW_DIM; i++) a[i * ZPOW_DIM + j] *= inv;
                } else {
                    for (int i = 0; i < ZPOW_DIM - j - 1; i++) {
                        a[(j + 1) * ZPOW_DIM + j] = a[(j + 1) * ZPOW_DIM + j] / a[ZPOW_DIM * j + j];
                    }
                }
            }
        }
        if (j < ZPOW_DIM - 1) {
            for (int row = j + 1; row < ZPOW_DIM; row++) {
                double t = (-1.0) * a[row * ZPOW_DIM + j];
                for (int col = j + 1; col < ZPOW_DIM; col++) {
                    a[row * ZPOW_DIM + col] = a[row * ZPOW_DIM + col] + t * a[j * ZPOW_DIM + col];
                }
            }
        }
    }
    int sign = 1;
    for (int i = 0; i < ZPOW_DIM; i++) {
        diag[i] = a[i * ZPOW_DIM + i];
        if (piv[i] != i) sign = -sign;
    }
    *swapSign = sign;
}

__global__ void zpow_factor_kernel(const unsigned char* hashes, int count, int emery, double* diags, int* signs) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= count) return;
    double a[900];
    fill_matrix(hashes + idx * 32, emery, a);
    double diag[30];
    int sign = 1;
    factor(a, diag, &sign);
    double* out = diags + idx * ZPOW_DIM;
    for (int i = 0; i < ZPOW_DIM; i++) out[i] = diag[i];
    signs[idx] = sign;
}

static int ensure_cooked() {
    if (g_cooked) return 0;
    cudaError_t e = cudaMemcpyToSymbol(c_cooked, zpow_rng_cooked, sizeof(zpow_rng_cooked));
    if (e != cudaSuccess) {
        set_cuda(e);
        return 2;
    }
    g_cooked = 1;
    return 0;
}

static int ensure_cap(int count) {
    if (count <= g_cap) return 0;
    free_bufs();
    cudaError_t e;
    e = cudaMalloc(&g_hash, (size_t)count * 32);
    if (e != cudaSuccess) { set_cuda(e); return 2; }
    e = cudaMalloc(&g_diag, (size_t)count * ZPOW_DIM * sizeof(double));
    if (e != cudaSuccess) { set_cuda(e); free_bufs(); return 2; }
    e = cudaMalloc(&g_sign, (size_t)count * sizeof(int));
    if (e != cudaSuccess) { set_cuda(e); free_bufs(); return 2; }
    g_cap = count;
    return 0;
}

extern "C" {

#ifdef _WIN32
#define ZPOW_API __declspec(dllexport)
#else
#define ZPOW_API __attribute__((visibility("default")))
#endif

ZPOW_API const char* zpow_last_error(void) { return g_err; }

ZPOW_API int zpow_device_count(void) {
    int n = 0;
    cudaError_t e = cudaGetDeviceCount(&n);
    if (e != cudaSuccess) {
        set_cuda(e);
        return -1;
    }
    return n;
}

ZPOW_API int zpow_set_device(int device) {
    cudaError_t e = cudaSetDevice(device);
    if (e != cudaSuccess) {
        set_cuda(e);
        return 2;
    }
    g_cooked = 0;
    free_bufs();
    return ensure_cooked();
}

ZPOW_API int zpow_device_name(int device, char* buf, int buflen) {
    if (!buf || buflen < 2) {
        set_err("name buffer is short");
        return 1;
    }
    cudaDeviceProp prop;
    cudaError_t e = cudaGetDeviceProperties(&prop, device);
    if (e != cudaSuccess) {
        set_cuda(e);
        buf[0] = 0;
        return 2;
    }
    snprintf(buf, (size_t)buflen, "%s", prop.name);
    return 0;
}

ZPOW_API int zpow_factor_batch(const unsigned char* hashes, int count, int emery, double* diags, int* signs) {
    if (count < 0 || (count > 0 && (!hashes || !diags || !signs))) {
        set_err("bad batch");
        return 1;
    }
    if (count == 0) return 0;
    int rc = ensure_cooked();
    if (rc) return rc;
    rc = ensure_cap(count);
    if (rc) return rc;
    cudaError_t e = cudaMemcpy(g_hash, hashes, (size_t)count * 32, cudaMemcpyHostToDevice);
    if (e != cudaSuccess) { set_cuda(e); return 2; }
    int threads = 128;
    int blocks = (count + threads - 1) / threads;
    zpow_factor_kernel<<<blocks, threads>>>(g_hash, count, emery, g_diag, g_sign);
    e = cudaGetLastError();
    if (e != cudaSuccess) { set_cuda(e); return 2; }
    e = cudaDeviceSynchronize();
    if (e != cudaSuccess) { set_cuda(e); return 2; }
    e = cudaMemcpy(diags, g_diag, (size_t)count * ZPOW_DIM * sizeof(double), cudaMemcpyDeviceToHost);
    if (e != cudaSuccess) { set_cuda(e); return 2; }
    e = cudaMemcpy(signs, g_sign, (size_t)count * sizeof(int), cudaMemcpyDeviceToHost);
    if (e != cudaSuccess) { set_cuda(e); return 2; }
    return 0;
}

} // extern "C"
