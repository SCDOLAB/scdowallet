// 3.1.3: team-payout.txt overrides the Shard0 EVM reward address; without it the selected address is used.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const MinerManager = require('../src/miner/manager')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teampay-'))
const M = MinerManager.MinerManager || MinerManager
const m = new M({ binDir: root, genesis: path.join(root, 'g.json'), dataRoot: root, platform: 'linux' })
assert.strictEqual(m.teamPayout(), null)
fs.writeFileSync(path.join(root, 'team-payout.txt'), 'not an address\n')
assert.strictEqual(m.teamPayout(), null)
fs.writeFileSync(path.join(root, 'team-payout.txt'), '0x' + '0'.repeat(40))
assert.strictEqual(m.teamPayout(), null)
const t = '0xf65977d69f6a67e52d9d2ec5b9c4a67efa08e49b'
fs.writeFileSync(path.join(root, 'team-payout.txt'), ' ' + t + '\r\n')
assert.strictEqual(m.teamPayout(), t)
assert.ok(!fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8').includes('team-payout'))
console.log('team-payout: ok')
