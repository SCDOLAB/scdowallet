// miner log helper (spec: src/hooks/useMinerLogger.ts). The on-screen log tail is masked; the export button asks the main
// process to write a sanitized file (keys / hashes removed, addresses shortened, Windows user name removed).
;(function (M) {
  function displayLines (logTail, max) { return (logTail || []).slice(-(max || 80)).map(l => M.maskText(l)) }
  async function exportLogs () { return window.scdo.invoke('mining:exportLogs') }
  M.minerLogger = { displayLines, exportLogs }
})(window.SCDOMining)
