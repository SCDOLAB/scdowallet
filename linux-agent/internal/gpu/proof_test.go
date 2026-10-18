package gpu

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

type memSolver struct {
	sol Solution
	ok  bool
}

func (m memSolver) Solve(context.Context, Challenge) (Solution, bool, error) {
	return m.sol, m.ok, nil
}

func TestAttestAndSolveOnlyWithNvidia(t *testing.T) {
	key, err := ledger.Generate()
	if err != nil {
		t.Fatal(err)
	}
	var posts []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		posts = append(posts, r.URL.Path+" "+string(body))
		w.Header().Set("content-type", "application/json")
		if r.URL.Path == "/gpu/challenge" {
			_, _ = w.Write([]byte(`{"ok":true,"challenge":{"id":"c1","epoch":0,"header":"0x` + strings.Repeat("ab", 32) + `","target":"0x` + strings.Repeat("ff", 32) + `","difficulty":1,"gpuClass":"weak","deadline":3000000000000}}`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	seq := int64(0)
	next := func() (int64, error) {
		seq++
		return seq, nil
	}
	intel := &fake{have: map[string]bool{"lspci": true}}
	p := &Proof{
		Key:    key,
		Client: &ledger.Client{URLs: []string{srv.URL}, Agent: "test"},
		Runner: intel,
		Solver: memSolver{ok: true, sol: Solution{Nonce: 1, MixHash: bytes32(1)}},
		Now:    func() int64 { return 1_700_000_000_000 },
	}
	p.Run(context.Background(), next)
	if len(posts) != 0 || seq != 0 {
		t.Fatalf("intel submitted %d seq %d", len(posts), seq)
	}

	nvidia := &fake{
		have: map[string]bool{"nvidia-smi": true},
		run: map[string]struct {
			out string
			err error
		}{
			"nvidia-smi --query-gpu=uuid,name,memory.total,pci.bus_id --format=csv,noheader": {
				out: "GPU-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee, NVIDIA GeForce 940MX, 2048 MiB, 00000000:01:00.0\n",
			},
		},
	}
	p.Runner = nvidia
	p.Solver = memSolver{ok: false}
	p.Run(context.Background(), next)
	if len(posts) != 2 || !strings.Contains(posts[0], "/gpu/attest") || !strings.Contains(posts[1], "/gpu/challenge") {
		t.Fatalf("posts %v", posts)
	}
	if strings.Contains(posts[0], "GPU-aaaaaaaa") && !strings.Contains(posts[0], `"type":"gpuattest"`) {
		t.Fatal(posts[0])
	}
	var env struct {
		Payload struct {
			Type string         `json:"type"`
			Body map[string]any `json:"body"`
		} `json:"payload"`
	}
	if json.Unmarshal([]byte(posts[0][len("/gpu/attest "):]), &env) != nil {
		t.Fatal(posts[0])
	}
	if env.Payload.Type != "gpuattest" || env.Payload.Body["uuid"] != "GPU-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" || env.Payload.Body["vramMiB"] != float64(2048) {
		t.Fatalf("%+v", env.Payload)
	}
	if strings.Contains(strings.Join(posts, "\n"), "/gpu/solve") {
		t.Fatal("solver that found nothing was posted")
	}
}

func TestParseChallengeDeadline(t *testing.T) {
	body := map[string]any{
		"ok": true,
		"challenge": map[string]any{
			"id": "9", "epoch": float64(0),
			"header":   "0x" + strings.Repeat("11", 32),
			"target":   "0x" + strings.Repeat("ff", 32),
			"deadline": float64(1_700_000_000_000),
		},
	}
	ch, ok := ParseChallenge(body, 1)
	if !ok || ch.ID != "9" || ch.Deadline != 1_700_000_000_000 {
		t.Fatalf("%v %+v", ok, ch)
	}
	body["challenge"] = nil
	if _, ok := ParseChallenge(body, 1); ok {
		t.Fatal("null challenge is open")
	}
}

func bytes32(b byte) []byte {
	out := make([]byte, 32)
	out[31] = b
	return out
}
