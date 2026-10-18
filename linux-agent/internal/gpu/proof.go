package gpu

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ethash"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

// Challenge is one open ledger ethash challenge.
type Challenge struct {
	ID         string
	Epoch      uint64
	Header     []byte
	Target     []byte
	Difficulty uint64
	GPUClass   string
	Deadline   int64
}

// Solution is a nonce and mix digest the GPU search returned.
type Solution struct {
	Nonce   uint64
	MixHash []byte
}

// Solver searches on a GPU. A CPU search must not be used.
type Solver interface {
	Solve(ctx context.Context, ch Challenge) (Solution, bool, error)
}

// Proof posts a NVIDIA attestation and, when the ledger has an open
// challenge, a GPU solution. It does not invent either one.
type Proof struct {
	Key    *ledger.Key
	Client *ledger.Client
	Runner Runner
	Solver Solver
	Now    func() int64
	Log    func(string)
	// Index, when non-nil, selects that nvidia-smi row. Nil uses the first.
	Index    *int
	attested string
}

func (p *Proof) now() int64 {
	if p.Now != nil {
		return p.Now()
	}
	return time.Now().UnixMilli()
}

func (p *Proof) log(msg string) {
	if p.Log != nil {
		p.Log(msg)
	}
}

// Run attests when a real NVIDIA adapter is present, then solves an open
// challenge on the GPU. No NVIDIA adapter, no solver, or a missed deadline
// leaves the agent unverified.
func (p *Proof) Run(ctx context.Context, nextSeq func() (int64, error)) {
	if p == nil || p.Key == nil || p.Client == nil || nextSeq == nil {
		return
	}
	ids, ok := Identities(p.Runner)
	if !ok {
		return
	}
	id := pickIdentity(ids, p.Index)
	if id.UUID == "" {
		return
	}
	if p.attested != id.UUID {
		if err := p.attest(ctx, nextSeq, id); err != nil {
			p.log("gpu attest failed " + err.Error())
		} else {
			p.attested = id.UUID
			p.log("gpu attest ok")
		}
	}
	ch, open, err := p.fetch(ctx)
	if err != nil {
		p.log("gpu challenge " + err.Error())
		return
	}
	if !open {
		return
	}
	if p.now() >= ch.Deadline {
		p.log("gpu challenge past deadline")
		return
	}
	solver := p.Solver
	if solver == nil {
		solver = ExecSolver{}
	}
	sol, solved, err := solver.Solve(ctx, ch)
	if err != nil || !solved {
		if err != nil {
			p.log("gpu solve " + err.Error())
		}
		return
	}
	if !ethash.Verify(ch.Epoch, ch.Header, sol.MixHash, ch.Target, sol.Nonce) {
		p.log("gpu result did not verify")
		return
	}
	if err := p.solve(ctx, nextSeq, ch, sol); err != nil {
		p.log("gpu solve post " + err.Error())
		return
	}
	p.log("gpu solve ok")
}

func pickIdentity(ids []Identity, index *int) Identity {
	if index != nil {
		for _, id := range ids {
			if id.Index == *index {
				return id
			}
		}
		return Identity{}
	}
	if len(ids) == 0 {
		return Identity{}
	}
	return ids[0]
}

func (p *Proof) attest(ctx context.Context, nextSeq func() (int64, error), id Identity) error {
	seq, err := nextSeq()
	if err != nil {
		return err
	}
	body := map[string]any{
		"uuid":     id.UUID,
		"model":    id.Model,
		"vramMiB":  id.VRAMMiB,
		"pciBusId": id.PCIBusID,
	}
	env, _, err := ledger.Sign(p.Key, "gpuattest", seq, body, p.now())
	if err != nil {
		return err
	}
	res, err := p.Client.Post(ctx, "gpuattest", env)
	if err != nil {
		return err
	}
	if !res.OK {
		return fmt.Errorf("%s", res.Error)
	}
	return nil
}

func (p *Proof) fetch(ctx context.Context) (Challenge, bool, error) {
	q := "/gpu/challenge?agent=" + p.Key.Address()
	res, err := p.Client.Get(ctx, q)
	if err != nil {
		return Challenge{}, false, err
	}
	ch, ok := ParseChallenge(res.Body, p.now())
	return ch, ok, nil
}

func (p *Proof) solve(ctx context.Context, nextSeq func() (int64, error), ch Challenge, sol Solution) error {
	seq, err := nextSeq()
	if err != nil {
		return err
	}
	body := map[string]any{
		"challengeId": ch.ID,
		"nonce":       fmt.Sprintf("0x%016x", sol.Nonce),
		"mixHash":     "0x" + hex.EncodeToString(sol.MixHash),
	}
	env, _, err := ledger.Sign(p.Key, "gpusolve", seq, body, p.now())
	if err != nil {
		return err
	}
	res, err := p.Client.Post(ctx, "gpusolve", env)
	if err != nil {
		return err
	}
	if !res.OK {
		return fmt.Errorf("%s", res.Error)
	}
	return nil
}

// ParseChallenge reads the ledger challenge document.
// An empty or null challenge is not open. deadline and deadlineMs are absolute
// unix milliseconds when they are at least 1e12, unix seconds when they are
// at least 1e9, and a duration in milliseconds otherwise.
func ParseChallenge(body map[string]any, now int64) (Challenge, bool) {
	if body == nil {
		return Challenge{}, false
	}
	raw := body
	if _, exists := body["challenge"]; exists {
		nested, ok := body["challenge"].(map[string]any)
		if !ok || nested == nil {
			return Challenge{}, false
		}
		raw = nested
	}
	id := jsonID(raw["id"])
	header, err := ethash.DecodeHex32(jsonString(raw["header"]))
	if err != nil || id == "" {
		return Challenge{}, false
	}
	epoch, _ := jsonUint(raw["epoch"])
	target, err := ethash.DecodeHex32(jsonString(raw["target"]))
	diff, _ := jsonUint(raw["difficulty"])
	if err != nil {
		target = ethash.TargetFromDifficulty(diff)
	}
	if len(target) != 32 {
		return Challenge{}, false
	}
	deadline := parseDeadline(raw, now)
	if deadline == 0 {
		return Challenge{}, false
	}
	return Challenge{
		ID:         id,
		Epoch:      epoch,
		Header:     header,
		Target:     target,
		Difficulty: diff,
		GPUClass:   jsonString(raw["gpuClass"]),
		Deadline:   deadline,
	}, true
}

func parseDeadline(raw map[string]any, now int64) int64 {
	v, ok := raw["deadline"]
	if !ok {
		v = raw["deadlineMs"]
	}
	n, ok := jsonInt(v)
	if !ok || n <= 0 {
		return 0
	}
	switch {
	case n >= 1_000_000_000_000:
		return n
	case n >= 1_000_000_000:
		return n * 1000
	default:
		return now + n
	}
}

func jsonString(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	default:
		return ""
	}
}

func jsonID(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case float64:
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	case json.Number:
		return t.String()
	default:
		return ""
	}
}

func jsonUint(v any) (uint64, bool) {
	switch t := v.(type) {
	case float64:
		if t < 0 {
			return 0, false
		}
		return uint64(t), true
	case string:
		n, err := strconv.ParseUint(strings.TrimSpace(t), 10, 64)
		return n, err == nil
	case json.Number:
		n, err := t.Int64()
		return uint64(n), err == nil && n >= 0
	default:
		return 0, false
	}
}

func jsonInt(v any) (int64, bool) {
	switch t := v.(type) {
	case float64:
		return int64(t), true
	case string:
		n, err := strconv.ParseInt(strings.TrimSpace(t), 10, 64)
		return n, err == nil
	case json.Number:
		n, err := t.Int64()
		return n, err == nil
	default:
		return 0, false
	}
}

// ExecSolver runs scdo-ethash-gpu. A missing binary or a non-zero exit is not
// a solution. The helper must refuse to search without an NVIDIA GPU.
type ExecSolver struct {
	Path string
}

func (e ExecSolver) Solve(ctx context.Context, ch Challenge) (Solution, bool, error) {
	path := e.Path
	if path == "" {
		path = findSolver()
	}
	if path == "" {
		return Solution{}, false, nil
	}
	deadline := time.UnixMilli(ch.Deadline)
	if d := time.Until(deadline); d <= 0 {
		return Solution{}, false, nil
	} else {
		var cancel context.CancelFunc
		ctx, cancel = context.WithDeadline(ctx, deadline)
		defer cancel()
	}
	cmd := exec.CommandContext(ctx, path, "solve",
		strconv.FormatUint(ch.Epoch, 10),
		"0x"+hex.EncodeToString(ch.Header),
		"0x"+hex.EncodeToString(ch.Target),
		strconv.FormatInt(ch.Deadline, 10),
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return Solution{}, false, nil
	}
	var doc struct {
		Nonce   string `json:"nonce"`
		MixHash string `json:"mixHash"`
	}
	if json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &doc) != nil {
		return Solution{}, false, nil
	}
	nonce, err := ethash.DecodeNonce(doc.Nonce)
	if err != nil {
		return Solution{}, false, nil
	}
	mix, err := ethash.DecodeHex32(doc.MixHash)
	if err != nil {
		return Solution{}, false, nil
	}
	return Solution{Nonce: nonce, MixHash: mix}, true, nil
}

func findSolver() string {
	if p := strings.TrimSpace(os.Getenv("SCDO_ETHASH_GPU")); p != "" {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	var names []string
	if exe, err := os.Executable(); err == nil {
		names = append(names, filepath.Join(filepath.Dir(exe), "scdo-ethash-gpu"))
	}
	if p, err := exec.LookPath("scdo-ethash-gpu"); err == nil {
		names = append(names, p)
	}
	names = append(names, "/usr/lib/scdo-agent/scdo-ethash-gpu")
	for _, name := range names {
		st, err := os.Stat(name)
		if err == nil && !st.IsDir() {
			return name
		}
	}
	return ""
}
