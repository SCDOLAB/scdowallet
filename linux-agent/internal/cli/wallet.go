package cli

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/i18n"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/wallet"
)

func cmdWallet(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, b.T("usage"))
		return 2
	}
	sub, rest := args[0], args[1:]
	switch sub {
	case "create":
		return walletCreate(b, root, rest, stdout, stderr)
	case "pay":
		return walletPay(b, root, rest, stdout, stderr)
	case "export":
		return walletExport(b, root, rest, stdout, stderr)
	case "allow":
		return walletAllow(b, root, rest, stdout, stderr)
	case "kill", "unkill":
		return walletKill(b, root, rest, stdout, stderr, sub == "kill")
	case "record":
		return walletRecord(b, root, rest, stdout, stderr)
	default:
		fmt.Fprintln(stderr, b.T("usage"))
		return 2
	}
}

func walletCreate(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("wallet create", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	bot := fs.String("bot", "", "")
	max := fs.String("max", "", "")
	daily := fs.String("daily", "", "")
	payee := fs.String("payee", "", "")
	platform := fs.String("platform", "other", "")
	operator := fs.String("operator", "", "")
	ledgerURL := fs.String("ledger", "", "")
	passFile := fs.String("passphrase-file", "", "")
	if err := fs.Parse(args); err != nil || strings.TrimSpace(*name) == "" {
		fmt.Fprintln(stderr, b.T("needName"))
		return 2
	}
	if strings.TrimSpace(*bot) == "" {
		fmt.Fprintln(stderr, b.T("needBot"))
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
	var payees []string
	if strings.TrimSpace(*payee) != "" {
		payees = []string{strings.TrimSpace(*payee)}
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	created, err := wallet.Create(ctx, wallet.CreateOptions{
		Root: root, Name: *name, BotID: *bot, MaxAtomic: *max, Daily: *daily,
		Payees: payees, Platform: *platform, Operator: *operator,
		Passphrase: pass, LedgerURLs: urls,
	})
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	fmt.Fprintf(stdout, b.T("walletReady")+"\n", created.Wallet, created.BotID)
	fmt.Fprintf(stdout, b.T("address")+"\n", created.Agent)
	fmt.Fprintf(stdout, b.T("walletNetwork")+"\n", created.Network)
	fmt.Fprintf(stdout, b.T("walletLedger")+"\n", created.Ledger)
	return 0
}

func walletPay(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("wallet pay", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	ledgerURL := fs.String("ledger", "", "")
	passFile := fs.String("passphrase-file", "", "")
	if err := fs.Parse(args); err != nil || strings.TrimSpace(*name) == "" {
		fmt.Fprintln(stderr, b.T("needName"))
		return 2
	}
	if fs.NArg() != 1 {
		fmt.Fprintln(stderr, b.T("needURL"))
		return 2
	}
	return finishPay(b, root, *name, fs.Arg(0), *ledgerURL, *passFile, stdout, stderr, false)
}

func walletRecord(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("wallet record", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	ledgerURL := fs.String("ledger", "", "")
	passFile := fs.String("passphrase-file", "", "")
	if err := fs.Parse(args); err != nil || strings.TrimSpace(*name) == "" {
		fmt.Fprintln(stderr, b.T("needName"))
		return 2
	}
	return finishPay(b, root, *name, "", *ledgerURL, *passFile, stdout, stderr, true)
}

func finishPay(b i18n.Bundle, root, name, rawURL, ledgerURL, passFile string, stdout, stderr io.Writer, recordOnly bool) int {
	pass, err := passphrase(passFile)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	defer ledger.Wipe(pass)
	urls, err := ledger.ResolveURLs(ledgerURL)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	opt := wallet.PayOptions{Root: root, Name: name, URL: rawURL, Passphrase: pass, LedgerURLs: urls}
	var paid wallet.Paid
	if recordOnly {
		paid, err = wallet.Record(ctx, opt)
	} else {
		paid, err = wallet.Pay(ctx, opt)
	}
	if paid.Wallet != "" {
		fmt.Fprintf(stdout, b.T("walletBot")+"\n", paid.Wallet)
	}
	if paid.Tx != "" {
		fmt.Fprintf(stdout, b.T("walletTx")+"\n", paid.Tx)
	}
	if paid.Ledger != "" {
		fmt.Fprintf(stdout, b.T("walletLedger")+"\n", paid.Ledger)
	}
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	return 0
}

func walletExport(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("wallet export", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	if err := fs.Parse(args); err != nil || strings.TrimSpace(*name) == "" {
		fmt.Fprintln(stderr, b.T("needName"))
		return 2
	}
	doc, agentAddr, err := wallet.Export(root, *name)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	blob, err := json.MarshalIndent(map[string]any{
		"agent": agentAddr, "wallet": doc.Address, "botId": doc.BotID,
		"network": doc.Network, "maxAtomic": doc.MaxAtomic, "dailyAtomic": doc.DailyAtomic,
		"spentAtomic": doc.SpentAtomic, "payees": doc.Payees, "killed": doc.Killed,
	}, "", "  ")
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	fmt.Fprintln(stdout, string(blob))
	fmt.Fprintln(stdout, b.T("about"))
	return 0
}

func walletAllow(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("wallet allow", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	payee := fs.String("payee", "", "")
	if err := fs.Parse(args); err != nil || strings.TrimSpace(*name) == "" {
		fmt.Fprintln(stderr, b.T("needName"))
		return 2
	}
	if strings.TrimSpace(*payee) == "" {
		fmt.Fprintln(stderr, b.T("badPayout"))
		return 2
	}
	doc, err := wallet.AllowPayee(root, *name, *payee)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	fmt.Fprintf(stdout, "%s\n", strings.Join(doc.Payees, "\n"))
	return 0
}

func walletKill(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer, killed bool) int {
	fs := flag.NewFlagSet("wallet kill", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	ledgerURL := fs.String("ledger", "", "")
	passFile := fs.String("passphrase-file", "", "")
	if err := fs.Parse(args); err != nil || strings.TrimSpace(*name) == "" {
		fmt.Fprintln(stderr, b.T("needName"))
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
	if err := wallet.SetKilled(ctx, root, *name, pass, urls, killed, time.Now()); err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	if killed {
		fmt.Fprintln(stdout, b.T("walletKilled"))
	} else {
		fmt.Fprintln(stdout, b.T("walletUnkilled"))
	}
	return 0
}
