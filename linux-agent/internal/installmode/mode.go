// Package installmode distinguishes a system install from a rootless one.
// A system install uses /usr/bin and /var/lib/scdo-agent. A user install uses
// ~/.local/bin and ~/.local/share/scdo-agent. The same agent name is not
// started in both.
package installmode

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

const (
	// ModeSystem is the root install.
	ModeSystem Mode = "system"
	// ModeUser is the rootless install.
	ModeUser Mode = "user"

	// SystemBin is the packaged binary path.
	SystemBin = "/usr/bin/scdo-agent"
	// SystemData is the packaged data root.
	SystemData = "/var/lib/scdo-agent"
	// SystemConfig is the packaged config directory.
	SystemConfig = "/etc/scdo-agent"
)

// Mode is which install an upgrade or a run should touch.
type Mode string

var (
	// ErrConflict means this name is already claimed by the other install.
	ErrConflict = errors.New("agent already claimed by the other install mode")
	// ErrHeld means another process holds the cross-mode lock.
	ErrHeld = errors.New("agent lock is held")
	nameRe  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`)
)

// Input is what Resolve can see. Empty strings mean "not passed".
type Input struct {
	DataRoot     string
	Binary       string
	ForceUser    bool
	DataExplicit bool
}

// Home is the current user's home directory.
func Home() string {
	if h := strings.TrimSpace(os.Getenv("HOME")); h != "" {
		return h
	}
	h, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return h
}

// UserBin is ~/.local/bin/scdo-agent.
func UserBin() string {
	return filepath.Join(Home(), ".local", "bin", "scdo-agent")
}

// UserData is ~/.local/share/scdo-agent.
func UserData() string {
	return filepath.Join(Home(), ".local", "share", "scdo-agent")
}

// UserConfig is ~/.config/scdo-agent.
func UserConfig() string {
	return filepath.Join(Home(), ".config", "scdo-agent")
}

// UserUnitDir is ~/.config/systemd/user.
func UserUnitDir() string {
	return filepath.Join(Home(), ".config", "systemd", "user")
}

// Resolve reports which install this process should operate on.
func Resolve(in Input) Mode {
	if in.ForceUser || strings.TrimSpace(os.Getenv("SCDO_AGENT_MODE")) == "user" {
		return ModeUser
	}
	if strings.TrimSpace(os.Getenv("SCDO_AGENT_MODE")) == "system" {
		return ModeSystem
	}
	if samePath(in.DataRoot, UserData()) || samePath(in.Binary, UserBin()) {
		return ModeUser
	}
	if scopeOf(in.DataRoot) == "user" {
		return ModeUser
	}
	if os.Geteuid() != 0 && in.Binary == "" && !in.DataExplicit && (in.DataRoot == "" || samePath(in.DataRoot, SystemData)) && UserInstalled() {
		return ModeUser
	}
	return ModeSystem
}

// UserInstalled reports a rootless binary or an install-scope marker.
func UserInstalled() bool {
	if st, err := os.Stat(UserBin()); err == nil && !st.IsDir() {
		return true
	}
	return scopeOf(UserData()) == "user"
}

func scopeOf(root string) string {
	if strings.TrimSpace(root) == "" {
		return ""
	}
	b, err := os.ReadFile(filepath.Join(root, "install-scope"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func samePath(a, b string) bool {
	if strings.TrimSpace(a) == "" || strings.TrimSpace(b) == "" {
		return false
	}
	aa, err1 := filepath.Abs(a)
	bb, err2 := filepath.Abs(b)
	if err1 != nil || err2 != nil {
		return filepath.Clean(a) == filepath.Clean(b)
	}
	return aa == bb
}

// PeerClaimed reports whether the other install already has this name
// enabled or active. A missing systemctl is treated as not claimed.
func PeerClaimed(self Mode, name string) (bool, error) {
	if !nameRe.MatchString(name) {
		return false, fmt.Errorf("name refused")
	}
	unit := "scdo-agent@" + name + ".service"
	if self == ModeUser {
		return systemctlTrue("is-active", unit) || systemctlTrue("is-enabled", unit), nil
	}
	if systemctlTrue("--user", "is-active", unit) || systemctlTrue("--user", "is-enabled", unit) {
		return true, nil
	}
	return userUnitLinked(name), nil
}

// Acquire refuses a second copy of name and holds a lock visible to both
// install modes. release is always safe to call.
func Acquire(name string, self Mode) (func(), error) {
	if !nameRe.MatchString(name) {
		return nil, fmt.Errorf("name refused")
	}
	claimed, err := PeerClaimed(self, name)
	if err != nil {
		return nil, err
	}
	if claimed {
		return nil, ErrConflict
	}
	path, err := lockPath(name)
	if err != nil {
		return func() {}, nil
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return func() {}, nil
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, ErrHeld
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
	}, nil
}

func lockPath(name string) (string, error) {
	st, err := os.Stat("/dev/shm")
	if err != nil || !st.IsDir() {
		return "", fmt.Errorf("no shared lock directory")
	}
	return filepath.Join("/dev/shm", "scdo-agent-"+name+".lock"), nil
}

func systemctlTrue(args ...string) bool {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, "systemctl", args...).Run() == nil
}

func userUnitLinked(name string) bool {
	unit := "scdo-agent@" + name + ".service"
	var homes []string
	if h := Home(); h != "" {
		homes = append(homes, h)
	}
	homes = append(homes, "/root")
	entries, err := os.ReadDir("/home")
	if err == nil {
		for _, e := range entries {
			if e.IsDir() {
				homes = append(homes, filepath.Join("/home", e.Name()))
			}
		}
	}
	seen := map[string]bool{}
	for _, h := range homes {
		if seen[h] {
			continue
		}
		seen[h] = true
		link := filepath.Join(h, ".config", "systemd", "user", "default.target.wants", unit)
		st, err := os.Lstat(link)
		if err == nil && !st.IsDir() {
			return true
		}
	}
	return false
}
