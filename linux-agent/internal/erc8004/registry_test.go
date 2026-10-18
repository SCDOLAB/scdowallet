package erc8004

import (
	"context"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

func TestRegisterOnceAndSkipTheSecondTime(t *testing.T) {
	key, err := ledger.Generate()
	if err != nil {
		t.Fatal(err)
	}
	scalar := key.Scalar()
	secret := "0x" + common.Bytes2Hex(scalar)
	ledger.Wipe(scalar)
	address := key.Address()
	var bodies []string
	var sent int
	var agentID = "4"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(b))
		var req struct {
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		_ = json.Unmarshal(b, &req)
		write := func(v any) {
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": v})
		}
		switch req.Method {
		case "eth_chainId":
			write("0x1630")
		case "eth_getLogs":
			if sent == 0 {
				write([]any{})
				return
			}
			write([]any{regLog(agentID, address, "0x"+strings.Repeat("ab", 32))})
		case "eth_call":
			var call struct {
				Data string `json:"data"`
			}
			_ = json.Unmarshal(req.Params[0], &call)
			if strings.HasPrefix(call.Data, "0x6352211e") {
				write("0x" + common.Bytes2Hex(common.LeftPadBytes(common.HexToAddress(address).Bytes(), 32)))
				return
			}
			packed, err := registryABI.Methods["getMetadata"].Outputs.Pack([]byte(address))
			if err != nil {
				t.Fatal(err)
			}
			write("0x" + common.Bytes2Hex(packed))
		case "eth_getBalance":
			write("0xde0b6b3a7640000")
		case "eth_getTransactionCount":
			write("0x1")
		case "eth_gasPrice":
			write("0x3b9aca00")
		case "eth_estimateGas":
			write("0x30d40")
		case "eth_sendRawTransaction":
			sent++
			var raw string
			_ = json.Unmarshal(req.Params[0], &raw)
			tx := new(types.Transaction)
			if err := tx.UnmarshalBinary(common.FromHex(raw)); err != nil {
				t.Fatal(err)
			}
			from, err := types.Sender(types.NewEIP155Signer(big.NewInt(ChainID)), tx)
			if err != nil || !strings.EqualFold(from.Hex(), address) {
				t.Fatalf("sender %s %v", from.Hex(), err)
			}
			if tx.To() == nil || !strings.EqualFold(tx.To().Hex(), IdentityRegistry) || tx.Value().Sign() != 0 {
				t.Fatalf("tx to %v value %s", tx.To(), tx.Value())
			}
			if !strings.HasPrefix(common.Bytes2Hex(tx.Data()), "8ea42286") {
				t.Fatalf("selector %x", tx.Data()[:4])
			}
			blob := string(tx.Data())
			if !strings.Contains(blob, MetadataKey) || !strings.Contains(blob, address) || !strings.Contains(blob, "/registration.json") {
				t.Fatal("calldata missing uri or metadata")
			}
			write("0x" + strings.Repeat("cd", 32))
		case "eth_getTransactionReceipt":
			write(map[string]any{
				"status": "0x1",
				"logs":   []any{regLog(agentID, address, "0x"+strings.Repeat("cd", 32))},
			})
		default:
			t.Fatalf("unexpected %s", req.Method)
		}
	}))
	defer srv.Close()
	dir := t.TempDir()
	opt := Options{Key: key, Dir: dir, Client: &rpc{URLs: []string{srv.URL}}}
	got, err := Register(context.Background(), opt)
	if err != nil {
		t.Fatal(err)
	}
	if got.Already || got.AgentID != "4" || got.URI != AgentURI(address) {
		t.Fatalf("%+v", got)
	}
	raw, err := os.ReadFile(dir + "/erc8004.json")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), strings.TrimPrefix(secret, "0x")) || strings.Contains(strings.Join(bodies, "\n"), strings.TrimPrefix(secret, "0x")) {
		t.Fatal("key was logged")
	}
	st, err := os.Stat(dir + "/erc8004.json")
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", st.Mode().Perm())
	}
	again, err := Register(context.Background(), opt)
	if err != nil {
		t.Fatal(err)
	}
	if !again.Already || again.AgentID != "4" || sent != 1 {
		t.Fatalf("again %+v sent %d", again, sent)
	}
}

func TestRejectsForeignRPC(t *testing.T) {
	if _, err := SanitizeRPC("https://scdoscan.io/rpc/0"); err == nil {
		t.Fatal("accepted a rejected host")
	}
	if _, err := SanitizeRPC("http://82.223.19.88/rpc/0"); err == nil {
		t.Fatal("accepted a rejected host")
	}
	if _, err := SanitizeRPC("http://example.com/rpc/0"); err == nil {
		t.Fatal("accepted plain http")
	}
}

func TestConfigFlag(t *testing.T) {
	dir := t.TempDir()
	if Enabled(dir) {
		t.Fatal("missing config")
	}
	if err := os.WriteFile(dir+"/config.toml", []byte("payout = \"0xabc\"\nerc8004 = false\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if Enabled(dir) {
		t.Fatal("false")
	}
	if err := os.WriteFile(dir+"/config.toml", []byte("# erc8004 = true\npayout = \"0xabc\"\nerc8004 = true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !Enabled(dir) {
		t.Fatal("true")
	}
}

func regLog(id, owner, tx string) map[string]any {
	n := new(big.Int)
	n.SetString(id, 10)
	return map[string]any{
		"topics": []string{
			registeredTopic.Hex(),
			common.BigToHash(n).Hex(),
			topicAddress(owner),
		},
		"transactionHash": tx,
	}
}
