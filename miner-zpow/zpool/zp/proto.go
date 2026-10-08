package zp

import (
	"encoding/json"
	"math/big"
)

// Wire protocol: newline-delimited JSON-RPC 2.0 over TCP (stratum style).
//  -> {"id":1,"method":"login","params":["1S01...", "worker1", "zminer/0.3"]}
//  <- {"id":1,"result":{"status":"ok","job":{...}}}
//  -> {"id":2,"method":"getjob","params":[]}
//  <- {"id":2,"result":{...job...}}
//  -> {"id":3,"method":"submit","params":["<job_id>", "<nonce decimal>"]}
//  <- {"id":3,"result":{"accepted":true,"block":false}}  or {"id":3,"error":{"code":..,"message":..}}
//  <- {"method":"job","params":{...job...}}   (server push, no id)
// HTTP getWork (same job object): GET /work?login=1S01..  POST /submit {"login","job_id","nonce"}

type Job struct {
	JobID       string          `json:"job_id"`
	Height      uint64          `json:"height"`
	Header      json.RawMessage `json:"header"`       // core/types.BlockHeader JSON (Witness empty)
	ShareTarget string          `json:"share_target"` // det must be >= this (decimal)
	BlockTarget string          `json:"block_target"` // det >= this is a block (decimal)
	ShareDiff   uint64          `json:"share_diff"`
}

type Req struct {
	ID     interface{}     `json:"id,omitempty"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type RPCErr struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type Resp struct {
	ID      interface{} `json:"id,omitempty"`
	JSONRPC string      `json:"jsonrpc,omitempty"`
	Method  string      `json:"method,omitempty"`
	Params  interface{} `json:"params,omitempty"`
	Result  interface{} `json:"result,omitempty"`
	Error   *RPCErr     `json:"error,omitempty"`
}

// ParseHeader decodes core/types header JSON into the mirror Header.
func ParseHeader(raw []byte) (*Header, error) {
	var h Header
	if err := json.Unmarshal(raw, &h); err != nil {
		return nil, err
	}
	if h.Difficulty == nil {
		h.Difficulty = new(big.Int)
	}
	if h.CreateTimestamp == nil {
		h.CreateTimestamp = new(big.Int)
	}
	return &h, nil
}

func ParseBig(s string) *big.Int {
	b, ok := new(big.Int).SetString(s, 10)
	if !ok {
		return nil
	}
	return b
}
