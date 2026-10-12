// address masking (spec: src/utils/stringMask.ts)
;(function (M) {
  function maskWalletAddress (addr) { addr = String(addr || ''); return addr.length < 12 ? addr : addr.slice(0, 6) + '…' + addr.slice(-4) }
  // mask every address / 64-hex secret inside free text (used for the on-screen miner log)
  function maskText (t) {
    return String(t == null ? '' : t)
      .replace(/\b(0x)?[0-9a-fA-F]{64}\b/g, '[redacted-64hex]')
      .replace(/\b0x[0-9a-fA-F]{40}\b/g, maskWalletAddress)
      .replace(/\b[1-4]S[0-9a-fA-F]{40}\b/g, maskWalletAddress)
  }
  M.maskWalletAddress = maskWalletAddress; M.maskText = maskText
})(window.SCDOMining)
