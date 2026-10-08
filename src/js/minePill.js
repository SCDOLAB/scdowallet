// Top-bar mining pill. Names the shards that are mining, and does not call a
// shard "mining" while it is only starting or still syncing.
'use strict'
;(function () {
function shardLabel (n, T) {
  const num = Number(n)
  if (num === 0) return T('pillShard0')
  if (num === 1 || num === 2 || num === 3 || num === 4) return T('mineShardN', { n: num })
  return ''
}

function uniq (list) {
  const seen = new Set()
  const out = []
  for (const s of list) {
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function formatMinePill (miners, T) {
  miners = miners || {}
  const tr = typeof T === 'function' ? T : (k) => k
  const s0 = miners.shard0 || {}
  const mining = []
  const starting = []
  const errors = []
  let node = false

  if (s0.chain !== 'classic') {
    if (s0.phase === 'error') errors.push(tr('pillShard0'))
    else if (s0.running && s0.mode === 'node') node = true
    else if (s0.running) {
      const label = tr('pillShard0')
      if (s0.code === 'MINING') mining.push(label)
      else starting.push(label)
    }
  }

  const addClassic = (m, fallbackKey) => {
    if (!m || !m.running) return
    const label = shardLabel(m.shard, tr) || tr(fallbackKey)
    const failed = m.phase === 'error' || m.code === 'LOGIN' || m.code === 'SELFTEST' || m.code === 'CRASHING'
    if (failed) { errors.push(label); return }
    if (m.code === 'CLASSIC_MINING' || m.code === 'CLASSIC_GPU') mining.push(label)
    else starting.push(label)
  }
  addClassic(miners.classicCpu, 'classicCpu')
  addClassic(miners.classicGpu, 'classicGpu')

  const mineL = uniq(mining)
  const startL = uniq(starting)
  const errL = uniq(errors)
  if (!mineL.length && !startL.length && !errL.length) {
    if (node) return { cls: '', t: tr('pillNode') }
    return { cls: '', t: '⛏ ' + tr('pillStopped') }
  }

  const parts = []
  if (mineL.length) parts.push(tr('pillMining') + ' · ' + mineL.join(' · '))
  if (startL.length) parts.push(tr('pillStarting') + ' · ' + startL.join(' · '))
  if (errL.length) parts.push(tr('pillError') + ' · ' + errL.join(' · '))
  if (node) parts.push(tr('pillNode'))
  let cls = 'ok'
  if (errL.length && !mineL.length) cls = 'bad'
  else if (startL.length || errL.length || !mineL.length) cls = 'warn'
  return { cls, t: '⛏ ' + parts.join(' · ') }
}

const api = { formatMinePill, shardLabel }
if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof window !== 'undefined') window.SCDOMinePill = Object.freeze(api)
})()
