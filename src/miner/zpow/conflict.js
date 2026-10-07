// Only one mining backend runs at a time.
// Shard0 Rigel (Ethash) and Classic CUDA (zpow) on the same GPU fault the
// driver (TDR) and each side keeps about a third of its hashrate.
// CPU zminer plus either node also shares one CPU budget, so that is refused too.
'use strict'

function snapshot (status) {
  if (!status || !status.running) return { running: false }
  return {
    running: true,
    chain: status.chain === 'classic' ? 'classic' : 'shard0',
    mode: status.mode || status.backend || 'mine'
  }
}

function decideStart (current, next) {
  const cur = snapshot(current)
  const req = snapshot(Object.assign({ running: true }, next))
  if (!cur.running) return { ok: true }
  const gpuClash = (cur.chain === 'shard0' && cur.mode === 'mine' && req.chain === 'classic' && req.mode === 'gpu') ||
    (cur.chain === 'classic' && cur.mode === 'gpu' && req.chain === 'shard0' && req.mode === 'mine')
  if (gpuClash) {
    const err = new Error('Shard0 GPU mining and Classic GPU mining cannot run together')
    err.code = 'GPU_CONFLICT'
    return { ok: false, code: 'GPU_CONFLICT', error: err }
  }
  const err = new Error('another miner is already running')
  err.code = 'CPU_BUDGET'
  return { ok: false, code: 'CPU_BUDGET', error: err }
}

module.exports = { decideStart, snapshot }
