package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/buildinfo"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/i18n"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/installmode"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/reconcile"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/update"
)

func cmdUpgrade(b i18n.Bundle, root string, dataExplicit bool, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("upgrade-now", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	dry := fs.Bool("dry-run", false, "")
	userMode := fs.Bool("user", false, "")
	passFile := fs.String("passphrase-file", "", "")
	configDir := fs.String("config-dir", "", "")
	binary := fs.String("binary", "", "")
	if err := fs.Parse(args); err != nil {
		fmt.Fprintln(stderr, b.T("usage"))
		return 2
	}
	mode := installmode.Resolve(installmode.Input{
		DataRoot:     root,
		Binary:       *binary,
		ForceUser:    *userMode,
		DataExplicit: dataExplicit,
	})
	if mode == installmode.ModeUser {
		if !dataExplicit && (root == "" || root == agent.DefaultRoot) {
			root = installmode.UserData()
		}
		if *binary == "" {
			*binary = installmode.UserBin()
		}
		if *configDir == "" {
			*configDir = installmode.UserConfig()
		}
	} else {
		if *binary == "" {
			*binary = installmode.SystemBin
		}
		if *configDir == "" {
			*configDir = installmode.SystemConfig
		}
		if !*dry && os.Geteuid() != 0 {
			fmt.Fprintln(stderr, b.T("needRoot"))
			return 1
		}
	}
	pass, err := passphrase(*passFile)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	defer ledger.Wipe(pass)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	log := func(msg string) {
		fmt.Fprintln(stdout, msg)
	}

	if *dry {
		return dryRun(ctx, b, stdout, stderr)
	}

	lock, err := lockUpgrade(root)
	if err != nil {
		if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) {
			fmt.Fprintln(stdout, b.T("upgradeBusy"))
			return 0
		}
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	defer func() {
		_ = syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
		_ = lock.Close()
	}()

	sys := update.Systemctl{DataRoot: root, User: mode == installmode.ModeUser}
	opt := reconcile.Options{
		DataRoot:   root,
		ConfigDir:  *configDir,
		Passphrase: pass,
		System:     sys,
		Log:        log,
	}
	if err := reconcile.Run(ctx, opt); err != nil {
		fmt.Fprintf(stdout, b.T("upgradeReconcile")+"\n", err.Error())
	}

	client := &http.Client{Timeout: 2 * time.Minute}
	outcome, err := update.Apply(ctx, update.Config{
		Version:      buildinfo.Version,
		Arch:         runtime.GOARCH,
		Binary:       *binary,
		DataRoot:     root,
		ConfigDir:    *configDir,
		HealthWindow: 3 * time.Minute,
		PubKey:       update.PubKeyB64,
	}, update.Deps{
		Log: log,
		Fetch: func(ctx context.Context) ([]byte, error) {
			return update.FetchVerified(ctx, update.DefaultFeed(), update.PubKeyB64, client)
		},
		Download: func(ctx context.Context, m update.Manifest) ([]byte, error) {
			return update.DownloadGET(ctx, m, client)
		},
		ListUnits: sys.ListUnits,
		Restart:   sys.Restart,
		Active:    sys.Active,
		Heartbeat: sys.Heartbeat,
	})
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	switch outcome {
	case update.OutcomeUpdated:
		if doc, ok, lerr := update.LoadResult(root); lerr == nil && ok {
			fmt.Fprintf(stdout, b.T("upgradeOk")+"\n", doc.From, doc.To)
		}
	case update.OutcomeRolledBack:
		fmt.Fprintln(stderr, b.T("upgradeRolled"))
		_ = reconcile.Run(ctx, opt)
		return 1
	default:
		fmt.Fprintln(stdout, b.T("upgradeNone"))
	}
	if err := reconcile.Run(ctx, opt); err != nil {
		fmt.Fprintf(stdout, b.T("upgradeReconcile")+"\n", err.Error())
	}
	return 0
}

func dryRun(ctx context.Context, b i18n.Bundle, stdout, stderr io.Writer) int {
	raw, err := update.FetchVerified(ctx, update.DefaultFeed(), update.PubKeyB64, nil)
	if err != nil {
		fmt.Fprintln(stdout, b.T("upgradeUnreachable"))
		return 0
	}
	manifest, err := update.VerifyArch(raw, update.PubKeyB64, runtime.GOARCH)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	if manifest.Arch != runtime.GOARCH {
		fmt.Fprintf(stdout, b.T("upgradeArch")+"\n", manifest.Arch, runtime.GOARCH)
		return 0
	}
	if update.CompareVersions(manifest.Version, buildinfo.Version) <= 0 {
		fmt.Fprintf(stdout, b.T("upgradeCurrent")+"\n", buildinfo.Version)
		return 0
	}
	fmt.Fprintf(stdout, b.T("upgradeWould")+"\n", manifest.Version, buildinfo.Version)
	return 0
}

func lockUpgrade(root string) (*os.File, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(root, "upgrade.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, err
	}
	return f, nil
}
