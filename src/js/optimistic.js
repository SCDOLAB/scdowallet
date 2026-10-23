// Tap-to-success. The screen paints the next state before any network or chain wait.
// Claim confirmation (~14s) and agent registration run after the paint. No spinner.
'use strict'
;(function () {
  const CONFIRM_MS = 14000
  const COPY = {
    gift: 'Bonus SCDO received · agent started',
    confirming: 'Confirming…',
    confirmed: 'Confirmed',
    starting: 'Starting…'
  }

  function startView () {
    return { phase: 'starting', text: COPY.starting, blocking: false, spinner: false }
  }

  // HTTP 200 is the success paint. Anything else is a quiet retry, not the gift line.
  function claimFromHttp (res) {
    if (res && Number(res.status) === 200) {
      return {
        phase: 'confirming',
        text: COPY.gift,
        badge: COPY.confirming,
        blocking: false,
        spinner: false,
        confirmMs: CONFIRM_MS
      }
    }
    return { phase: 'retry', text: '', badge: '', retry: true, gentle: true, blocking: false, spinner: false }
  }

  function claimSettled (state, ok) {
    if (!state || state.phase !== 'confirming') return state
    if (ok) {
      return { phase: 'confirmed', text: COPY.gift, badge: COPY.confirmed, blocking: false, spinner: false }
    }
    return { phase: 'retry', text: '', badge: '', retry: true, gentle: true, blocking: false, spinner: false }
  }

  // Resolves only after the background wait. The confirming view is already on screen.
  function confirmInBackground (state, check, opts) {
    opts = opts || {}
    const wait = opts.waitMs == null ? CONFIRM_MS : opts.waitMs
    const sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }
    return sleep(wait).then(function () {
      return Promise.resolve().then(function () { return check ? check() : false }).then(function (ok) {
        return claimSettled(state, !!ok)
      }, function () {
        return claimSettled(state, false)
      })
    })
  }

  function createView () {
    return { phase: 'creating', kind: 'create', text: 'Creating…', blocking: false, spinner: false }
  }

  function cancelView () {
    return { phase: 'cancelling', kind: 'cancel', text: 'Cancelling…', blocking: false, spinner: false }
  }

  // Broadcast accepted: paint the link and the confirming badge. A miss is a quiet retry.
  function actionFromResult (state, res) {
    const kind = (state && state.kind) || 'create'
    if (res && res.ok) {
      return {
        phase: 'confirming',
        kind: kind,
        text: kind === 'cancel' ? 'Cancelling…' : 'Creating…',
        badge: COPY.confirming,
        link: res.link || '',
        hash: res.hash || '',
        id: res.id || '',
        blocking: false,
        spinner: false,
        confirmMs: CONFIRM_MS
      }
    }
    return { phase: 'retry', kind: kind, text: '', badge: '', retry: true, gentle: true, blocking: false, spinner: false }
  }

  function claimBannerHtml (view, t, esc) {
    if (!view || view.phase === 'idle' || view.spinner) return ''
    if (view.phase === 'retry') {
      return '<p class="agent-claim" id="claimBanner"><button type="button" class="shell-act sec" id="claimRetry" data-act="claimRetry">' + esc(t('claimRetry')) + '</button></p>'
    }
    if (view.phase !== 'confirming' && view.phase !== 'confirmed') return ''
    const cls = view.phase === 'confirmed' ? 'ok' : 'wait'
    const badge = view.phase === 'confirmed' ? t('claimConfirmed') : t('claimConfirming')
    return '<p class="agent-claim" id="claimBanner"><span id="claimGift">' + esc(t('claimGift')) + '</span> <span class="home-tx-tag ' + cls + '" id="claimBadge">' + esc(badge) + '</span></p>'
  }

  const api = {
    CONFIRM_MS: CONFIRM_MS,
    COPY: COPY,
    startView: startView,
    claimFromHttp: claimFromHttp,
    claimSettled: claimSettled,
    confirmInBackground: confirmInBackground,
    createView: createView,
    cancelView: cancelView,
    actionFromResult: actionFromResult,
    claimBannerHtml: claimBannerHtml
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOOptimistic = api
})()
