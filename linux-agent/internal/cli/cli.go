// Package cli is the scdo-agent command line.
// Commands are a flat map so a later group (for example wallet) can be registered
// beside init/run/status without changing the ledger path.
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
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/buildinfo"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/erc8004"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/gpu"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/i18n"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/installmode"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/keys"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

// Main runs the CLI and returns the process exit code.
func Main(args []string, stdout, stderr io.Writer) int {
	global := flag.NewFlagSet("scdo-agent", flag.ContinueOnError)
	global.SetOutput(io.Discard)
	langFlag := global.String("lang", "", "en or zh")
	dataFlag := global.String("data-dir", "", "agent data root")
	showVersion := global.Bool("version", false, "print version")
	showV := global.Bool("v", false, "print version")
	global.Usage = func() {}
	if err := global.Parse(args); err != nil {
		if err == flag.ErrHelp {
			fmt.Fprint(stdout, i18n.New(i18n.Detect("", os.Getenv("LC_ALL"), os.Getenv("LANG"))).T("help"))
			return 0
		}
		fmt.Fprintln(stderr, i18n.New(i18n.EN).T("usage"))
		return 2
	}
	b := i18n.New(i18n.Detect(*langFlag, os.Getenv("LC_ALL"), os.Getenv("LANG")))
	if *showVersion || *showV {
		return printVersion(b, stdout)
	}
	rest := global.Args()
	if len(rest) == 0 {
		fmt.Fprint(stdout, b.T("help"))
		return 0
	}
	cmd, rest := rest[0], rest[1:]
	switch cmd {
	case "help", "-h", "--help":
		fmt.Fprint(stdout, b.T("help"))
		return 0
	case "version", "-v", "--version":
		return printVersion(b, stdout)
	case "init":
		return cmdInit(b, dataDir(*dataFlag), rest, stdout, stderr)
	case "run":
		return cmdRun(b, dataDir(*dataFlag), rest, stdout, stderr)
	case "status":
		return cmdStatus(b, dataDir(*dataFlag), rest, stdout, stderr)
	case "list":
		return cmdList(b, dataDir(*dataFlag), rest, stdout, stderr)
	case "logs":
		return cmdLogs(b, dataDir(*dataFlag), rest, stdout, stderr)
	case "upgrade-now":
		explicit := strings.TrimSpace(*dataFlag) != "" || strings.TrimSpace(os.Getenv("SCDO_AGENT_DATA")) != ""
		return cmdUpgrade(b, dataDir(*dataFlag), explicit, rest, stdout, stderr)
	case "wallet":
		return cmdWallet(b, dataDir(*dataFlag), rest, stdout, stderr)
	case "pay":
		return cmdPay(b, dataDir(*dataFlag), rest, stdout, stderr)
	case "serve-paywall":
		return cmdServePaywall(b, dataDir(*dataFlag), rest, stdout, stderr)
	case "erc8004":
		return cmdERC8004(b, dataDir(*dataFlag), rest, stdout, stderr)
	case "link-8004":
		return cmdLink8004(b, dataDir(*dataFlag), rest, stdout, stderr)
	case "log-job":
		return cmdLogJob(b, dataDir(*dataFlag), rest, stdout, stderr)
	case "operator":
		return cmdOperator(b, dataDir(*dataFlag), rest, stdout, stderr)
	default:
		fmt.Fprintln(stderr, b.T("usage"))
		return 2
	}
}

func printVersion(b i18n.Bundle, stdout io.Writer) int {
	fmt.Fprintf(stdout, b.T("version")+"\n", buildinfo.Version)
	fmt.Fprintln(stdout, b.T("about"))
	return 0
}

func dataDir(flag string) string {
	if strings.TrimSpace(flag) != "" {
		return flag
	}
	if v := strings.TrimSpace(os.Getenv("SCDO_AGENT_DATA")); v != "" {
		return v
	}
	// A rootless install is the default for a user who already ran install.sh --user.
	if installmode.Resolve(installmode.Input{}) == installmode.ModeUser {
		return installmode.UserData()
	}
	return agent.DefaultRoot
}

func cmdInit(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("init", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	payout := fs.String("payout", "", "")
	label := fs.String("label", "", "")
	role := fs.String("role", agent.RoleLight, "")
	ref := fs.String("ref", "", "")
	src := fs.String("src", "", "")
	passFile := fs.String("passphrase-file", "", "")
	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(stderr, b.T("usage"))
		return 2
	}
	if strings.TrimSpace(*name) == "" {
		fmt.Fprintln(stderr, b.T("needName"))
		return 2
	}
	switch strings.ToLower(strings.TrimSpace(*role)) {
	case "bookkeeping-node", "bookkeeping", "light":
		*role = agent.RoleLight
	}
	pass, err := passphrase(*passFile)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	defer ledger.Wipe(pass)
	lay, err := agent.Create(root, *name, *payout, *label, *role, *ref, *src, pass)
	if errors.Is(err, agent.ErrExists) {
		if existing, oerr := agent.Open(root, *name); oerr == nil {
			fmt.Fprintf(stderr, b.T("exists")+"\n", *name)
			fmt.Fprintf(stderr, b.T("address")+"\n", existing.Meta.Address)
			return 1
		}
		fmt.Fprintf(stderr, b.T("exists")+"\n", *name)
		return 1
	}
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	fmt.Fprintf(stdout, b.T("ready")+"\n", lay.Name)
	fmt.Fprintf(stdout, b.T("address")+"\n", lay.Meta.Address)
	fmt.Fprintf(stdout, b.T("payout")+"\n", lay.Meta.Payout)
	fmt.Fprintf(stdout, b.T("role")+"\n", roleLabel(b, lay.Meta.Role))
	fmt.Fprintf(stdout, b.T("data")+"\n", lay.Dir)
	fmt.Fprintln(stdout, b.T("next"))
	if installmode.Resolve(installmode.Input{DataRoot: root, DataExplicit: true}) == installmode.ModeUser {
		fmt.Fprintf(stdout, b.T("nextEnableUser")+"\n", lay.Name)
	} else {
		fmt.Fprintf(stdout, b.T("nextEnable")+"\n", lay.Name)
	}
	if root != agent.DefaultRoot {
		// A user install (or any non-default data root) needs --data-dir for status to find the agent.
		fmt.Fprintf(stdout, b.T("nextStatusData")+"\n", root, lay.Name)
	} else {
		fmt.Fprintf(stdout, b.T("nextStatus")+"\n", lay.Name)
	}
	return 0
}

func cmdRun(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("run", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	ledgerURL := fs.String("ledger", "", "")
	configDir := fs.String("config-dir", "", "")
	passFile := fs.String("passphrase-file", "", "")
	if err := fs.Parse(args); err != nil || strings.TrimSpace(*name) == "" {
		fmt.Fprintln(stderr, b.T("needName"))
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
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	client := &ledger.Client{URLs: urls, Agent: "scdo-agent/" + buildinfo.Version}
	svc := &agent.Service{
		Layout:  lay,
		Key:     key,
		Version: buildinfo.Version,
		Client:  client,
		Log: func(msg string) {
			fmt.Fprintf(stdout, "%s %s\n", time.Now().UTC().Format(time.RFC3339), agent.Scrub(msg))
		},
	}
	proof := &gpu.Proof{
		Key:    key,
		Client: client,
		Index:  lay.Meta.GPUIndex,
		Log:    func(msg string) { svc.Log(msg) },
	}
	wantsGPU := gpu.IsAdapterName(lay.Name) || lay.Meta.GPUIndex != nil || lay.Meta.GPUModel != ""
	if wantsGPU {
		svc.Prove = func(ctx context.Context) {
			proof.Run(ctx, lay.NextSeq)
		}
	}
	// 0.5.10: self-register on the ERC-8004 identity registry by default (gas from the
	// one-time ledger drip when needed). erc8004 = false in config.toml turns it off.
	if !erc8004.Disabled(*configDir) {
		svc.OnStart = func(ctx context.Context) {
			go selfRegisterLoop(ctx, erc8004.Options{Key: key, Dir: lay.Dir, Drip: dripper(lay, key, client)}, svc.Log, 10*time.Minute)
		}
	}
	if err := svc.Run(ctx); err != nil {
		if errors.Is(err, installmode.ErrConflict) {
			fmt.Fprintf(stderr, b.T("otherMode")+"\n", *name)
			return 1
		}
		if errors.Is(err, agent.ErrRunning) || errors.Is(err, installmode.ErrHeld) {
			fmt.Fprintf(stderr, b.T("running")+"\n", *name)
			return 1
		}
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	return 0
}

func cmdStatus(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("status", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	ledgerURL := fs.String("ledger", "", "")
	if err := fs.Parse(args); err != nil || strings.TrimSpace(*name) == "" {
		fmt.Fprintln(stderr, b.T("needName"))
		return 2
	}
	lay, err := agent.Open(root, *name)
	if err != nil {
		fmt.Fprintf(stderr, b.T("notInit")+"\n", *name)
		return 1
	}
	urls, err := ledger.ResolveURLs(first(*ledgerURL, os.Getenv("SCDO_AGENT_LEDGER")))
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	fmt.Fprintf(stdout, "Name: %s\n", lay.Name)
	fmt.Fprintf(stdout, b.T("address")+"\n", lay.Meta.Address)
	fmt.Fprintf(stdout, b.T("payout")+"\n", lay.Meta.Payout)
	fmt.Fprintf(stdout, b.T("role")+"\n", roleLabel(b, lay.Meta.Role))
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	sum, base, err := (&ledger.Client{URLs: urls, Agent: "scdo-agent/" + buildinfo.Version}).Lookup(ctx, lay.Meta.Address)
	if err != nil {
		fmt.Fprintf(stdout, b.T("online")+"\n", "false")
		if err.Error() == "not registered" {
			fmt.Fprintln(stdout, b.T("notReg"))
		} else {
			fmt.Fprintln(stdout, b.T("unreachable"))
		}
		return 1
	}
	online := "false"
	if sum.Online {
		online = "true"
	}
	fmt.Fprintf(stdout, b.T("online")+"\n", online)
	fmt.Fprintf(stdout, b.T("ledger")+"\n", base)
	if sum.Code != "" {
		fmt.Fprintf(stdout, b.T("code")+"\n", sum.Code)
	}
	ercCtx, ercCancel := context.WithTimeout(ctx, 8*time.Second)
	if id, ok, _ := erc8004.OwnedID(ercCtx, nil, lay.Meta.Address); ok && id != "" {
		fmt.Fprintf(stdout, b.T("erc8004ID")+"\n", id)
	}
	ercCancel()
	return 0
}

func cmdList(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("list", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(stderr, b.T("usage"))
		return 2
	}
	items, err := agent.List(root)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	if len(items) == 0 {
		fmt.Fprintln(stdout, b.T("noAgents"))
		return 0
	}
	fmt.Fprintln(stdout, b.T("listHead"))
	for _, m := range items {
		fmt.Fprintf(stdout, "%s  %s\n", m.Name, m.Address)
	}
	return 0
}

func cmdLogs(b i18n.Bundle, root string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("logs", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	if err := fs.Parse(args); err != nil || strings.TrimSpace(*name) == "" {
		fmt.Fprintln(stderr, b.T("needName"))
		return 2
	}
	if err := agent.ValidateName(*name); err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 2
	}
	hint := "logsHint"
	if installmode.Resolve(installmode.Input{DataRoot: root, DataExplicit: true}) == installmode.ModeUser {
		hint = "logsHintUser"
	}
	fmt.Fprintf(stdout, b.T(hint)+"\n", *name)
	fmt.Fprintln(stdout, b.T("logsOut"))
	return 0
}

func passphrase(flagPath string) ([]byte, error) {
	path := strings.TrimSpace(flagPath)
	if path == "" {
		path = strings.TrimSpace(os.Getenv("SCDO_AGENT_PASSPHRASE_FILE"))
	}
	if path == "" {
		return nil, nil
	}
	return keys.ReadPassphraseFile(path)
}

func first(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return strings.TrimSpace(a)
	}
	return strings.TrimSpace(b)
}

func roleLabel(b i18n.Bundle, role string) string {
	if role == agent.RoleServer {
		return b.T("roleServer")
	}
	return b.T("roleLight")
}
