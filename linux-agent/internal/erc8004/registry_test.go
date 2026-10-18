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
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/keys"
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

func TestPackSelectors(t *testing.T) {
	uri, err := packRegisterURI("https://scdo.com.au/agent-ledger/api/agents/0xabc/registration.json")
	if err != nil || common.Bytes2Hex(uri[:4]) != "f2c298be" {
		t.Fatalf("%x %v", uri, err)
	}
	reg, err := packRegister("https://scdo.com.au/agent-ledger/api/agents/0xabc/registration.json", "0x0000000000000000000000000000000000000001")
	if err != nil || common.Bytes2Hex(reg[:4]) != "8ea42286" {
		t.Fatalf("%x %v", reg, err)
	}
	xfer, err := packTransfer("0x0000000000000000000000000000000000000002", "0x0000000000000000000000000000000000000001", big.NewInt(4))
	if err != nil || common.Bytes2Hex(xfer[:4]) != "42842e0e" {
		t.Fatalf("%x %v", xfer, err)
	}
}

func TestSponsoredRegisterTransfersToTheAgent(t *testing.T) {
	agentKey, err := ledger.Generate()
	if err != nil {
		t.Fatal(err)
	}
	agentAddr := agentKey.Address()
	store := keys.Store{Dir: t.TempDir()}
	if _, err := store.Create("ledger", nil); err != nil {
		t.Fatal(err)
	}
	path, err := store.Path("ledger")
	if err != nil {
		t.Fatal(err)
	}
	sponsor, err := keys.OpenFile(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := keys.OpenFile(path, nil); err == nil {
		t.Fatal("mode 0644 key file was accepted")
	}
	sponsorAddr := sponsor.Address()
	if strings.EqualFold(sponsorAddr, agentAddr) {
		t.Fatal("sponsor and agent collided")
	}
	scalar := sponsor.Scalar()
	secret := common.Bytes2Hex(scalar)
	ledger.Wipe(scalar)

	var bodies []string
	var sent int
	const agentID = "7"
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
			write([]any{})
		case "eth_call":
			var call struct {
				Data string `json:"data"`
			}
			_ = json.Unmarshal(req.Params[0], &call)
			if strings.HasPrefix(call.Data, "0x6352211e") {
				who := sponsorAddr
				if sent >= 2 {
					who = agentAddr
				}
				write("0x" + common.Bytes2Hex(common.LeftPadBytes(common.HexToAddress(who).Bytes(), 32)))
				return
			}
			t.Fatalf("unexpected call %s", call.Data)
		case "eth_getBalance":
			write("0xde0b6b3a7640000")
		case "eth_getTransactionCount":
			if sent == 0 {
				write("0x0")
			} else {
				write("0x1")
			}
		case "eth_gasPrice":
			write("0x3b9aca00")
		case "eth_estimateGas":
			write("0x30d40")
		case "eth_sendRawTransaction":
			var raw string
			_ = json.Unmarshal(req.Params[0], &raw)
			tx := new(types.Transaction)
			if err := tx.UnmarshalBinary(common.FromHex(raw)); err != nil {
				t.Fatal(err)
			}
			from, err := types.Sender(types.NewEIP155Signer(big.NewInt(ChainID)), tx)
			if err != nil || !strings.EqualFold(from.Hex(), sponsorAddr) || strings.EqualFold(from.Hex(), agentAddr) {
				t.Fatalf("sender %s", from.Hex())
			}
			sel := common.Bytes2Hex(tx.Data()[:4])
			blob := string(tx.Data())
			switch sent {
			case 0:
				if sel != "f2c298be" || !strings.Contains(blob, AgentURI(agentAddr)) {
					t.Fatalf("register selector %s", sel)
				}
			case 1:
				if sel != "42842e0e" {
					t.Fatalf("transfer selector %s", sel)
				}
				hexData := strings.ToLower(common.Bytes2Hex(tx.Data()))
				if !strings.Contains(hexData, strings.ToLower(strings.TrimPrefix(sponsorAddr, "0x"))) || !strings.Contains(hexData, strings.ToLower(strings.TrimPrefix(agentAddr, "0x"))) {
					t.Fatal("transfer calldata")
				}
			default:
				t.Fatalf("extra transaction %d", sent)
			}
			sent++
			write("0x" + strings.Repeat("cd", 32))
		case "eth_getTransactionReceipt":
			logs := []any{}
			if sent == 1 {
				logs = []any{regLog(agentID, sponsorAddr, "0x"+strings.Repeat("cd", 32))}
			}
			write(map[string]any{"status": "0x1", "logs": logs})
		default:
			t.Fatalf("unexpected %s", req.Method)
		}
	}))
	defer srv.Close()
	dir := t.TempDir()
	opt := Options{Sponsor: sponsor, Agent: agentAddr, Dir: dir, Client: &rpc{URLs: []string{srv.URL}}}
	got, err := Register(context.Background(), opt)
	if err != nil {
		t.Fatal(err)
	}
	if got.Already || got.AgentID != agentID || got.Address != agentAddr || sent != 2 {
		t.Fatalf("%+v sent %d", got, sent)
	}
	raw, err := os.ReadFile(dir + "/erc8004.json")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), secret) || strings.Contains(strings.Join(bodies, "\n"), secret) {
		t.Fatal("sponsor key was logged")
	}
	again, err := Register(context.Background(), opt)
	if err != nil {
		t.Fatal(err)
	}
	if !again.Already || again.AgentID != agentID || sent != 2 {
		t.Fatalf("again %+v sent %d", again, sent)
	}
}

func TestTransferredIdentityIsNotMintedAgain(t *testing.T) {
	key, err := ledger.Generate()
	if err != nil {
		t.Fatal(err)
	}
	address := key.Address()
	var sent int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
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
			write([]any{transferLog("28", "0x0000000000000000000000000000000000000002", address, "0x"+strings.Repeat("ab", 32))})
		case "eth_call":
			var call struct {
				Data string `json:"data"`
			}
			_ = json.Unmarshal(req.Params[0], &call)
			if strings.HasPrefix(call.Data, "0x6352211e") {
				write("0x" + common.Bytes2Hex(common.LeftPadBytes(common.HexToAddress(address).Bytes(), 32)))
				return
			}
			t.Fatalf("call %s", call.Data)
		case "eth_sendRawTransaction":
			sent++
			t.Fatal("minted a second identity")
		default:
			t.Fatalf("unexpected %s", req.Method)
		}
	}))
	defer srv.Close()
	got, err := Register(context.Background(), Options{Key: key, Dir: t.TempDir(), Client: &rpc{URLs: []string{srv.URL}}})
	if err != nil {
		t.Fatal(err)
	}
	if !got.Already || got.AgentID != "28" || sent != 0 {
		t.Fatalf("%+v sent %d", got, sent)
	}
}

func TestLiveAgent28Owner(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	node, err := (&rpc{URLs: DefaultRPCs()}).dial(ctx)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := node.ownerOf(ctx, big.NewInt(28))
	if err != nil {
		t.Fatal(err)
	}
	const want = "0x6379C88ef7E28ebefC91fC53A91B2C7bcc101B7c"
	if !strings.EqualFold(owner, want) {
		t.Fatalf("ownerOf(28) = %s", owner)
	}
}

func transferLog(id, from, to, tx string) map[string]any {
	n := new(big.Int)
	n.SetString(id, 10)
	return map[string]any{
		"topics": []string{
			transferTopic.Hex(),
			topicAddress(from),
			topicAddress(to),
			common.BigToHash(n).Hex(),
		},
		"transactionHash": tx,
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
