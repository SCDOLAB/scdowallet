package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
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
	case "show":
		return walletShow(b, root, rest, stdout, stderr)
	case "limit":
		return walletLimit(b, root, rest, stdout, stderr)
	case "pay":
		return walletPay(b, root, rest, stdout, stderr)
	case "export":
		return walletExport(b, root, rest, stdout, stderr)
	case "allow":
		return walletAllow(b, root, rest, stdout, stderr)
	case "kill", "unkill", "freeze", "unfreeze":
		return walletKill(b, root, rest, stdout, stderr, sub == "kill" || sub == "freeze")
	case "record":
		return walletRecord(b, root, rest, stdout, stderr)
	default:
		fmt.Fprintln(stderr, b.T("usage"))
		return 2
	}
}

func cmdPay(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	return walletPay(b, root, args, stdout, stderr)
}

func cmdServePaywall(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("serve-paywall", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	bot := fs.String("bot", "", "")
	name := fs.String("name", "", "")
	price := fs.String("price", "", "")
	path := fs.String("path", "/answer", "")
	port := fs.Int("port", 8410, "")
	passFile := fs.String("passphrase-file", "", "")
	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(stderr, b.T("usage"))
		return 2
	}
	dirName, err := agentDir(*bot, *name)
	if err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	if strings.TrimSpace(*price) == "" {
		fmt.Fprintln(stderr, b.T("needPrice"))
		return 2
	}
	pass, err := passphrase(*passFile)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	defer ledger.Wipe(pass)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	fmt.Fprintf(stdout, b.T("paywallReady")+"\n", dirName, *price, *path, *port)
	err = wallet.ServePaywall(ctx, wallet.PaywallOptions{
		Root: root, Name: dirName, Price: *price, Path: *path,
		Addr: fmt.Sprintf(":%d", *port), Passphrase: pass,
	})
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	return 0
}

func walletCreate(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("wallet create", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	bot := fs.String("bot", "", "")
	email := fs.String("email", "", "")
	max := fs.String("max", "", "")
	daily := fs.String("daily", "", "")
	payee := fs.String("payee", "", "")
	platform := fs.String("platform", "other", "")
	operator := fs.String("operator", "", "")
	ledgerURL := fs.String("ledger", "", "")
	passFile := fs.String("passphrase-file", "", "")
	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	dirName, botID, err := agentRef(*bot, *name)
	if err != nil {
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
		Root: root, Name: dirName, BotID: botID, Email: *email, MaxAtomic: *max, Daily: *daily,
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
	if created.EmailCommit != "" {
		fmt.Fprintf(stdout, b.T("walletEmail")+"\n", created.EmailCommit)
	}
	fmt.Fprintf(stdout, b.T("walletLedger")+"\n", created.Ledger)
	fmt.Fprintln(stdout, b.T("walletKeys"))
	return 0
}

func walletShow(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("wallet show", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	bot := fs.String("bot", "", "")
	name := fs.String("name", "", "")
	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	dirName, err := agentDir(*bot, *name)
	if err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	view, err := wallet.Show(root, dirName)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	fmt.Fprintf(stdout, b.T("walletBotLine")+"\n", view.Doc.BotID)
	fmt.Fprintf(stdout, b.T("walletBot")+"\n", view.Doc.Address)
	fmt.Fprintf(stdout, b.T("address")+"\n", view.Agent)
	fmt.Fprintf(stdout, b.T("walletNetwork")+"\n", view.Doc.Network)
	if view.Doc.EmailCommit != "" {
		fmt.Fprintf(stdout, b.T("walletEmail")+"\n", view.Doc.EmailCommit)
	}
	fmt.Fprintf(stdout, b.T("walletPer")+"\n", view.MaxDisplay)
	fmt.Fprintf(stdout, b.T("walletDaily")+"\n", view.DailyDisplay)
	fmt.Fprintf(stdout, b.T("walletSpent")+"\n", view.SpentDisplay)
	if len(view.Doc.Payees) == 0 {
		fmt.Fprintln(stdout, b.T("walletAnyPayee"))
	} else {
		fmt.Fprintf(stdout, b.T("walletPayees")+"\n", strings.Join(view.Doc.Payees, ", "))
	}
	if len(view.Doc.Domains) == 0 {
		fmt.Fprintln(stdout, b.T("walletAnyDomain"))
	} else {
		fmt.Fprintf(stdout, b.T("walletDomains")+"\n", strings.Join(view.Doc.Domains, ", "))
	}
	if view.Doc.Killed {
		fmt.Fprintln(stdout, b.T("walletKillOn"))
	} else {
		fmt.Fprintln(stdout, b.T("walletKillOff"))
	}
	fmt.Fprintln(stdout, b.T("walletKeys"))
	return 0
}

func walletLimit(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("wallet limit", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	bot := fs.String("bot", "", "")
	name := fs.String("name", "", "")
	per := fs.String("per-payment", "", "")
	daily := fs.String("daily", "", "")
	var domains stringList
	var payees stringList
	fs.Var(&domains, "allow-domain", "")
	fs.Var(&payees, "allow-payto", "")
	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	dirName, err := agentDir(*bot, *name)
	if err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	if *per == "" && *daily == "" && len(domains) == 0 && len(payees) == 0 {
		fmt.Fprintln(stderr, b.T("needLimit"))
		return 2
	}
	doc, err := wallet.ApplyLimit(root, dirName, wallet.LimitUpdate{
		PerPayment: *per, Daily: *daily, Payees: payees, Domains: domains,
	})
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	fmt.Fprintf(stdout, b.T("walletPer")+"\n", wallet.FormatUSDC(doc.MaxAtomic))
	fmt.Fprintf(stdout, b.T("walletDaily")+"\n", wallet.FormatUSDC(doc.DailyAtomic))
	if len(doc.Payees) > 0 {
		fmt.Fprintf(stdout, b.T("walletPayees")+"\n", strings.Join(doc.Payees, ", "))
	}
	if len(doc.Domains) > 0 {
		fmt.Fprintf(stdout, b.T("walletDomains")+"\n", strings.Join(doc.Domains, ", "))
	}
	return 0
}

func walletPay(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("pay", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	bot := fs.String("bot", "", "")
	max := fs.String("max", "", "")
	dry := fs.Bool("dry-run", false, "")
	ledgerURL := fs.String("ledger", "", "")
	passFile := fs.String("passphrase-file", "", "")
	if err := fs.Parse(hoistPositionals(args, map[string]bool{
		"name": true, "bot": true, "max": true, "ledger": true, "passphrase-file": true,
	})); err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	dirName, err := agentDir(*bot, *name)
	if err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	if fs.NArg() != 1 {
		fmt.Fprintln(stderr, b.T("needURL"))
		return 2
	}
	atomic := ""
	if strings.TrimSpace(*max) != "" {
		atomic, err = wallet.ParseUSDC(*max)
		if err != nil {
			fmt.Fprintln(stderr, err.Error())
			return 2
		}
	}
	return finishPay(b, root, dirName, fs.Arg(0), atomic, *dry, *ledgerURL, *passFile, stdout, stderr, false)
}

func walletRecord(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("wallet record", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	bot := fs.String("bot", "", "")
	ledgerURL := fs.String("ledger", "", "")
	passFile := fs.String("passphrase-file", "", "")
	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	dirName, err := agentDir(*bot, *name)
	if err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	return finishPay(b, root, dirName, "", "", false, *ledgerURL, *passFile, stdout, stderr, true)
}

func finishPay(b i18n.Bundle, root, name, rawURL, maxAtomic string, dry bool, ledgerURL, passFile string, stdout, stderr io.Writer, recordOnly bool) int {
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
	opt := wallet.PayOptions{
		Root: root, Name: name, URL: rawURL, MaxAtomic: maxAtomic, DryRun: dry,
		Passphrase: pass, LedgerURLs: urls,
	}
	var paid wallet.Paid
	if recordOnly {
		paid, err = wallet.Record(ctx, opt)
	} else if dry {
		paid, err = wallet.Preview(ctx, opt)
	} else {
		paid, err = wallet.Pay(ctx, opt)
	}
	if dry && err == nil {
		fmt.Fprintf(stdout, b.T("payDry")+"\n", paid.Amount, paid.PayTo)
		return 0
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
		if errors.Is(err, wallet.ErrPolicy) {
			fmt.Fprintln(stderr, b.T("limitBlocked"))
			fmt.Fprintln(stderr, err.Error())
			return 3
		}
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	return 0
}

func walletExport(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("wallet export", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	bot := fs.String("bot", "", "")
	outPath := fs.String("out", "", "")
	raw := fs.Bool("raw", false, "")
	understandRaw := fs.Bool("i-understand-raw-key", false, "")
	understandSpec := fs.Bool("i-understand-this-reveals-the-key", false, "")
	passFile := fs.String("passphrase-file", "", "")
	exportPass := fs.String("export-passphrase-file", "", "")
	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	dirName, err := agentDir(*bot, *name)
	if err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	pass, err := passphrase(*passFile)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	defer ledger.Wipe(pass)
	var exp []byte
	if !*raw {
		exp, err = passphrase(*exportPass)
		if err != nil {
			fmt.Fprintln(stderr, err.Error())
			return 1
		}
		if len(exp) == 0 {
			fmt.Fprintln(stderr, b.T("needExportPass"))
			return 2
		}
	}
	defer ledger.Wipe(exp)
	res, err := wallet.ExportKey(wallet.ExportRequest{
		Root: root, Name: dirName, Passphrase: pass, ExportPass: exp,
		Raw: *raw, Understand: *understandRaw || *understandSpec, TTY: isTerminal(stdout),
		OutPath: *outPath,
	})
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	if res.Kind == "raw" {
		fmt.Fprintln(stdout, string(res.JSON))
		fmt.Fprintln(stderr, b.T("walletKeys"))
		return 0
	}
	if *outPath == "" {
		fmt.Fprintln(stdout, string(res.JSON))
	} else {
		fmt.Fprintf(stdout, b.T("exportWrote")+"\n", *outPath)
	}
	fmt.Fprintln(stderr, b.T("walletKeys"))
	return 0
}

func walletAllow(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("wallet allow", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	bot := fs.String("bot", "", "")
	payee := fs.String("payee", "", "")
	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	dirName, err := agentDir(*bot, *name)
	if err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	if strings.TrimSpace(*payee) == "" {
		fmt.Fprintln(stderr, b.T("badPayout"))
		return 2
	}
	doc, err := wallet.AllowPayee(root, dirName, *payee)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	fmt.Fprintf(stdout, "%s\n", strings.Join(doc.Payees, "\n"))
	return 0
}

func walletKill(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer, killed bool) int {
	fs := flag.NewFlagSet("wallet freeze", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	bot := fs.String("bot", "", "")
	ledgerURL := fs.String("ledger", "", "")
	passFile := fs.String("passphrase-file", "", "")
	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(stderr, b.T("needBot"))
		return 2
	}
	dirName, err := agentDir(*bot, *name)
	if err != nil {
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
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := wallet.SetKilled(ctx, root, dirName, pass, urls, killed, time.Now()); err != nil {
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

func agentRef(bot, name string) (string, string, error) {
	bot = strings.TrimSpace(bot)
	name = strings.TrimSpace(name)
	if bot == "" && name == "" {
		return "", "", fmt.Errorf("bot")
	}
	if name == "" {
		name = bot
	}
	if bot == "" {
		bot = name
	}
	if err := agent.ValidateName(name); err != nil {
		return "", "", err
	}
	return name, bot, nil
}

func agentDir(bot, name string) (string, error) {
	name, _, err := agentRef(bot, name)
	return name, err
}

type stringList []string

func (s *stringList) String() string { return strings.Join(*s, ",") }

func (s *stringList) Set(v string) error {
	v = strings.TrimSpace(v)
	if v == "" {
		return fmt.Errorf("empty")
	}
	*s = append(*s, v)
	return nil
}

func hoistPositionals(args []string, valueFlags map[string]bool) []string {
	var flags, pos []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			pos = append(pos, args[i+1:]...)
			break
		}
		if strings.HasPrefix(a, "-") && a != "-" {
			flags = append(flags, a)
			name := strings.TrimLeft(a, "-")
			if eq := strings.IndexByte(name, '='); eq >= 0 {
				continue
			}
			if valueFlags[name] && i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
				i++
				flags = append(flags, args[i])
			}
			continue
		}
		pos = append(pos, a)
	}
	return append(flags, pos...)
}

func isTerminal(w io.Writer) bool {
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	fi, err := f.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}
