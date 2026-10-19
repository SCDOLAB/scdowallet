'use strict'
// 3.1.10+: leftover cleanup only claims miners this profile spawned when the binary is the shared app copy.
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path')
const { MinerManager } = require('../src/miner/manager')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ownproc-'))
const bin = '/Applications/SCDO Wallet.app/Contents/Resources/miner/bin'
const m = new MinerManager({ platform: 'darwin', dataRoot: root, binDir: bin })
const shared = path.join(bin, 'scdo-clminer')
assert.strictEqual(m.isOwnProc({ pid: 4242, name: 'rigel', exe: shared }), false, 'shared-path miner of another profile is not ours')
m.recordOwnPid('rigel', 4242, true)
assert.strictEqual(m.isOwnProc({ pid: 4242, name: 'rigel', exe: shared }), true, 'a pid this profile spawned is ours')
assert.strictEqual(m.isOwnProc({ pid: 4243, name: 'rigel', exe: shared }), false)
m.recordOwnPid('rigel', 4242, false)
assert.strictEqual(m.isOwnProc({ pid: 4242, name: 'rigel', exe: shared }), false, 'exited pid is forgotten')
assert.strictEqual(m.isOwnProc({ pid: 7, name: 'rigel', exe: path.join(root, 'miner', 'x', 'rigel') }), true, 'binary in own data folder is ours')
assert.strictEqual(m.isOwnProc({ pid: 8, name: 'scdo-stratum', exe: path.join(bin, 'scdo-stratum') }), false)
fs.rmSync(root, { recursive: true, force: true })
console.log('own-proc: ok')
