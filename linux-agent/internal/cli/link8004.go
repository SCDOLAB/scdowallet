package cli

import (
	"context"
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

var reAgentID = regexp.MustCompile(`^\d{1,30}$`)

func cmdLink8004(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("link-8004", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	id := fs.String("agent-id", "", "")
	ledgerURL := fs.String("ledger", "", "")
	passFile := fs.String("passphrase-file", "", "")
	if err := fs.Parse(args); err != nil || strings.TrimSpace(*name) == "" || !reAgentID.MatchString(*id) {
		fmt.Fprintln(stderr, "usage: scdo-agent link-8004 --name NAME --agent-id N")
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
	for attempt := 0; attempt < 4; attempt++ {
		seq, err := lay.NextSeq()
		if err != nil {
			fmt.Fprintln(stderr, err.Error())
			return 1
		}
		env, _, err := ledger.Sign(key, "erc8004link", seq, map[string]any{"agentId": *id}, time.Now().UnixMilli())
		if err != nil {
			fmt.Fprintln(stderr, err.Error())
			return 1
		}
		res, err = client.Post(ctx, "erc8004link", env)
		if err == nil && res.OK {
			break
		}
		if res.Status == 409 && strings.Contains(res.Error, "replay") {
			continue
		}
		msg := res.Error
		if msg == "" && err != nil {
			msg = err.Error()
		}
		if d, ok := res.Body["detail"].(string); ok && d != "" {
			msg += ": " + d
		}
		fmt.Fprintln(stderr, "link-8004 failed: "+msg)
		return 1
	}
	if !res.OK {
		fmt.Fprintln(stderr, "link-8004 failed: replay")
		return 1
	}
	fmt.Fprintf(stdout, "Linked ERC-8004 agentId %s (Base mainnet IdentityRegistry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) to agent %s\n", *id, lay.Meta.Address)
	fmt.Fprintf(stdout, "Ledger page: https://scdo.com.au/agent-ledger/?agent=%s\n", lay.Meta.Address)
	return 0
}
