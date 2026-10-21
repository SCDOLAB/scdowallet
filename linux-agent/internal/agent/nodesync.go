package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Shard0 EVM chain id. A local node on another chain is ignored.
const shard0ChainID = 5680

// NodeSample is one per-minute reading of the local Shard0 node. It goes into the
// signed heartbeat body so the ledger can check real sync (anti-farm, 2026-10-20).
type NodeSample struct {
	T     int64  `json:"t"`
	Block uint64 `json:"h"`
	Hash  string `json:"hash"`
	Peers int    `json:"peers"`
}

type nodeSampler struct {
	mu      sync.Mutex
	urls    []string
	samples []NodeSample
	enode   string
	sentTo  int64
	client  *http.Client
}

func newNodeSampler() *nodeSampler {
	urls := []string{"http://127.0.0.1:8545", "http://127.0.0.1:18545"}
	if v := strings.TrimSpace(os.Getenv("SCDO_NODE_RPC")); v != "" {
		urls = strings.Split(v, ",")
	}
	return &nodeSampler{urls: urls, client: &http.Client{Timeout: 3 * time.Second}}
}

func (n *nodeSampler) call(ctx context.Context, url, method string, out any) error {
	raw, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": paramsFor(method)})
	rq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	rq.Header.Set("Content-Type", "application/json")
	r, err := n.client.Do(rq)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	var env struct {
		Result json.RawMessage `json:"result"`
		Error  any             `json:"error"`
	}
	if err := json.NewDecoder(r.Body).Decode(&env); err != nil {
		return err
	}
	if env.Error != nil || len(env.Result) == 0 {
		return errRPC
	}
	return json.Unmarshal(env.Result, out)
}

type rpcErr struct{}

func (rpcErr) Error() string { return "rpc error" }

var errRPC = rpcErr{}

func paramsFor(m string) []any {
	if m == "eth_getBlockByNumber" {
		return []any{"latest", false}
	}
	return []any{}
}

func hexU(s string) uint64 {
	v, _ := strconv.ParseUint(strings.TrimPrefix(s, "0x"), 16, 64)
	return v
}

// sample reads the first local Shard0 node that answers. No node: no sample.
func (n *nodeSampler) sample(ctx context.Context, now int64) {
	for _, u := range n.urls {
		u = strings.TrimSpace(u)
		var cid string
		if n.call(ctx, u, "eth_chainId", &cid) != nil || hexU(cid) != shard0ChainID {
			continue
		}
		var blk struct {
			Number string `json:"number"`
			Hash   string `json:"hash"`
		}
		var pc string
		if n.call(ctx, u, "eth_getBlockByNumber", &blk) != nil || blk.Hash == "" || n.call(ctx, u, "net_peerCount", &pc) != nil {
			continue
		}
		var info struct {
			Enode string `json:"enode"`
			ID    string `json:"id"`
		}
		enode := ""
		if n.call(ctx, u, "admin_nodeInfo", &info) == nil {
			enode = info.ID
			if enode == "" {
				enode = info.Enode
			}
		}
		n.mu.Lock()
		n.samples = append(n.samples, NodeSample{T: now, Block: hexU(blk.Number), Hash: strings.ToLower(blk.Hash), Peers: int(hexU(pc))})
		if len(n.samples) > 120 {
			n.samples = n.samples[len(n.samples)-120:]
		}
		if enode != "" {
			n.enode = enode
		}
		n.mu.Unlock()
		return
	}
}

func (n *nodeSampler) loop(ctx context.Context, now func() int64) {
	for {
		n.sample(ctx, now())
		if sleepCtx(ctx, time.Minute) != nil {
			return
		}
	}
}

// addTo puts the latest reading and the samples since the last heartbeat into body.
func (n *nodeSampler) addTo(body map[string]any) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if len(n.samples) == 0 {
		return
	}
	last := n.samples[len(n.samples)-1]
	body["head_block"] = int64(last.Block)
	body["head_hash"] = last.Hash
	body["peer_count"] = last.Peers
	if n.enode != "" {
		body["enode"] = n.enode
	}
	arr := make([]any, 0, len(n.samples))
	for _, x := range n.samples { // canonical signer takes only []any / map[string]any / int64
		arr = append(arr, map[string]any{"t": x.T, "h": int64(x.Block), "hash": x.Hash, "peers": x.Peers})
	}
	body["node_samples"] = arr
	n.sentTo = last.T
}

// clear drops samples once a heartbeat carrying them was accepted.
func (n *nodeSampler) clear() {
	n.mu.Lock()
	keep := n.samples[:0]
	for _, x := range n.samples {
		if x.T > n.sentTo {
			keep = append(keep, x)
		}
	}
	n.samples = keep
	n.mu.Unlock()
}
