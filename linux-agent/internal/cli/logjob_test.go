package cli

import (
	"strings"
	"testing"
)

func TestJobBody(t *testing.T) {
	b, err := JobBody(JobOpts{JobID: "j-1", Status: "refunded", ServiceType: "api", ProviderHash: "acme", DurationS: 42, LatencyMS: 830,
		ErrorClass: "timeout", Amount: "0.5", Currency: "USDC", RefundAmount: "0.5", PaymentTx: "0x" + strings.Repeat("AB", 32), Note: "refund"})
	if err != nil {
		t.Fatal(err)
	}
	if b["status"] != "refunded" || b["service_type"] != "api" || b["latency_ms"] != int64(830) || b["refund_amount"] != "0.5" ||
		b["payment_tx"] != "0x"+strings.Repeat("ab", 32) || !strings.HasPrefix(b["provider"].(string), "sha256:") {
		t.Fatal(b)
	}
	for _, s := range []string{"started", "succeeded", "placed", "ready", "failed", "credited"} {
		if _, err := JobBody(JobOpts{JobID: "j", Status: s, DurationS: -1, LatencyMS: -1}); err != nil {
			t.Fatal(s, err)
		}
	}
	if _, err := JobBody(JobOpts{JobID: "j", Status: "done", DurationS: -1, LatencyMS: -1}); err == nil {
		t.Fatal("bad status accepted")
	}
	if _, err := JobBody(JobOpts{JobID: "j", Status: "failed", RefundAmount: "x", DurationS: -1, LatencyMS: -1}); err == nil {
		t.Fatal("bad refund accepted")
	}
	b, _ = JobBody(JobOpts{JobID: "j", Status: "ready", DurationS: -1, LatencyMS: -1})
	if _, ok := b["latency_ms"]; ok {
		t.Fatal("latency set when absent")
	}
}
