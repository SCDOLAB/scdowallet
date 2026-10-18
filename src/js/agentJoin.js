// Start-my-agent helpers shared by the window and by tests.
// Live join fields go out through the existing Agent Ledger register.
// The referral-code lookup is POST /agent-ledger/api/refcode.
// SCDO_AGENT_FAKE=1 is only for tests and local dev.
'use strict'
;(function () {
  const JOIN = {
    base: 'https://scdo.com.au',
    fallbackBase: 'https://apeccapital.org',
    ledgerPrefix: '/agent-ledger/api',
    registerPath: '/agent-ledger/api/register',
    refcodePath: '/agent-ledger/api/refcode',
    joinPage: 'https://scdo.com.au/join',
    // Cleaned the same way as https://scdo.com.au/join : ref and src.
    tokenRe: /^[A-Za-z0-9_.-]{1,64}$/,
    addressRe: /^0x[0-9a-fA-F]{40}$/,
    registry: '0x458F974CcC4F1DB16Fe9F57489b134D7013bAD0d',
    chainId: 5680
  }

  function cleanToken (value) {
    const s = String(value == null ? '' : value).trim()
    return JOIN.tokenRe.test(s) ? s : ''
  }

  function validRef (value) { return cleanToken(value) !== '' }
  function validSrc (value) { return cleanToken(value) !== '' }

  // A pasted join link becomes its ref. Anything else is cleaned as a plain code.
  // Only https on scdo.com.au and apeccapital.org, or scdowallet://join, can carry a ref.
  function refFromPaste (raw) {
    const text = String(raw == null ? '' : raw).trim()
    if (!text) return ''
    let candidate = text
    if (!/^[a-z][a-z0-9+.-]*:/i.test(text) && /^(?:scdo\.com\.au|apeccapital\.org)(?:[/:?#]|$)/i.test(text)) {
      candidate = 'https://' + text
    }
    let u
    try { u = new URL(candidate) } catch (e) { return cleanToken(text) }
    const proto = String(u.protocol || '').toLowerCase()
    if (proto === 'scdowallet:') {
      const parsed = parseJoinUrl(candidate)
      return parsed.ok ? parsed.ref : ''
    }
    if (proto !== 'https:') return ''
    const host = String(u.hostname || '').toLowerCase()
    if (host !== 'scdo.com.au' && host !== 'apeccapital.org') return ''
    if (u.username || u.password) return ''
    if (u.port && u.port !== '443') return ''
    const refRaw = u.searchParams.get('ref')
    if (refRaw == null || refRaw === '') return ''
    return cleanToken(refRaw)
  }

  function parseJoinUrl (input) {
    const raw = String(input || '').trim()
    let u
    try { u = new URL(raw) } catch (e) { return { ok: false, reason: 'url' } }
    if (String(u.protocol || '').toLowerCase() !== 'scdowallet:') return { ok: false, reason: 'scheme' }
    const host = String(u.hostname || '').toLowerCase()
    if (host !== 'join') return { ok: false, reason: 'host' }
    const path = String(u.pathname || '').replace(/\/+$/, '')
    if (path && path !== '/') return { ok: false, reason: 'path' }
    const refRaw = u.searchParams.get('ref')
    const srcRaw = u.searchParams.get('src')
    const ref = refRaw == null || refRaw === '' ? '' : cleanToken(refRaw)
    const src = srcRaw == null || srcRaw === '' ? '' : cleanToken(srcRaw)
    return {
      ok: true,
      ref: ref,
      src: src,
      refRejected: !!(refRaw && !ref),
      srcRejected: !!(srcRaw && !src)
    }
  }

  function cleanSecret (value) {
    const s = String(value == null ? '' : value).trim()
    if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase()
    if (/^0x[0-9a-fA-F]{64}$/.test(s)) return s.slice(2).toLowerCase()
    if (/^[A-Za-z0-9_-]{43}$/.test(s)) return s
    return ''
  }

  // scdowallet://agent/start, invite/create, invite?s=&c=&n=5680, and join?ref=&src=.
  // A rejected invite link does not echo the secret.
  function parseWalletUrl (input) {
    const raw = String(input || '').trim()
    let u
    try { u = new URL(raw) } catch (e) { return { ok: false, reason: 'url' } }
    if (String(u.protocol || '').toLowerCase() !== 'scdowallet:') return { ok: false, reason: 'scheme' }
    const host = String(u.hostname || '').toLowerCase()
    const path = String(u.pathname || '').replace(/\/+$/, '').toLowerCase()
    if (host === 'join' && (!path || path === '/')) {
      const join = parseJoinUrl(raw)
      return Object.assign({ kind: 'join' }, join)
    }
    if (host === 'agent' && path === '/start') return { ok: true, kind: 'agent-start' }
    if (host === 'invite' && path === '/create') return { ok: true, kind: 'invite-create' }
    if (host === 'invite' && (!path || path === '/')) {
      const secret = cleanSecret(u.searchParams.get('s'))
      const contract = String(u.searchParams.get('c') || '').trim()
      const chain = String(u.searchParams.get('n') || '').trim()
      if (chain !== String(JOIN.chainId)) return { ok: false, kind: 'invite-claim', reason: 'chain' }
      if (!JOIN.addressRe.test(contract) || contract.toLowerCase() !== JOIN.registry.toLowerCase()) {
        return { ok: false, kind: 'invite-claim', reason: 'contract' }
      }
      if (!secret) return { ok: false, kind: 'invite-claim', reason: 'secret' }
      return { ok: true, kind: 'invite-claim', secret: secret, contract: JOIN.registry, chainId: JOIN.chainId }
    }
    return { ok: false, reason: 'host' }
  }

  function giftAmount (value) {
    const n = Math.floor(Number(value))
    if (!Number.isFinite(n) || n < 1) return 1
    if (n > 1000) return 1000
    return n
  }

  function inviteGiftHtml (t, esc, opts) {
    opts = opts || {}
    const n = giftAmount(opts.gift == null ? 1 : opts.gift)
    const view = opts.view || {}
    let status = ''
    if (view.phase === 'creating' || view.phase === 'cancelling') {
      status = '<p class="home-state" id="inviteBadge">' + esc(t(view.phase === 'cancelling' ? 'inviteCancelling' : 'inviteCreating')) + '</p>'
    } else if (view.phase === 'confirming' && view.link) {
      status = '<p class="lbl" id="inviteLinkLabel">' + esc(t('inviteLinkLabel')) + '</p><p class="mono" id="inviteLink">' + esc(view.link) + '</p><p class="home-state" id="inviteBadge">' + esc(t('claimConfirming')) + '</p>'
    } else if (view.phase === 'confirmed') {
      status = '<p class="home-state" id="inviteBadge">' + esc(t('claimConfirmed')) + '</p>'
    } else if (view.phase === 'retry') {
      status = '<p class="agent-claim" id="inviteRetry"><button type="button" class="shell-act sec" data-act="inviteCreateSubmit">' + esc(t('claimRetry')) + '</button></p>'
    }
    const cancel = opts.id
      ? '<button type="button" class="shell-act sec" id="inviteCancelBtn" data-act="inviteCancelSubmit">' + esc(t('inviteCancelBtn')) + '</button>'
      : ''
    return '<div class="page shell-home" id="inviteGift"><h1 class="shell-h">' + esc(t('inviteGiftTitle')) + '</h1>' +
      '<p class="home-lead" id="inviteGiftOwn">' + esc(t('inviteGiftOwn', { n: n })) + '</p>' +
      '<div class="field"><div class="lbl">' + esc(t('inviteGiftAsk')) + '</div>' +
      '<input class="inp" id="inviteGiftAmt" inputmode="numeric" maxlength="4" value="' + n + '" autocomplete="off"></div>' +
      '<div class="field"><div class="lbl">' + esc(t('invitePassword')) + '</div>' +
      '<input class="inp" id="invitePass" type="password" autocomplete="off"></div>' +
      '<div class="shell-actions"><button type="button" class="shell-act" id="inviteCreateBtn" data-act="inviteCreateSubmit">' + esc(t('inviteCreateBtn')) + '</button>' + cancel + '</div>' +
      status + '</div>'
  }

  function inviteClaimHtml (t, esc) {
    return '<div class="page shell-home" id="inviteClaim"><h1 class="shell-h">' + esc(t('inviteClaimTitle')) + '</h1>' +
      '<p class="home-lead" id="inviteClaimBody">' + esc(t('inviteClaimBody')) + '</p>' +
      '<p class="home-state">' + esc(t('inviteClaimConsent')) + '</p>' +
      '<div class="shell-actions"><button type="button" class="shell-act" id="inviteClaimBtn" data-act="inviteClaimSubmit">' + esc(t('inviteClaimBtn')) + '</button></div></div>'
  }

  function urlsFromArgv (argv) {
    const out = []
    for (const a of argv || []) {
      const s = String(a || '')
      if (s.toLowerCase().indexOf('scdowallet://') === 0 || s.toLowerCase().indexOf('scdowallet:') === 0) out.push(s)
    }
    return out
  }

  // First ref/src wins. A deep link beats a typed code. A later call does not change a lock.
  function lockAttribution (state, typedRef) {
    const s = {
      locked: !!(state && state.locked),
      pendingRef: state && state.pendingRef || '',
      pendingSrc: state && state.pendingSrc || '',
      ref: state && state.ref || '',
      src: state && state.src || ''
    }
    if (s.locked) return s
    const deep = cleanToken(s.pendingRef)
    const typed = cleanToken(typedRef)
    return {
      locked: true,
      pendingRef: '',
      pendingSrc: '',
      ref: deep || typed || '',
      src: cleanToken(s.pendingSrc)
    }
  }

  function rememberJoin (state, parsed) {
    const s = {
      locked: !!(state && state.locked),
      pendingRef: state && state.pendingRef || '',
      pendingSrc: state && state.pendingSrc || '',
      ref: state && state.ref || '',
      src: state && state.src || ''
    }
    if (s.locked || !parsed || !parsed.ok) return s
    if (parsed.ref) s.pendingRef = parsed.ref
    if (parsed.src) s.pendingSrc = parsed.src
    return s
  }

  function shard0Of (account) {
    const evm = account && account.evm ? String(account.evm).trim() : ''
    return JOIN.addressRe.test(evm) ? evm : ''
  }

  function validPayout (value) {
    const s = String(value || '').trim()
    if (JOIN.addressRe.test(s)) return s
    if (/^[1-4]S[0-9a-fA-F]{40}$/.test(s)) return s
    return ''
  }

  // Empty payout becomes the selected wallet's Shard0 address. A payout already set stays.
  function choosePayout (accounts, selectedFile, current) {
    const cur = validPayout(current)
    if (cur) return { payout: cur, changed: false, file: selectedFile || '' }
    const list = (accounts || []).filter(shard0Of)
    if (!list.length) return { payout: '', changed: false, file: '' }
    const sel = list.find(a => a.filename && a.filename === selectedFile) || list[0]
    return { payout: shard0Of(sel), changed: true, file: sel.filename || '' }
  }

  // Bookkeeping pool reward and the node service-fee address, only when each one is empty.
  function bookkeepingPatch (intent, payout) {
    const patch = {}
    const addr = validPayout(payout)
    if (!addr) return patch
    const reward = intent && intent.reward ? String(intent.reward).trim() : ''
    const node = intent && intent.payout ? String(intent.payout).trim() : ''
    if (!reward) patch.reward = addr
    if (!node) patch.payout = addr
    return patch
  }

  function deviceHash (installId, hashFn) {
    const id = String(installId || '')
    if (!id) return ''
    if (typeof hashFn === 'function') return hashFn(id)
    const crypto = require('crypto')
    return crypto.createHash('sha256').update(id, 'utf8').digest('hex')
  }

  function generatePassword (bytes) {
    const buf = bytes || require('crypto').randomBytes(12)
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    const specials = '!@#$%&*'
    let s = ''
    for (let i = 0; i < 9; i++) s += alphabet[buf[i] % alphabet.length]
    s += specials[buf[9] % specials.length]
    s += String(buf[10] % 10)
    if (!/[A-Z]/.test(s)) s = 'A' + s.slice(1)
    if (!/[a-z]/.test(s)) s = s.slice(0, 1) + 'a' + s.slice(2)
    return s.slice(0, 12)
  }

  function x402Reserve (json) {
    if (!json || typeof json !== 'object') return ''
    const direct = json.usdcWallet || json.x402Reserve || ''
    if (JOIN.addressRe.test(String(direct))) return String(direct)
    let blob = ''
    try { blob = JSON.stringify(json) } catch (e) { blob = '' }
    const m = blob.match(/eip155:8453:(0x[0-9a-fA-F]{40})/)
    return m ? m[1] : ''
  }

  function ledgerEntries (record) {
    const heals = record && Array.isArray(record.heals) ? record.heals : []
    const out = []
    for (let i = heals.length - 1; i >= 0 && out.length < 8; i--) {
      const h = heals[i] || {}
      const body = h.body || {}
      const text = [body.action, body.outcome].filter(Boolean).map(x => String(x)).join(' · ')
      if (text) out.push({ ts: h.ts || 0, text: text.slice(0, 180) })
    }
    return out
  }

  function cardStatus (view) {
    view = view || {}
    if (view.registered && view.online === true) return 'registered'
    if (view.registered && (view.online === false || view.reachable === false)) return 'offline'
    if (!view.registered && view.reachable === false) return 'offline'
    return 'pending'
  }

  function showBackupCard (s) {
    s = s || {}
    if (!s.phrasePending) return false
    if (s.dismissed) return false
    return !!(s.registered || (Array.isArray(s.entries) && s.entries.length > 0))
  }

  function claimBlocked (phrasePending) {
    return !!phrasePending
  }

  function joinBodyFields (extra) {
    extra = extra || {}
    const body = {}
    const ref = cleanToken(extra.ref)
    const src = cleanToken(extra.src)
    const device = String(extra.device || '').trim().toLowerCase()
    const usdc = String(extra.usdcWallet || '').trim()
    if (ref) body.ref = ref
    if (src) body.src = src
    if (/^[0-9a-f]{64}$/.test(device)) body.device = device
    if (JOIN.addressRe.test(usdc)) {
      body.usdcWallet = usdc
      body.x402Support = true
    }
    return body
  }

  function useFake (env) {
    return String((env || {}).SCDO_AGENT_FAKE || '') === '1'
  }

  function fakeRefcode () {
    return { ok: true, code: 'abc1234567', shareUrl: JOIN.joinPage + '?ref=abc1234567', fake: true }
  }

  function fakeAgent () {
    return {
      ok: true,
      fake: true,
      summary: { online: true, payout: '0x' + 'ab'.repeat(20) },
      heals: [{ ts: 1, body: { action: 'task:join', outcome: 'done' } }]
    }
  }

  function fakeRegistration () {
    return { services: [{ name: 'x402Usdc', endpoint: 'eip155:8453:0x' + 'cd'.repeat(20) }] }
  }

  function fallbackShareUrl (address) {
    const u = new URL(JOIN.joinPage)
    const addr = String(address || '').trim()
    if (addr) u.searchParams.set('ref', addr)
    u.searchParams.set('src', 'wallet')
    return u.toString()
  }

  function statusLabel (status, t) {
    if (status === 'starting') return t('agentStarting')
    if (status === 'registered') return t('agentRegistered')
    if (status === 'offline') return t('agentOffline')
    return t('agentPending')
  }

  // Green while this process has a started agent. Grey before that. A quiet ledger does not turn it grey.
  function agentPresence (model) {
    model = model || {}
    if (model.noWallet) return 'offline'
    const status = model.status || 'pending'
    if (status === 'starting' || status === 'registered' || model.started) return 'online'
    return 'offline'
  }

  function agentCardHtml (t, esc, model) {
    model = model || {}
    const status = model.status || 'pending'
    const addr = model.scdoAddress || '\u2014'
    const reserve = model.x402Reserve ? model.x402Reserve : 'pending'
    const book = model.bookkeeping || ''
    const entries = model.entries || []
    const presence = agentPresence(model)
    const presenceKey = presence === 'online' ? 'agentOnlineLine' : 'agentOfflineLine'
    const line = model.noWallet && !model.rewardLineHidden
      ? '<div class="agent-reward-line" id="agentRewardLine"><button type="button" class="agent-reward-tap" data-act="agentUseWallet">' + esc(t('agentNoReward')) + '</button><button type="button" class="home-backup-x" data-act="agentRewardDismiss" aria-label="' + esc(t('dismiss')) + '">\u2715</button></div>'
      : ''
    const list = entries.length
      ? '<ul class="agent-entries">' + entries.map(e => '<li>' + esc(e.text) + '</li>').join('') + '</ul>'
      : '<p class="home-state">' + esc(t('agentEntriesEmpty')) + '</p>'
    const bookBtn = model.noWallet ? '' : '<button type="button" class="shell-act" id="agentBookBtn" data-act="isleStart">' + esc(t('agentStartBook')) + '</button>'
    return '<section class="agent-card" id="agentCard"><h2>' + esc(t('agentCardTitle')) + '</h2>' + line +
      '<p class="agent-presence ' + presence + '" id="agentPresence">' + esc(t(presenceKey)) + '</p>' +
      '<p class="agent-row"><span>' + esc(t('agentStatus')) + '</span> <b id="agentStatus">' + esc(statusLabel(status, t)) + '</b></p>' +
      '<p class="agent-row"><span>' + esc(t('agentScdoAddr')) + '</span> <b class="mono" id="agentScdo">' + esc(addr) + '</b></p>' +
      '<p class="agent-row"><span>' + esc(t('agentX402')) + '</span> <b class="mono" id="agentX402">' + esc(reserve) + '</b></p>' +
      '<p class="agent-row"><span>' + esc(t('agentBook')) + '</span> <b id="agentBook">' + esc(book) + '</b></p>' +
      bookBtn + '<h3>' + esc(t('agentEntries')) + '</h3>' + list + '</section>'
  }

  function firstRunHtml (t, esc, opts) {
    opts = opts || {}
    const pending = cleanToken(opts.pendingRef)
    const input = '<input class="inp" id="joinRef" maxlength="64" value="' + esc(pending) + '" autocomplete="off" spellcheck="false"' + (pending ? ' readonly' : '') + '>'
    const btn = pending
      ? '<button type="button" class="shell-copy" id="joinRefCopy" data-act="copy" data-v="' + esc(pending) + '">' + esc(t('copy')) + '</button>'
      : '<button type="button" class="shell-copy" id="joinRefPaste" data-act="pasteJoinRef">' + esc(t('paste')) + '</button>'
    return '<div class="page shell-home first-run" id="firstRun"><h1 class="shell-h">' + esc(t('startAgent')) + '</h1>' +
      '<p class="home-lead" id="agentRewards">' + esc(t('agentRewards')) + '</p>' +
      '<p class="agent-stay" id="agentStayOpen">' + esc(t('agentStayOpen')) + '</p>' +
      '<div class="field"><div class="lbl">' + esc(t('inviteCodeAsk')) + '</div>' +
      '<div class="join-ref-row">' + input + btn + '</div></div>' +
      '<div class="shell-actions first-run-actions">' +
      '<button type="button" class="shell-act" id="startAgentBtn" data-act="startAgent">' + esc(t('startAgent')) + '</button>' +
      '<button type="button" class="shell-act sec" data-act="import">' + esc(t('importShort')) + '</button></div>' +
      agentCardHtml(t, esc, { noWallet: true, rewardLineHidden: !!opts.rewardLineHidden, status: 'pending', bookkeeping: t('homeLineIdle'), entries: [] }) +
      '</div>'
  }

  // One click: create when needed, lock ref, fill payout, register. A failed register still returns the wallet.
  async function runStart (deps) {
    deps = deps || {}
    let accounts = (deps.accounts || []).slice()
    let created = null
    if (!accounts.length) {
      const password = deps.password || generatePassword()
      created = await deps.create({ name: 'Agent', password: password, shard: '0' })
      if (!created || !created.ok) return { ok: false, error: (created && created.error) || 'create', wallet: null }
      accounts = [{ filename: created.file, evm: created.evm, pubkey: created.pubkey || '' }]
    }
    const locked = lockAttribution(deps.state, deps.typedRef)
    const choice = choosePayout(accounts, created ? created.file : deps.selectedFile, deps.currentPayout || '')
    const book = bookkeepingPatch(deps.intent, choice.payout)
    const payload = { payout: choice.payout, ref: locked.ref, src: locked.src, device: deps.device }
    if (typeof deps.register === 'function') {
      // One extra tick so the caller can paint before register starts.
      Promise.resolve().then(function () {}).then(function () { return deps.register(payload) }).catch(function () {})
    }
    return {
      ok: true,
      starting: true,
      wallet: accounts[0],
      created: created,
      locked: locked,
      choice: choice,
      book: book,
      registered: false,
      phrase: created && created.phrase ? created.phrase : ''
    }
  }

  const api = {
    JOIN: JOIN,
    cleanToken: cleanToken,
    refFromPaste: refFromPaste,
    validRef: validRef,
    validSrc: validSrc,
    parseJoinUrl: parseJoinUrl,
    parseWalletUrl: parseWalletUrl,
    cleanSecret: cleanSecret,
    giftAmount: giftAmount,
    inviteGiftHtml: inviteGiftHtml,
    inviteClaimHtml: inviteClaimHtml,
    urlsFromArgv: urlsFromArgv,
    lockAttribution: lockAttribution,
    rememberJoin: rememberJoin,
    choosePayout: choosePayout,
    bookkeepingPatch: bookkeepingPatch,
    deviceHash: deviceHash,
    generatePassword: generatePassword,
    x402Reserve: x402Reserve,
    ledgerEntries: ledgerEntries,
    cardStatus: cardStatus,
    agentPresence: agentPresence,
    showBackupCard: showBackupCard,
    claimBlocked: claimBlocked,
    joinBodyFields: joinBodyFields,
    useFake: useFake,
    fakeRefcode: fakeRefcode,
    fakeAgent: fakeAgent,
    fakeRegistration: fakeRegistration,
    fallbackShareUrl: fallbackShareUrl,
    agentCardHtml: agentCardHtml,
    firstRunHtml: firstRunHtml,
    runStart: runStart,
    validPayout: validPayout
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOAgentJoin = api
})()
