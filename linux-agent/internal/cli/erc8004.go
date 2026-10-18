package cli

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os/signal"
	"strings"
	"syscall"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/erc8004"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/i18n"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/keys"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

func cmdERC8004(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] != "register" {
		fmt.Fprintln(stderr, b.T("usage"))
		return 2
	}
	fs := flag.NewFlagSet("erc8004 register", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	rpcFlag := fs.String("rpc", "", "")
	passFile := fs.String("passphrase-file", "", "")
	if err := fs.Parse(args[1:]); err != nil || strings.TrimSpace(*name) == "" {
		fmt.Fprintln(stderr, b.T("needName"))
		return 2
	}
	return registerERC8004(b, root, *name, *rpcFlag, *passFile, stdout, stderr)
}

func registerERC8004(b i18n.Bundle, root, name, rpcFlag, passFile string, stdout, stderr io.Writer) int {
	lay, err := agent.Open(root, name)
	if err != nil {
		fmt.Fprintf(stderr, b.T("notInit")+"\n", name)
		return 1
	}
	pass, err := passphrase(passFile)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	defer ledger.Wipe(pass)
	key, err := lay.OpenKey(pass)
	if err != nil {
		if err == keys.ErrPassphrase {
			fmt.Fprintln(stderr, b.T("passFile"))
			return 1
		}
		fmt.Fprintln(stderr, "key file could not be read")
		return 1
	}
	defer ledger.Wipe(key.Scalar())
	var rpcs []string
	if strings.TrimSpace(rpcFlag) != "" {
		one, err := erc8004.SanitizeRPC(rpcFlag)
		if err != nil {
			fmt.Fprintln(stderr, err.Error())
			return 1
		}
		rpcs = []string{one}
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	res, err := erc8004.Register(ctx, erc8004.Options{Key: key, Dir: lay.Dir, RPCs: rpcs})
	if res.AgentID != "" {
		fmt.Fprintf(stdout, b.T("erc8004ID")+"\n", res.AgentID)
	}
	if res.URI != "" {
		fmt.Fprintf(stdout, b.T("erc8004URI")+"\n", res.URI)
	}
	if res.Tx != "" {
		fmt.Fprintf(stdout, b.T("erc8004Tx")+"\n", res.Tx)
	}
	if err != nil {
		fmt.Fprintln(stderr, agent.Scrub(err.Error()))
		return 1
	}
	if res.Already {
		fmt.Fprintf(stdout, b.T("erc8004Already")+"\n", res.Address)
		return 0
	}
	fmt.Fprintf(stdout, b.T("erc8004Ready")+"\n", res.Address)
	return 0
}
