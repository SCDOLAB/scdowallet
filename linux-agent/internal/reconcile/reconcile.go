// Package reconcile creates missing bookkeeping agents for graphics adapters
// and for rows in x-accounts.toml. Existing keys are never replaced.
package reconcile

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/agent"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/bindings"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/buildinfo"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/gpu"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

var gpuName = regexp.MustCompile(`^gpu([0-9]+)$`)

// System starts and stops scdo-agent instances.
type System interface {
	EnableNow(name string) error
	Stop(name string) error
}

// Options controls one reconcile pass.
type Options struct {
	DataRoot   string
	ConfigDir  string
	Passphrase []byte
	Probe      gpu.Runner
	System     System
	LedgerURLs []string
	Log        func(string)
}

// OnNewAgent runs after a new identity is created.
// The default writes keys/wallet.key with the same keystore format and does not
// open a payment account. A later wallet command can replace this function.
var OnNewAgent = func(dir string, passphrase []byte) error {
	return agent.EnsureWallet(dir, passphrase)
}

// Run detects adapters and applies x-accounts.toml.
func Run(ctx context.Context, opt Options) error {
	if opt.Log == nil {
		opt.Log = func(string) {}
	}
	if opt.DataRoot == "" {
		opt.DataRoot = agent.DefaultRoot
	}
	if opt.ConfigDir == "" {
		opt.ConfigDir = "/etc/scdo-agent"
	}
	if err := adapters(ctx, opt); err != nil {
		opt.Log("adapters: " + err.Error())
	}
	if err := accounts(opt); err != nil {
		return err
	}
	return nil
}

func accounts(opt Options) error {
	path := filepath.Join(opt.ConfigDir, "x-accounts.toml")
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	rows, err := bindings.Parse(string(b))
	if err != nil {
		return err
	}
	payout, _ := findPayout(opt.DataRoot, opt.ConfigDir)
	for _, row := range rows {
		if _, err := agent.Open(opt.DataRoot, row.Agent); err == nil {
			if err := touchBinding(opt.DataRoot, row); err != nil {
				return err
			}
			continue
		}
		if payout == "" {
			return fmt.Errorf("payout is required in %s before creating %s", filepath.Join(opt.ConfigDir, "config.toml"), row.Agent)
		}
		lay, err := agent.Create(opt.DataRoot, row.Agent, payout, row.Handle, agent.RoleLight, "", "x-account", opt.Passphrase)
		if err != nil {
			return err
		}
		lay.Meta.XHandle = row.Handle
		lay.Meta.XUserID = row.UserID
		if err := lay.SaveMeta(); err != nil {
			return err
		}
		if err := OnNewAgent(lay.Dir, opt.Passphrase); err != nil {
			return err
		}
		opt.Log("created agent " + row.Agent)
		if opt.System != nil {
			if err := opt.System.EnableNow(row.Agent); err != nil {
				opt.Log("enable " + row.Agent + ": " + err.Error())
			}
		}
	}
	return nil
}

func touchBinding(root string, row bindings.Account) error {
	lay, err := agent.Open(root, row.Agent)
	if err != nil {
		return err
	}
	if lay.Meta.XHandle == row.Handle && lay.Meta.XUserID == row.UserID {
		return nil
	}
	lay.Meta.XHandle = row.Handle
	lay.Meta.XUserID = row.UserID
	return lay.SaveMeta()
}

func adapters(ctx context.Context, opt Options) error {
	cards, ok, err := gpu.Detect(opt.Probe)
	if !ok {
		if err != nil {
			opt.Log(err.Error() + "; leaving adapter agents in place")
		}
		return nil
	}
	seen := map[string]gpu.Card{}
	payout, _ := findPayout(opt.DataRoot, opt.ConfigDir)
	for _, c := range cards {
		name := fmt.Sprintf("gpu%d", c.Index)
		seen[name] = c
		lay, err := agent.Open(opt.DataRoot, name)
		if err != nil {
			if payout == "" {
				opt.Log("skip " + name + ": no payout configured")
				continue
			}
			lay, err = agent.Create(opt.DataRoot, name, payout, c.Model, agent.RoleLight, "", "adapter", opt.Passphrase)
			if err != nil {
				return err
			}
			if err := OnNewAgent(lay.Dir, opt.Passphrase); err != nil {
				return err
			}
			opt.Log("created " + name)
			if opt.System != nil {
				if err := opt.System.EnableNow(name); err != nil {
					opt.Log("enable " + name + ": " + err.Error())
				}
			}
		}
		lay.Meta.GPUIndex = &c.Index
		lay.Meta.GPUModel = c.Model
		lay.Meta.GPUVramMiB = c.VRAMMiB
		if err := lay.SaveMeta(); err != nil {
			return err
		}
	}
	items, err := agent.List(opt.DataRoot)
	if err != nil {
		return err
	}
	for _, m := range items {
		if !gpuName.MatchString(m.Name) {
			continue
		}
		if _, ok := seen[m.Name]; ok {
			continue
		}
		lay, err := agent.Open(opt.DataRoot, m.Name)
		if err != nil {
			continue
		}
		_ = reportGone(ctx, opt, lay)
		if opt.System != nil {
			if err := opt.System.Stop(m.Name); err != nil {
				opt.Log("stop " + m.Name + ": " + err.Error())
			}
		}
		opt.Log(m.Name + " adapter not present; directory kept")
	}
	return nil
}

func reportGone(ctx context.Context, opt Options, lay *agent.Layout) error {
	key, err := lay.OpenKey(opt.Passphrase)
	if err != nil {
		return err
	}
	urls := opt.LedgerURLs
	if len(urls) == 0 {
		urls = ledger.DefaultURLs()
	}
	seq, err := lay.NextSeq()
	if err != nil {
		return err
	}
	body := map[string]any{
		"kind":     "offline",
		"message":  lay.Name + " adapter not present",
		"stack":    "",
		"version":  buildinfo.Version,
		"platform": agent.Platform,
	}
	if lay.Meta.GPUModel != "" {
		body["gpuModel"] = lay.Meta.GPUModel
	}
	env, _, err := ledger.Sign(key, "report", seq, body, time.Now().UnixMilli())
	if err != nil {
		return err
	}
	_, err = (&ledger.Client{URLs: urls, Agent: "scdo-agent/" + buildinfo.Version}).Post(ctx, "report", env)
	return err
}

func findPayout(root, configDir string) (string, error) {
	if b, err := os.ReadFile(filepath.Join(configDir, "config.toml")); err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			s := strings.TrimSpace(line)
			if s == "" || strings.HasPrefix(s, "#") || !strings.HasPrefix(s, "payout") {
				continue
			}
			_, val, ok := strings.Cut(s, "=")
			if !ok {
				continue
			}
			val = strings.Trim(strings.TrimSpace(val), `"`)
			if val != "" {
				return ledger.ChecksumAddress(val)
			}
		}
	}
	items, err := agent.List(root)
	if err != nil {
		return "", err
	}
	for _, m := range items {
		if m.Payout != "" {
			return m.Payout, nil
		}
	}
	return "", nil
}
