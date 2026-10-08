// +build cuda

package gpu

import (
	"encoding/json"
	"io/ioutil"
	"math"
	"os"
	"strconv"
	"testing"

	"github.com/scdoproject/go-scdo/common"
	"github.com/scdoproject/go-scdo/zpool/zp"
)

// TestDeviceMatchesCPU compares the CUDA library with zp.Det (the pool's
// CPU verifier) for the same header hash. It skips when no library or no
// GPU is available, and fails when a GPU returns different bits.
func TestDeviceMatchesCPU(t *testing.T) {
	dev, err := Open(os.Getenv("ZPOW_GPU_LIB"), 0)
	if err != nil {
		t.Skip(err)
	}
	defer dev.Close()
	t.Logf("device %s", dev.Name())

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
	h, err := zp.ParseHeader(fixtures[0].Header)
	if err != nil {
		t.Fatal(err)
	}
	nonce, err := strconv.ParseUint(string(h.Witness), 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	heights := []uint64{h.Height, 1}
	nonces := []uint64{nonce, nonce + 1, nonce + 2, nonce + 100003, 1, 42, 99, 1000}
	for _, height := range heights {
		hdr := *h
		hdr.Height = height
		hashes := make([]common.Hash, len(nonces))
		for i, n := range nonces {
			c := hdr
			hashes[i] = c.HashWithNonce(n)
		}
		dets, err := dev.Dets(hashes, height)
		if err != nil {
			t.Fatal(err)
		}
		if len(dets) != len(hashes) {
			t.Fatalf("got %d dets, want %d", len(dets), len(hashes))
		}
		for i := range hashes {
			cpu := zp.Det(hashes[i], height, nil)
			port := Det(hashes[i], height)
			if math.Float64bits(cpu) != math.Float64bits(dets[i]) {
				t.Fatalf("height %d nonce %d cpu %x (%g) port %x device %x (%g)",
					height, nonces[i], math.Float64bits(cpu), cpu, math.Float64bits(port), math.Float64bits(dets[i]), dets[i])
			}
		}
	}
}
