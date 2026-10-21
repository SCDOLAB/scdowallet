/* Ethash dataset item and hashimoto for a NVIDIA OpenCL device.
   The search runs on the device. The host does not search. */
#pragma OPENCL EXTENSION cl_khr_global_int32_base_atomics : enable
#pragma OPENCL EXTENSION cl_khr_byte_addressable_store : enable

uint fnv1(uint a, uint b) { return a * 0x01000193u ^ b; }

ulong rotl64(ulong x, uint n) {
  return (n == 0u) ? x : ((x << n) | (x >> (64u - n)));
}

void keccakf(ulong st[25]) {
  const ulong rc[24] = {
    0x0000000000000001UL, 0x0000000000008082UL, 0x800000000000808aUL,
    0x8000000080008000UL, 0x000000000000808bUL, 0x0000000080000001UL,
    0x8000000080008081UL, 0x8000000000008009UL, 0x000000000000008aUL,
    0x0000000000000088UL, 0x0000000080008009UL, 0x000000008000000aUL,
    0x000000008000808bUL, 0x800000000000008bUL, 0x8000000000008089UL,
    0x8000000000008003UL, 0x8000000000008002UL, 0x8000000000000080UL,
    0x000000000000800aUL, 0x800000008000000aUL, 0x8000000080008081UL,
    0x8000000000008080UL, 0x0000000080000001UL, 0x8000000080008008UL
  };
  const uchar piln[24] = {10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1};
  const uchar rotc[24] = {1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44};
  for (int round = 0; round < 24; round++) {
    ulong bc[5];
    for (int i = 0; i < 5; i++)
      bc[i] = st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20];
    for (int i = 0; i < 5; i++) {
      ulong t = bc[(i + 4) % 5] ^ rotl64(bc[(i + 1) % 5], 1u);
      for (int j = 0; j < 25; j += 5)
        st[j + i] ^= t;
    }
    ulong t = st[1];
    for (int i = 0; i < 24; i++) {
      ulong nxt = st[piln[i]];
      st[piln[i]] = rotl64(t, rotc[i]);
      t = nxt;
    }
    for (int j = 0; j < 25; j += 5) {
      ulong t0 = st[j], t1 = st[j + 1], t2 = st[j + 2], t3 = st[j + 3], t4 = st[j + 4];
      st[j] = t0 ^ ((~t1) & t2);
      st[j + 1] = t1 ^ ((~t2) & t3);
      st[j + 2] = t2 ^ ((~t3) & t4);
      st[j + 3] = t3 ^ ((~t4) & t0);
      st[j + 4] = t4 ^ ((~t0) & t1);
    }
    st[0] ^= rc[round];
  }
}

void keccak512_bytes(uchar dst[64], const uchar *src, uint len) {
  ulong st[25];
  uchar temp[72];
  for (int i = 0; i < 25; i++) st[i] = 0;
  for (int i = 0; i < 72; i++) temp[i] = 0;
  for (uint i = 0; i < len; i++) temp[i] = src[i];
  temp[len] = 0x01;
  temp[71] |= 0x80;
  for (int i = 0; i < 9; i++) {
    ulong v = 0;
    for (int b = 0; b < 8; b++) v |= ((ulong)temp[i * 8 + b]) << (8 * b);
    st[i] ^= v;
  }
  keccakf(st);
  for (int i = 0; i < 8; i++) {
    ulong v = st[i];
    for (int b = 0; b < 8; b++) dst[i * 8 + b] = (uchar)((v >> (8 * b)) & 0xff);
  }
}

void keccak256_bytes(uchar dst[32], const uchar *src, uint len) {
  ulong st[25];
  uchar temp[136];
  for (int i = 0; i < 25; i++) st[i] = 0;
  for (int i = 0; i < 136; i++) temp[i] = 0;
  for (uint i = 0; i < len; i++) temp[i] = src[i];
  temp[len] = 0x01;
  temp[135] |= 0x80;
  for (int i = 0; i < 17; i++) {
    ulong v = 0;
    for (int b = 0; b < 8; b++) v |= ((ulong)temp[i * 8 + b]) << (8 * b);
    st[i] ^= v;
  }
  keccakf(st);
  for (int i = 0; i < 4; i++) {
    ulong v = st[i];
    for (int b = 0; b < 8; b++) dst[i * 8 + b] = (uchar)((v >> (8 * b)) & 0xff);
  }
}

uint load32(const uchar *p) {
  return (uint)p[0] | ((uint)p[1] << 8) | ((uint)p[2] << 16) | ((uint)p[3] << 24);
}

void store32(uchar *p, uint v) {
  p[0] = (uchar)v;
  p[1] = (uchar)(v >> 8);
  p[2] = (uchar)(v >> 16);
  p[3] = (uchar)(v >> 24);
}

void dataset_item(__global const uint *cache, uint rows, uint index, uchar out[64]) {
  uchar mix[64];
  uint base = (index % rows) * 16u;
  store32(mix, cache[base] ^ index);
  for (uint i = 1; i < 16u; i++) store32(mix + i * 4u, cache[base + i]);
  keccak512_bytes(mix, mix, 64);
  uint words[16];
  for (int i = 0; i < 16; i++) words[i] = load32(mix + i * 4);
  for (uint j = 0; j < 256u; j++) {
    uint parent = fnv1(index ^ j, words[j % 16u]) % rows;
    uint off = parent * 16u;
    for (int i = 0; i < 16; i++) words[i] = fnv1(words[i], cache[off + (uint)i]);
  }
  for (int i = 0; i < 16; i++) store32(mix + i * 4, words[i]);
  keccak512_bytes(out, mix, 64);
}

int leq_be(const uchar result[32], __global const uchar *target) {
  for (int i = 0; i < 32; i++) {
    if (result[i] < target[i]) return 1;
    if (result[i] > target[i]) return 0;
  }
  return 1;
}

void hashimoto_from_lookup(__global const uchar *header, ulong nonce, uint dag_rows,
                            __global const uint *cache, uint cache_rows, __global const uint *dataset,
                            int use_dag, uchar mix_out[32], uchar result[32]) {
  uchar seed_in[40];
  uchar seed[64];
  for (int i = 0; i < 32; i++) seed_in[i] = header[i];
  for (int b = 0; b < 8; b++) seed_in[32 + b] = (uchar)((nonce >> (8 * b)) & 0xff);
  keccak512_bytes(seed, seed_in, 40);
  uint seed_head = load32(seed);
  uint mix[32];
  for (int i = 0; i < 32; i++) mix[i] = load32(seed + (i % 16) * 4);
  for (uint i = 0; i < 64u; i++) {
    uint parent = fnv1(i ^ seed_head, mix[i % 32u]) % dag_rows;
    uint temp[32];
    for (uint j = 0; j < 2u; j++) {
      uint idx = 2u * parent + j;
      if (use_dag) {
        uint off = idx * 16u;
        for (int k = 0; k < 16; k++) temp[j * 16u + (uint)k] = dataset[off + (uint)k];
      } else {
        uchar item[64];
        dataset_item(cache, cache_rows, idx, item);
        for (int k = 0; k < 16; k++) temp[j * 16u + (uint)k] = load32(item + k * 4);
      }
    }
    for (int k = 0; k < 32; k++) mix[k] = fnv1(mix[k], temp[k]);
  }
  uchar digest[32];
  for (int i = 0; i < 8; i++) {
    uint c = fnv1(fnv1(fnv1(mix[i * 4], mix[i * 4 + 1]), mix[i * 4 + 2]), mix[i * 4 + 3]);
    store32(digest + i * 4, c);
  }
  uchar buf[96];
  for (int i = 0; i < 64; i++) buf[i] = seed[i];
  for (int i = 0; i < 32; i++) buf[64 + i] = digest[i];
  keccak256_bytes(result, buf, 96);
  for (int i = 0; i < 32; i++) mix_out[i] = digest[i];
}

__kernel void dag_range(__global const uint *cache, uint rows, __global uint *dataset, uint begin, uint end) {
  uint index = begin + (uint)get_global_id(0);
  if (index >= end) return;
  uchar item[64];
  dataset_item(cache, rows, index, item);
  uint off = index * 16u;
  for (int i = 0; i < 16; i++) dataset[off + (uint)i] = load32(item + i * 4);
}

__kernel void hashimoto_one(__global const uchar *header, __global const uint *cache, uint cache_rows,
                             uint dag_rows, ulong nonce, __global uchar *mix_out, __global uchar *result) {
  uchar mix[32];
  uchar dig[32];
  hashimoto_from_lookup(header, nonce, dag_rows, cache, cache_rows, cache, 0, mix, dig);
  for (int i = 0; i < 32; i++) {
    mix_out[i] = mix[i];
    result[i] = dig[i];
  }
}

__kernel void search_light(__global const uchar *header, __global const uint *cache, uint cache_rows,
                            uint dag_rows, ulong nonce0, __global const uchar *target,
                            __global volatile uint *found, __global ulong *out_nonce, __global uchar *out_mix) {
  if (*found) return;
  ulong nonce = nonce0 + (ulong)get_global_id(0);
  uchar mix[32];
  uchar result[32];
  hashimoto_from_lookup(header, nonce, dag_rows, cache, cache_rows, cache, 0, mix, result);
  if (!leq_be(result, target)) return;
  if (atomic_cmpxchg(found, 0u, 1u) == 0u) {
    *out_nonce = nonce;
    for (int i = 0; i < 32; i++) out_mix[i] = mix[i];
  }
}

__kernel void search_dag(__global const uchar *header, __global const uint *dataset, uint dag_rows,
                          ulong nonce0, __global const uchar *target, __global volatile uint *found,
                          __global ulong *out_nonce, __global uchar *out_mix) {
  if (*found) return;
  ulong nonce = nonce0 + (ulong)get_global_id(0);
  uchar mix[32];
  uchar result[32];
  hashimoto_from_lookup(header, nonce, dag_rows, dataset, 0, dataset, 1, mix, result);
  if (!leq_be(result, target)) return;
  if (atomic_cmpxchg(found, 0u, 1u) == 0u) {
    *out_nonce = nonce;
    for (int i = 0; i < 32; i++) out_mix[i] = mix[i];
  }
}
