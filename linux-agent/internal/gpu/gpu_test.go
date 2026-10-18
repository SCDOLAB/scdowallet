package gpu

import (
	"errors"
	"strings"
	"testing"
)

type fake struct {
	have map[string]bool
	run  map[string]struct {
		out string
		err error
	}
	calls []string
}

func (f *fake) Look(name string) bool { return f.have[name] }

func (f *fake) Run(name string, args ...string) ([]byte, error) {
	key := name + " " + strings.Join(args, " ")
	f.calls = append(f.calls, key)
	r, ok := f.run[key]
	if !ok {
		r, ok = f.run[name]
	}
	if !ok {
		return nil, errors.New("missing fixture")
	}
	return []byte(r.out), r.err
}

func TestNvidia940MX(t *testing.T) {
	f := &fake{
		have: map[string]bool{"nvidia-smi": true, "lspci": true},
		run: map[string]struct {
			out string
			err error
		}{
			"nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader,nounits": {
				out: "0, NVIDIA GeForce 940MX, 2048\n",
			},
		},
	}
	cards, ok, err := Detect(f)
	if err != nil || !ok || len(cards) != 1 {
		t.Fatalf("%v %v %+v", ok, err, cards)
	}
	if cards[0].Index != 0 || cards[0].Model != "NVIDIA GeForce 940MX" || cards[0].VRAMMiB != 2048 || cards[0].Source != "nvidia" {
		t.Fatalf("%+v", cards[0])
	}
	if len(f.calls) != 1 {
		t.Fatalf("calls %v", f.calls)
	}
}

func TestNvidiaPresentButFailsFallsThroughToLspci(t *testing.T) {
	fail := errors.New("NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver")
	f := &fake{
		have: map[string]bool{"nvidia-smi": true, "rocm-smi": false, "lspci": true},
		run: map[string]struct {
			out string
			err error
		}{
			"nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader,nounits": {out: "NVIDIA-SMI has failed\n", err: fail},
			"nvidia-smi -L": {out: "NVIDIA-SMI has failed\n", err: fail},
			"lspci -nn":     {out: "00:02.0 VGA compatible controller [0300]: Intel Corporation Device [8086:1234]\n01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GM108M [GeForce 940MX] [10de:134d] (rev a2)\n02:00.0 VGA compatible controller [0300]: Microsoft Basic Display Adapter\n"},
		},
	}
	cards, ok, err := Detect(f)
	if err != nil || !ok {
		t.Fatalf("%v %v", ok, err)
	}
	if len(cards) != 2 {
		t.Fatalf("%+v", cards)
	}
	if !strings.Contains(cards[1].Model, "940MX") || cards[1].Source != "lspci" || cards[1].Index != 1 {
		t.Fatalf("%+v", cards)
	}
	if strings.Contains(cards[0].Model, "Basic Display") {
		t.Fatal("virtual adapter was kept")
	}
}

func TestNoEnumeratorDoesNotClaimEmpty(t *testing.T) {
	f := &fake{
		have: map[string]bool{"nvidia-smi": true},
		run: map[string]struct {
			out string
			err error
		}{
			"nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader,nounits": {err: errors.New("fail")},
			"nvidia-smi -L": {err: errors.New("fail")},
		},
	}
	cards, ok, err := Detect(f)
	if ok || err == nil || len(cards) != 0 {
		t.Fatalf("ok=%v err=%v cards=%v", ok, err, cards)
	}
}

func TestNoAdapterBox(t *testing.T) {
	f := &fake{
		have: map[string]bool{"lspci": true},
		run: map[string]struct {
			out string
			err error
		}{
			"lspci -nn": {out: "00:00.0 Host bridge [0600]: Intel Corporation Device\n"},
		},
	}
	cards, ok, err := Detect(f)
	if err != nil || !ok || len(cards) != 0 {
		t.Fatalf("%v %v %+v", ok, err, cards)
	}
}

func TestRocm(t *testing.T) {
	f := &fake{
		have: map[string]bool{"rocm-smi": true},
		run: map[string]struct {
			out string
			err error
		}{
			"rocm-smi --showproductname --showmeminfo vram": {out: "GPU[0] : Card series: Radeon RX 580\nGPU[0] : VRAM Total Memory (B): 8589934592\n"},
		},
	}
	cards, ok, err := Detect(f)
	if err != nil || !ok || len(cards) != 1 || cards[0].VRAMMiB != 8192 || cards[0].Source != "rocm" {
		t.Fatalf("%v %v %+v", ok, err, cards)
	}
}

func TestNvidiaIdentity(t *testing.T) {
	f := &fake{
		have: map[string]bool{"nvidia-smi": true},
		run: map[string]struct {
			out string
			err error
		}{
			"nvidia-smi --query-gpu=uuid,name,memory.total,pci.bus_id --format=csv,noheader": {
				out: "GPU-11111111-2222-3333-4444-555555555555, NVIDIA GeForce 940MX, 2048 MiB, 00000000:01:00.0\n",
			},
		},
	}
	ids, ok := Identities(f)
	if !ok || len(ids) != 1 {
		t.Fatalf("%v %+v", ok, ids)
	}
	if ids[0].UUID != "GPU-11111111-2222-3333-4444-555555555555" || ids[0].Model != "NVIDIA GeForce 940MX" || ids[0].VRAMMiB != 2048 || ids[0].PCIBusID != "00000000:01:00.0" {
		t.Fatalf("%+v", ids[0])
	}
}

func TestIntelHasNoIdentity(t *testing.T) {
	f := &fake{
		have: map[string]bool{"lspci": true},
		run: map[string]struct {
			out string
			err error
		}{
			"lspci -nn": {out: "00:02.0 VGA compatible controller [0300]: Intel Corporation UHD Graphics 610\n"},
		},
	}
	ids, ok := Identities(f)
	if ok || len(ids) != 0 {
		t.Fatalf("intel attested %+v", ids)
	}
	cards, detected, err := Detect(f)
	if err != nil || !detected || len(cards) != 1 || cards[0].Source != "lspci" {
		t.Fatalf("%v %v %+v", detected, err, cards)
	}
}
