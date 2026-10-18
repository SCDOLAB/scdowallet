package ledger

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestCanonicalDesktop(t *testing.T) {
	got, err := Canonical(map[string]any{
		"b": 1,
		"a": []any{2, map[string]any{"d": 1, "c": nil}},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"a":[2,{"c":null,"d":1}],"b":1}`
	if got != want {
		t.Fatalf("canonical mismatch\n got %s\nwant %s", got, want)
	}

	got, err = Canonical(map[string]any{"z": "華語", "a": "line\n\t\"\\"})
	if err != nil {
		t.Fatal(err)
	}
	want = `{"a":"line\n\t\"\\","z":"華語"}`
	if got != want {
		t.Fatalf("escape mismatch\n got %s\nwant %s", got, want)
	}

	got, err = Canonical(map[string]any{"n": nil, "t": true, "f": false, "s": ""})
	if err != nil {
		t.Fatal(err)
	}
	if got != `{"f":false,"n":null,"s":"","t":true}` {
		t.Fatal(got)
	}
	got, err = Canonical([]any{1, nil, nil})
	if err != nil {
		t.Fatal(err)
	}
	if got != `[1,null,null]` {
		t.Fatal(got)
	}
	got, err = Canonical(map[string]any{"nested": map[string]any{"m": 2, "a": 1}})
	if err != nil {
		t.Fatal(err)
	}
	if got != `{"nested":{"a":1,"m":2}}` {
		t.Fatal(got)
	}
	got, err = Canonical(1.5)
	if err != nil || got != "1.5" {
		t.Fatalf("%s %v", got, err)
	}
	got, err = Canonical(map[string]any{"only": 1})
	if err != nil || got != `{"only":1}` {
		t.Fatal(got)
	}
}

type vectorFile struct {
	PrivateKey string `json:"privateKey"`
	Address    string `json:"address"`
	Cases      []struct {
		Name    string         `json:"name"`
		Type    string         `json:"type"`
		Seq     int64          `json:"seq"`
		TS      int64          `json:"ts"`
		Body    map[string]any `json:"body"`
		Message string         `json:"message"`
		Sig     string         `json:"sig"`
	} `json:"cases"`
}

func TestSignMatchesDesktop(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "vector.json"))
	if err != nil {
		t.Fatal(err)
	}
	var vec vectorFile
	if err := json.Unmarshal(raw, &vec); err != nil {
		t.Fatal(err)
	}
	key, err := KeyFromHex(vec.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	if key.Address() != vec.Address {
		t.Fatalf("address %s want %s", key.Address(), vec.Address)
	}
	for _, tc := range vec.Cases {
		tc := tc
		t.Run(tc.Name, func(t *testing.T) {
			body := jsonMap(tc.Body)
			env, msg, err := Sign(key, tc.Type, tc.Seq, body, tc.TS)
			if err != nil {
				t.Fatal(err)
			}
			if msg != tc.Message {
				t.Fatalf("message\n got %s\nwant %s", msg, tc.Message)
			}
			if env.Sig != tc.Sig {
				t.Fatalf("sig\n got %s\nwant %s", env.Sig, tc.Sig)
			}
			if env.Payload.Agent != vec.Address || env.Payload.ChainID != ChainID || env.Payload.V != Version {
				t.Fatalf("payload %+v", env.Payload)
			}
		})
	}
}

// jsonMap converts numbers that encoding/json stored as float64 back to int
// when they are whole, so canonical integer formatting matches the desktop.
func jsonMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = jsonVal(v)
	}
	return out
}

func TestWalletProofMatchesLedger(t *testing.T) {
	const agent = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
	msg, err := WalletProofMessage(agent, nil, "eip155:8453", "n1")
	if err != nil {
		t.Fatal(err)
	}
	want := "SCDO Agent Ledger v1\n" + `{"agent":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","botId":null,"network":"eip155:8453","nonce":"n1","type":"wallet-proof"}`
	if msg != want {
		t.Fatalf("null botId\n got %q\nwant %q", msg, want)
	}
	key, err := KeyFromHex("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
	if err != nil {
		t.Fatal(err)
	}
	_, sig, err := WalletProof(key, agent, nil, "eip155:8453", "n1")
	if err != nil {
		t.Fatal(err)
	}
	if sig != "0xeb3afdc38f3cb798edef9638e6bd4b2add7021bc87b96d7e0593ac50866cc9e814b458ba995dc5bec7a59b83e18f117f29fe78c3de394a5866a4b332bf7a949f1c" {
		t.Fatal(sig)
	}
	bot := "m1-bot"
	_, sig, err = WalletProof(key, agent, &bot, "eip155:84532", "n1")
	if err != nil {
		t.Fatal(err)
	}
	if sig != "0x2be35a051c21d422e6a9b867c1b45faaebaf69d35d53d191b945a85c5ba04cde3dfd08f5286a722970a287692951eeb2b68a51d5c2e2a8c54f845ab205e9b6161c" {
		t.Fatal(sig)
	}
}

func jsonVal(v any) any {
	switch t := v.(type) {
	case float64:
		if t == float64(int64(t)) {
			return int64(t)
		}
		return t
	case map[string]any:
		return jsonMap(t)
	case []any:
		arr := make([]any, len(t))
		for i, el := range t {
			arr[i] = jsonVal(el)
		}
		return arr
	default:
		return v
	}
}
