package cli

import (
	"strings"
	"testing"
)

func TestJobBody(t *testing.T) {
	b, err := JobBody("j-1", "credited", "H100", "", "acme", 42, "0.5", "USDC", "0x"+strings.Repeat("ab", 32), "refund")
	if err != nil {
		t.Fatal(err)
	}
	if b["status"] != "credited" || b["duration_s"] != int64(42) || !strings.HasPrefix(b["provider"].(string), "sha256:") {
		t.Fatal(b)
	}
	if _, err := JobBody("j", "done", "", "", "", -1, "", "", "", ""); err == nil {
		t.Fatal("bad status accepted")
	}
	if _, err := JobBody("", "ready", "", "", "", -1, "", "", "", ""); err == nil {
		t.Fatal("empty job id accepted")
	}
	if _, err := JobBody("j", "ready", "", "", "", -1, "", "", "0x12", ""); err == nil {
		t.Fatal("bad tx accepted")
	}
	b, _ = JobBody("j", "ready", "", "", "", -1, "", "", "", "")
	if _, ok := b["duration_s"]; ok {
		t.Fatal("duration set when absent")
	}
}
