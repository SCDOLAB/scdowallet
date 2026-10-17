// scdo-clminer: Ethash (SCDO Shard0) OpenCL miner for the Apple graphics chip, with a built-in ethproxy pool client.
// Copyright (C) 2026 SCDO Wallet. GPL-3.0-or-later (see LICENSE). The OpenCL kernel ethash.cl is from ethminer 0.19
// (Gateless Gate Sharp, GPL-3). CPU verification uses chfast/ethash 0.4.3 (Apache-2.0).
//
// Command line is compatible with the subset of rigel that SCDO Wallet uses:
//   scdo-clminer -a ethash -o ethproxy+tcp://HOST:PORT -u 0xADDRESS -w WORKER --api-bind 127.0.0.1:PORT
//                [--no-tui] [--no-colour] [--log-file FILE]
//   scdo-clminer --probe            JSON with the OpenCL graphics devices
//   scdo-clminer --bench [EPOCH] [SECONDS]
// The API (any GET on --api-bind) answers rigel-shaped JSON:
//   {"hashrate":{"ethash":H/s},"solution_stat":{"ethash":{"accepted":a,"rejected":r,"invalid":i}},"devices":[...],
//    "thermal":"nominal|fair|serious|critical","paused":bool,"pool":{"connected":bool,"url":"..."}}
// Thermal guard: mining pauses while macOS reports thermal state serious or critical, and resumes at fair or nominal.
#include <OpenCL/opencl.h>
#import <Foundation/Foundation.h>
#include <ethash/ethash.hpp>
#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <signal.h>
#include <sys/socket.h>
#include <unistd.h>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include "kernel.h"   // const char* ETHASH_CL (generated from ethash.cl)

#define VERSION "1.0.0"
static const unsigned WS = 128, MAXOUT = 4;
struct SearchResults { struct { uint32_t gid, mix[8], pad[7]; } rslt[MAXOUT]; uint32_t count, hashCount, abort; };

static std::atomic<bool> g_stop{false};
static FILE* g_log = nullptr;
static std::mutex g_logmu;
static void logf(const char* fmt, ...) {
  char buf[1024]; va_list ap; va_start(ap, fmt); vsnprintf(buf, sizeof buf, fmt, ap); va_end(ap);
  std::lock_guard<std::mutex> l(g_logmu);
  time_t t = time(nullptr); char ts[32]; strftime(ts, sizeof ts, "%Y-%m-%d %H:%M:%S", localtime(&t));
  printf("%s %s\n", ts, buf); fflush(stdout);
  if (g_log) { fprintf(g_log, "%s %s\n", ts, buf); fflush(g_log); }
}
static std::string hex(const uint8_t* p, size_t n) { static const char* h = "0123456789abcdef"; std::string s; for (size_t i = 0; i < n; i++) { s += h[p[i] >> 4]; s += h[p[i] & 15]; } return s; }
static bool unhex(std::string s, uint8_t* p, size_t n) {
  if (s.rfind("0x", 0) == 0 || s.rfind("0X", 0) == 0) s = s.substr(2);
  if (s.size() > n * 2) return false; while (s.size() < n * 2) s = "0" + s;
  for (size_t i = 0; i < n; i++) { char b[3] = { s[i * 2], s[i * 2 + 1], 0 }; char* e; p[i] = (uint8_t)strtoul(b, &e, 16); if (*e) return false; }
  return true;
}

// ---------------- thermal ----------------
static const char* thermalName() {
  switch ([[NSProcessInfo processInfo] thermalState]) {
    case NSProcessInfoThermalStateNominal: return "nominal";
    case NSProcessInfoThermalStateFair: return "fair";
    case NSProcessInfoThermalStateSerious: return "serious";
    case NSProcessInfoThermalStateCritical: return "critical";
  }
  return "unknown";
}
static bool thermalHot() { auto s = [[NSProcessInfo processInfo] thermalState]; return s == NSProcessInfoThermalStateSerious || s == NSProcessInfoThermalStateCritical; }

// ---------------- OpenCL ----------------
struct Gpu {
  cl_device_id dev = nullptr; cl_context ctx = nullptr; cl_command_queue q = nullptr; cl_kernel ks = nullptr, kd = nullptr;
  cl_mem dag0 = nullptr, dag1 = nullptr, hdr = nullptr, outb = nullptr; cl_uint dagItems = 0; int epoch = -1; std::string name;
  ethash::epoch_context_ptr ectx{nullptr, nullptr};
};
static bool clOk(cl_int e, const char* what) { if (e) { logf("OpenCL error %d: %s", e, what); return false; } return true; }
static std::vector<cl_device_id> gpuDevices() {
  std::vector<cl_device_id> out; cl_uint np = 0; if (clGetPlatformIDs(0, nullptr, &np) || !np) return out;
  std::vector<cl_platform_id> ps(np); clGetPlatformIDs(np, ps.data(), nullptr);
  for (auto p : ps) { cl_uint nd = 0; if (clGetDeviceIDs(p, CL_DEVICE_TYPE_GPU, 0, nullptr, &nd) || !nd) continue; std::vector<cl_device_id> ds(nd); clGetDeviceIDs(p, CL_DEVICE_TYPE_GPU, nd, ds.data(), nullptr); out.insert(out.end(), ds.begin(), ds.end()); }
  return out;
}
static std::string jsonEsc(const std::string& s) { std::string o; for (char c : s) { if (c == '"' || c == '\\') { o += '\\'; o += c; } else if ((unsigned char)c >= 0x20) o += c; } return o; }
static int probe() {
  auto ds = gpuDevices(); std::string j = "{\"version\":\"" VERSION "\",\"devices\":[";
  for (size_t i = 0; i < ds.size(); i++) {
    char nm[256] = {0}; cl_ulong g = 0, m = 0; cl_uint cu = 0;
    clGetDeviceInfo(ds[i], CL_DEVICE_NAME, sizeof nm, nm, nullptr); clGetDeviceInfo(ds[i], CL_DEVICE_GLOBAL_MEM_SIZE, 8, &g, nullptr);
    clGetDeviceInfo(ds[i], CL_DEVICE_MAX_MEM_ALLOC_SIZE, 8, &m, nullptr); clGetDeviceInfo(ds[i], CL_DEVICE_MAX_COMPUTE_UNITS, 4, &cu, nullptr);
    char b[512]; snprintf(b, sizeof b, "%s{\"name\":\"%s\",\"globalMB\":%llu,\"maxAllocMB\":%llu,\"computeUnits\":%u}", i ? "," : "", jsonEsc(nm).c_str(), (unsigned long long)(g >> 20), (unsigned long long)(m >> 20), cu); j += b;
  }
  j += "]}"; printf("%s\n", j.c_str()); return ds.empty() ? 1 : 0;
}
static bool gpuInit(Gpu& G) {
  auto ds = gpuDevices(); if (ds.empty()) { logf("no OpenCL graphics device found"); return false; }
  G.dev = ds[0]; char nm[256] = {0}; clGetDeviceInfo(G.dev, CL_DEVICE_NAME, sizeof nm, nm, nullptr); G.name = nm;
  cl_int e; G.ctx = clCreateContext(nullptr, 1, &G.dev, nullptr, nullptr, &e); if (!clOk(e, "context")) return false;
  G.q = clCreateCommandQueue(G.ctx, G.dev, 0, &e); if (!clOk(e, "queue")) return false;
  std::string src = std::string("#define WORKSIZE 128\n#define ACCESSES 64\n#define MAX_OUTPUTS 4\n#define PLATFORM 0\n#define COMPUTE 0\n") + ETHASH_CL;
  const char* s = src.c_str(); cl_program pr = clCreateProgramWithSource(G.ctx, 1, &s, nullptr, &e); if (!clOk(e, "program")) return false;
  if (clBuildProgram(pr, 1, &G.dev, "", nullptr, nullptr)) { char lg[8192] = {0}; clGetProgramBuildInfo(pr, G.dev, CL_PROGRAM_BUILD_LOG, sizeof lg, lg, nullptr); logf("kernel build failed: %s", lg); return false; }
  G.ks = clCreateKernel(pr, "search", &e); if (!clOk(e, "search kernel")) return false;
  G.kd = clCreateKernel(pr, "GenerateDAG", &e); if (!clOk(e, "dag kernel")) return false;
  G.hdr = clCreateBuffer(G.ctx, CL_MEM_READ_ONLY, 32, nullptr, &e); if (!clOk(e, "header buffer")) return false;
  G.outb = clCreateBuffer(G.ctx, CL_MEM_READ_WRITE, sizeof(SearchResults), nullptr, &e); if (!clOk(e, "result buffer")) return false;
  logf("graphics device: %s (OpenCL)", G.name.c_str());
  return true;
}
static bool gpuEpoch(Gpu& G, int ep) {
  if (ep == G.epoch) return true;
  auto t0 = std::chrono::steady_clock::now(); cl_int e;
  G.ectx = ethash::create_epoch_context(ep); if (!G.ectx) { logf("epoch %d: cannot create light cache", ep); return false; }
  size_t light = ethash::get_light_cache_size(G.ectx->light_cache_num_items);
  uint64_t dsz = ethash::get_full_dataset_size(G.ectx->full_dataset_num_items); G.dagItems = G.ectx->full_dataset_num_items;
  if (G.dag0) { clReleaseMemObject(G.dag0); clReleaseMemObject(G.dag1); G.dag0 = G.dag1 = nullptr; }
  G.dag0 = clCreateBuffer(G.ctx, CL_MEM_READ_WRITE, dsz / 2 + 64, nullptr, &e); if (!clOk(e, "DAG buffer 0")) return false;
  G.dag1 = clCreateBuffer(G.ctx, CL_MEM_READ_WRITE, dsz / 2 - 64, nullptr, &e); if (!clOk(e, "DAG buffer 1")) return false;
  cl_mem lb = clCreateBuffer(G.ctx, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR, light, (void*)G.ectx->light_cache, &e); if (!clOk(e, "light buffer")) return false;
  cl_uint ln = G.ectx->light_cache_num_items;
  clSetKernelArg(G.kd, 1, sizeof lb, &lb); clSetKernelArg(G.kd, 2, sizeof G.dag0, &G.dag0); clSetKernelArg(G.kd, 3, sizeof G.dag1, &G.dag1); clSetKernelArg(G.kd, 4, 4, &ln);
  cl_uint work = G.dagItems * 2, chunk = 10000 * WS; size_t lw = WS;
  for (cl_uint st = 0; st < work && !g_stop; st += chunk) {
    size_t gsz = std::min(chunk, work - st); gsz = (gsz + WS - 1) / WS * WS;
    clSetKernelArg(G.kd, 0, 4, &st); if (!clOk(clEnqueueNDRangeKernel(G.q, G.kd, 1, nullptr, &gsz, &lw, 0, nullptr, nullptr), "DAG kernel")) { clReleaseMemObject(lb); return false; }
    clFinish(G.q);
  }
  clReleaseMemObject(lb); G.epoch = ep;
  clSetKernelArg(G.ks, 0, sizeof G.outb, &G.outb); clSetKernelArg(G.ks, 1, sizeof G.hdr, &G.hdr); clSetKernelArg(G.ks, 2, sizeof G.dag0, &G.dag0); clSetKernelArg(G.ks, 3, sizeof G.dag1, &G.dag1); clSetKernelArg(G.ks, 4, 4, &G.dagItems);
  logf("epoch %d: DAG %.0f MB generated in %.1f s", ep, dsz / 1048576.0, std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count());
  return true;
}
static int gpuBatch(Gpu& G, const uint8_t h[32], uint64_t start, uint64_t target, size_t gsz, uint64_t* nonces) {
  SearchResults z; memset(&z, 0, sizeof z);
  clEnqueueWriteBuffer(G.q, G.hdr, CL_FALSE, 0, 32, h, 0, nullptr, nullptr); clEnqueueWriteBuffer(G.q, G.outb, CL_FALSE, 0, sizeof z, &z, 0, nullptr, nullptr);
  clSetKernelArg(G.ks, 5, 8, &start); clSetKernelArg(G.ks, 6, 8, &target); size_t lw = WS;
  if (clEnqueueNDRangeKernel(G.q, G.ks, 1, nullptr, &gsz, &lw, 0, nullptr, nullptr)) return -1;
  SearchResults r; if (clEnqueueReadBuffer(G.q, G.outb, CL_TRUE, 0, sizeof r, &r, 0, nullptr, nullptr)) return -1;
  int n = std::min(r.count, MAXOUT); for (int i = 0; i < n; i++) nonces[i] = start + r.rslt[i].gid; return n;
}

// ---------------- shared state ----------------
struct Job { std::string header, seed, boundary; uint8_t h[32]; uint8_t b[32]; int epoch = -1; uint64_t target = 0; int gen = 0; };
static std::mutex g_jobmu; static Job g_job; static std::atomic<int> g_jobGen{0};
static std::atomic<uint64_t> g_accepted{0}, g_rejected{0}, g_invalid{0};
static std::atomic<double> g_rate{0};
static std::atomic<bool> g_connected{false}, g_paused{false};
static std::string g_poolUrl, g_wallet, g_worker = "mac";

// ---------------- pool (ethproxy) ----------------
struct Pool {
  std::string host; int port = 0; int fd = -1; std::mutex wmu; int nextId = 100; std::mutex pmu; std::vector<int> pending;
  bool send(const std::string& line) { std::lock_guard<std::mutex> l(wmu); if (fd < 0) return false; std::string s = line + "\n"; return ::send(fd, s.data(), s.size(), 0) == (ssize_t)s.size(); }
};
static Pool g_pool;
// minimal JSON helpers for the few ethproxy replies we need
static bool jsonId(const std::string& s, long* id) { auto p = s.find("\"id\""); if (p == std::string::npos) return false; p = s.find(':', p); if (p == std::string::npos) return false; while (++p < s.size() && s[p] == ' '); if (s.compare(p, 4, "null") == 0) { *id = 0; return true; } *id = strtol(s.c_str() + p, nullptr, 10); return true; }
static bool jsonResultArray(const std::string& s, std::vector<std::string>& out) {
  auto p = s.find("\"result\""); if (p == std::string::npos) return false; p = s.find(':', p); if (p == std::string::npos) return false;
  while (++p < s.size() && s[p] == ' '); if (p >= s.size() || s[p] != '[') return false;
  auto e = s.find(']', p); if (e == std::string::npos) return false; std::string a = s.substr(p + 1, e - p - 1);
  size_t q = 0; while ((q = a.find('"', q)) != std::string::npos) { auto r = a.find('"', q + 1); if (r == std::string::npos) break; out.push_back(a.substr(q + 1, r - q - 1)); q = r + 1; }
  return out.size() >= 3;
}
static bool jsonResultTrue(const std::string& s) { auto p = s.find("\"result\""); if (p == std::string::npos) return false; p = s.find(':', p); while (++p < s.size() && s[p] == ' '); return s.compare(p, 4, "true") == 0; }
static void setJob(const std::vector<std::string>& r) {
  Job j; j.header = r[0]; j.seed = r[1]; j.boundary = r[2];
  uint8_t sd[32]; if (!unhex(j.header, j.h, 32) || !unhex(j.seed, sd, 32) || !unhex(j.boundary, j.b, 32)) { logf("pool sent a malformed job"); return; }
  ethash::hash256 s; memcpy(s.bytes, sd, 32); j.epoch = ethash::find_epoch_number(s); if (j.epoch < 0) { logf("pool job has an unknown seed"); return; }
  j.target = 0; for (int i = 0; i < 8; i++) j.target = (j.target << 8) | j.b[i];
  std::lock_guard<std::mutex> l(g_jobmu); if (g_job.header == j.header) return; j.gen = ++g_jobGen; g_job = j;
}
static void poolThread() {
  int backoff = 2;
  while (!g_stop) {
    struct addrinfo hints = {}, *res = nullptr; hints.ai_socktype = SOCK_STREAM; char ps[16]; snprintf(ps, sizeof ps, "%d", g_pool.port);
    int fd = -1;
    if (getaddrinfo(g_pool.host.c_str(), ps, &hints, &res) == 0) {
      for (auto a = res; a; a = a->ai_next) { fd = socket(a->ai_family, a->ai_socktype, a->ai_protocol); if (fd < 0) continue; struct timeval tv = {10, 0}; setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv); if (connect(fd, a->ai_addr, a->ai_addrlen) == 0) break; close(fd); fd = -1; }
      freeaddrinfo(res);
    }
    if (fd < 0) { logf("pool %s:%d unreachable, retrying in %d s", g_pool.host.c_str(), g_pool.port, backoff); for (int i = 0; i < backoff * 10 && !g_stop; i++) usleep(100000); backoff = std::min(backoff * 2, 60); continue; }
    int one = 1; setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one); struct timeval rtv = {1, 0}; setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &rtv, sizeof rtv);
    { std::lock_guard<std::mutex> l(g_pool.wmu); g_pool.fd = fd; }
    g_pool.send("{\"id\":1,\"jsonrpc\":\"2.0\",\"method\":\"eth_submitLogin\",\"params\":[\"" + g_wallet + "\"],\"worker\":\"" + g_worker + "\"}");
    g_pool.send("{\"id\":2,\"jsonrpc\":\"2.0\",\"method\":\"eth_getWork\",\"params\":[]}");
    std::string buf; auto lastGet = std::chrono::steady_clock::now(), lastRx = lastGet, lastHr = lastGet; bool loggedIn = false;
    while (!g_stop) {
      char tmp[4096]; ssize_t n = recv(fd, tmp, sizeof tmp, 0); auto now = std::chrono::steady_clock::now();
      if (n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK)) { logf("pool connection closed"); break; }
      if (n > 0) { lastRx = now; buf.append(tmp, n); size_t p;
        while ((p = buf.find('\n')) != std::string::npos) { std::string line = buf.substr(0, p); buf.erase(0, p + 1); long id = -1; jsonId(line, &id);
          std::vector<std::string> r;
          if (id == 1) { loggedIn = jsonResultTrue(line); logf(loggedIn ? "pool login OK (%s)" : "pool login refused (%s)", g_poolUrl.c_str()); if (loggedIn) { g_connected = true; backoff = 2; } }
          else if (id >= 100) { bool ok = jsonResultTrue(line); if (ok) { g_accepted++; logf("share accepted (%llu ok / %llu rejected)", (unsigned long long)g_accepted, (unsigned long long)g_rejected); } else { g_rejected++; logf("share rejected: %s", line.substr(0, 160).c_str()); } }
          else if (jsonResultArray(line, r)) setJob(r);
        } }
      if (now - lastGet > std::chrono::seconds(5)) { lastGet = now; g_pool.send("{\"id\":3,\"jsonrpc\":\"2.0\",\"method\":\"eth_getWork\",\"params\":[]}"); }
      if (now - lastHr > std::chrono::seconds(30)) { lastHr = now; char b[200]; snprintf(b, sizeof b, "{\"id\":4,\"jsonrpc\":\"2.0\",\"method\":\"eth_submitHashrate\",\"params\":[\"0x%llx\",\"0x%064x\"],\"worker\":\"%s\"}", (unsigned long long)g_rate.load(), 1, g_worker.c_str()); g_pool.send(b); }
      if (now - lastRx > std::chrono::seconds(90)) { logf("pool silent for 90 s, reconnecting"); break; }
    }
    { std::lock_guard<std::mutex> l(g_pool.wmu); close(g_pool.fd); g_pool.fd = -1; }
    g_connected = false; { std::lock_guard<std::mutex> l(g_jobmu); g_job = Job(); }
    for (int i = 0; i < 30 && !g_stop; i++) usleep(100000);
  }
}
static void submit(uint64_t nonce, const std::string& header, const std::string& mix) {
  int id; { std::lock_guard<std::mutex> l(g_pool.pmu); id = ++g_pool.nextId; }
  char b[400]; snprintf(b, sizeof b, "{\"id\":%d,\"jsonrpc\":\"2.0\",\"method\":\"eth_submitWork\",\"params\":[\"0x%016llx\",\"%s\",\"0x%s\"],\"worker\":\"%s\"}", id, (unsigned long long)nonce, header.c_str(), mix.c_str(), g_worker.c_str());
  if (!g_pool.send(b)) logf("share could not be sent (pool offline)");
}

// ---------------- API ----------------
static void apiThread(std::string bindHost, int port) {
  int s = socket(AF_INET, SOCK_STREAM, 0); int one = 1; setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  sockaddr_in a = {}; a.sin_family = AF_INET; a.sin_port = htons(port); inet_pton(AF_INET, bindHost.c_str(), &a.sin_addr);
  if (bind(s, (sockaddr*)&a, sizeof a) || listen(s, 8)) { logf("API: cannot bind %s:%d", bindHost.c_str(), port); return; }
  logf("API listening on %s:%d", bindHost.c_str(), port);
  while (!g_stop) {
    fd_set fs; FD_ZERO(&fs); FD_SET(s, &fs); struct timeval tv = {0, 500000}; if (select(s + 1, &fs, nullptr, nullptr, &tv) <= 0) continue;
    int c = accept(s, nullptr, nullptr); if (c < 0) continue; struct timeval rtv = {2, 0}; setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, &rtv, sizeof rtv);
    char req[2048]; recv(c, req, sizeof req, 0);
    char body[1024]; double hr = g_rate.load();
    snprintf(body, sizeof body, "{\"miner\":\"scdo-clminer\",\"version\":\"" VERSION "\",\"algorithm\":\"ethash\",\"hashrate\":{\"ethash\":%.0f},\"solution_stat\":{\"ethash\":{\"accepted\":%llu,\"rejected\":%llu,\"invalid\":%llu}},\"devices\":[{\"id\":0,\"hashrate\":{\"ethash\":%.0f}}],\"thermal\":\"%s\",\"paused\":%s,\"pool\":{\"connected\":%s,\"url\":\"%s\"}}",
      hr, (unsigned long long)g_accepted, (unsigned long long)g_rejected, (unsigned long long)g_invalid, hr, thermalName(), g_paused ? "true" : "false", g_connected ? "true" : "false", jsonEsc(g_poolUrl).c_str());
    char resp[1400]; int n = snprintf(resp, sizeof resp, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %zu\r\nConnection: close\r\n\r\n%s", strlen(body), body);
    send(c, resp, n, 0); close(c);
  }
  close(s);
}

// ---------------- main loops ----------------
static int bench(int ep, double secs) {
  Gpu G; if (!gpuInit(G) || !gpuEpoch(G, ep)) return 2;
  uint8_t h[32]; arc4random_buf(h, 32); size_t gsz = 1 << 22; uint64_t ns[4], s = 0, done = 0;
  gpuBatch(G, h, s, 0, gsz, ns); s += gsz; auto t0 = std::chrono::steady_clock::now();
  while (!g_stop && std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count() < secs) { if (gpuBatch(G, h, s, 0, gsz, ns) < 0) return 3; s += gsz; done += gsz; }
  double dt = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  printf("bench epoch %d: %.2f MH/s over %.1f s on %s\n", ep, done / dt / 1e6, dt, G.name.c_str()); return 0;
}
static int mine() {
  Gpu G; if (!gpuInit(G)) return 2;
  std::thread(poolThread).detach();
  size_t gsz = 1 << 20; uint64_t nonce = ((uint64_t)arc4random() << 32) | arc4random(); int seen = -1; Job j;
  uint64_t count = 0; auto t0 = std::chrono::steady_clock::now(); double ema = 0; bool wasHot = false;
  while (!g_stop) {
    if (thermalHot()) { if (!wasHot) { wasHot = true; g_paused = true; g_rate = 0; logf("thermal state %s: paused to let the Mac cool down", thermalName()); } usleep(1000000); continue; }
    if (wasHot) { wasHot = false; g_paused = false; logf("thermal state %s: resumed", thermalName()); t0 = std::chrono::steady_clock::now(); count = 0; }
    if (g_jobGen.load() != seen) { std::lock_guard<std::mutex> l(g_jobmu); j = g_job; seen = g_jobGen.load(); }
    if (j.epoch < 0) { g_rate = 0; usleep(200000); continue; }
    if (!gpuEpoch(G, j.epoch)) { logf("cannot prepare epoch %d, retrying", j.epoch); sleep(5); continue; }
    auto b0 = std::chrono::steady_clock::now(); uint64_t ns[4]; int n = gpuBatch(G, j.h, nonce, j.target, gsz, ns);
    if (n < 0) { logf("graphics device error, retrying"); sleep(2); continue; }
    double bt = std::chrono::duration<double>(std::chrono::steady_clock::now() - b0).count();
    if (bt < 0.15 && gsz < (1u << 24)) gsz <<= 1; else if (bt > 0.6 && gsz > (1u << 18)) gsz >>= 1;
    nonce += gsz; count += gsz;
    for (int i = 0; i < n; i++) {
      ethash::hash256 hh; memcpy(hh.bytes, j.h, 32); auto res = ethash::hash(*G.ectx, hh, ns[i]);
      if (memcmp(res.final_hash.bytes, j.b, 32) <= 0) submit(ns[i], j.header, hex(res.mix_hash.bytes, 32));
      else { g_invalid++; logf("graphics result failed the CPU check (nonce %016llx), not sent", (unsigned long long)ns[i]); }
    }
    double dt = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    if (dt >= 2) { double r = count / dt; ema = ema ? ema * 0.7 + r * 0.3 : r; g_rate = ema; count = 0; t0 = std::chrono::steady_clock::now(); }
    static auto lastLog = std::chrono::steady_clock::now(); if (std::chrono::steady_clock::now() - lastLog > std::chrono::seconds(60)) { lastLog = std::chrono::steady_clock::now(); logf("hashrate %.2f MH/s, shares %llu ok / %llu rejected, thermal %s", g_rate.load() / 1e6, (unsigned long long)g_accepted, (unsigned long long)g_rejected, thermalName()); }
  }
  logf("stopped"); return 0;
}
static void onSig(int) { g_stop = true; }
int main(int argc, char** argv) {
  signal(SIGINT, onSig); signal(SIGTERM, onSig); signal(SIGPIPE, SIG_IGN);
  std::string api, logFile, algo = "ethash";
  for (int i = 1; i < argc; i++) {
    std::string a = argv[i]; auto next = [&]() -> std::string { return i + 1 < argc ? argv[++i] : ""; };
    if (a == "--probe") return probe();
    if (a == "--version") { printf("scdo-clminer " VERSION "\n"); return 0; }
    if (a == "--help" || a == "-h") { printf("scdo-clminer " VERSION " (GPL-3.0)\n  -a ethash -o ethproxy+tcp://HOST:PORT -u 0xADDRESS -w WORKER --api-bind 127.0.0.1:PORT [--log-file FILE]\n  --probe | --bench [EPOCH] [SECONDS] | --version\n"); return 0; }
    if (a == "--bench") { int ep = i + 1 < argc ? atoi(argv[++i]) : 4; double s = i + 1 < argc ? atof(argv[++i]) : 30; return bench(ep, s); }
    if (a == "-a") algo = next(); else if (a == "-o") g_poolUrl = next(); else if (a == "-u") g_wallet = next(); else if (a == "-w") g_worker = next();
    else if (a == "--api-bind") api = next(); else if (a == "--log-file") logFile = next(); else if (a == "--no-tui" || a == "--no-colour") {}
    else if (a == "-d" || a == "--devices") next();
    else { fprintf(stderr, "unknown argument %s\n", a.c_str()); return 1; }
  }
  if (algo != "ethash") { fprintf(stderr, "only -a ethash is supported\n"); return 1; }
  if (!logFile.empty()) g_log = fopen(logFile.c_str(), "a");
  auto pp = g_poolUrl.find("://"); std::string hp = pp == std::string::npos ? g_poolUrl : g_poolUrl.substr(pp + 3); auto c = hp.rfind(':');
  if (g_poolUrl.rfind("ethproxy+tcp://", 0) != 0 && g_poolUrl.rfind("stratum+tcp://", 0) != 0) { fprintf(stderr, "pool must be ethproxy+tcp://HOST:PORT\n"); return 1; }
  if (c == std::string::npos) { fprintf(stderr, "pool must be ethproxy+tcp://HOST:PORT\n"); return 1; }
  g_pool.host = hp.substr(0, c); g_pool.port = atoi(hp.c_str() + c + 1);
  if (g_wallet.size() != 42 || g_wallet.rfind("0x", 0) != 0) { fprintf(stderr, "-u must be a 0x address\n"); return 1; }
  if (!api.empty()) { auto k = api.rfind(':'); std::thread(apiThread, api.substr(0, k), atoi(api.c_str() + k + 1)).detach(); }
  logf("scdo-clminer " VERSION " starting: pool %s, worker %s", g_poolUrl.c_str(), g_worker.c_str());
  @autoreleasepool { return mine(); }
}
