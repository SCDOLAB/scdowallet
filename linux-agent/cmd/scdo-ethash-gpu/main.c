#define _POSIX_C_SOURCE 200809L
#define CL_TARGET_OPENCL_VERSION 120
/* scdo-ethash-gpu searches one ethash nonce range on a NVIDIA adapter.
   self-test checks the host ethash-light vectors and, when any OpenCL device
   is present, one device hashimoto. solve refuses unless nvidia-smi lists an
   adapter and OpenCL exposes a NVIDIA GPU. A CPU search is not a solution. */
#include <CL/cl.h>
#include <ctype.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

extern const unsigned char ethash_kernel_src[];
extern const unsigned int ethash_kernel_len;

static uint64_t rotl64(uint64_t x, unsigned n) {
  return (n == 0) ? x : (x << n) | (x >> (64 - n));
}

static void keccakf(uint64_t st[25]) {
  static const uint64_t rc[24] = {
      0x0000000000000001ULL, 0x0000000000008082ULL, 0x800000000000808aULL,
      0x8000000080008000ULL, 0x000000000000808bULL, 0x0000000080000001ULL,
      0x8000000080008081ULL, 0x8000000000008009ULL, 0x000000000000008aULL,
      0x0000000000000088ULL, 0x0000000080008009ULL, 0x000000008000000aULL,
      0x000000008000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL,
      0x8000000000008003ULL, 0x8000000000008002ULL, 0x8000000000000080ULL,
      0x000000000000800aULL, 0x800000008000000aULL, 0x8000000080008081ULL,
      0x8000000000008080ULL, 0x0000000080000001ULL, 0x8000000080008008ULL};
  static const unsigned char piln[24] = {10, 7,  11, 17, 18, 3,  5,  16, 8,  21, 24, 4,
                                          15, 23, 19, 13, 12, 2,  20, 14, 22, 9,  6,  1};
  static const unsigned char rotc[24] = {1,  3,  6,  10, 15, 21, 28, 36, 45, 55, 2,  14,
                                          27, 41, 56, 8,  25, 43, 62, 18, 39, 61, 20, 44};
  for (int round = 0; round < 24; round++) {
    uint64_t bc[5];
    for (int i = 0; i < 5; i++)
      bc[i] = st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20];
    for (int i = 0; i < 5; i++) {
      uint64_t t = bc[(i + 4) % 5] ^ rotl64(bc[(i + 1) % 5], 1);
      for (int j = 0; j < 25; j += 5) st[j + i] ^= t;
    }
    uint64_t t = st[1];
    for (int i = 0; i < 24; i++) {
      uint64_t nxt = st[piln[i]];
      st[piln[i]] = rotl64(t, rotc[i]);
      t = nxt;
    }
    for (int j = 0; j < 25; j += 5) {
      uint64_t t0 = st[j], t1 = st[j + 1], t2 = st[j + 2], t3 = st[j + 3], t4 = st[j + 4];
      st[j] = t0 ^ ((~t1) & t2);
      st[j + 1] = t1 ^ ((~t2) & t3);
      st[j + 2] = t2 ^ ((~t3) & t4);
      st[j + 3] = t3 ^ ((~t4) & t0);
      st[j + 4] = t4 ^ ((~t0) & t1);
    }
    st[0] ^= rc[round];
  }
}

static void keccak512(uint8_t dst[64], const uint8_t *src, size_t len) {
  uint64_t st[25] = {0};
  uint8_t temp[72] = {0};
  if (len > 71) len = 71;
  memcpy(temp, src, len);
  temp[len] = 0x01;
  temp[71] |= 0x80;
  for (int i = 0; i < 9; i++) {
    uint64_t v = 0;
    for (int b = 0; b < 8; b++) v |= (uint64_t)temp[i * 8 + b] << (8 * b);
    st[i] ^= v;
  }
  keccakf(st);
  for (int i = 0; i < 8; i++) {
    uint64_t v = st[i];
    for (int b = 0; b < 8; b++) dst[i * 8 + b] = (uint8_t)((v >> (8 * b)) & 0xff);
  }
}

static void keccak256(uint8_t dst[32], const uint8_t *src, size_t len) {
  uint64_t st[25] = {0};
  uint8_t temp[136] = {0};
  if (len > 135) len = 135;
  memcpy(temp, src, len);
  temp[len] = 0x01;
  temp[135] |= 0x80;
  for (int i = 0; i < 17; i++) {
    uint64_t v = 0;
    for (int b = 0; b < 8; b++) v |= (uint64_t)temp[i * 8 + b] << (8 * b);
    st[i] ^= v;
  }
  keccakf(st);
  for (int i = 0; i < 4; i++) {
    uint64_t v = st[i];
    for (int b = 0; b < 8; b++) dst[i * 8 + b] = (uint8_t)((v >> (8 * b)) & 0xff);
  }
}

static uint32_t load32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static void store32(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)v;
  p[1] = (uint8_t)(v >> 8);
  p[2] = (uint8_t)(v >> 16);
  p[3] = (uint8_t)(v >> 24);
}

static uint32_t fnv(uint32_t a, uint32_t b) { return a * 0x01000193u ^ b; }

static int prime(uint64_t n) {
  if (n < 2) return 0;
  if (n % 2 == 0) return n == 2;
  if (n % 3 == 0) return n == 3;
  for (uint64_t i = 5; i * i <= n; i += 6) {
    if (n % i == 0 || n % (i + 2) == 0) return 0;
  }
  return 1;
}

static uint64_t cache_size(uint64_t epoch) {
  uint64_t size = (1ull << 24) + (1ull << 17) * epoch - 64;
  while (!prime(size / 64)) size -= 128;
  return size;
}

static uint64_t dataset_size(uint64_t epoch) {
  uint64_t size = (1ull << 30) + (1ull << 23) * epoch - 128;
  while (!prime(size / 128)) size -= 256;
  return size;
}

static void seed_epoch(uint8_t seed[32], uint64_t epoch) {
  memset(seed, 0, 32);
  for (uint64_t i = 0; i < epoch; i++) {
    uint8_t next[32];
    keccak256(next, seed, 32);
    memcpy(seed, next, 32);
  }
}

static uint32_t *generate_cache(uint64_t size, const uint8_t seed[32]) {
  if (size < 64 || size % 64 != 0) return NULL;
  uint8_t *raw = calloc(1, size);
  uint32_t *out = calloc(size / 4, sizeof(uint32_t));
  if (!raw || !out) {
    free(raw);
    free(out);
    return NULL;
  }
  int rows = (int)(size / 64);
  keccak512(raw, seed, 32);
  for (int row = 1; row < rows; row++) keccak512(raw + row * 64, raw + (row - 1) * 64, 64);
  uint8_t temp[64];
  for (int round = 0; round < 3; round++) {
    for (int j = 0; j < rows; j++) {
      int src = ((j - 1 + rows) % rows) * 64;
      int dst = j * 64;
      uint32_t pick = load32(raw + dst) % (uint32_t)rows;
      int xor = (int)pick * 64;
      for (int i = 0; i < 64; i++) temp[i] = raw[src + i] ^ raw[xor + i];
      keccak512(raw + dst, temp, 64);
    }
  }
  for (uint64_t i = 0; i < size / 4; i++) out[i] = load32(raw + i * 4);
  free(raw);
  return out;
}

static void dataset_item(const uint32_t *cache, uint32_t rows, uint32_t index, uint8_t out[64]) {
  uint8_t mix[64];
  uint32_t base = (index % rows) * 16u;
  store32(mix, cache[base] ^ index);
  for (uint32_t i = 1; i < 16; i++) store32(mix + i * 4, cache[base + i]);
  keccak512(mix, mix, 64);
  uint32_t words[16];
  for (int i = 0; i < 16; i++) words[i] = load32(mix + i * 4);
  for (uint32_t j = 0; j < 256; j++) {
    uint32_t parent = fnv(index ^ j, words[j % 16]) % rows;
    uint32_t off = parent * 16u;
    for (int i = 0; i < 16; i++) words[i] = fnv(words[i], cache[off + (uint32_t)i]);
  }
  for (int i = 0; i < 16; i++) store32(mix + i * 4, words[i]);
  keccak512(out, mix, 64);
}

static void hashimoto_light(const uint32_t *cache, uint32_t cache_rows, uint64_t dataset_bytes,
                             const uint8_t header[32], uint64_t nonce, uint8_t mix_out[32], uint8_t result[32]) {
  uint32_t dag_rows = (uint32_t)(dataset_bytes / 128);
  uint8_t seed_in[40], seed[64];
  memcpy(seed_in, header, 32);
  for (int b = 0; b < 8; b++) seed_in[32 + b] = (uint8_t)((nonce >> (8 * b)) & 0xff);
  keccak512(seed, seed_in, 40);
  uint32_t seed_head = load32(seed);
  uint32_t mix[32];
  for (int i = 0; i < 32; i++) mix[i] = load32(seed + (i % 16) * 4);
  for (uint32_t i = 0; i < 64; i++) {
    uint32_t parent = fnv(i ^ seed_head, mix[i % 32]) % dag_rows;
    uint32_t temp[32];
    for (uint32_t j = 0; j < 2; j++) {
      uint8_t item[64];
      dataset_item(cache, cache_rows, 2 * parent + j, item);
      for (int k = 0; k < 16; k++) temp[j * 16 + (uint32_t)k] = load32(item + k * 4);
    }
    for (int k = 0; k < 32; k++) mix[k] = fnv(mix[k], temp[k]);
  }
  uint8_t digest[32];
  for (int i = 0; i < 8; i++) {
    uint32_t c = fnv(fnv(fnv(mix[i * 4], mix[i * 4 + 1]), mix[i * 4 + 2]), mix[i * 4 + 3]);
    store32(digest + i * 4, c);
  }
  uint8_t buf[96];
  memcpy(buf, seed, 64);
  memcpy(buf + 64, digest, 32);
  keccak256(result, buf, 96);
  memcpy(mix_out, digest, 32);
}

static int hex_nibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static int parse_hex32(const char *s, uint8_t out[32]) {
  if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) s += 2;
  if (strlen(s) != 64) return -1;
  for (int i = 0; i < 32; i++) {
    int hi = hex_nibble(s[i * 2]), lo = hex_nibble(s[i * 2 + 1]);
    if (hi < 0 || lo < 0) return -1;
    out[i] = (uint8_t)((hi << 4) | lo);
  }
  return 0;
}

static int hex_eq(const uint8_t *got, const char *want) {
  uint8_t exp[64];
  size_t n = strlen(want) / 2;
  if (n > sizeof exp) return 0;
  for (size_t i = 0; i < n; i++) {
    int hi = hex_nibble(want[i * 2]), lo = hex_nibble(want[i * 2 + 1]);
    if (hi < 0 || lo < 0) return 0;
    exp[i] = (uint8_t)((hi << 4) | lo);
  }
  return memcmp(got, exp, n) == 0;
}

static int64_t now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static void print_hex(FILE *fp, const uint8_t *p, size_t n) {
  for (size_t i = 0; i < n; i++) fprintf(fp, "%02x", p[i]);
}

static int check_host_vectors(void) {
  uint8_t empty[64];
  keccak512(empty, (const uint8_t *)"", 0);
  if (!hex_eq(empty,
              "0eab42de4c3ceb9235fc91acffe746b29c29a8c366b7c60e4e67c466f36a4304"
              "c00fa9caf9d87976ba469bcbe06713b435f091ef2769fb160cdab33d3670680e")) {
    fprintf(stderr, "keccak512\n");
    return 1;
  }
  if (cache_size(0) != 16776896 || dataset_size(0) != 1073739904) {
    fprintf(stderr, "sizes\n");
    return 1;
  }
  uint8_t seed[32] = {0};
  uint32_t *cache = generate_cache(1024, seed);
  if (!cache) return 1;
  uint8_t prefix[64];
  for (int i = 0; i < 16; i++) store32(prefix + i * 4, cache[i]);
  int bad = !hex_eq(prefix,
                     "7ce2991c951f7bf4c4c1bb119887ee07871eb5339d7b97b8588e85c742de90e5"
                     "bafd5bbe6ce93a134fb6be9ad3e30db99d9528a2ea7846833f52e9ca119b6b54");
  uint8_t header[32], mix[32], result[32];
  parse_hex32("c9149cc0386e689d789a1c2f3d5d169a61a6218ed30e74414dc736e442ef3d1f", header);
  hashimoto_light(cache, 1024 / 64, 32 * 1024, header, 0, mix, result);
  bad = bad || !hex_eq(mix, "e4073cffaef931d37117cefd9afd27ea0f1cad6a981dd2605c4a1ac97c519800");
  bad = bad || !hex_eq(result, "d3539235ee2e6f8db665c0a72169f55b7f6c605712330b778ec3944f0eb5a557");
  free(cache);
  if (bad) fprintf(stderr, "hashimoto\n");
  return bad;
}

typedef struct {
  cl_context ctx;
  cl_device_id dev;
  cl_command_queue q;
  cl_program prog;
} ocl_t;

static int ocl_build(ocl_t *o, cl_device_id dev) {
  memset(o, 0, sizeof *o);
  cl_int err = 0;
  o->ctx = clCreateContext(NULL, 1, &dev, NULL, NULL, &err);
  if (err != CL_SUCCESS) return err;
  o->q = clCreateCommandQueue(o->ctx, dev, 0, &err);
  if (err != CL_SUCCESS) return err;
  const char *src = (const char *)ethash_kernel_src;
  size_t len = ethash_kernel_len;
  o->prog = clCreateProgramWithSource(o->ctx, 1, &src, &len, &err);
  if (err != CL_SUCCESS) return err;
  err = clBuildProgram(o->prog, 1, &dev, "-cl-std=CL1.2", NULL, NULL);
  if (err != CL_SUCCESS) {
    size_t logn = 0;
    clGetProgramBuildInfo(o->prog, dev, CL_PROGRAM_BUILD_LOG, 0, NULL, &logn);
    char *log = calloc(1, logn + 1);
    if (log) {
      clGetProgramBuildInfo(o->prog, dev, CL_PROGRAM_BUILD_LOG, logn, log, NULL);
      fprintf(stderr, "%s\n", log);
      free(log);
    }
    return err;
  }
  o->dev = dev;
  return 0;
}

static void ocl_free(ocl_t *o) {
  if (o->prog) clReleaseProgram(o->prog);
  if (o->q) clReleaseCommandQueue(o->q);
  if (o->ctx) clReleaseContext(o->ctx);
}

static int device_is_nvidia_gpu(cl_device_id dev) {
  cl_device_type typ = 0;
  char vendor[128] = {0};
  clGetDeviceInfo(dev, CL_DEVICE_TYPE, sizeof typ, &typ, NULL);
  clGetDeviceInfo(dev, CL_DEVICE_VENDOR, sizeof vendor - 1, vendor, NULL);
  if ((typ & CL_DEVICE_TYPE_GPU) == 0) return 0;
  for (char *p = vendor; *p; p++) *p = (char)tolower((unsigned char)*p);
  return strstr(vendor, "nvidia") != NULL;
}

static int nvidia_smi_lists_gpu(void) {
  FILE *fp = popen("nvidia-smi -L", "r");
  if (!fp) return 0;
  char buf[1024];
  size_t n = fread(buf, 1, sizeof buf - 1, fp);
  int st = pclose(fp);
  if (st != 0 || n == 0) return 0;
  buf[n] = 0;
  return strstr(buf, "GPU") != NULL;
}

static cl_device_id find_device(int nvidia_only) {
  cl_platform_id plats[16];
  cl_uint np = 0;
  if (clGetPlatformIDs(16, plats, &np) != CL_SUCCESS) return NULL;
  for (cl_uint i = 0; i < np; i++) {
    cl_device_id devs[16];
    cl_uint nd = 0;
    if (clGetDeviceIDs(plats[i], CL_DEVICE_TYPE_ALL, 16, devs, &nd) != CL_SUCCESS) continue;
    for (cl_uint j = 0; j < nd; j++) {
      if (nvidia_only) {
        if (device_is_nvidia_gpu(devs[j])) return devs[j];
      } else {
        return devs[j];
      }
    }
  }
  return NULL;
}

static int device_hashimoto_matches(cl_device_id dev) {
  ocl_t o;
  if (ocl_build(&o, dev) != 0) {
    ocl_free(&o);
    return 1;
  }
  uint8_t seed[32] = {0};
  uint32_t *cache = generate_cache(1024, seed);
  uint8_t header[32], want_mix[32], want_result[32];
  parse_hex32("c9149cc0386e689d789a1c2f3d5d169a61a6218ed30e74414dc736e442ef3d1f", header);
  hashimoto_light(cache, 16, 32 * 1024, header, 0, want_mix, want_result);
  cl_int err = 0;
  cl_mem cbuf = clCreateBuffer(o.ctx, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR, 1024, cache, &err);
  cl_mem hbuf = clCreateBuffer(o.ctx, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR, 32, header, &err);
  cl_mem mbuf = clCreateBuffer(o.ctx, CL_MEM_WRITE_ONLY, 32, NULL, &err);
  cl_mem rbuf = clCreateBuffer(o.ctx, CL_MEM_WRITE_ONLY, 32, NULL, &err);
  cl_kernel k = clCreateKernel(o.prog, "hashimoto_one", &err);
  uint32_t cache_rows = 16, dag_rows = (32 * 1024) / 128;
  uint64_t nonce = 0;
  int bad = err != CL_SUCCESS;
  bad = bad || clSetKernelArg(k, 0, sizeof hbuf, &hbuf) != CL_SUCCESS;
  bad = bad || clSetKernelArg(k, 1, sizeof cbuf, &cbuf) != CL_SUCCESS;
  bad = bad || clSetKernelArg(k, 2, sizeof cache_rows, &cache_rows) != CL_SUCCESS;
  bad = bad || clSetKernelArg(k, 3, sizeof dag_rows, &dag_rows) != CL_SUCCESS;
  bad = bad || clSetKernelArg(k, 4, sizeof nonce, &nonce) != CL_SUCCESS;
  bad = bad || clSetKernelArg(k, 5, sizeof mbuf, &mbuf) != CL_SUCCESS;
  bad = bad || clSetKernelArg(k, 6, sizeof rbuf, &rbuf) != CL_SUCCESS;
  size_t one = 1;
  bad = bad || clEnqueueNDRangeKernel(o.q, k, 1, NULL, &one, NULL, 0, NULL, NULL) != CL_SUCCESS;
  uint8_t mix[32], result[32];
  bad = bad || clEnqueueReadBuffer(o.q, mbuf, CL_TRUE, 0, 32, mix, 0, NULL, NULL) != CL_SUCCESS;
  bad = bad || clEnqueueReadBuffer(o.q, rbuf, CL_TRUE, 0, 32, result, 0, NULL, NULL) != CL_SUCCESS;
  bad = bad || memcmp(mix, want_mix, 32) != 0 || memcmp(result, want_result, 32) != 0;
  if (bad) {
    fprintf(stderr, "device hashimoto ");
    print_hex(stderr, mix, 32);
    fprintf(stderr, " ");
    print_hex(stderr, result, 32);
    fprintf(stderr, "\n");
  }
  if (k) clReleaseKernel(k);
  if (cbuf) clReleaseMemObject(cbuf);
  if (hbuf) clReleaseMemObject(hbuf);
  if (mbuf) clReleaseMemObject(mbuf);
  if (rbuf) clReleaseMemObject(rbuf);
  free(cache);
  ocl_free(&o);
  return bad;
}

static int self_test(void) {
  if (check_host_vectors() != 0) return 1;
  cl_device_id dev = find_device(0);
  if (!dev) {
    fprintf(stderr, "opencl skipped\n");
    return 0;
  }
  return device_hashimoto_matches(dev);
}

static int search_on_device(ocl_t *o, cl_mem header, cl_mem cache, cl_mem dataset, cl_mem target, uint32_t cache_rows,
                            uint32_t dag_rows, int use_dag, int64_t deadline, uint64_t *nonce_out, uint8_t mix_out[32]) {
  cl_int err = 0;
  cl_mem found = clCreateBuffer(o->ctx, CL_MEM_READ_WRITE, sizeof(uint32_t), NULL, &err);
  cl_mem nonce_buf = clCreateBuffer(o->ctx, CL_MEM_WRITE_ONLY, sizeof(uint64_t), NULL, &err);
  cl_mem mix_buf = clCreateBuffer(o->ctx, CL_MEM_WRITE_ONLY, 32, NULL, &err);
  const char *name = use_dag ? "search_dag" : "search_light";
  cl_kernel k = clCreateKernel(o->prog, name, &err);
  if (err != CL_SUCCESS || !k) {
    fprintf(stderr, "kernel\n");
    return 1;
  }
  uint32_t zero = 0;
  clEnqueueWriteBuffer(o->q, found, CL_TRUE, 0, sizeof zero, &zero, 0, NULL, NULL);
  size_t global = 4096;
  uint64_t base = 0;
  int hit = 0;
  while (now_ms() < deadline) {
    uint32_t flag = 0;
    clEnqueueReadBuffer(o->q, found, CL_TRUE, 0, sizeof flag, &flag, 0, NULL, NULL);
    if (flag) {
      hit = 1;
      break;
    }
    cl_uint arg = 0;
    if (use_dag) {
      clSetKernelArg(k, arg++, sizeof header, &header);
      clSetKernelArg(k, arg++, sizeof dataset, &dataset);
      clSetKernelArg(k, arg++, sizeof dag_rows, &dag_rows);
      clSetKernelArg(k, arg++, sizeof base, &base);
      clSetKernelArg(k, arg++, sizeof target, &target);
      clSetKernelArg(k, arg++, sizeof found, &found);
      clSetKernelArg(k, arg++, sizeof nonce_buf, &nonce_buf);
      clSetKernelArg(k, arg++, sizeof mix_buf, &mix_buf);
    } else {
      clSetKernelArg(k, arg++, sizeof header, &header);
      clSetKernelArg(k, arg++, sizeof cache, &cache);
      clSetKernelArg(k, arg++, sizeof cache_rows, &cache_rows);
      clSetKernelArg(k, arg++, sizeof dag_rows, &dag_rows);
      clSetKernelArg(k, arg++, sizeof base, &base);
      clSetKernelArg(k, arg++, sizeof target, &target);
      clSetKernelArg(k, arg++, sizeof found, &found);
      clSetKernelArg(k, arg++, sizeof nonce_buf, &nonce_buf);
      clSetKernelArg(k, arg++, sizeof mix_buf, &mix_buf);
    }
    if (clEnqueueNDRangeKernel(o->q, k, 1, NULL, &global, NULL, 0, NULL, NULL) != CL_SUCCESS) {
      clReleaseKernel(k);
      return 1;
    }
    clFinish(o->q);
    base += global;
  }
  uint32_t flag = 0;
  clEnqueueReadBuffer(o->q, found, CL_TRUE, 0, sizeof flag, &flag, 0, NULL, NULL);
  if (flag) hit = 1;
  if (hit) {
    clEnqueueReadBuffer(o->q, nonce_buf, CL_TRUE, 0, sizeof *nonce_out, nonce_out, 0, NULL, NULL);
    clEnqueueReadBuffer(o->q, mix_buf, CL_TRUE, 0, 32, mix_out, 0, NULL, NULL);
  }
  clReleaseKernel(k);
  clReleaseMemObject(found);
  clReleaseMemObject(nonce_buf);
  clReleaseMemObject(mix_buf);
  return hit ? 0 : 2;
}

static int fill_dag(ocl_t *o, cl_mem cache, cl_mem dataset, uint32_t cache_rows, uint32_t items) {
  cl_int err = 0;
  cl_kernel k = clCreateKernel(o->prog, "dag_range", &err);
  if (err != CL_SUCCESS) return 1;
  const uint32_t batch = 1u << 20;
  for (uint32_t begin = 0; begin < items; begin += batch) {
    uint32_t end = begin + batch;
    if (end > items) end = items;
    uint32_t count = end - begin;
    size_t global = count;
    clSetKernelArg(k, 0, sizeof cache, &cache);
    clSetKernelArg(k, 1, sizeof cache_rows, &cache_rows);
    clSetKernelArg(k, 2, sizeof dataset, &dataset);
    clSetKernelArg(k, 3, sizeof begin, &begin);
    clSetKernelArg(k, 4, sizeof end, &end);
    if (clEnqueueNDRangeKernel(o->q, k, 1, NULL, &global, NULL, 0, NULL, NULL) != CL_SUCCESS) {
      clReleaseKernel(k);
      return 1;
    }
    clFinish(o->q);
  }
  clReleaseKernel(k);
  return 0;
}

static int solve(int argc, char **argv) {
  if (argc != 6) {
    fprintf(stderr, "usage: scdo-ethash-gpu solve <epoch> <header> <target> <deadlineUnixMs>\n");
    return 2;
  }
  if (!nvidia_smi_lists_gpu()) {
    fprintf(stderr, "no nvidia adapter\n");
    return 3;
  }
  cl_device_id dev = find_device(1);
  if (!dev) {
    fprintf(stderr, "no nvidia opencl device\n");
    return 3;
  }
  char *end = NULL;
  unsigned long long epoch_u = strtoull(argv[2], &end, 10);
  if (!end || *end || epoch_u > 100000) return 2;
  uint8_t header[32], target[32];
  if (parse_hex32(argv[3], header) || parse_hex32(argv[4], target)) return 2;
  long long deadline = strtoll(argv[5], &end, 10);
  if (!end || *end || deadline <= 0) return 2;
  if (now_ms() >= deadline) return 1;

  uint64_t csize = cache_size((uint64_t)epoch_u);
  uint64_t dsize = dataset_size((uint64_t)epoch_u);
  uint8_t seed[32];
  seed_epoch(seed, (uint64_t)epoch_u);
  uint32_t *cache = generate_cache(csize, seed);
  if (!cache) return 1;
  uint32_t cache_rows = (uint32_t)(csize / 64);
  uint32_t dag_rows = (uint32_t)(dsize / 128);
  uint32_t items = (uint32_t)(dsize / 64);

  ocl_t o;
  if (ocl_build(&o, dev) != 0) {
    free(cache);
    ocl_free(&o);
    return 3;
  }
  cl_int err = 0;
  cl_mem cbuf = clCreateBuffer(o.ctx, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR, csize, cache, &err);
  cl_mem hbuf = clCreateBuffer(o.ctx, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR, 32, header, &err);
  cl_mem tbuf = clCreateBuffer(o.ctx, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR, 32, target, &err);
  cl_mem dbuf = clCreateBuffer(o.ctx, CL_MEM_READ_WRITE, dsize, NULL, &err);
  int use_dag = err == CL_SUCCESS && dbuf != NULL;
  if (!use_dag) {
    err = CL_SUCCESS;
    dbuf = NULL;
  }
  if (!cbuf || !hbuf || !tbuf) {
    free(cache);
    ocl_free(&o);
    return 3;
  }
  if (use_dag) {
    uint8_t host_item[64];
    dataset_item(cache, cache_rows, 0, host_item);
    if (fill_dag(&o, cbuf, dbuf, cache_rows, items) != 0) {
      use_dag = 0;
      clReleaseMemObject(dbuf);
      dbuf = NULL;
    } else {
      uint8_t got[64];
      if (clEnqueueReadBuffer(o.q, dbuf, CL_TRUE, 0, 64, got, 0, NULL, NULL) != CL_SUCCESS ||
          memcmp(got, host_item, 64) != 0) {
        fprintf(stderr, "dataset mismatch\n");
        use_dag = 0;
        clReleaseMemObject(dbuf);
        dbuf = NULL;
      }
    }
  }
  /* One device hashimoto of nonce 0 must match the host before any search. */
  {
    cl_mem mbuf = clCreateBuffer(o.ctx, CL_MEM_WRITE_ONLY, 32, NULL, &err);
    cl_mem rbuf = clCreateBuffer(o.ctx, CL_MEM_WRITE_ONLY, 32, NULL, &err);
    cl_kernel k = clCreateKernel(o.prog, "hashimoto_one", &err);
    uint64_t nonce = 0;
    uint8_t host_mix[32], host_result[32], dev_mix[32], dev_result[32];
    hashimoto_light(cache, cache_rows, dsize, header, 0, host_mix, host_result);
    int bad = err != CL_SUCCESS;
    bad = bad || clSetKernelArg(k, 0, sizeof hbuf, &hbuf);
    bad = bad || clSetKernelArg(k, 1, sizeof cbuf, &cbuf);
    bad = bad || clSetKernelArg(k, 2, sizeof cache_rows, &cache_rows);
    bad = bad || clSetKernelArg(k, 3, sizeof dag_rows, &dag_rows);
    bad = bad || clSetKernelArg(k, 4, sizeof nonce, &nonce);
    bad = bad || clSetKernelArg(k, 5, sizeof mbuf, &mbuf);
    bad = bad || clSetKernelArg(k, 6, sizeof rbuf, &rbuf);
    size_t one = 1;
    bad = bad || clEnqueueNDRangeKernel(o.q, k, 1, NULL, &one, NULL, 0, NULL, NULL);
    bad = bad || clEnqueueReadBuffer(o.q, mbuf, CL_TRUE, 0, 32, dev_mix, 0, NULL, NULL);
    bad = bad || clEnqueueReadBuffer(o.q, rbuf, CL_TRUE, 0, 32, dev_result, 0, NULL, NULL);
    bad = bad || memcmp(dev_mix, host_mix, 32) || memcmp(dev_result, host_result, 32);
    if (k) clReleaseKernel(k);
    if (mbuf) clReleaseMemObject(mbuf);
    if (rbuf) clReleaseMemObject(rbuf);
    if (bad) {
      fprintf(stderr, "device mismatch\n");
      free(cache);
      if (cbuf) clReleaseMemObject(cbuf);
      if (hbuf) clReleaseMemObject(hbuf);
      if (tbuf) clReleaseMemObject(tbuf);
      if (dbuf) clReleaseMemObject(dbuf);
      ocl_free(&o);
      return 4;
    }
  }
  uint64_t nonce = 0;
  uint8_t mix[32];
  int rc = search_on_device(&o, hbuf, cbuf, dbuf, tbuf, cache_rows, dag_rows, use_dag, deadline, &nonce, mix);
  if (rc == 0) {
    /* Confirm on the host light path before printing. A mismatch is not a solution. */
    uint8_t host_mix[32], host_result[32];
    hashimoto_light(cache, cache_rows, dsize, header, nonce, host_mix, host_result);
    if (memcmp(host_mix, mix, 32) != 0) {
      fprintf(stderr, "mix mismatch\n");
      rc = 4;
    } else {
      printf("{\"nonce\":\"0x%016" PRIx64 "\",\"mixHash\":\"0x", nonce);
      print_hex(stdout, mix, 32);
      printf("\"}\n");
    }
  }
  free(cache);
  clReleaseMemObject(cbuf);
  clReleaseMemObject(hbuf);
  clReleaseMemObject(tbuf);
  if (dbuf) clReleaseMemObject(dbuf);
  ocl_free(&o);
  return rc == 0 ? 0 : 1;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: scdo-ethash-gpu self-test | solve <epoch> <header> <target> <deadlineUnixMs>\n");
    return 2;
  }
  if (strcmp(argv[1], "self-test") == 0) return self_test();
  if (strcmp(argv[1], "solve") == 0) return solve(argc, argv);
  fprintf(stderr, "usage: scdo-ethash-gpu self-test | solve <epoch> <header> <target> <deadlineUnixMs>\n");
  return 2;
}
