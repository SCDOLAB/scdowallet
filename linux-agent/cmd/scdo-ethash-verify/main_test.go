package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ethash"
)

func TestVerifyEpochZeroAndReject(t *testing.T) {
	var out, errb bytes.Buffer
	if code := run(strings.NewReader(`{"epoch":0,"header":"zz","target":"0x11","nonce":"0x0","mixHash":"0x22"}`), &out, &errb); code != 2 || out.Len() != 0 {
		t.Fatalf("malformed %d %q", code, out.String())
	}
	header := make([]byte, 32)
	cache := ethash.GenerateCache(ethash.CacheSize(0), ethash.Seed(0))
	mix, _ := ethash.HashimotoLight(ethash.DatasetSize(0), cache, header, 1)
	doc := map[string]any{
		"epoch":   0,
		"header":  "0x" + hex.EncodeToString(header),
		"target":  "0x" + hex.EncodeToString(bytes.Repeat([]byte{0xff}, 32)),
		"nonce":   "0x1",
		"mixHash": "0x" + hex.EncodeToString(mix),
	}
	raw, _ := json.Marshal(doc)
	out.Reset()
	code := run(bytes.NewReader(raw), &out, &errb)
	if code != 0 || strings.TrimSpace(out.String()) != `{"ok":true}` {
		t.Fatalf("ok %d %s", code, out.String())
	}
	mix[0] ^= 0xff
	doc["mixHash"] = "0x" + hex.EncodeToString(mix)
	raw, _ = json.Marshal(doc)
	out.Reset()
	code = run(bytes.NewReader(raw), &out, &errb)
	if code != 0 || strings.TrimSpace(out.String()) != `{"ok":false}` {
		t.Fatalf("bad mix %d %s", code, out.String())
	}
}
