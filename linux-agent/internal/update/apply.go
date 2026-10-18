package update

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ResultDoc is what the next heartbeat or /report tells the ledger.
type ResultDoc struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Outcome  string `json:"outcome"`
	Reported bool   `json:"reported"`
}

// Outcome is the result of one upgrade attempt.
type Outcome string

const (
	OutcomeNone       Outcome = "none"
	OutcomeUpdated    Outcome = "ok"
	OutcomeRolledBack Outcome = "rolled-back"
)

// Deps are the host operations. Tests substitute them.
type Deps struct {
	Now       func() time.Time
	Sleep     func(time.Duration)
	ListUnits func() ([]string, error)
	Restart   func(name string) error
	Active    func(name string) bool
	Heartbeat func(name string) (time.Time, bool)
	Fetch     func(ctx context.Context) ([]byte, error)
	Download  func(ctx context.Context, m Manifest) ([]byte, error)
	Log       func(string)
}

// Config is the local install Apply updates.
type Config struct {
	Version      string
	Arch         string
	Binary       string
	DataRoot     string
	ConfigDir    string
	HealthWindow time.Duration
	PubKey       string
}

var backupName = regexp.MustCompile(`^\d{8}T\d{6}Z$`)

// Apply downloads a newer signed release, swaps the binary, restarts
// scdo-agent@* one at a time, and rolls back if health fails.
// Keys are only copied into the backup. They are not deleted or replaced.
func Apply(ctx context.Context, cfg Config, deps Deps) (Outcome, error) {
	if deps.Log == nil {
		deps.Log = func(string) {}
	}
	if deps.Now == nil {
		deps.Now = time.Now
	}
	if deps.Sleep == nil {
		deps.Sleep = time.Sleep
	}
	// A zero window is a single health check. Callers that want the
	// production wait pass 3 minutes explicitly.
	raw, err := deps.Fetch(ctx)
	if err != nil {
		deps.Log("feed unreachable")
		return OutcomeNone, nil
	}
	manifest, err := VerifyArch(raw, cfg.PubKey, cfg.Arch)
	if err != nil {
		return OutcomeNone, err
	}
	if manifest.Arch != cfg.Arch {
		deps.Log("feed arch " + manifest.Arch + " skipped")
		return OutcomeNone, nil
	}
	if CompareVersions(manifest.Version, cfg.Version) <= 0 {
		deps.Log("no newer release")
		return OutcomeNone, nil
	}
	blob, err := deps.Download(ctx, manifest)
	if err != nil {
		return OutcomeNone, err
	}
	if int64(len(blob)) != manifest.Size || !strings.EqualFold(SumHex(blob), manifest.SHA256) {
		return OutcomeNone, fmt.Errorf("sha256 mismatch")
	}
	bin, err := ExtractBinary(blob)
	if err != nil {
		return OutcomeNone, err
	}
	backup, err := Backup(cfg.DataRoot, cfg.Binary, cfg.ConfigDir, deps.Now())
	if err != nil {
		return OutcomeNone, err
	}
	if err := InstallBinary(cfg.Binary, bin); err != nil {
		return OutcomeNone, err
	}
	units, err := deps.ListUnits()
	if err != nil {
		_ = restore(cfg.Binary, backup)
		_ = writeResult(cfg.DataRoot, ResultDoc{From: cfg.Version, To: manifest.Version, Outcome: string(OutcomeRolledBack)})
		return OutcomeRolledBack, err
	}
	since := deps.Now()
	if err := restartHealthy(ctx, cfg, deps, units, since); err != nil {
		deps.Log("health failed, rolling back")
		if rerr := restore(cfg.Binary, backup); rerr != nil {
			return OutcomeRolledBack, rerr
		}
		_ = restartAll(deps, units)
		_ = writeResult(cfg.DataRoot, ResultDoc{From: cfg.Version, To: manifest.Version, Outcome: string(OutcomeRolledBack)})
		_ = PruneBackups(cfg.DataRoot, 5)
		return OutcomeRolledBack, nil
	}
	if err := writeResult(cfg.DataRoot, ResultDoc{From: cfg.Version, To: manifest.Version, Outcome: string(OutcomeUpdated)}); err != nil {
		return OutcomeUpdated, err
	}
	if err := PruneBackups(cfg.DataRoot, 5); err != nil {
		deps.Log("backup prune: " + err.Error())
	}
	deps.Log("updated " + cfg.Version + " -> " + manifest.Version)
	return OutcomeUpdated, nil
}

func restartHealthy(ctx context.Context, cfg Config, deps Deps, units []string, since time.Time) error {
	for _, name := range units {
		if err := deps.Restart(name); err != nil {
			return err
		}
		if err := waitHealthy(ctx, cfg, deps, name, since); err != nil {
			return err
		}
	}
	return nil
}

func waitHealthy(ctx context.Context, cfg Config, deps Deps, name string, since time.Time) error {
	deadline := deps.Now().Add(cfg.HealthWindow)
	for {
		if healthy(cfg, deps, name, since) {
			return nil
		}
		if !deps.Now().Before(deadline) {
			return fmt.Errorf("%s did not heartbeat", name)
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		deps.Sleep(200 * time.Millisecond)
	}
}

func healthy(cfg Config, deps Deps, name string, since time.Time) bool {
	if deps.Active != nil && !deps.Active(name) {
		return false
	}
	if deps.Heartbeat == nil {
		return false
	}
	ts, ok := deps.Heartbeat(name)
	if !ok || ts.Before(since) {
		return false
	}
	return deps.Now().Sub(ts) <= cfg.HealthWindow
}

func restartAll(deps Deps, units []string) error {
	var err error
	for _, name := range units {
		if e := deps.Restart(name); e != nil && err == nil {
			err = e
		}
	}
	return err
}

// ExtractBinary returns the scdo-agent file inside a .tar.gz, or the blob itself when it is an ELF.
func ExtractBinary(blob []byte) ([]byte, error) {
	if len(blob) >= 4 && bytes.Equal(blob[:4], []byte{0x7f, 'E', 'L', 'F'}) {
		return append([]byte(nil), blob...), nil
	}
	gz, err := gzip.NewReader(bytes.NewReader(blob))
	if err != nil {
		return nil, fmt.Errorf("package is not a tar.gz")
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		name := filepath.Clean(hdr.Name)
		if strings.HasPrefix(name, "..") || filepath.IsAbs(name) {
			return nil, fmt.Errorf("package path refused")
		}
		base := filepath.Base(name)
		if base != "scdo-agent" || hdr.Typeflag != tar.TypeReg {
			continue
		}
		if hdr.Size < 0 || hdr.Size > maxBytes {
			return nil, fmt.Errorf("package is too large")
		}
		return io.ReadAll(io.LimitReader(tr, hdr.Size))
	}
	return nil, fmt.Errorf("package has no scdo-agent binary")
}

// Backup copies the binary, the config directory, and each agent directory
// (including keys) into dataRoot/backups/<timestamp>/.
func Backup(dataRoot, binary, configDir string, when time.Time) (string, error) {
	dir := filepath.Join(dataRoot, "backups", when.UTC().Format("20060102T150405Z"))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	if binary != "" {
		if err := copyFile(binary, filepath.Join(dir, "scdo-agent"), 0o755); err != nil && !os.IsNotExist(err) {
			return "", err
		}
	}
	if configDir != "" {
		if st, err := os.Stat(configDir); err == nil && st.IsDir() {
			if err := copyDir(configDir, filepath.Join(dir, "config")); err != nil {
				return "", err
			}
		}
	}
	entries, err := os.ReadDir(dataRoot)
	if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	for _, e := range entries {
		if !e.IsDir() || e.Name() == "backups" {
			continue
		}
		src := filepath.Join(dataRoot, e.Name())
		if _, err := os.Stat(filepath.Join(src, "meta.json")); err != nil {
			continue
		}
		if err := copyDir(src, filepath.Join(dir, "agents", e.Name())); err != nil {
			return "", err
		}
	}
	return dir, nil
}

func restore(binary, backup string) error {
	return copyFile(filepath.Join(backup, "scdo-agent"), binary, 0o755)
}

// InstallBinary replaces dest atomically.
func InstallBinary(dest string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	tmp := dest + ".new"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dest)
}

// PruneBackups keeps the newest keep timestamp directories under dataRoot/backups.
// It never removes anything outside that directory.
func PruneBackups(dataRoot string, keep int) error {
	dir := filepath.Join(dataRoot, "backups")
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() && backupName.MatchString(e.Name()) {
			names = append(names, e.Name())
		}
	}
	if len(names) <= keep {
		return nil
	}
	// Names are UTC timestamps, so lexical order is chronological.
	for _, name := range names[:len(names)-keep] {
		if !backupName.MatchString(name) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(dir, name)); err != nil {
			return err
		}
	}
	return nil
}

func writeResult(root string, doc ResultDoc) error {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	blob, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(root, "update-result.json"), append(blob, '\n'), 0o644)
}

// LoadResult reads the pending update note. ok is false when the file is absent.
func LoadResult(root string) (ResultDoc, bool, error) {
	b, err := os.ReadFile(filepath.Join(root, "update-result.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return ResultDoc{}, false, nil
		}
		return ResultDoc{}, false, err
	}
	var doc ResultDoc
	if err := json.Unmarshal(b, &doc); err != nil {
		return ResultDoc{}, false, err
	}
	return doc, true, nil
}

// MarkReported flips the note so it is sent once.
func MarkReported(root string) error {
	doc, ok, err := LoadResult(root)
	if err != nil || !ok {
		return err
	}
	doc.Reported = true
	return writeResult(root, doc)
}

func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		mode := info.Mode().Perm()
		if mode == 0 {
			mode = 0o600
		}
		return copyFile(path, target, mode)
	})
}
