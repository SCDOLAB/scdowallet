package main

import (
	"sync/atomic"
	"testing"

	"github.com/scdoproject/go-scdo/zpool/zp"
)

func resetMinerState() {
	if old, _ := cur.Load().(*work); old != nil {
		cur.Store((*work)(nil))
		old.supersede()
	} else {
		cur.Store((*work)(nil))
	}
	flushSubmits()
	resetSessionTargets()
	atomic.StoreUint64(&dropped, 0)
	atomic.StoreUint64(&closedHeight, 0)
	atomic.StoreUint64(&inflightHeight, 0)
	drainAck()
}

func jobAt(id string, height uint64, shareTarget string) *zp.Job {
	return &zp.Job{
		JobID:       id,
		Height:      height,
		Header:      []byte(`{"Difficulty":1,"Height":1,"CreateTimestamp":1}`),
		ShareTarget: shareTarget,
		BlockTarget: "100000000000000000000000000000",
		ShareDiff:   1,
	}
}

func TestFlushDropsQueuedShareOnNewHeight(t *testing.T) {
	resetMinerState()
	defer resetMinerState()
	setJob(jobAt("h1", 10, "100"))
	if !enqueueShare(share{jobID: "h1", height: 10, nonce: "1", det: 1000}) {
		t.Fatal("enqueue")
	}
	setJob(jobAt("h2", 11, "100"))
	select {
	case s := <-submitCh:
		t.Fatalf("stale share stayed queued: %+v", s)
	default:
	}
	if prepareSend(share{jobID: "h1", height: 10, nonce: "1", det: 1000}) {
		t.Fatal("stale height was still sendable")
	}
}

func TestRetargetDropsShareBelowNewTarget(t *testing.T) {
	resetMinerState()
	defer resetMinerState()
	setJob(jobAt("j", 10, "100"))
	s := share{jobID: "j", height: 10, nonce: "7", det: 150}
	if !enqueueShare(s) {
		t.Fatal("enqueue")
	}
	// Same job id and height, higher share target. 150 met 100 and misses 500.
	setJob(jobAt("j", 10, "500"))
	select {
	case got := <-submitCh:
		t.Fatalf("below-target share stayed queued: %+v", got)
	default:
	}
	if prepareSend(s) {
		t.Fatal("share below the current target was sent")
	}
	// A hit that still clears the new target is sendable.
	if !shareCurrent(share{jobID: "j", height: 10, nonce: "8", det: 800}) {
		t.Fatal("share that meets the new target was dropped")
	}
}

func TestWarmupQueuesOneShareUntilTargetChanges(t *testing.T) {
	resetMinerState()
	defer resetMinerState()
	setJob(jobAt("h1", 10, "100"))
	if atomic.LoadUint32(&vardiffReady) != 0 {
		t.Fatal("first target should not confirm vardiff")
	}
	if !enqueueShare(share{jobID: "h1", height: 10, nonce: "1", det: 1000}) {
		t.Fatal("first share")
	}
	if enqueueShare(share{jobID: "h1", height: 10, nonce: "2", det: 1000}) {
		t.Fatal("second share queued before vardiff changed")
	}
	// Height moved, target unchanged: still warming up, one new probe allowed
	// after the previous one was discarded with the queue.
	setJob(jobAt("h2", 11, "100"))
	if atomic.LoadUint32(&vardiffReady) != 0 {
		t.Fatal("same target should stay in warmup")
	}
	if !enqueueShare(share{jobID: "h2", height: 11, nonce: "3", det: 1000}) {
		t.Fatal("probe after flush")
	}
	if enqueueShare(share{jobID: "h2", height: 11, nonce: "4", det: 1000}) {
		t.Fatal("warmup allowed a second share")
	}
	setJob(jobAt("h3", 12, "900"))
	if atomic.LoadUint32(&vardiffReady) != 1 {
		t.Fatal("target change should confirm vardiff")
	}
	if !enqueueShare(share{jobID: "h3", height: 12, nonce: "5", det: 1000}) {
		t.Fatal("share after vardiff")
	}
	// One non-block share waits in the queue. Further hits are dropped
	// instead of filling it while the starting difficulty is still low.
	if enqueueShare(share{jobID: "h3", height: 12, nonce: "6", det: 1000}) {
		t.Fatal("second share queued behind one that is already waiting")
	}
}

func TestCloseHeightDropsSharesButKeepsBlock(t *testing.T) {
	resetMinerState()
	defer resetMinerState()
	setJob(jobAt("h1", 10, "100"))
	if !enqueueShare(share{jobID: "h1", height: 10, nonce: "1", det: 1000}) {
		t.Fatal("enqueue")
	}
	if closeHeight(10) != 1 {
		t.Fatal("queued share was not discarded")
	}
	if prepareSend(share{jobID: "h1", height: 10, nonce: "2", det: 1000}) {
		t.Fatal("share for a closed height was sendable")
	}
	if enqueueShare(share{jobID: "h1", height: 10, nonce: "3", det: 1000}) {
		t.Fatal("share enqueued after the height closed")
	}
	b := share{jobID: "h1", height: 10, nonce: "9", det: 1000, block: true}
	if !enqueueShare(b) {
		t.Fatal("block share was not queued")
	}
	if !prepareSend(b) {
		t.Fatal("block share was not sendable")
	}
	select {
	case got := <-submitCh:
		if !got.block || got.nonce != "9" {
			t.Fatalf("queue held %+v", got)
		}
	default:
		t.Fatal("block share missing from the queue")
	}
}

func TestClearWorkDropsQueueAndRearmsWarmup(t *testing.T) {
	resetMinerState()
	defer resetMinerState()
	setJob(jobAt("h1", 10, "100"))
	if !enqueueShare(share{jobID: "h1", height: 10, nonce: "1", det: 1000}) {
		t.Fatal("enqueue")
	}
	clearWork()
	select {
	case s := <-submitCh:
		t.Fatalf("share survived disconnect: %+v", s)
	default:
	}
	if shareCurrent(share{jobID: "h1", height: 10, nonce: "1", det: 1000}) {
		t.Fatal("old job still current after disconnect")
	}
	setJob(jobAt("h9", 20, "100"))
	if atomic.LoadUint32(&vardiffReady) != 0 {
		t.Fatal("reconnect should wait for a fresh target change")
	}
	if !enqueueShare(share{jobID: "h9", height: 20, nonce: "2", det: 1000}) {
		t.Fatal("probe after reconnect")
	}
}
