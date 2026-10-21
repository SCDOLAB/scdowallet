package erc8004

import (
	"os"
	"path/filepath"
	"strings"
)

// ConfigDir is the operator config directory.
const ConfigDir = "/etc/scdo-agent"

// Enabled reports whether config.toml turns on automatic registration.
// The flag is `erc8004 = true`. Anything else leaves it off.
func Enabled(configDir string) bool {
	if strings.TrimSpace(configDir) == "" {
		configDir = ConfigDir
	}
	b, err := os.ReadFile(filepath.Join(configDir, "config.toml"))
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(b), "\n") {
		s := strings.TrimSpace(line)
		if s == "" || strings.HasPrefix(s, "#") {
			continue
		}
		key, val, ok := strings.Cut(s, "=")
		if !ok || strings.TrimSpace(key) != "erc8004" {
			continue
		}
		val = strings.Trim(strings.TrimSpace(val), `"'`)
		switch strings.ToLower(val) {
		case "1", "true", "yes", "on":
			return true
		default:
			return false
		}
	}
	return false
}

// Disabled reports whether config.toml turns automatic self-registration off
// (erc8004 = false). Since 0.5.10 it is on when the key is absent.
func Disabled(configDir string) bool {
	if strings.TrimSpace(configDir) == "" {
		configDir = ConfigDir
	}
	b, err := os.ReadFile(filepath.Join(configDir, "config.toml"))
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(b), "\n") {
		s := strings.TrimSpace(line)
		if s == "" || strings.HasPrefix(s, "#") {
			continue
		}
		key, val, ok := strings.Cut(s, "=")
		if !ok || strings.TrimSpace(key) != "erc8004" {
			continue
		}
		val = strings.Trim(strings.TrimSpace(val), `"'`)
		switch strings.ToLower(val) {
		case "0", "false", "no", "off":
			return true
		}
		return false
	}
	return false
}
