// platform helper (spec: src/utils/osPlatform.ts). Uses the value the preload exposes, not navigator.platform.
;(function (M) {
  const PlatformType = Object.freeze({ WINDOWS: 'windows', MACOS: 'macos', LINUX: 'linux', OTHER: 'other' })
  function getPlatform () {
    const p = (window.scdo && window.scdo.platform) || ''
    if (p === 'win32') return PlatformType.WINDOWS
    if (p === 'darwin') return PlatformType.MACOS
    if (p === 'linux') return PlatformType.LINUX
    return PlatformType.OTHER
  }
  M.PlatformType = PlatformType; M.getPlatform = getPlatform
})(window.SCDOMining)
