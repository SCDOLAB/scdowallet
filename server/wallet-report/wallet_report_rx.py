#!/usr/bin/env python3
"""SCDO Wallet error-report receiver (HK edge). 127.0.0.1:8811 behind nginx /api/wallet-report.
Stores gzip JSON reports under /var/lib/scdo-wallet-reports/YYYY-MM-DD/<id>.json.gz (0600). No keys, never serves reports."""
import gzip, json, os, re, secrets, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ROOT = os.environ.get('REPORT_DIR', '/var/lib/scdo-wallet-reports')
MAX_BODY = 2 * 1024 * 1024          # compressed
MAX_RAW = 8 * 1024 * 1024           # decompressed
PER_IP_HOUR = 30
_hits, _lock = {}, threading.Lock()
HEX64 = re.compile(r'(?<![0-9a-fA-F])(0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])')
BEARER = re.compile(r'(?i)bearer\s+[A-Za-z0-9._~+/=-]{8,}')
def scrub(s):  # server-side second pass, in case an old/buggy client skipped redaction
    return BEARER.sub('Bearer [REDACTED]', HEX64.sub('[REDACTED_HEX64]', s))
def limited(ip):
    now = time.time()
    with _lock:
        q = [t for t in _hits.get(ip, []) if now - t < 3600]
        if len(q) >= PER_IP_HOUR: _hits[ip] = q; return True
        q.append(now); _hits[ip] = q; return False
class H(BaseHTTPRequestHandler):
    server_version = 'scdo-wallet-report/1'
    def log_message(self, *a): pass
    def out(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        self.out(200, {'ok': True, 'service': 'wallet-report', 'serverTime': int(time.time() * 1000)})
    def do_POST(self):
        ip = self.headers.get('X-Real-IP') or self.client_address[0]
        try: n = int(self.headers.get('Content-Length') or '0')
        except ValueError: n = -1
        if n <= 0: return self.out(411, {'ok': False, 'error': 'length'})
        if n > MAX_BODY: return self.out(413, {'ok': False, 'error': 'too_large'})
        if limited(ip): return self.out(429, {'ok': False, 'error': 'rate_limited'})
        raw = self.rfile.read(n)
        try:
            if (self.headers.get('Content-Encoding') or '').lower() == 'gzip' or raw[:2] == b'\x1f\x8b':
                with gzip.GzipFile(fileobj=__import__('io').BytesIO(raw)) as g: raw = g.read(MAX_RAW + 1)
            if len(raw) > MAX_RAW: return self.out(413, {'ok': False, 'error': 'too_large'})
            doc = json.loads(scrub(raw.decode('utf-8', 'replace')))
            if not isinstance(doc, dict) or not doc.get('code') and not doc.get('message'): raise ValueError('shape')
        except Exception:
            return self.out(400, {'ok': False, 'error': 'bad_report'})
        rid = time.strftime('%Y%m%d', time.gmtime()) + '-' + secrets.token_hex(5)
        doc['_server'] = {'id': rid, 'receivedAt': int(time.time() * 1000), 'ipPrefix': '.'.join(ip.split('.')[:3]) + '.x' if '.' in ip else ip[:12]}
        d = os.path.join(ROOT, rid[:8]); os.makedirs(d, mode=0o700, exist_ok=True)
        p = os.path.join(d, rid + '.json.gz')
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as f: f.write(gzip.compress(json.dumps(doc).encode()))
        self.out(200, {'ok': True, 'id': rid, 'serverTime': doc['_server']['receivedAt']})
if __name__ == '__main__':
    os.makedirs(ROOT, mode=0o700, exist_ok=True); os.chmod(ROOT, 0o700)
    ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('PORT', '8811'))), H).serve_forever()
