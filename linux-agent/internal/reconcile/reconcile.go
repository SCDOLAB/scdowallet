// Package reconcile records graphics adapters and x-account rows.
// It never creates an agent. Existing keys are never replaced.
package reconcile

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
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

// Run detects adapters and applies x-accounts.toml.
// It never creates an agent. A missing graphics adapter or x-account row is a hint.
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
	for _, row := range rows {
		if _, err := agent.Open(opt.DataRoot, row.Agent); err == nil {
			if err := touchBinding(opt.DataRoot, row); err != nil {
				return err
			}
			continue
		}
		opt.Log("hint: x-account " + row.Agent + " has no agent. upgrade-now does not create agents. Run: scdo-agent init --name " + row.Agent + " --payout 0x<address>")
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
	held := map[string]bool{}
	for _, c := range cards {
		name := fmt.Sprintf("gpu%d", c.Index)
		if c.Source != "nvidia" && c.Source != "rocm" {
			// Intel integrated and lspci-only adapters are not bookkeeping GPUs.
			// Keep an existing directory, and do not hint a new gpuN.
			held[name] = true
			continue
		}
		seen[name] = c
		lay, err := agent.Open(opt.DataRoot, name)
		if err != nil {
			opt.Log("hint: graphics adapter " + name + " (" + c.Model + ") has no agent. upgrade-now does not create agents. Run: scdo-agent init --name " + name + " --payout 0x<address>")
			continue
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
		if held[m.Name] {
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
