// Multi-GPU preflight: a virtual/remote display (often the primary adapter)
// must not hide a ready NVIDIA card, and must not be the device Rigel is pointed at.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  evaluateGpu, miningGpuReady, readyNvidiaNames, parseNvidiaSmi, parseVideoControllerOutput,
  isVirtualDisplayName, rigelDeviceArgs
} = require('../src/miner/gpuSelect')

const RTX = 'NVIDIA GeForce RTX 4060'
const ORAY = 'OrayIddDriver Device'

function bannerWouldShow (info) { return !miningGpuReady(info) }

let n = 0
function test (name, fn) {
  fn()
  n++
  console.log('ok ' + name)
}

test('virtual and remote display names are excluded', () => {
  for (const name of [
    'OrayIddDriver Device', 'orayidd driver', '向日葵虚拟显示器',
    'Parsec Virtual Display Adapter', 'PARSEC',
    'Microsoft Basic Display Adapter', 'Microsoft Basic Render Driver',
    'Foo IddDriver Bar', 'Indirect Display Driver', 'Virtual Display',
    'RustDesk Virtual Display', 'AnyDesk Mirror Driver', 'TeamViewer Display',
    'Sunlogin Display', 'ToDesk Virtual Monitor'
  ]) assert.strictEqual(isVirtualDisplayName(name), true, name)
  assert.strictEqual(isVirtualDisplayName(RTX), false)
  assert.strictEqual(isVirtualDisplayName('NVIDIA GeForce GTX 1660'), false)
})

test('primary Oray adapter plus a ready 4060 is mineable and hides noGpu', () => {
  const info = evaluateGpu({
    adapters: [
      { name: ORAY, pnp: 'ROOT\\DISPLAY\\0001', compat: 'Oray' },
      { name: RTX, pnp: 'PCI\\VEN_10DE&DEV_2882&SUBSYS_00000000', compat: 'NVIDIA' }
    ],
    cuda: [{ index: 0, name: RTX }],
    driver: true
  })
  assert.strictEqual(miningGpuReady(info), true)
  assert.strictEqual(bannerWouldShow(info), false)
  assert.strictEqual(info.nvidia, true)
  assert.deepStrictEqual(info.mineDevices, [0])
  assert.deepStrictEqual(info.mineNames, [RTX])
  assert.deepStrictEqual(readyNvidiaNames(info), [RTX])
  assert.ok(!info.nvidiaNames.includes(ORAY))
  assert.strictEqual(info.adapters[0].virtual, true)
  assert.strictEqual(info.adapters[0].ready, false)
  assert.strictEqual(info.adapters[1].ready, true)
  assert.deepStrictEqual(rigelDeviceArgs(info.mineDevices), ['-d', '0'])
})

test('enumerator that only returned the first virtual adapter still uses nvidia-smi', () => {
  const info = evaluateGpu({
    adapters: [{ name: ORAY }],
    cuda: parseNvidiaSmi('GPU 0: NVIDIA GeForce RTX 4060 (UUID: GPU-abc)\r\n'),
    driver: true
  })
  assert.strictEqual(miningGpuReady(info), true)
  assert.strictEqual(bannerWouldShow(info), false)
  assert.deepStrictEqual(info.mineNames, [RTX])
  assert.deepStrictEqual(info.mineDevices, [0])
  assert.ok(info.names.includes(ORAY))
})

test('virtual-only machine shows noGpu', () => {
  const info = evaluateGpu({
    adapters: [
      { name: 'Microsoft Basic Display Adapter' },
      { name: 'Parsec Virtual Display Adapter' },
      { name: ORAY }
    ],
    cuda: [],
    driver: true
  })
  assert.strictEqual(miningGpuReady(info), false)
  assert.strictEqual(bannerWouldShow(info), true)
  assert.strictEqual(info.nvidia, false)
  assert.strictEqual(info.nvidiaNoDriver, false)
  assert.deepStrictEqual(info.mineDevices, [])
  assert.deepStrictEqual(rigelDeviceArgs(info.mineDevices), [])
})

test('NVIDIA without a driver is not ready', () => {
  const info = evaluateGpu({
    adapters: [{ name: RTX, pnp: 'PCI\\VEN_10DE&DEV_2882' }, { name: ORAY }],
    cuda: [],
    driver: false
  })
  assert.strictEqual(miningGpuReady(info), false)
  assert.strictEqual(info.nvidiaNoDriver, true)
  assert.deepStrictEqual(info.nvidiaNames, [RTX])
})

test('several real NVIDIA cards are all used; virtual adapter is not', () => {
  const info = evaluateGpu({
    adapters: [
      { name: 'Parsec Virtual Display Adapter' },
      { name: 'NVIDIA GeForce RTX 3060' },
      { name: RTX }
    ],
    cuda: [
      { index: 0, name: 'NVIDIA GeForce RTX 3060' },
      { index: 1, name: RTX }
    ],
    driver: true
  })
  assert.deepStrictEqual(info.mineDevices, [0, 1])
  assert.deepStrictEqual(rigelDeviceArgs(info.mineDevices), ['-d', '0,1'])
  assert.strictEqual(info.mineNames.includes('Parsec Virtual Display Adapter'), false)
  assert.strictEqual(miningGpuReady(info), true)
})

test('WMI index is not used as a CUDA index', () => {
  const info = evaluateGpu({
    adapters: [{ name: ORAY }, { name: RTX, pnp: 'PCI\\VEN_10DE&DEV_2882' }],
    cuda: [],
    driver: true
  })
  assert.strictEqual(miningGpuReady(info), true)
  assert.deepStrictEqual(info.mineDevices, [])
  assert.deepStrictEqual(rigelDeviceArgs(info.mineDevices), [])
  assert.deepStrictEqual(info.mineNames, [RTX])
})

test('PCI VEN_10DE counts even when the friendly name is not NVIDIA, unless the name is virtual', () => {
  const ok = evaluateGpu({
    adapters: [{ name: '顯示介面卡', pnp: 'PCI\\VEN_10DE&DEV_2882' }],
    cuda: [],
    driver: true
  })
  assert.strictEqual(miningGpuReady(ok), true)
  const spoof = evaluateGpu({
    adapters: [{ name: 'OrayIddDriver', pnp: 'PCI\\VEN_10DE&DEV_0000' }],
    cuda: [],
    driver: true
  })
  assert.strictEqual(miningGpuReady(spoof), false)
})

test('video-controller JSON lists every adapter, including a single object', () => {
  const many = parseVideoControllerOutput(JSON.stringify([
    { Name: ORAY, PNPDeviceID: 'ROOT\\DISPLAY\\0000', AdapterCompatibility: '' },
    { Name: RTX, PNPDeviceID: 'PCI\\VEN_10DE&DEV_2882', AdapterCompatibility: 'NVIDIA' }
  ]))
  assert.strictEqual(many.length, 2)
  assert.strictEqual(many[1].pnp.includes('VEN_10DE'), true)
  const one = parseVideoControllerOutput('noise\n' + JSON.stringify({ Name: RTX, PNPDeviceID: 'PCI\\VEN_10DE&DEV_2882', AdapterCompatibility: 'NVIDIA' }))
  assert.strictEqual(one.length, 1)
  assert.strictEqual(one[0].name, RTX)
})

test('locked Traditional Chinese mining copy is unchanged', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/js/i18n112.js'), 'utf8')
  assert.ok(src.includes("noGpu: '這台電腦沒有偵測到 NVIDIA 顯示卡，暫時無法用顯示卡挖礦。執行節點只佔用很少記憶體，也可獲得額外獎勵。'"))
  assert.ok(src.includes("externalNode: '✅ 已偵測到這台電腦正在執行 Shard0 EVM 的節點（{u}），錢包會直接使用它，不另外啟動。'"))
  assert.ok(src.includes("extPayout: '此節點不是由錢包啟動，如需設定節點收益地址，請在該節點的設定中修改。'"))
})

console.log('gpu-preflight: ' + n + ' passed')
