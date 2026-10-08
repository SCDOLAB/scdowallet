package main

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/scdoproject/go-scdo/zpool/zp"
)

// submitQueue is drained when the job, the share target, or the height changes.
// Shares for a finished height never stay in it to be written later.
const submitQueue = 256

// maxQueued is the most non-block shares kept waiting. One is already on the
// wire. A deeper queue is what the low starting difficulty filled, and what
// still got submitted after this miner had found a block.
const maxQueued = 1

// share is one CPU-confirmed hit. It is sent only if that job is still the
// pool's current job, the height is still open, and the determinant still
// meets the current share target. A block share is sent even after the pool
// has confirmed block:true for that height, and every other share for that
// height is not.
type share struct {
	jobID  string
	height uint64
	nonce  string
	det    float64
	block  bool
}

var (
	submitMu sync.Mutex
	submitCh = make(chan share, submitQueue)

	targetMu       sync.Mutex
	sessionTarget  string
	vardiffReady   uint32 // 1 after this connection's share target has changed
	probeGen       uint64 // job generation that already has its one warmup share
	dropped        uint64
	closedHeight   uint64 // highest height known to be mined; 0 means none
	inflightHeight uint64

	ackCh = make(chan struct{}, 8)
)

// supersede wakes a submitter waiting on this job.
func (w *work) supersede() {
	if w == nil {
		return
	}
	w.staleOnce.Do(func() { close(w.stale) })
}

// heightOpen reports whether shares for h may still be submitted.
// A block share is the exception once the pool has confirmed block:true.
func heightOpen(h uint64) bool {
	c := atomic.LoadUint64(&closedHeight)
	return c == 0 || h > c
}

// closeHeight marks h, and every lower height, finished. Queued non-block
// shares for those heights are discarded. The submitter is left to finish
// the share already on the wire, then send a queued block if there is one.
func closeHeight(h uint64) int {
	if h == 0 {
		return 0
	}
	for {
		old := atomic.LoadUint64(&closedHeight)
		if old != 0 && h <= old {
			return flushHeight(h)
		}
		if atomic.CompareAndSwapUint64(&closedHeight, old, h) {
			break
		}
	}
	n := flushHeight(h)
	if n > 0 {
		logf("height %d closed, discarded %d queued shares", h, n)
	}
	return n
}

// shareCurrent reports whether s may be sent for the job the miner is on now.
func shareCurrent(s share) bool {
	w, _ := cur.Load().(*work)
	if w == nil || w.job == nil || w.shareTarget == nil {
		return false
	}
	if w.job.JobID != s.jobID || w.job.Height != s.height {
		return false
	}
	if !s.block && !heightOpen(s.height) {
		return false
	}
	return zp.DetMeets(s.det, w.shareTarget)
}

func observeTarget(target string) {
	targetMu.Lock()
	prev := sessionTarget
	if prev == "" {
		sessionTarget = target
		targetMu.Unlock()
		return
	}
	if prev != target {
		sessionTarget = target
		targetMu.Unlock()
		atomic.StoreUint32(&vardiffReady, 1)
		return
	}
	targetMu.Unlock()
}

func resetSessionTargets() {
	targetMu.Lock()
	sessionTarget = ""
	targetMu.Unlock()
	atomic.StoreUint32(&vardiffReady, 0)
	atomic.StoreUint64(&probeGen, 0)
}

// enqueueShare queues s, or drops it when the job is already stale.
// Until the pool changes the share target on this connection, each job
// gets one share, so a low starting difficulty is not flooded.
func enqueueShare(s share) bool {
	submitMu.Lock()
	defer submitMu.Unlock()
	if !shareCurrent(s) {
		atomic.AddUint64(&dropped, 1)
		return false
	}
	if atomic.LoadUint32(&vardiffReady) == 0 && !s.block {
		w, _ := cur.Load().(*work)
		if w == nil || atomic.LoadUint64(&probeGen) == w.gen {
			atomic.AddUint64(&dropped, 1)
			return false
		}
		atomic.StoreUint64(&probeGen, w.gen)
	}
	if !s.block && len(submitCh) >= maxQueued {
		atomic.AddUint64(&dropped, 1)
		return false
	}
	select {
	case submitCh <- s:
		return true
	default:
		if atomic.LoadUint32(&vardiffReady) == 0 && !s.block {
			atomic.StoreUint64(&probeGen, 0)
		}
		atomic.AddUint64(&dropped, 1)
		return false
	}
}

// flushHeight drops queued shares at or below h, except a block share for h.
func flushHeight(h uint64) int {
	submitMu.Lock()
	defer submitMu.Unlock()
	n := 0
	kept := make([]share, 0)
	for {
		select {
		case s := <-submitCh:
			if s.height > h || (s.block && s.height == h) {
				kept = append(kept, s)
			} else {
				n++
			}
		default:
			for _, s := range kept {
				submitCh <- s
			}
			if n > 0 {
				atomic.AddUint64(&dropped, uint64(n))
			}
			return n
		}
	}
}

// flushSubmits removes every queued share. The caller has already published
// the new job, so anything still queued was computed for a previous one.
func flushSubmits() int {
	submitMu.Lock()
	defer submitMu.Unlock()
	n := 0
	for {
		select {
		case <-submitCh:
			n++
		default:
			if n > 0 {
				atomic.AddUint64(&dropped, uint64(n))
			}
			return n
		}
	}
}

// prepareSend re-checks s against the job that is current at the moment of sending.
func prepareSend(s share) bool {
	if shareCurrent(s) {
		return true
	}
	atomic.AddUint64(&dropped, 1)
	return false
}

func noteSubmitResult() {
	select {
	case ackCh <- struct{}{}:
	default:
	}
}

func drainAck() {
	for {
		select {
		case <-ackCh:
		default:
			return
		}
	}
}

// waitSettle returns when the pool has answered, the job has been replaced,
// or the wait expires. One share is on the wire at a time, so a vardiff
// update is applied before the next submit.
func waitSettle(stale <-chan struct{}) {
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	select {
	case <-ackCh:
	case <-stale:
	case <-timer.C:
	case <-stopCh:
	}
}

// clearWork drops the current job and every queued share. Used on disconnect.
func clearWork() {
	if old, _ := cur.Load().(*work); old != nil {
		cur.Store((*work)(nil))
		old.supersede()
	}
	n := flushSubmits()
	if n > 0 {
		logf("discarded %d queued shares", n)
	}
	resetSessionTargets()
}
