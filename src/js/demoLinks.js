// Home screen promo links (3.1.6). This file is the ONLY place these URLs live: the renderer reads
// window.SCDODemoLinks, and main.js reads module.exports to allow exactly these URLs in openExternalSafe.
// DEMO_WHEEL_URL is a PLACEHOLDER until Games Ledger confirms the demo deep link. Demo only, no real money.
;(function (root) {
  'use strict'
  const links = Object.freeze({
    DEMO_WHEEL_URL: 'https://wheel.apeccapital.org/games/stakewheel/?mode=demo',
    TELEGRAM_URL: 'https://t.me/scdowheelledger'
  })
  if (typeof module === 'object' && module.exports) module.exports = links
  if (root) root.SCDODemoLinks = links
})(typeof window !== 'undefined' ? window : null)
