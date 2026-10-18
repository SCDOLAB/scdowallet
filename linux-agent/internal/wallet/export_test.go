package wallet

import (
	"bytes"
	"os"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/keystore"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
)

func TestExportKeystoreAndRefuseRawOffTerminal(t *testing.T) {
	if defaultExportN != 1<<18 || defaultExportP != 1 {
		t.Fatalf("scrypt n=%d p=%d", defaultExportN, defaultExportP)
	}
	prevN, prevP := exportN, exportP
	exportN = keystore.LightScryptN
	exportP = keystore.LightScryptP
	t.Cleanup(func() {
		exportN = prevN
		exportP = prevP
	})

	root := t.TempDir()
	if _, err := agent.Create(root, "bot", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "TEST", agent.RoleLight, "", "test", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(t.Context(), CreateOptions{Root: root, Name: "bot", BotID: "bot", LedgerURLs: []string{mustLedger(t)}}); err != nil {
		t.Fatal(err)
	}
	if _, err := ExportKey(ExportRequest{Root: root, Name: "bot", Raw: true, Understand: true, TTY: false}); err == nil {
		t.Fatal("raw key left the terminal")
	}
	if _, err := os.Stat(root + "/bot/export-audit.log"); !os.IsNotExist(err) {
		t.Fatal("refused export wrote an audit line")
	}
	res, err := ExportKey(ExportRequest{Root: root, Name: "bot", ExportPass: []byte("export-secret"), OutPath: root + "/ks.json"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "keystore" || !bytes.Contains(res.JSON, []byte(`"n":4096`)) && !bytes.Contains(res.JSON, []byte(`"n": 4096`)) {
		// LightScryptN is 4096. Encoding has no spaces.
		if !bytes.Contains(res.JSON, []byte(`"n":4096`)) {
			t.Fatalf("keystore n: %s", res.JSON)
		}
	}
	if bytes.Contains(bytes.ToLower(res.JSON), []byte("private")) {
		t.Fatal("keystore json contains a private field name")
	}
	key, err := keystore.DecryptKey(res.JSON, "export-secret")
	if err != nil {
		t.Fatal(err)
	}
	defer zeroECDSA(key.PrivateKey)
	if !strings.EqualFold(key.Address.Hex(), res.Address) {
		t.Fatalf("address %s vs %s", key.Address.Hex(), res.Address)
	}
	audit, err := os.ReadFile(root + "/bot/export-audit.log")
	if err != nil || !bytes.Contains(audit, []byte("keystore")) || bytes.Contains(audit, key.PrivateKey.D.Bytes()) {
		t.Fatal("audit")
	}
	raw, err := ExportKey(ExportRequest{Root: root, Name: "bot", Raw: true, Understand: true, TTY: true})
	if err != nil || !strings.HasPrefix(string(raw.JSON), "0x") || len(raw.JSON) != 66 {
		t.Fatal(err, string(raw.JSON))
	}
	audit, _ = os.ReadFile(root + "/bot/export-audit.log")
	if bytes.Contains(audit, raw.JSON) || !bytes.Contains(audit, []byte("\traw\t")) {
		t.Fatal("raw key landed in the audit log")
	}
}

func mustLedger(t *testing.T) string {
	t.Helper()
	return stubLedger(t)
}
