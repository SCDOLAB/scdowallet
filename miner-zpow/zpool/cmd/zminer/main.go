// zminer: standalone SCDO Classic zpow CPU miner (stratum-style JSON over TCP, or HTTP getWork).
// Pure Go (CGO_ENABLED=0), builds for Linux and Windows.
//
//   zminer -pool 82.223.19.88:3341 -user 1S01...yourAddress -worker rig1 -threads 4
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"math/big"
	"math/rand"
	"net"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/scdoproject/go-scdo/zpool/zp"
	"gonum.org/v1/gonum/mat"
)

var version = "0.3.0"

type work struct {
	gen         uint64
	job         *zp.Job
	hdr         *zp.Header
	shareTarget *big.Int
	blockTarget *big.Int
}

var (
	cur       atomic.Value // *work
	genSeq    uint64
	hashes    uint64
	accepted  uint64
	rejected  uint64
	blocks    uint64
	connected uint32
	stopping  uint32
	submitCh  = make(chan [2]interface{}, 256) // job_id, nonce
	stopCh    = make(chan struct{})
	stopOnce  sync.Once

	connMu  sync.Mutex
	curConn net.Conn

	rateMu  sync.Mutex
	rateHs  float64
	started time.Time
)

func logf(f string, a ...interface{}) {
	fmt.Printf(time.Now().Format("2006-01-02 15:04:05")+" "+f+"\n", a...)
}

// One JSON object per line. The wallet parses these; human log lines stay plain text.
func emitStatus() {
	rateMu.Lock()
	rate := rateHs
	rateMu.Unlock()
	up := 0
	if !started.IsZero() {
		up = int(time.Since(started).Seconds())
	}
	b, err := json.Marshal(map[string]interface{}{
		"type":       "status",
		"hashrate":   rate,
		"accepted":   atomic.LoadUint64(&accepted),
		"rejected":   atomic.LoadUint64(&rejected),
		"connected":  atomic.LoadUint32(&connected) == 1,
		"blocks":     atomic.LoadUint64(&blocks),
		"uptime_sec": up,
	})
	if err == nil {
		fmt.Println(string(b))
	}
}

func setRate(v float64) {
	rateMu.Lock()
	rateHs = v
	rateMu.Unlock()
}

func requestStop() {
	stopOnce.Do(func() {
		atomic.StoreUint32(&stopping, 1)
		close(stopCh)
		connMu.Lock()
		c := curConn
		connMu.Unlock()
		if c != nil {
			c.Close()
		}
	})
}

func setConn(c net.Conn) {
	connMu.Lock()
	curConn = c
	connMu.Unlock()
}

func stopped() bool { return atomic.LoadUint32(&stopping) == 1 }

func setJob(j *zp.Job) {
	h, err := zp.ParseHeader(j.Header)
	if err != nil {
		logf("bad job header: %v", err)
		return
	}
	st, bt := zp.ParseBig(j.ShareTarget), zp.ParseBig(j.BlockTarget)
	if st == nil || bt == nil {
		logf("bad job targets")
		return
	}
	h.Witness = nil
	if old, _ := cur.Load().(*work); old != nil && old.job.JobID == j.JobID && old.job.ShareTarget == j.ShareTarget {
		return
	}
	cur.Store(&work{gen: atomic.AddUint64(&genSeq, 1), job: j, hdr: h, shareTarget: st, blockTarget: bt})
	logf("new job %s height=%d share_diff=%d", j.JobID, j.Height, j.ShareDiff)
}

func worker(id int) {
	r := rand.New(rand.NewSource(time.Now().UnixNano() + int64(id)*7919))
	m := mat.NewDense(zp.MatrixDim, zp.MatrixDim, nil)
	var gen uint64
	var nonce uint64
	var hdr zp.Header
	for {
		if stopped() {
			return
		}
		w, _ := cur.Load().(*work)
		if w == nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		if w.gen != gen {
			gen, nonce, hdr = w.gen, r.Uint64(), *w.hdr
		}
		for i := 0; i < 16; i++ {
			if stopped() {
				return
			}
			nonce++
			_, det := zp.Check(&hdr, nonce, m)
			atomic.AddUint64(&hashes, 1)
			if zp.DetMeets(det, w.shareTarget) {
				if zp.DetMeets(det, w.blockTarget) {
					logf("[thread %d] BLOCK candidate height=%d nonce=%d", id, w.job.Height, nonce)
				}
				select {
				case submitCh <- [2]interface{}{w.job.JobID, fmt.Sprint(nonce)}:
				default:
				}
			}
		}
	}
}

// ---------- stratum (TCP) ----------

func runStratum(pool, user, worker string) {
	backoff := time.Second
	for {
		if stopped() {
			return
		}
		err := stratumSession(pool, user, worker)
		if stopped() {
			return
		}
		atomic.StoreUint32(&connected, 0)
		emitStatus()
		logf("pool connection lost: %v; reconnecting in %s", err, backoff)
		cur.Store((*work)(nil))
		select {
		case <-stopCh:
			return
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func stratumSession(pool, user, worker string) error {
	c, err := net.DialTimeout("tcp", pool, 15*time.Second)
	if err != nil {
		return err
	}
	setConn(c)
	defer func() {
		c.Close()
		connMu.Lock()
		if curConn == c {
			curConn = nil
		}
		connMu.Unlock()
	}()
	var wmu sync.Mutex
	var id uint64
	send := func(method string, params interface{}) error {
		b, _ := json.Marshal(map[string]interface{}{"jsonrpc": "2.0", "id": atomic.AddUint64(&id, 1), "method": method, "params": params})
		wmu.Lock()
		defer wmu.Unlock()
		c.SetWriteDeadline(time.Now().Add(15 * time.Second))
		_, err := c.Write(append(b, '\n'))
		return err
	}
	if err := send("login", []string{user, worker, "zminer/" + version}); err != nil {
		return err
	}
	done := make(chan struct{})
	defer close(done)
	go func() {
		ka := time.NewTicker(60 * time.Second)
		defer ka.Stop()
		for {
			select {
			case <-done:
				return
			case <-stopCh:
				c.Close()
				return
			case s := <-submitCh:
				if send("submit", []interface{}{s[0], s[1]}) != nil {
					c.Close()
					return
				}
			case <-ka.C:
				send("keepalived", []interface{}{})
			}
		}
	}()
	rd := bufio.NewReaderSize(c, 1<<16)
	loggedIn := false
	for {
		c.SetReadDeadline(time.Now().Add(5 * time.Minute))
		line, err := rd.ReadBytes('\n')
		if err != nil {
			return err
		}
		var msg struct {
			ID     interface{}     `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
			Result json.RawMessage `json:"result"`
			Error  *zp.RPCErr      `json:"error"`
		}
		if json.Unmarshal(line, &msg) != nil {
			continue
		}
		if msg.Method == "job" {
			var j zp.Job
			if json.Unmarshal(msg.Params, &j) == nil {
				setJob(&j)
			}
			continue
		}
		if !loggedIn {
			if msg.Error != nil {
				logf("login failed: %s", msg.Error.Message)
				os.Exit(2)
			}
			loggedIn = true
			atomic.StoreUint32(&connected, 1)
			logf("logged in to %s as %s.%s", pool, user, worker)
			emitStatus()
			var res struct {
				Job *zp.Job `json:"job"`
			}
			if json.Unmarshal(msg.Result, &res) == nil && res.Job != nil {
				setJob(res.Job)
			}
			continue
		}
		if msg.Error != nil {
			atomic.AddUint64(&rejected, 1)
			logf("share rejected: %s", msg.Error.Message)
			emitStatus()
			continue
		}
		var r struct {
			Accepted bool   `json:"accepted"`
			Block    bool   `json:"block"`
			Status   string `json:"status"`
		}
		if json.Unmarshal(msg.Result, &r) == nil && r.Accepted {
			atomic.AddUint64(&accepted, 1)
			if r.Block {
				atomic.AddUint64(&blocks, 1)
				logf("BLOCK accepted by pool!")
			}
			emitStatus()
		}
	}
}

// ---------- HTTP getWork ----------

func runHTTP(base, user, worker string) {
	cl := &http.Client{Timeout: 15 * time.Second}
	base = strings.TrimRight(base, "/")
	go func() {
		for s := range submitCh {
			b, _ := json.Marshal(map[string]interface{}{"login": user, "worker": worker, "job_id": s[0], "nonce": s[1]})
			resp, err := cl.Post(base+"/submit", "application/json", bytes.NewReader(b))
			if err != nil {
				logf("submit: %v", err)
				continue
			}
			var r struct {
				Accepted bool   `json:"accepted"`
				Block    bool   `json:"block"`
				Error    string `json:"error"`
			}
			json.NewDecoder(resp.Body).Decode(&r)
			resp.Body.Close()
			if r.Accepted {
				atomic.AddUint64(&accepted, 1)
				if r.Block {
					atomic.AddUint64(&blocks, 1)
				}
			} else {
				atomic.AddUint64(&rejected, 1)
				logf("share rejected: %s", r.Error)
			}
			emitStatus()
		}
	}()
	for {
		if stopped() {
			return
		}
		resp, err := cl.Get(base + "/work?login=" + user)
		if err == nil {
			var j zp.Job
			if resp.StatusCode == 200 && json.NewDecoder(resp.Body).Decode(&j) == nil {
				setJob(&j)
				if atomic.SwapUint32(&connected, 1) == 0 {
					emitStatus()
				}
			}
			resp.Body.Close()
		} else {
			if atomic.SwapUint32(&connected, 0) == 1 {
				emitStatus()
			}
			logf("getwork: %v", err)
		}
		select {
		case <-stopCh:
			return
		case <-time.After(2 * time.Second):
		}
	}
}

// benchmark on a fixed synthetic header (no pool needed)
func bench(threads int, secs int) {
	h := &zp.Header{Difficulty: big.NewInt(2854297), Height: 9262262, CreateTimestamp: big.NewInt(time.Now().Unix())}
	raw, _ := json.Marshal(h)
	setJob(&zp.Job{JobID: "bench", Height: h.Height, Header: raw, ShareTarget: "1" + strings.Repeat("0", 40), BlockTarget: "1" + strings.Repeat("0", 40)})
	for i := 0; i < threads; i++ {
		go worker(i)
	}
	time.Sleep(time.Duration(secs) * time.Second)
	n := atomic.LoadUint64(&hashes)
	rate := float64(n) / float64(secs)
	fmt.Printf("bench: threads=%d hashes=%d -> %.0f H/s total, %.0f H/s per thread\n", threads, n, rate, rate/float64(threads))
}

func main() {
	pool := flag.String("pool", "82.223.19.88:3341", "pool stratum host:port")
	httpURL := flag.String("http", "", "use HTTP getWork instead, e.g. http://82.223.19.88:8341")
	user := flag.String("user", "", "your Classic address on the pool's shard (1S01... for shard 1); addr.worker also works")
	wk := flag.String("worker", "", "worker name")
	threads := flag.Int("threads", runtime.NumCPU(), "CPU threads")
	benchSec := flag.Int("bench", 0, "run an offline benchmark for N seconds and exit")
	flag.Parse()
	fmt.Printf("zminer %s - SCDO Classic zpow CPU miner\n", version)
	if err := zp.SelfTest(); err != nil {
		fmt.Println(err)
		os.Exit(3)
	}
	fmt.Println("zpow self-test OK (real shard1 block verified)")
	if *threads < 1 {
		*threads = 1
	}
	if *benchSec > 0 {
		bench(*threads, *benchSec)
		return
	}
	if *user == "" {
		fmt.Println("usage: zminer -pool 82.223.19.88:3341 -user 1S01<your address> [-worker rig1] [-threads N]")
		os.Exit(1)
	}
	u, w := *user, *wk
	if i := strings.IndexAny(u, ".+"); i > 0 {
		if w == "" {
			w = u[i+1:]
		}
		u = u[:i]
	}
	if w == "" {
		w, _ = os.Hostname()
		if w == "" {
			w = "default"
		}
	}
	started = time.Now()
	for i := 0; i < *threads; i++ {
		go worker(i)
	}
	if *httpURL != "" {
		go runHTTP(*httpURL, u, w)
	} else {
		go runStratum(*pool, u, w)
	}
	// Wallet launches with stdin piped and windowsHide (CREATE_NO_WINDOW). Closing stdin,
	// a line "stop", SIGINT or SIGTERM all shut the workers down.
	go watchStdin()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	start, last := started, uint64(0)
	for {
		select {
		case <-sig:
			requestStop()
		case <-stopCh:
			logf("exit: accepted=%d rejected=%d blocks=%d", atomic.LoadUint64(&accepted), atomic.LoadUint64(&rejected), atomic.LoadUint64(&blocks))
			atomic.StoreUint32(&connected, 0)
			emitStatus()
			return
		case <-t.C:
			n := atomic.LoadUint64(&hashes)
			rate := float64(n-last) / 15
			last = n
			setRate(rate)
			logf("hashrate %.0f H/s (%.0f per thread, %d threads) | accepted %d rejected %d blocks %d | up %s",
				rate, rate/float64(*threads), *threads, atomic.LoadUint64(&accepted), atomic.LoadUint64(&rejected),
				atomic.LoadUint64(&blocks), time.Since(start).Round(time.Second))
			emitStatus()
		}
	}
}

func watchStdin() {
	rd := bufio.NewReader(os.Stdin)
	for {
		line, err := rd.ReadString('\n')
		if err != nil {
			requestStop()
			return
		}
		if strings.EqualFold(strings.TrimSpace(line), "stop") {
			requestStop()
			return
		}
	}
}
