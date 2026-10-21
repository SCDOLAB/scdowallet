// Pay invoice screen. English text. One confirm tap, then the hand-off.
// The request is only the transfer itself.
'use strict'
;(function () {
  function payApi () {
    if (typeof window !== 'undefined' && window.SCDOPayInvoice && window.SCDOPayInvoice.parseInvoice) return window.SCDOPayInvoice
    return require('./parse.js')
  }
  function evmApi () {
    if (typeof window !== 'undefined' && window.SCDOPayEvm) return window.SCDOPayEvm
    return require('./evm681.js')
  }

  function esc (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    })
  }

  function errText (code) {
    const map = {
      BAD_URI: 'This is not a TON or Ethereum invoice link.',
      BAD_ADDRESS: 'The address is not valid.',
      BAD_CHECKSUM: 'The address checksum does not match.',
      BAD_AMOUNT: 'Enter the amount in exact decimal form.',
      NEGATIVE: 'The amount cannot be negative.',
      NOT_INTEGER: 'The amount must be an exact integer.',
      OVERFLOW: 'The amount is too large.',
      WRONG_FUNCTION: 'Only a transfer invoice can be paid.',
      VALUE_NOT_ALLOWED: 'A token transfer cannot include a separate value.',
      MISSING: 'The invoice is missing the recipient or the amount.',
      TOO_MANY_DECIMALS: 'This amount has more decimals than the token. It was not cut.',
      BAD_TOKEN: 'Choose a token this invoice can pay.',
      NO_QR: 'No QR code was found in that image.',
      BAD_IMAGE: 'That image could not be read.'
    }
    return map[code] || 'This invoice cannot be paid.'
  }

  function pad2 (b) {
    const t = b.toString()
    return t.length < 2 ? '0' + t : t
  }

  function remainText (exp, now) {
    if (exp == null) return 'No expiry'
    const t = BigInt(now)
    if (t >= exp) return 'Expired'
    let s = exp - t
    const days = s / 86400n
    s = s % 86400n
    const h = s / 3600n
    s = s % 3600n
    const m = s / 60n
    const sec = s % 60n
    const clock = pad2(h) + ':' + pad2(m) + ':' + pad2(sec)
    if (days > 0n) return 'Expires in ' + days.toString() + 'd ' + clock
    return 'Expires in ' + clock
  }

  function tokenLine (invoice) {
    if (invoice.known) return invoice.token
    const addr = invoice.tokenAddress || ''
    return addr ? ('Unknown token ' + addr) : 'Unknown token'
  }

  function detailHtml (invoice, diff, now) {
    const warn = diff && diff.differs ? '<div class="payinv-differs" id="payInvDiff">' + esc(diff.text) + '</div>' : ''
    const memoNote = invoice.memoLocalOnly ? '<div class="payinv-note">A Base USDC transfer does not carry this memo.</div>' : ''
    return '<div class="payinv-row"><span>Network</span><b id="payInvNetwork">' + esc(invoice.network) + '</b></div>' +
      '<div class="payinv-row"><span>Token</span><b id="payInvTokenLine">' + esc(tokenLine(invoice)) + '</b></div>' +
      '<div class="payinv-row"><span>Amount</span><b id="payInvAmount">' + esc(invoice.amountText) + '</b></div>' +
      '<div class="payinv-row"><span>Memo</span><b id="payInvMemoLine">' + esc(invoice.memoText) + '</b></div>' +
      memoNote +
      '<div class="payinv-row"><span>Recipient</span><b class="mono payinv-addr" id="payInvToLine">' + esc(invoice.to) + '</b>' +
      '<button type="button" class="shell-copy" data-act="copy" data-v="' + esc(invoice.to) + '">Copy address</button></div>' +
      '<div class="payinv-row"><span>Expiry</span><b id="payInvExp">' + esc(remainText(invoice.exp, now)) + '</b></div>' +
      warn
  }

  function opt (value, label, cur) {
    return '<option value="' + esc(value) + '"' + (cur === value ? ' selected' : '') + '>' + esc(label) + '</option>'
  }

  function entryHtml (state) {
    const s = state || {}
    const f = s.fields || {}
    const net = f.network === 'base' ? 'base' : 'ton'
    const token = f.token || (net === 'base' ? 'USDC' : 'TON')
    const tokenOpts = net === 'base'
      ? opt('USDC', 'USDC', token)
      : opt('TON', 'TON', token) + opt('USDT', 'USDT', token) + opt('other', 'Other jetton', token)
    const err = s.error ? '<div class="err" id="payInvErr">' + esc(errText(s.error)) + '</div>' : '<div class="err" id="payInvErr"></div>'
    const warn = s.diff && s.diff.differs ? '<div class="payinv-differs" id="payInvDiff">' + esc(s.diff.text) + '</div>' : '<div id="payInvDiff"></div>'
    return '<div class="payinv" id="payInv">' +
      '<h2>Pay invoice</h2>' +
      '<p class="payinv-note">Paste a ton: or ethereum: invoice, or import a QR image. This is a direct on-chain transfer.</p>' +
      '<div class="field"><div class="lbl">Invoice link</div>' +
      '<input class="inp" id="payInvUri" placeholder="ton://transfer/… or ethereum:…" autocomplete="off" spellcheck="false" autocapitalize="off" value="' + esc(f.uri || '') + '"></div>' +
      '<div class="payinv-actions"><button type="button" class="shell-go" id="payInvUse">Use this link</button></div>' +
      '<div class="payinv-drop" id="payInvDrop">Drop a QR image here, paste an image, or <button type="button" class="shell-copy" id="payInvFileBtn">Choose image</button></div>' +
      '<input id="payInvFile" type="file" hidden>' +
      '<h3>Enter it yourself</h3>' +
      '<div class="field"><div class="lbl">Network</div><select class="inp" id="payInvNet">' + opt('ton', 'TON', net) + opt('base', 'Base', net) + '</select></div>' +
      '<div class="field"><div class="lbl">Token</div><select class="inp" id="payInvToken">' + tokenOpts + '</select></div>' +
      '<div class="field"><input class="inp" id="payInvJetton" placeholder="Jetton master address" autocomplete="off" spellcheck="false" value="' + esc(f.jetton || '') + '"' + (net === 'ton' && token === 'other' ? '' : ' hidden') + '></div>' +
      '<div class="field"><div class="lbl">Recipient</div><input class="inp" id="payInvAddr" placeholder="Address" autocomplete="off" spellcheck="false" value="' + esc(f.to || '') + '"></div>' +
      '<div class="field"><div class="lbl">Amount</div><input class="inp" id="payInvAmt" placeholder="0.00" autocomplete="off" spellcheck="false" inputmode="decimal" value="' + esc(f.amount || '') + '"></div>' +
      '<div class="field"><div class="lbl">Memo (optional)</div><input class="inp" id="payInvMemo" placeholder="Memo" autocomplete="off" spellcheck="false" value="' + esc(f.memo || '') + '"></div>' +
      err + warn +
      '<div class="payinv-actions"><button type="button" class="shell-go" id="payInvManual">Review invoice</button>' +
      '<button type="button" class="shell-copy" data-act="closeModal" id="payInvClose">Close</button></div>' +
      '</div>'
  }

  function reviewHtml (invoice, diff, now) {
    const expired = invoice.expired(now)
    const blocked = expired ? '<div class="payinv-expired" id="payInvExpired">This invoice has expired.</div>' : ''
    const confirm = expired ? '' : '<button type="button" class="shell-go" id="payInvConfirm">Confirm</button>'
    return '<div class="payinv" id="payInv"><h2>Pay invoice</h2>' +
      detailHtml(invoice, diff, now) + blocked +
      '<div class="payinv-actions">' + confirm +
      '<button type="button" class="shell-copy" id="payInvBack">Back</button>' +
      '<button type="button" class="shell-copy" data-act="closeModal" id="payInvClose">Close</button></div></div>'
  }

  function handoffHtml (invoice, diff, now, opts) {
    if (invoice.expired(now)) return reviewHtml(invoice, diff, now)
    const P = payApi()
    const opt = opts || {}
    let wallets = ''
    if (invoice.scheme === 'ethereum' && !P.hasBaseKey()) {
      const links = evmApi().baseDappLinks(opt.pageUrl)
      const meta = links ? links.metamask : invoice.uri
      const coin = links ? links.coinbase : invoice.uri
      wallets = '<div class="payinv-note">Choose your wallet app. This wallet has no Base key.</div>' +
        '<div class="payinv-actions"><button type="button" class="shell-act" id="payInvMetaMask" data-open="' + esc(meta) + '">MetaMask</button>' +
        '<button type="button" class="shell-act" id="payInvCoinbase" data-open="' + esc(coin) + '">Coinbase / Base Wallet</button></div>'
    }
    if (invoice.scheme === 'ton' && !P.hasTonKey()) {
      wallets = '<div class="payinv-note">This wallet has no TON key.</div>'
    }
    const copies = '<button type="button" class="shell-copy" data-act="copy" data-v="' + esc(invoice.to) + '">Copy address</button>' +
      '<button type="button" class="shell-copy" data-act="copy" data-v="' + esc(invoice.display) + '">Copy amount (' + esc(invoice.display) + ')</button>'
    return '<div class="payinv" id="payInv"><h2>Pay invoice</h2>' +
      detailHtml(invoice, diff, now) + wallets +
      '<div class="qrwrap" id="payInvQr"></div>' +
      '<div class="payinv-actions"><button type="button" class="shell-go" id="payInvOpen" data-open="' + esc(invoice.uri) + '">Open in my wallet app</button></div>' +
      '<div class="payinv-actions">' + copies + '</div>' +
      '<div class="payinv-note" id="payInvNote">' + esc(invoice.note) + '</div>' +
      '<div class="payinv-actions"><button type="button" class="shell-copy" id="payInvBack">Back</button>' +
      '<button type="button" class="shell-copy" data-act="closeModal" id="payInvClose">Close</button></div></div>'
  }

  function setHtml (el, html) {
    if (typeof window !== 'undefined' && window.SafeDom) window.SafeDom.html(el, html)
    else if (el) el.innerHTML = html
  }

  function scaleOf (network, token) {
    const P = payApi()
    if (network === 'base') return { decimals: P.USDC_DECIMALS, symbol: 'USDC' }
    if (token === 'USDT') return { decimals: P.USDT_DECIMALS, symbol: 'USDT' }
    if (token === 'other') return { decimals: null, symbol: 'Unknown token' }
    return { decimals: P.TON_DECIMALS, symbol: 'TON' }
  }

  function mount (root, hooks) {
    const P = payApi()
    const h = hooks || {}
    const state = { phase: 'entry', invoice: null, diff: null, error: '', shownAt: 0n, fields: {} }

    function remember () {
      const net = root.querySelector('#payInvNet')
      if (!root.querySelector('#payInvUri') && !net) return
      state.fields = {
        uri: (root.querySelector('#payInvUri') || {}).value || '',
        network: net ? net.value : (state.fields.network || 'ton'),
        token: (root.querySelector('#payInvToken') || {}).value || state.fields.token || '',
        jetton: (root.querySelector('#payInvJetton') || {}).value || '',
        to: (root.querySelector('#payInvAddr') || {}).value || '',
        amount: (root.querySelector('#payInvAmt') || {}).value || '',
        memo: (root.querySelector('#payInvMemo') || {}).value || ''
      }
    }
    let timer = 0

    function paint () {
      remember()
      if (state.phase === 'handoff' && state.invoice) setHtml(root, handoffHtml(state.invoice, state.diff, P.nowSec(), { pageUrl: h.pageUrl }))
      else if (state.phase === 'review' && state.invoice) setHtml(root, reviewHtml(state.invoice, state.diff, P.nowSec()))
      else setHtml(root, entryHtml(state))
      state.shownAt = P.nowSec()
      bind()
      const box = root.querySelector('#payInvQr')
      if (box && state.invoice && state.phase === 'handoff') {
        if (h.qr) h.qr(box, state.invoice.uri)
        else if (typeof window !== 'undefined' && window.QRCode) {
          try { new window.QRCode(box, { text: state.invoice.uri, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M }) } catch (e) {}
        }
      }
    }

    function showInvoice (parsed) {
      if (!parsed || !parsed.ok) {
        state.error = parsed && parsed.code ? parsed.code : 'BAD_URI'
        state.phase = 'entry'
        paint()
        return
      }
      state.error = ''
      state.invoice = parsed.invoice
      state.diff = P.compareSend({
        invoiceAtomic: parsed.invoice.atomic,
        decimals: parsed.invoice.decimals,
        symbol: parsed.invoice.token,
        payerMinimumAtomic: h.payerMinimumAtomic,
        payerMinimum: h.payerMinimum,
        feeFromAmountAtomic: h.feeFromAmountAtomic,
        feeFromAmount: h.feeFromAmount
      })
      state.phase = 'review'
      paint()
    }

    // The QR decoder (vendor/jsQR.js, ~258 KB) is not loaded at startup; it is fetched the first time an image is picked.
    let qrLoading = null
    function loadQrDecoder () {
      if (window.jsQR) return Promise.resolve(true)
      if (qrLoading) return qrLoading
      qrLoading = new Promise(function (resolve) {
        const s = document.createElement('script')
        s.src = './src/js/vendor/jsQR.js'
        s.onload = function () { resolve(!!window.jsQR) }
        s.onerror = function () { qrLoading = null; resolve(false) }
        document.head.appendChild(s)
      })
      return qrLoading
    }

    function readImage (file) {
      if (file && window.FileReader && !window.jsQR) {
        loadQrDecoder().then(function (ok) {
          if (ok) { readImage(file); return }
          state.error = 'NO_QR'
          paint()
        })
        return
      }
      if (!file || !window.FileReader || !window.jsQR) {
        state.error = 'NO_QR'
        paint()
        return
      }
      const reader = new window.FileReader()
      reader.onerror = function () { state.error = 'BAD_IMAGE'; paint() }
      reader.onload = function () {
        const img = new window.Image()
        img.onload = function () {
          const canvas = document.createElement('canvas')
          const w = img.naturalWidth || img.width
          const ht = img.naturalHeight || img.height
          if (!w || !ht) { state.error = 'BAD_IMAGE'; paint(); return }
          canvas.width = w
          canvas.height = ht
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0)
          const image = ctx.getImageData(0, 0, w, ht)
          const code = window.jsQR(image.data, image.width, image.height)
          if (!code || !code.data) { state.error = 'NO_QR'; state.phase = 'entry'; paint(); return }
          showInvoice(P.parseInvoice(code.data))
        }
        img.onerror = function () { state.error = 'BAD_IMAGE'; paint() }
        img.src = String(reader.result || '')
      }
      reader.readAsDataURL(file)
    }

    function bind () {
      const use = root.querySelector('#payInvUse')
      if (use) use.addEventListener('click', function () {
        const input = root.querySelector('#payInvUri')
        showInvoice(P.parseInvoice(input ? input.value : ''))
      })
      const file = root.querySelector('#payInvFile')
      const fileBtn = root.querySelector('#payInvFileBtn')
      if (file) {
        file.accept = 'image/*'
        file.addEventListener('change', function () {
          const f = file.files && file.files[0]
          if (f) readImage(f)
        })
      }
      if (fileBtn && file) fileBtn.addEventListener('click', function () { file.click() })
      const drop = root.querySelector('#payInvDrop')
      if (drop) {
        drop.addEventListener('dragover', function (e) { e.preventDefault() })
        drop.addEventListener('drop', function (e) {
          e.preventDefault()
          const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
          if (f) readImage(f)
        })
      }
      const net = root.querySelector('#payInvNet')
      const token = root.querySelector('#payInvToken')
      function fillTokens () {
        if (!net || !token) return
        const base = net.value === 'base'
        const cur = token.value
        const opts = base ? [['USDC', 'USDC']] : [['TON', 'TON'], ['USDT', 'USDT'], ['other', 'Other jetton']]
        token.replaceChildren()
        for (let i = 0; i < opts.length; i++) {
          const o = document.createElement('option')
          o.value = opts[i][0]
          o.textContent = opts[i][1]
          if (opts[i][0] === cur) o.selected = true
          token.appendChild(o)
        }
        const jetton = root.querySelector('#payInvJetton')
        if (jetton) {
          if (!base && token.value === 'other') jetton.removeAttribute('hidden')
          else jetton.setAttribute('hidden', '')
        }
      }
      if (net) net.addEventListener('change', fillTokens)
      if (token) token.addEventListener('change', fillTokens)
      const manual = root.querySelector('#payInvManual')
      if (manual) manual.addEventListener('click', function () {
        remember()
        const fields = {
          network: net ? net.value : 'ton',
          token: token ? token.value : 'TON',
          jetton: state.fields.jetton || '',
          to: state.fields.to || '',
          amount: state.fields.amount || '',
          memo: state.fields.memo || ''
        }
        const built = P.invoiceFromManual(fields)
        if (!built.ok && built.code === 'TOO_MANY_DECIMALS') {
          const scale = scaleOf(fields.network, fields.token)
          state.error = built.code
          state.diff = P.compareSend({
            invoiceAtomic: built.wouldCutAtomic,
            decimals: scale.decimals,
            symbol: scale.symbol,
            typedText: fields.amount
          })
          state.phase = 'entry'
          paint()
          return
        }
        state.diff = null
        showInvoice(built)
      })
      const confirm = root.querySelector('#payInvConfirm')
      if (confirm) confirm.addEventListener('click', function () {
        if (!state.invoice || state.invoice.expired(P.nowSec())) {
          state.phase = 'review'
          paint()
          return
        }
        state.phase = 'handoff'
        paint()
      })
      const back = root.querySelector('#payInvBack')
      if (back) back.addEventListener('click', function () {
        state.phase = 'entry'
        state.error = ''
        paint()
      })
      const buttons = root.querySelectorAll('[data-open]')
      for (let i = 0; i < buttons.length; i++) {
        buttons[i].addEventListener('click', function () {
          const url = this.getAttribute('data-open')
          if (url && h.open) h.open(url)
        })
      }
    }

    function onPaste (e) {
      if (!root.isConnected) {
        root.ownerDocument.removeEventListener('paste', onPaste)
        return
      }
      const items = e.clipboardData && e.clipboardData.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          const file = items[i].getAsFile()
          if (file) {
            e.preventDefault()
            readImage(file)
          }
          return
        }
      }
    }
    root.ownerDocument.addEventListener('paste', onPaste)
    timer = setInterval(function () {
      if (!root.isConnected) { clearInterval(timer); return }
      if (!state.invoice || state.phase === 'entry') return
      const now = P.nowSec()
      if (!!state.invoice.expired(state.shownAt) !== !!state.invoice.expired(now)) {
        state.phase = 'review'
        paint()
        return
      }
      const el = root.querySelector('#payInvExp')
      if (el) el.textContent = remainText(state.invoice.exp, now)
    }, 1000)
    paint()
    return {
      close: function () { clearInterval(timer) }
    }
  }

  const api = payApi()
  api.esc = esc
  api.errText = errText
  api.remainText = remainText
  api.entryHtml = entryHtml
  api.reviewHtml = reviewHtml
  api.handoffHtml = handoffHtml
  api.mount = mount
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOPayInvoice = api
})()
