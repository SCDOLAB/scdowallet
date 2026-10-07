// GPU detection (spec: src/hooks/useGpuDetector.ts). The hardware query runs in the main process (nvidia-smi /
// Win32_VideoController) behind the allowlisted 'mining:gpuPreflight' channel.
;(function (M) {
  let cache = null; let pending = null
  async function detect (force) {
    if (cache && !force) return cache
    if (pending) return pending
    pending = window.scdo.invoke('mining:gpuPreflight')
      .then(r => { cache = r; return r })
      .catch(err => ({ platform: window.scdo.platform, supported: true, gpus: [{ vendor: 'Unknown', deviceName: 'GPU detection failed', vramGB: 0, driverVersion: '', cuda: false, status: 'notReady', reasons: ['Hardware query error: ' + (err && err.message)] }] }))
      .finally(() => { pending = null })
    return pending
  }
  M.gpuDetector = { detect, get: () => cache }
})(window.SCDOMining)
