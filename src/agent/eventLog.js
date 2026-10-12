// Local append-only heal/event log (JSON lines), rotated at 2 MB, 3 files kept.
'use strict'
const fs = require('fs')
const path = require('path')
const LIMIT = 2 * 1024 * 1024
const KEEP = 3

class EventLog {
  constructor (dir) { this.dir = dir; this.file = path.join(dir, 'agent-events.jsonl'); try { fs.mkdirSync(dir, { recursive: true }) } catch (e) {} }
  rotate () {
    try {
      if (fs.statSync(this.file).size < LIMIT) return
      for (let i = KEEP - 1; i >= 1; i--) { try { fs.renameSync(this.file + '.' + i, this.file + '.' + (i + 1)) } catch (e) {} }
      fs.renameSync(this.file, this.file + '.1')
    } catch (e) {}
  }
  append (ev) {
    const rec = Object.assign({ at: new Date().toISOString() }, ev)
    try { this.rotate(); fs.appendFileSync(this.file, JSON.stringify(rec) + '\n') } catch (e) {}
    return rec
  }
  recent (n) {
    try { return fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean).slice(-(n || 50)).map(l => { try { return JSON.parse(l) } catch (e) { return null } }).filter(Boolean) } catch (e) { return [] }
  }
}
module.exports = { EventLog, LIMIT, KEEP }
