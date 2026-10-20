package agent

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"time"

	"github.com/SCDOLAB/scdowallet/linux-agent/internal/buildinfo"
	"github.com/SCDOLAB/scdowallet/linux-agent/internal/ledger"
)

const (
	// HeartbeatInterval matches the desktop HEARTBEAT_MS of 5 minutes.
	HeartbeatInterval = 5 * time.Minute
	// RetryInterval is the pause after a failed register or heartbeat.
	RetryInterval = 15 * time.Second
	attempts      = 3
	retryDelay    = 400 * time.Millisecond
)

var secretRE = regexp.MustCompile(`(?i)0x[0-9a-f]{64}`)

// Scrub redacts a 32-byte hex scalar from a log line.
func Scrub(s string) string {
	return secretRE.ReplaceAllString(s, "0x[key]")
}

// Service registers the agent and sends heartbeats. It does not do bookkeeping work
// beyond the ledger record.
type Service struct {
	Layout     *Layout
	Key        *ledger.Key
	Client     *ledger.Client
	Version    string
	Interval   time.Duration
	RetryEvery time.Duration
	Attempts   int
	RetryDelay time.Duration
	Now        func() int64
	Sleep      func(time.Duration)
	Log        func(string)
	registered bool
}

func (s *Service) version() string {
	if s.Version != "" {
		return s.Version
	}
	return buildinfo.Version
}

func (s *Service) interval() time.Duration {
	if s.Interval > 0 {
		return s.Interval
	}
	return HeartbeatInterval
}

func (s *Service) retryEvery() time.Duration {
	if s.RetryEvery > 0 {
		return s.RetryEvery
	}
	return RetryInterval
}

func (s *Service) attempts() int {
	if s.Attempts > 0 {
		return s.Attempts
	}
	return attempts
}

func (s *Service) retryDelay() time.Duration {
	if s.RetryDelay > 0 {
		return s.RetryDelay
	}
	return retryDelay
}

func (s *Service) now() int64 {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now().UnixMilli()
}

func (s *Service) sleep(d time.Duration) {
	if s.Sleep != nil {
		s.Sleep(d)
		return
	}
	time.Sleep(d)
}

func (s *Service) log(msg string) {
	if s.Log != nil {
		s.Log(Scrub(msg))
	}
}

// Run holds the process lock, registers, heartbeats, and repeats until ctx ends.
func (s *Service) Run(ctx context.Context) error {
	unlock, err := s.Layout.LockRun()
	if err != nil {
		return err
	}
	defer unlock()
	s.log("agent " + s.Layout.Meta.Address + " bookkeeping")
	for {
		if ctx.Err() != nil {
			return nil
		}
		ok := s.Tick(ctx)
		wait := s.interval()
		if !ok {
			wait = s.retryEvery()
		}
		if err := sleepCtx(ctx, wait); err != nil {
			return nil
		}
	}
}

// Tick registers if needed, then sends one heartbeat.
// It returns true when the heartbeat was accepted.
func (s *Service) Tick(ctx context.Context) bool {
	if !s.registered {
		if err := s.deliver(ctx, "register", s.registerBody()); err != nil {
			return false
		}
		s.registered = true
	}
	if err := s.deliver(ctx, "heartbeat", s.heartbeatBody()); err != nil {
		return false
	}
	return true
}

func (s *Service) registerBody() map[string]any {
	m := s.Layout.Meta
	body := map[string]any{
		"version":  s.version(),
		"platform": Platform,
		"label":    m.Label,
		"role":     m.Role,
		"payout":   m.Payout,
	}
	if m.Ref != "" {
		body["ref"] = m.Ref
	}
	if m.Src != "" {
		body["src"] = m.Src
	}
	return body
}

func (s *Service) heartbeatBody() map[string]any {
	code := s.Layout.Meta.Code
	if code == "" {
		code = CodeLight
	}
	return map[string]any{
		"version": s.version(),
		"code":    code,
	}
}

func (s *Service) deliver(ctx context.Context, typ string, body map[string]any) error {
	var last error
	for attempt := 1; attempt <= s.attempts(); attempt++ {
		seq, err := s.Layout.NextSeq()
		if err != nil {
			return err
		}
		env, _, err := ledger.Sign(s.Key, typ, seq, body, s.now())
		if err != nil {
			return err
		}
		res, err := s.Client.Post(ctx, typ, env)
		if err == nil && res.OK {
			s.log(fmt.Sprintf("%s ok seq=%d ledger=%s", typ, seq, hostOf(res.Ledger)))
			return nil
		}
		status := res.Status
		msg := res.Error
		if err != nil && msg == "" {
			msg = err.Error()
		}
		last = fmt.Errorf("%s", msg)
		s.log(fmt.Sprintf("%s failed status=%d ledger=%s error=%s", typ, status, hostOf(res.Ledger), msg))
		if !ledger.ShouldRetry(status) || attempt == s.attempts() {
			break
		}
		s.sleep(s.retryDelay() * time.Duration(attempt))
	}
	if last == nil {
		last = fmt.Errorf("not sent")
	}
	return last
}

func hostOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return raw
	}
	return u.Host
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		d = time.Millisecond
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
