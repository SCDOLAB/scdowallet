// Package gpu reads local graphics adapters for the bookkeeping record.
// It does not start a workload on the adapter.
package gpu

import (
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

// Card is one adapter. VRAMMiB is 0 when the probe cannot see a size.
type Card struct {
	Index   int
	Model   string
	VRAMMiB int
	Source  string
}

// Runner executes a local probe. Look is false when the program is not installed.
type Runner interface {
	Look(name string) bool
	Run(name string, args ...string) ([]byte, error)
}

// OS runs the real commands.
type OS struct{}

func (OS) Look(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func (OS) Run(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).CombinedOutput()
}

// Detect tries nvidia-smi, then rocm-smi, then lspci.
// ok is false when every enumerator failed to run, so the caller must not
// treat that as "no adapters" and must not stop existing instances.
// nvidia-smi present but failing falls through to the next probe.
func Detect(r Runner) (cards []Card, ok bool, err error) {
	if r == nil {
		r = OS{}
	}
	if r.Look("nvidia-smi") {
		if b, e := r.Run("nvidia-smi", "--query-gpu=index,name,memory.total", "--format=csv,noheader,nounits"); e == nil {
			if parsed := parseNvidiaCSV(string(b)); len(parsed) > 0 {
				return parsed, true, nil
			}
		}
		if b, e := r.Run("nvidia-smi", "-L"); e == nil {
			if parsed := parseNvidiaList(string(b)); len(parsed) > 0 {
				return parsed, true, nil
			}
		}
	}
	if r.Look("rocm-smi") {
		if b, e := r.Run("rocm-smi", "--showproductname", "--showmeminfo", "vram"); e == nil {
			if parsed := parseRocm(string(b)); len(parsed) > 0 {
				return parsed, true, nil
			}
		}
	}
	if r.Look("lspci") {
		b, e := r.Run("lspci", "-nn")
		if e != nil {
			return nil, false, fmt.Errorf("graphics probe failed")
		}
		return parseLspci(string(b)), true, nil
	}
	return nil, false, fmt.Errorf("graphics probe failed")
}

var nvidiaList = regexp.MustCompile(`(?m)^GPU\s+(\d+)\s*:\s*(.+?)\s*\(UUID:`)

func parseNvidiaCSV(text string) []Card {
	var out []Card
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "NVIDIA-SMI") {
			continue
		}
		parts := strings.Split(line, ",")
		if len(parts) < 2 {
			continue
		}
		idx, err := strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil {
			continue
		}
		model := strings.TrimSpace(parts[1])
		if model == "" || virtualName(model) {
			continue
		}
		vram := 0
		if len(parts) >= 3 {
			fields := strings.Fields(strings.TrimSpace(parts[2]))
			if len(fields) > 0 {
				vram, _ = strconv.Atoi(fields[0])
			}
		}
		out = append(out, Card{Index: idx, Model: model, VRAMMiB: vram, Source: "nvidia"})
	}
	return out
}

func parseNvidiaList(text string) []Card {
	var out []Card
	for _, m := range nvidiaList.FindAllStringSubmatch(text, -1) {
		idx, _ := strconv.Atoi(m[1])
		model := strings.TrimSpace(m[2])
		if model == "" || virtualName(model) {
			continue
		}
		out = append(out, Card{Index: idx, Model: model, Source: "nvidia"})
	}
	return out
}

var (
	rocmGPU   = regexp.MustCompile(`GPU\[(\d+)\]`)
	rocmModel = regexp.MustCompile(`(?i)card series:\s*(.+)$`)
	rocmVRAM  = regexp.MustCompile(`(?i)VRAM Total Memory \(B\):\s*(\d+)`)
)

func parseRocm(text string) []Card {
	type acc struct {
		model string
		vram  int
	}
	got := map[int]*acc{}
	var order []int
	for _, line := range strings.Split(text, "\n") {
		id := rocmGPU.FindStringSubmatch(line)
		if id == nil {
			continue
		}
		n, _ := strconv.Atoi(id[1])
		if _, ok := got[n]; !ok {
			got[n] = &acc{}
			order = append(order, n)
		}
		if m := rocmModel.FindStringSubmatch(line); m != nil {
			got[n].model = strings.TrimSpace(m[1])
		}
		if m := rocmVRAM.FindStringSubmatch(line); m != nil {
			b, _ := strconv.ParseInt(m[1], 10, 64)
			if b > 0 {
				got[n].vram = int(b / (1024 * 1024))
			}
		}
	}
	var out []Card
	for _, n := range order {
		model := got[n].model
		if model == "" {
			model = fmt.Sprintf("ROCm GPU %d", n)
		}
		if virtualName(model) {
			continue
		}
		out = append(out, Card{Index: n, Model: model, VRAMMiB: got[n].vram, Source: "rocm"})
	}
	return out
}

var lspciLine = regexp.MustCompile(`^[0-9a-fA-F:.]+ (VGA compatible controller|3D controller|Display controller)(?:\s+\[[^\]]+\])?:\s*(.+)$`)

func parseLspci(text string) []Card {
	var out []Card
	for _, line := range strings.Split(text, "\n") {
		m := lspciLine.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		model := strings.TrimSpace(m[2])
		if i := strings.Index(model, " (rev"); i > 0 {
			model = strings.TrimSpace(model[:i])
		}
		if model == "" || virtualName(model) {
			continue
		}
		out = append(out, Card{Index: len(out), Model: model, Source: "lspci"})
	}
	return out
}

func virtualName(name string) bool {
	l := strings.ToLower(name)
	for _, n := range []string{
		"virtual", "parsec", "basic display", "basic render", "oray",
		"indirect display", "rustdesk", "anydesk", "teamviewer", "sunlogin",
		"todesk", "idd driver", "idd display",
	} {
		if strings.Contains(l, n) {
			return true
		}
	}
	return false
}
