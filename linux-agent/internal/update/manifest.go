// Package update verifies SCDO Linux release feeds the same way the desktop
// wallet verifies latest.json: Ed25519 over canonical JSON, then sha256.
package update

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

// PubKeyB64 is the desktop updater public key (src/updater.js PUBKEY_B64).
const PubKeyB64 = "4qt9g0KOI32agOxfEU+/W28zA8iRjt8pYSkcj/VTW5k="

const maxBytes int64 = 64 << 20

var (
	verRe = regexp.MustCompile(`^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$`)
	// ErrArch means the signed feed is for a different CPU.
	ErrArch = errors.New("feed is for a different cpu")
	// ErrSame means the feed is not newer than the running binary.
	ErrSame = errors.New("already current")
)

// Manifest is a verified Linux feed document.
type Manifest struct {
	Version string
	URL     string
	SHA256  string
	Size    int64
	Arch    string
}

// DefaultFeed is scdo.com.au, then apeccapital.org. No other host.
func DefaultFeed() []string {
	return []string{
		"https://scdo.com.au/downloads/wallet/linux/latest.json",
		"https://apeccapital.org/downloads/wallet/linux/latest.json",
	}
}

// CanonicalManifest is src/updater.js canonicalManifest: drop signature,
// sort keys recursively, compact JSON.
func CanonicalManifest(obj map[string]any) (string, error) {
	clean := cloneMap(obj)
	delete(clean, "signature")
	return ledger.Canonical(clean)
}

func cloneMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = cloneVal(v)
	}
	return out
}

func cloneVal(v any) any {
	switch t := v.(type) {
	case map[string]any:
		return cloneMap(t)
	case []any:
		cp := make([]any, len(t))
		for i, el := range t {
			cp[i] = cloneVal(el)
		}
		return cp
	default:
		return v
	}
}

var shaRe = regexp.MustCompile(`(?i)^[0-9a-f]{64}$`)

// Verify checks the Ed25519 signature first, then the flat fields.
// pubB64 empty uses the production key. The signature covers every key
// except signature, including a files map when one is present.
func Verify(raw []byte, pubB64 string) (Manifest, error) {
	return VerifyArch(raw, pubB64, "")
}

// VerifyArch checks the same signature, then selects files[arch] when that
// object has url, sha256, and size. A missing entry falls back to the flat
// fields. arch empty always uses the flat fields.
func VerifyArch(raw []byte, pubB64, arch string) (Manifest, error) {
	if strings.TrimSpace(pubB64) == "" {
		pubB64 = PubKeyB64
	}
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil || obj == nil {
		return Manifest{}, fmt.Errorf("manifest not an object")
	}
	sig, _ := obj["signature"].(string)
	if sig == "" {
		return Manifest{}, fmt.Errorf("manifest has no signature")
	}
	pub, err := base64.StdEncoding.DecodeString(pubB64)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return Manifest{}, fmt.Errorf("invalid embedded public key")
	}
	msg, err := CanonicalManifest(obj)
	if err != nil {
		return Manifest{}, err
	}
	sigBytes, err := base64.StdEncoding.DecodeString(sig)
	if err != nil || !ed25519.Verify(ed25519.PublicKey(pub), []byte(msg), sigBytes) {
		return Manifest{}, fmt.Errorf("signature mismatch")
	}
	return validate(obj, arch)
}

func validate(obj map[string]any, wantArch string) (Manifest, error) {
	version, _ := obj["version"].(string)
	if !verRe.MatchString(version) {
		return Manifest{}, fmt.Errorf("bad version")
	}
	if ch, ok := obj["changelog"]; ok && ch != nil {
		m, ok := ch.(map[string]any)
		if !ok {
			return Manifest{}, fmt.Errorf("bad changelog")
		}
		for _, v := range m {
			if _, ok := v.(string); !ok {
				return Manifest{}, fmt.Errorf("bad changelog")
			}
		}
	}
	if wantArch != "" {
		entry, ok, err := archEntry(obj, wantArch)
		if err != nil {
			return Manifest{}, err
		}
		if ok {
			bits, err := fileFields(entry)
			if err != nil {
				return Manifest{}, err
			}
			return Manifest{Version: version, URL: bits.url, SHA256: bits.sum, Size: bits.size, Arch: wantArch}, nil
		}
	}
	bits, err := fileFields(obj)
	if err != nil {
		return Manifest{}, err
	}
	arch, _ := obj["arch"].(string)
	switch arch {
	case "amd64", "arm64":
	default:
		return Manifest{}, fmt.Errorf("bad arch")
	}
	return Manifest{Version: version, URL: bits.url, SHA256: bits.sum, Size: bits.size, Arch: arch}, nil
}

type fileBits struct {
	url  string
	sum  string
	size int64
}

func fileFields(obj map[string]any) (fileBits, error) {
	rawURL, _ := obj["url"].(string)
	sum, _ := obj["sha256"].(string)
	if err := urlAllowed(rawURL); err != nil {
		return fileBits{}, err
	}
	if !strings.HasSuffix(strings.ToLower(pathOf(rawURL)), ".tar.gz") {
		return fileBits{}, fmt.Errorf("package url is not a .tar.gz")
	}
	if !shaRe.MatchString(sum) {
		return fileBits{}, fmt.Errorf("bad sha256")
	}
	size, err := asInt(obj["size"])
	if err != nil || size <= 0 || size > maxBytes {
		return fileBits{}, fmt.Errorf("bad size")
	}
	return fileBits{url: rawURL, sum: strings.ToLower(sum), size: size}, nil
}

// archEntry returns files[arch] when the signed document has that object.
// A missing files key or a missing arch key is not an error: the caller
// falls back to the flat fields. A present but unusable value is an error.
func archEntry(obj map[string]any, arch string) (map[string]any, bool, error) {
	switch arch {
	case "amd64", "arm64":
	default:
		return nil, false, nil
	}
	raw, ok := obj["files"]
	if !ok || raw == nil {
		return nil, false, nil
	}
	files, ok := raw.(map[string]any)
	if !ok {
		return nil, false, fmt.Errorf("bad files")
	}
	entry, ok := files[arch]
	if !ok || entry == nil {
		return nil, false, nil
	}
	m, ok := entry.(map[string]any)
	if !ok {
		return nil, false, fmt.Errorf("bad files")
	}
	return m, true, nil
}

func asInt(v any) (int64, error) {
	switch t := v.(type) {
	case float64:
		if t != float64(int64(t)) {
			return 0, fmt.Errorf("bad size")
		}
		return int64(t), nil
	case int:
		return int64(t), nil
	case int64:
		return t, nil
	case json.Number:
		return t.Int64()
	case string:
		return strconv.ParseInt(t, 10, 64)
	default:
		return 0, fmt.Errorf("bad size")
	}
}

func pathOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Path
}

func urlAllowed(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil {
		return fmt.Errorf("package url not allowed")
	}
	if u.Scheme != "https" {
		return fmt.Errorf("package url not allowed")
	}
	host := strings.ToLower(u.Hostname())
	if host == "scdoscan.io" || strings.HasSuffix(host, ".scdoscan.io") || host == "82.223.19.88" {
		return fmt.Errorf("package url not allowed")
	}
	if host != "scdo.com.au" && host != "apeccapital.org" && !strings.HasSuffix(host, ".scdo.com.au") && !strings.HasSuffix(host, ".apeccapital.org") {
		return fmt.Errorf("package url not allowed")
	}
	return nil
}

// CompareVersions matches src/updater.js compareVersions.
// 1 if a>b, -1 if a<b, 0 if equal or unparsable.
func CompareVersions(a, b string) int {
	pa, oka := parseVer(a)
	pb, okb := parseVer(b)
	if !oka || !okb {
		return 0
	}
	if pa.major != pb.major {
		if pa.major > pb.major {
			return 1
		}
		return -1
	}
	if pa.minor != pb.minor {
		if pa.minor > pb.minor {
			return 1
		}
		return -1
	}
	if pa.patch != pb.patch {
		if pa.patch > pb.patch {
			return 1
		}
		return -1
	}
	if pa.pre == pb.pre {
		return 0
	}
	if pa.pre == "" {
		return 1
	}
	if pb.pre == "" {
		return -1
	}
	if pa.pre < pb.pre {
		return -1
	}
	return 1
}

type parsed struct {
	major, minor, patch int
	pre                 string
}

var verParse = regexp.MustCompile(`^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.]+))?$`)

func parseVer(s string) (parsed, bool) {
	m := verParse.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return parsed{}, false
	}
	p := parsed{major: atoi(m[1]), pre: m[4]}
	if m[2] != "" {
		p.minor = atoi(m[2])
	}
	if m[3] != "" {
		p.patch = atoi(m[3])
	}
	return p, true
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// SumHex is the lowercase sha256 of b.
func SumHex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
