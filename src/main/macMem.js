// 3.1.7: on macOS os.freemem() counts only truly free pages (a few hundred MB on a busy 16 GB Mac), so the
// AI cat's low-memory rule restarted Shard0 every few minutes. Count the memory macOS can hand out at once:
// free + inactive + speculative + purgeable pages from vm_stat.
'use strict'
const { execFileSync } = require('child_process')
function parseVmStat (text) {
  const s = String(text || '')
  const ps = Number((/page size of (\d+) bytes/.exec(s) || [])[1]) || 0
  if (!ps) return null
  const pg = (k) => Number((new RegExp(k + ':\\s+(\\d+)').exec(s) || [])[1]) || 0
  return (pg('Pages free') + pg('Pages inactive') + pg('Pages speculative') + pg('Pages purgeable')) * ps
}
function macAvailable () {
  try { return parseVmStat(execFileSync('/usr/bin/vm_stat', { encoding: 'utf8', timeout: 3000 })) } catch (e) { return null }
}
module.exports = { parseVmStat, macAvailable }
