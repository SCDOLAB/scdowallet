package update

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// FetchVerified reads the first feed URL whose signature and fields check out.
func FetchVerified(ctx context.Context, urls []string, pub string, client *http.Client) ([]byte, error) {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	var last error
	for _, u := range urls {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			last = err
			continue
		}
		req.Header.Set("accept", "application/json")
		req.Header.Set("user-agent", "scdo-agent")
		resp, err := client.Do(req)
		if err != nil {
			last = err
			continue
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if err != nil {
			last = err
			continue
		}
		if resp.StatusCode != 200 {
			last = fmt.Errorf("feed HTTP %d", resp.StatusCode)
			continue
		}
		if _, err := Verify(body, pub); err != nil {
			last = err
			continue
		}
		return body, nil
	}
	if last == nil {
		last = fmt.Errorf("no feed")
	}
	return nil, last
}

// DownloadGET fetches the package and refuses a body larger than the signed size.
func DownloadGET(ctx context.Context, m Manifest, client *http.Client) ([]byte, error) {
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Minute}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.URL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("package HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, m.Size+1))
}

// Systemctl is the production host.
type Systemctl struct {
	DataRoot string
}

func (s Systemctl) ListUnits() ([]string, error) {
	out, err := exec.Command("systemctl", "list-units", "--type=service", "--all", "--no-legend", "scdo-agent@*").CombinedOutput()
	if err != nil {
		if len(out) == 0 {
			return nil, err
		}
	}
	var names []string
	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Fields(line)
		if len(f) == 0 {
			continue
		}
		unit := f[0]
		if !strings.HasPrefix(unit, "scdo-agent@") || !strings.HasSuffix(unit, ".service") {
			continue
		}
		name := strings.TrimSuffix(strings.TrimPrefix(unit, "scdo-agent@"), ".service")
		if name != "" {
			names = append(names, name)
		}
	}
	return names, nil
}

func (s Systemctl) Restart(name string) error {
	return exec.Command("systemctl", "restart", "scdo-agent@"+name+".service").Run()
}

func (s Systemctl) Active(name string) bool {
	return exec.Command("systemctl", "is-active", "--quiet", "scdo-agent@"+name+".service").Run() == nil
}

func (s Systemctl) Heartbeat(name string) (time.Time, bool) {
	b, err := os.ReadFile(filepath.Join(s.DataRoot, name, "last-heartbeat"))
	if err != nil {
		return time.Time{}, false
	}
	ms, err := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
	if err != nil {
		return time.Time{}, false
	}
	return time.UnixMilli(ms), true
}

// EnableNow starts one agent instance.
func EnableNow(name string) error {
	return exec.Command("systemctl", "enable", "--now", "scdo-agent@"+name+".service").Run()
}

// StopDisable stops an instance and does not remove its directory.
func StopDisable(name string) error {
	_ = exec.Command("systemctl", "disable", "scdo-agent@"+name+".service").Run()
	return exec.Command("systemctl", "stop", "scdo-agent@"+name+".service").Run()
}

// EnableNow implements reconcile.System.
func (s Systemctl) EnableNow(name string) error { return EnableNow(name) }

// Stop implements reconcile.System. The directory and keys are left in place.
func (s Systemctl) Stop(name string) error { return StopDisable(name) }
