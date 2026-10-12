// GPU preflight for the built-in miner.
//
// Win32_VideoController lists every display adapter. On a PC that also runs a
// remote desktop (向日葵 / Oray IddDriver, Parsec, Microsoft Basic Display, …)
// the virtual adapter is often first, and it is not a CUDA device. Preflight
// therefore looks at the whole list, drops virtual/remote displays, and treats
// the machine as mineable when any remaining NVIDIA adapter is ready.
//
// "Ready" means: not a virtual/remote display, identified as NVIDIA (name,
// AdapterCompatibility, or PCI VEN_10DE), and a CUDA driver is present
// (nvcuda.dll and/or nvidia-smi). The card Rigel should use is that ready
// NVIDIA device. CUDA indices come only from `nvidia-smi -L` — the WMI order
// is not a CUDA index, so a virtual adapter at position 0 is never passed as
// `-d 0`. When nvidia-smi indices are unknown, Rigel is started without `-d`
// and uses every CUDA device (virtual displays are not CUDA devices).
'use strict'

const VIRTUAL_DISPLAY_SUBSTRINGS = [
  'oray',
  '向日葵',
  'parsec',
  'microsoft basic display',
  'microsoft basic render',
  'idddriver',
  'idd driver',
  'indirect display',
  'indirectdisplay',
  'iddcx',
  'virtual display',
  'virtual desktop',
  'virtual monitor',
  'spacedesk',
  'rustdesk',
  'anydesk',
  'teamviewer',
  'splashtop',
  'sunlogin',
  'todesk',
  'nomachine',
  'hyper-v',
  'virtualbox',
  'vmware',
  'citrix',
  'basic render',
  'mirror driver',
  'remote display',
  'remote desktop',
  'usbmmid',
  'gameviewer',
  'asklink',
  'deskin'
]

function norm (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() }

function isVirtualDisplayName (name) {
  const n = norm(name).toLowerCase()
  if (!n) return false
  return VIRTUAL_DISPLAY_SUBSTRINGS.some(p => n.includes(p))
}

function isNvidiaName (name) {
  return /nvidia|geforce|quadro|tesla|rtx|gtx/i.test(norm(name))
}

function isNvidiaHardware (pnp, compat) {
  if (/VEN_10DE/i.test(pnp || '')) return true
  if (/nvidia/i.test(compat || '') && !isVirtualDisplayName(compat)) return true
  return false
}

function namesLooselyMatch (a, b) {
  const x = norm(a).toLowerCase()
  const y = norm(b).toLowerCase()
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

function parseNvidiaSmi (text) {
  const out = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*GPU\s+(\d+)\s*:\s*(.+?)\s*$/i)
    if (!m) continue
    const name = m[2].replace(/\s*\(UUID:.*$/i, '').trim()
    const index = parseInt(m[1], 10)
    if (!name || !Number.isInteger(index)) continue
    out.push({ index, name })
  }
  return out
}

function adapterFromJson (x) {
  if (!x || typeof x !== 'object') return null
  const name = norm(x.Name || x.name)
  if (!name) return null
  return {
    name,
    pnp: norm(x.PNPDeviceID || x.PnpDeviceID || x.pnp),
    compat: norm(x.AdapterCompatibility || x.compat)
  }
}

function parseVideoControllerOutput (text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim()
  if (!raw) return []
  const tryParse = (s) => { try { return JSON.parse(s) } catch (e) { return undefined } }
  let data = tryParse(raw)
  if (data === undefined) {
    const i = raw.indexOf('[')
    const j = raw.lastIndexOf(']')
    if (i >= 0 && j > i) data = tryParse(raw.slice(i, j + 1))
  }
  if (data === undefined) {
    const i = raw.indexOf('{')
    const j = raw.lastIndexOf('}')
    if (i >= 0 && j > i) data = tryParse(raw.slice(i, j + 1))
  }
  if (data !== undefined && data !== null) {
    const arr = Array.isArray(data) ? data : (typeof data === 'object' ? [data] : [])
    return arr.map(adapterFromJson).filter(Boolean)
  }
  return raw.split(/\r?\n/).map(l => ({ name: norm(l), pnp: '', compat: '' })).filter(a => a.name && a.name[0] !== '{' && a.name[0] !== '[')
}

// adapters: display-adapter records (every one the OS enumerated).
// cuda: `{ index, name }` from nvidia-smi -L (real CUDA devices only).
// driver: true when nvcuda.dll (or an equivalent driver check) is present.
function evaluateGpu (input) {
  input = input || {}
  const cuda = []
  for (const c of input.cuda || []) {
    const index = Number(c && c.index)
    const name = norm(c && c.name)
    if (!name || !Number.isInteger(index) || index < 0) continue
    if (isVirtualDisplayName(name)) continue
    if (cuda.some(x => x.index === index)) continue
    cuda.push({ index, name })
  }
  const driverOk = input.driver === true || cuda.length > 0
  const adapters = []
  const claimed = new Set()

  for (const raw of input.adapters || []) {
    const name = norm(raw && (typeof raw === 'string' ? raw : raw.name))
    if (!name) continue
    const pnp = norm(raw && raw.pnp)
    const compat = norm(raw && raw.compat)
    const virtual = isVirtualDisplayName(name) || isVirtualDisplayName(compat)
    const nvidia = !virtual && (isNvidiaName(name) || isNvidiaHardware(pnp, compat))
    let cudaIndex = null
    if (nvidia) {
      const hit = cuda.find(c => !claimed.has(c.index) && namesLooselyMatch(name, c.name))
      if (hit) { cudaIndex = hit.index; claimed.add(hit.index) }
    }
    adapters.push({ name, pnp, compat, virtual, nvidia, cudaIndex, ready: false })
  }

  for (const c of cuda) {
    if (claimed.has(c.index)) continue
    adapters.push({ name: c.name, pnp: '', compat: '', virtual: false, nvidia: true, cudaIndex: c.index, ready: true })
    claimed.add(c.index)
  }

  for (const a of adapters) {
    if (a.virtual || !a.nvidia) { a.ready = false; continue }
    if (a.cudaIndex != null) { a.ready = true; continue }
    // No nvidia-smi list: a named NVIDIA adapter plus the driver is enough.
    // When nvidia-smi did list devices, those entries (matched or appended) are the ready set.
    a.ready = driverOk && cuda.length === 0
  }

  const ready = adapters.filter(a => a.ready)
  const nv = adapters.filter(a => a.nvidia)
  const mineDevices = []
  for (const a of ready) {
    if (a.cudaIndex == null || mineDevices.includes(a.cudaIndex)) continue
    mineDevices.push(a.cudaIndex)
  }
  mineDevices.sort((x, y) => x - y)

  return {
    names: adapters.map(a => a.name),
    adapters,
    nvidia: ready.length > 0,
    nvidiaNames: nv.map(a => a.name),
    driver: driverOk,
    nvidiaNoDriver: nv.length > 0 && ready.length === 0 && !driverOk,
    mineDevices,
    mineNames: ready.map(a => a.name)
  }
}

// Yellow noGpu banner is the opposite: there is no ready non-virtual NVIDIA adapter.
function miningGpuReady (info) {
  if (!info) return false
  if (Array.isArray(info.adapters)) return info.adapters.some(a => a && a.ready && !a.virtual)
  return !!info.nvidia
}

function readyNvidiaNames (info) {
  if (!info) return []
  if (Array.isArray(info.adapters)) {
    const names = info.adapters.filter(a => a && a.ready && !a.virtual).map(a => a.name).filter(Boolean)
    if (names.length) return names
  }
  return Array.isArray(info.nvidiaNames) ? info.nvidiaNames.filter(Boolean) : []
}

function rigelDeviceArgs (mineDevices) {
  const devs = []
  for (const n of mineDevices || []) {
    if (Number.isInteger(n) && n >= 0 && !devs.includes(n)) devs.push(n)
  }
  return devs.length ? ['-d', devs.join(',')] : []
}

module.exports = {
  VIRTUAL_DISPLAY_SUBSTRINGS,
  isVirtualDisplayName,
  isNvidiaName,
  parseNvidiaSmi,
  parseVideoControllerOutput,
  evaluateGpu,
  miningGpuReady,
  readyNvidiaNames,
  rigelDeviceArgs
}
