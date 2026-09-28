// Downloads the official Rigel 1.23.2 Windows zip, checks SHA256 and extracts it with the same code
// the wallet uses on Windows (MinerManager.ensureRigel with platform=win32). Does not run Rigel.
const { MinerManager } = require('../src/miner/manager')
const fs = require('fs'); const path = require('path'); const os = require('os')
;(async () => {
  const root = process.env.RIGEL_TEST_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'rigel-'))
  const m = new MinerManager({ platform: 'win32', binDir: '/nonexistent', genesis: '', dataRoot: root })
  m.on('status', s => { if (s.phase !== m._lp) { m._lp = s.phase; console.log('phase', s.phase, s.message) } })
  const exe = await m.ensureRigel()
  console.log('rigel.exe at', exe, fs.statSync(exe).size, 'bytes')
  console.log(fs.readdirSync(path.dirname(exe)).join(' '))
  console.log('rigel-fetch: PASS')
})().catch(e => { console.error('FAIL', e); process.exit(1) })
