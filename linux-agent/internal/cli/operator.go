package cli

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os/signal"
	"syscall"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/i18n"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/wallet"
)

func cmdOperator(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] != "batch" {
		fmt.Fprintln(stderr, b.T("usage"))
		return 2
	}
	fs := flag.NewFlagSet("operator batch", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	var bots stringList
	fs.Var(&bots, "bot", "")
	ledgerURL := fs.String("ledger", "", "")
	passFile := fs.String("passphrase-file", "", "")
	if err := fs.Parse(args[1:]); err != nil {
		fmt.Fprintln(stderr, b.T("needBatch"))
		return 2
	}
	if *name == "" || len(bots) == 0 {
		fmt.Fprintln(stderr, b.T("needBatch"))
		return 2
	}
	pass, err := passphrase(*passFile)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	defer ledger.Wipe(pass)
	urls, err := ledger.ResolveURLs(*ledgerURL)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	res, err := wallet.ConfirmBatch(ctx, wallet.BatchOptions{
		Root: root, Name: *name, Bots: bots, Passphrase: pass, LedgerURLs: urls,
	})
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	fmt.Fprintf(stdout, b.T("batchReady")+"\n", len(bots))
	if res.Ledger != "" {
		fmt.Fprintf(stdout, b.T("walletLedger")+"\n", res.Ledger)
	}
	return 0
}
