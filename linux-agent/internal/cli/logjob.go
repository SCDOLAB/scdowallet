package cli

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/buildinfo"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/i18n"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/keys"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

var (
	jobStatuses = map[string]bool{"placed": true, "ready": true, "failed": true, "refunded": true, "credited": true}
	reTxHash    = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)
	reAmount    = regexp.MustCompile(`^\d+(\.\d{1,18})?$`)
	reCurrency  = regexp.MustCompile(`^[A-Za-z0-9]{1,12}$`)
)

// JobBody validates log-job flags into the signed body (same rules as the ledger).
func JobBody(jobID, status, gpuType, provider, providerHash string, duration int64, amount, currency, evidence, note string) (map[string]any, error) {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" || len(jobID) > 128 {
		return nil, fmt.Errorf("--job-id is required (1-128 characters)")
	}
	if !jobStatuses[status] {
		return nil, fmt.Errorf("--status must be one of placed, ready, failed, refunded, credited")
	}
	body := map[string]any{"job_id": jobID, "status": status}
	if gpuType != "" {
		if len(gpuType) > 64 {
			return nil, fmt.Errorf("--gpu-type is longer than 64 characters")
		}
		body["gpu_type"] = gpuType
	}
	if provider != "" && providerHash != "" {
		return nil, fmt.Errorf("use --provider or --provider-hash, not both")
	}
	if providerHash != "" {
		sum := sha256.Sum256([]byte(providerHash))
		body["provider"] = "sha256:" + hex.EncodeToString(sum[:])
	} else if provider != "" {
		if len(provider) > 128 {
			return nil, fmt.Errorf("--provider is longer than 128 characters")
		}
		body["provider"] = provider
	}
	if duration >= 0 {
		body["duration_s"] = duration
	}
	if amount != "" {
		if !reAmount.MatchString(amount) {
			return nil, fmt.Errorf("--amount must be a decimal such as 0.42")
		}
		body["amount"] = amount
	}
	if currency != "" {
		if !reCurrency.MatchString(currency) {
			return nil, fmt.Errorf("--currency must be letters/digits, e.g. USDC")
		}
		body["currency"] = currency
	}
	if evidence != "" {
		if !reTxHash.MatchString(evidence) {
			return nil, fmt.Errorf("--evidence-tx must be 0x + 64 hex characters")
		}
		body["evidence_tx"] = strings.ToLower(evidence)
	}
	if note != "" {
		if len(note) > 500 {
			return nil, fmt.Errorf("--note is longer than 500 characters")
		}
		body["note"] = note
	}
	return body, nil
}

func cmdLogJob(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("log-job", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	jobID := fs.String("job-id", "", "")
	status := fs.String("status", "", "")
	gpuType := fs.String("gpu-type", "", "")
	provider := fs.String("provider", "", "")
	providerHash := fs.String("provider-hash", "", "")
	duration := fs.Int64("duration-s", -1, "")
	amount := fs.String("amount", "", "")
	currency := fs.String("currency", "", "")
	evidence := fs.String("evidence-tx", "", "")
	note := fs.String("note", "", "")
	ledgerURL := fs.String("ledger", "", "")
	passFile := fs.String("passphrase-file", "", "")
	asJSON := fs.Bool("json", false, "")
	if err := fs.Parse(args); err != nil || strings.TrimSpace(*name) == "" {
		fmt.Fprintln(stderr, "usage: scdo-agent log-job --name NAME --job-id ID --status placed|ready|failed|refunded|credited [--gpu-type T] [--provider P | --provider-hash P] [--duration-s N] [--amount A --currency C] [--evidence-tx 0x...] [--note TEXT]")
		return 2
	}
	body, err := JobBody(*jobID, *status, *gpuType, *provider, *providerHash, *duration, *amount, *currency, *evidence, *note)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 2
	}
	lay, err := agent.Open(root, *name)
	if err != nil {
		fmt.Fprintf(stderr, b.T("notInit")+"\n", *name)
		return 1
	}
	pass, err := passphrase(*passFile)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	defer ledger.Wipe(pass)
	key, err := lay.OpenKey(pass)
	if errors.Is(err, keys.ErrPassphrase) {
		fmt.Fprintln(stderr, b.T("passFile"))
		return 1
	}
	if err != nil {
		fmt.Fprintln(stderr, "key file could not be read")
		return 1
	}
	urls, err := ledger.ResolveURLs(first(*ledgerURL, os.Getenv("SCDO_AGENT_LEDGER")))
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	client := &ledger.Client{URLs: urls, Agent: "scdo-agent/" + buildinfo.Version}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var res ledger.Result
	// The background agent shares the seq counter; a replay (409) means it signed the same seq first: take the next one.
	for attempt := 0; attempt < 4; attempt++ {
		seq, err := lay.NextSeq()
		if err != nil {
			fmt.Fprintln(stderr, err.Error())
			return 1
		}
		env, _, err := ledger.Sign(key, "job", seq, body, time.Now().UnixMilli())
		if err != nil {
			fmt.Fprintln(stderr, err.Error())
			return 1
		}
		res, err = client.Post(ctx, "job", env)
		if err == nil && res.OK {
			break
		}
		if res.Status == 409 && strings.Contains(res.Error, "replay") {
			continue
		}
		msg := "ledger unreachable"
		if res.Error != "" {
			msg = res.Error
		} else if err != nil {
			msg = err.Error()
		}
		if d, ok := res.Body["detail"].(string); ok && d != "" {
			msg += ": " + d
		}
		fmt.Fprintln(stderr, "log-job failed: "+msg)
		return 1
	}
	if !res.OK {
		fmt.Fprintln(stderr, "log-job failed: replay")
		return 1
	}
	addr := lay.Meta.Address
	public := "https://scdo.com.au/agent-ledger/api/agents/" + addr + "/jobs"
	if *asJSON {
		out := map[string]any{"ok": true, "agent": addr, "seq": res.Body["seq"], "job": res.Body["job"], "publicUrl": public,
			"page": "https://scdo.com.au/agent-ledger/?agent=" + addr}
		enc := json.NewEncoder(stdout)
		_ = enc.Encode(out)
		return 0
	}
	fmt.Fprintf(stdout, "Logged job %s (%s), signed by agent %s\n", body["job_id"], body["status"], addr)
	if j, ok := res.Body["job"].(map[string]any); ok {
		if ev, ok := j["evidence"].(map[string]any); ok && ev != nil {
			fmt.Fprintf(stdout, "Evidence: %v on Base (%v)\n", ev["explorer"], ev["status"])
		}
	}
	fmt.Fprintf(stdout, "Public record: %s\n", public)
	fmt.Fprintf(stdout, "Ledger page:   https://scdo.com.au/agent-ledger/?agent=%s\n", addr)
	return 0
}
