// zminer-gpu: SCDO Classic zpow pool miner. The 30x30 determinant runs on an
// NVIDIA GPU (zpowdet.dll / libzpowdet.so). Shares are checked again with the
// CPU reference in zp before they are submitted, and the pool wire protocol
// matches zminer.
//
//	zminer-gpu -pool 82.223.19.88:3341 -user 1S01...yourAddress -worker rig1
//	zminer-gpu -check 32
//
// -threads is accepted and ignored so the wallet's default GPU argument list
// still launches this binary. One process drives one GPU.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"math/big"
	"math/rand"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/scdoproject/go-scdo/common"
	"github.com/scdoproject/go-scdo/zpool/gpu"
	"github.com/scdoproject/go-scdo/zpool/zp"
)

var version = "0.1.2"

const (
	defaultBatch = 8192
	maxBatch     = 262144
	gateNonces   = 4
)

type work struct {
	gen         uint64
	job         *zp.Job
	hdr         *zp.Header
	shareTarget *big.Int
	blockTarget *big.Int
	stale       chan struct{}
	staleOnce   sync.Once
}

var (
	cur       atomic.Value // *work
	genSeq    uint64
	hashCount uint64
	accepted  uint64
	rejected  uint64
	blocks    uint64
	connected uint32
	stopping  uint32
	exitCode  int32
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

func fail(code int, format string, args ...interface{}) {
	fmt.Printf(format+"\n", args...)
	os.Exit(code)
}

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
	old, _ := cur.Load().(*work)
	if old != nil && old.job.JobID == j.JobID && old.job.Height == j.Height && old.job.ShareTarget == j.ShareTarget {
		return
	}
	observeTarget(j.ShareTarget)
	nw := &work{
		gen:         atomic.AddUint64(&genSeq, 1),
		job:         j,
		hdr:         h,
		shareTarget: st,
		blockTarget: bt,
		stale:       make(chan struct{}),
	}
	cur.Store(nw)
	if old != nil {
		old.supersede()
	}
	if n := flushSubmits(); n > 0 {
		logf("discarded %d queued shares", n)
	}
	logf("new job %s height=%d share_diff=%d", j.JobID, j.Height, j.ShareDiff)
}

func gpuLoop(dev *gpu.Device, batch int) {
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	fails := 0
	for {
		if stopped() {
			return
		}
		w, _ := cur.Load().(*work)
		if w == nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		hdr := *w.hdr
		jobID := w.job.JobID
		height := w.job.Height
		nonce := r.Uint64()
		hashes := make([]common.Hash, batch)
		nonces := make([]uint64, batch)
		for i := 0; i < batch; i++ {
			nonce++
			c := hdr
			nonces[i] = nonce
			hashes[i] = c.HashWithNonce(nonce)
		}
		dets, err := dev.Dets(hashes, hdr.Height)
		if err != nil {
			fails++
			logf("GPU batch: %v", err)
			if fails >= 8 {
				atomic.StoreInt32(&exitCode, 4)
				requestStop()
				return
			}
			time.Sleep(time.Second)
			continue
		}
		fails = 0
		atomic.AddUint64(&hashCount, uint64(len(dets)))
		if stopped() {
			return
		}
		for i, det := range dets {
			w2, _ := cur.Load().(*work)
			if w2 == nil || w2.job.JobID != jobID || w2.job.Height != height || !heightOpen(height) {
				break
			}
			if !zp.DetMeets(det, w2.shareTarget) {
				continue
			}
			// A block closes the height. Anything else is not worth a CPU
			// confirm once this job already has a share queued, or once the
			// warmup probe for this job exists: the low starting difficulty
			// produces far more hits than the pool will accept.
			blockish := zp.DetMeets(det, w2.blockTarget)
			if !blockish && (len(submitCh) >= maxQueued || (atomic.LoadUint32(&vardiffReady) == 0 && atomic.LoadUint64(&probeGen) == w2.gen)) {
				atomic.AddUint64(&dropped, 1)
				continue
			}
			confirm := hdr
			_, cpuDet := zp.Check(&confirm, nonces[i], nil)
			w3, _ := cur.Load().(*work)
			if w3 == nil || w3.job.JobID != jobID || w3.job.Height != height || !heightOpen(height) {
				break
			}
			if math.Float64bits(cpuDet) != math.Float64bits(det) {
				logf("GPU/CPU det bits differ nonce=%d cpu=%x gpu=%x", nonces[i], math.Float64bits(cpuDet), math.Float64bits(det))
			}
			if !zp.DetMeets(cpuDet, w3.shareTarget) {
				if zp.DetMeets(det, w3.shareTarget) {
					logf("GPU false positive nonce=%d; not submitting", nonces[i])
				}
				continue
			}
			s := share{jobID: w3.job.JobID, height: w3.job.Height, nonce: fmt.Sprint(nonces[i]), det: cpuDet}
			if zp.DetMeets(cpuDet, w3.blockTarget) {
				s.block = true
				logf("BLOCK candidate height=%d nonce=%d", w3.job.Height, nonces[i])
				// Height H is done as soon as we know it. Drop every other
				// share for H now; do not wait for the pool's next job.
				closeHeight(w3.job.Height)
				enqueueShare(s)
				break
			}
			enqueueShare(s)
		}
	}
}

func crossCheck(dev *gpu.Device, n int) error {
	if n < 1 {
		n = 1
	}
	// Height 9262262 is past EmeryFork; height 1 is the older RNG.
	heights := []uint64{9262262, 1}
	for _, height := range heights {
		hdr := zp.Header{
			Difficulty:      big.NewInt(2854297),
			Height:          height,
			CreateTimestamp: big.NewInt(1700000000),
			ExtraData:       []byte("zminer-gpu-check"),
		}
		hashes := make([]common.Hash, n)
		for i := 0; i < n; i++ {
			c := hdr
			hashes[i] = c.HashWithNonce(uint64(i*997) + 1)
		}
		dets, err := dev.Dets(hashes, height)
		if err != nil {
			return err
		}
		if len(dets) != n {
			return fmt.Errorf("GPU returned %d determinants, want %d", len(dets), n)
		}
		for i := 0; i < n; i++ {
			cpu := zp.Det(hashes[i], height, nil)
			if math.Float64bits(cpu) != math.Float64bits(dets[i]) {
				return fmt.Errorf("GPU/CPU determinant mismatch height=%d index=%d cpu=%x (%g) gpu=%x (%g)",
					height, i, math.Float64bits(cpu), cpu, math.Float64bits(dets[i]), dets[i])
			}
		}
	}
	return nil
}

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
		clearWork()
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
	if err := send("login", []string{user, worker, "zminer-gpu/" + version}); err != nil {
		return err
	}
	done := make(chan struct{})
	var submitWG sync.WaitGroup
	submitWG.Add(1)
	go func() {
		defer submitWG.Done()
		ka := time.NewTicker(60 * time.Second)
		defer ka.Stop()
		for {
			select {
			case <-done:
				return
			case <-stopCh:
				c.Close()
				return
			case <-ka.C:
				send("keepalived", []interface{}{})
			case s := <-submitCh:
				if !prepareSend(s) {
					continue
				}
				if !shareCurrent(s) {
					atomic.AddUint64(&dropped, 1)
					continue
				}
				w, _ := cur.Load().(*work)
				var stale <-chan struct{}
				if w != nil {
					stale = w.stale
				}
				atomic.StoreUint64(&inflightHeight, s.height)
				drainAck()
				if send("submit", []interface{}{s.jobID, s.nonce}) != nil {
					c.Close()
					return
				}
				// One share on the wire. A new job closes w.stale and is
				// applied before the next submit is written.
				waitSettle(stale)
			}
		}
	}()
	defer func() {
		close(done)
		clearWork()
		submitWG.Wait()
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
		noteSubmitResult()
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
				if h := atomic.LoadUint64(&inflightHeight); h > 0 {
					closeHeight(h)
				}
			}
			emitStatus()
		}
	}
}

func runHTTP(base, user, worker string) {
	cl := &http.Client{Timeout: 15 * time.Second}
	base = strings.TrimRight(base, "/")
	go func() {
		for s := range submitCh {
			if !prepareSend(s) {
				continue
			}
			if !shareCurrent(s) {
				atomic.AddUint64(&dropped, 1)
				continue
			}
			atomic.StoreUint64(&inflightHeight, s.height)
			b, _ := json.Marshal(map[string]interface{}{"login": user, "worker": worker, "job_id": s.jobID, "nonce": s.nonce})
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
					if h := atomic.LoadUint64(&inflightHeight); h > 0 {
						closeHeight(h)
					}
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

func bench(dev *gpu.Device, batch, secs int) {
	h := &zp.Header{Difficulty: big.NewInt(2854297), Height: 9262262, CreateTimestamp: big.NewInt(time.Now().Unix())}
	raw, _ := json.Marshal(h)
	setJob(&zp.Job{JobID: "bench", Height: h.Height, Header: raw, ShareTarget: "1" + strings.Repeat("0", 40), BlockTarget: "1" + strings.Repeat("0", 40)})
	done := make(chan struct{})
	go func() {
		gpuLoop(dev, batch)
		close(done)
	}()
	time.Sleep(time.Duration(secs) * time.Second)
	requestStop()
	<-done
	n := atomic.LoadUint64(&hashCount)
	rate := float64(n) / float64(secs)
	fmt.Printf("bench: batch=%d hashes=%d -> %.0f H/s (%s)\n", batch, n, rate, dev.Name())
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

func main() {
	pool := flag.String("pool", "82.223.19.88:3341", "pool stratum host:port (Shard1)")
	httpURL := flag.String("http", "", "use HTTP getWork instead, e.g. http://82.223.19.88:8341")
	user := flag.String("user", "", "your Classic address on the pool's shard (1S01... for shard 1); addr.worker also works")
	wk := flag.String("worker", "", "worker name")
	batch := flag.Int("batch", defaultBatch, "header hashes per GPU launch (max 262144)")
	device := flag.Int("device", 0, "CUDA device index")
	lib := flag.String("lib", "", "path to zpowdet.dll or libzpowdet.so (default: ZPOW_GPU_LIB, then next to this exe)")
	checkN := flag.Int("check", 0, "compare N nonces per RNG era with the CPU determinant and exit")
	benchSec := flag.Int("bench", 0, "run an offline benchmark for N seconds and exit")
	threads := flag.Int("threads", 0, "accepted and ignored (one GPU uses one launcher)")
	flag.Parse()

	fmt.Printf("zminer-gpu %s - SCDO Classic zpow GPU pool miner\n", version)
	if err := zp.SelfTest(); err != nil {
		fmt.Println(err)
		os.Exit(3)
	}
	fmt.Println("zpow self-test OK (real shard1 block verified)")
	if *batch < 1 {
		*batch = defaultBatch
	}
	if *batch > maxBatch {
		fmt.Printf("batch %d capped at %d\n", *batch, maxBatch)
		*batch = maxBatch
	}
	if *threads > 0 {
		fmt.Printf("ignoring -threads %d; one GPU uses one launcher (batch %d)\n", *threads, *batch)
	}

	dev, err := gpu.Open(*lib, *device)
	if err != nil {
		fail(4, "GPU: %v", err)
	}
	defer dev.Close()
	fmt.Printf("GPU device %d: %s\n", *device, dev.Name())

	n := gateNonces
	if *checkN > 0 {
		n = *checkN
	}
	if err := crossCheck(dev, n); err != nil {
		fail(5, "GPU/CPU cross-check failed: %v", err)
	}
	fmt.Printf("GPU/CPU cross-check OK (%d nonces x 2 heights, bit-exact vs zp.Det)\n", n)
	if *checkN > 0 {
		return
	}
	if *benchSec > 0 {
		bench(dev, *batch, *benchSec)
		return
	}
	if *user == "" {
		fmt.Println("usage: zminer-gpu -pool 82.223.19.88:3341 -user 1S01<your address> [-worker rig1] [-batch 8192]")
		fmt.Println("       zminer-gpu -check 32")
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
	go gpuLoop(dev, *batch)
	if *httpURL != "" {
		go runHTTP(*httpURL, u, w)
	} else {
		go runStratum(*pool, u, w)
	}
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
			logf("exit: accepted=%d rejected=%d dropped=%d blocks=%d", atomic.LoadUint64(&accepted), atomic.LoadUint64(&rejected), atomic.LoadUint64(&dropped), atomic.LoadUint64(&blocks))
			atomic.StoreUint32(&connected, 0)
			emitStatus()
			if c := atomic.LoadInt32(&exitCode); c != 0 {
				os.Exit(int(c))
			}
			return
		case <-t.C:
			n := atomic.LoadUint64(&hashCount)
			rate := float64(n-last) / 15
			last = n
			setRate(rate)
			logf("hashrate %.0f H/s | batch %d | %s | accepted %d rejected %d dropped %d blocks %d | up %s",
				rate, *batch, dev.Name(), atomic.LoadUint64(&accepted), atomic.LoadUint64(&rejected),
				atomic.LoadUint64(&dropped), atomic.LoadUint64(&blocks), time.Since(start).Round(time.Second))
			emitStatus()
		}
	}
}
