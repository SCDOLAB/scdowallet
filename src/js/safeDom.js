// SCDO Wallet 2.0.1 safe rendering.
// The CSP enforces Trusted Types (require-trusted-types-for 'script'), so assigning a plain string to innerHTML throws.
// All markup goes through SafeDom.html(), which sanitizes it with an allowlist (tags, attributes, URL schemes) first.
// Dynamic values inside templates are still escaped with SafeDom.esc(); simple text updates use textContent.
'use strict'
;(function () {
  const TAGS = new Set(['div', 'span', 'b', 'i', 'em', 'strong', 'small', 'br', 'hr', 'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li',
    'button', 'input', 'select', 'option', 'label', 'details', 'summary', 'img', 'pre', 'code', 'nav', 'section', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'canvas'])
  const ATTRS = new Set(['class', 'id', 'style', 'title', 'type', 'placeholder', 'value', 'disabled', 'selected', 'checked', 'readonly',
    'maxlength', 'inputmode', 'autocomplete', 'src', 'alt', 'role', 'hidden', 'open', 'for', 'name', 'width', 'height', 'tabindex', 'colspan', 'rowspan', 'spellcheck'])
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const okSrc = (v) => /^\.\/src\/img\/[\w./-]+$/.test(v) || /^\.\/assets\/[\w./-]+$/.test(v) || /^data:image\/(png|gif|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)
  const tt = window.trustedTypes
  // private pass-through policy: only used below to parse markup into an inert <template> before it is cleaned
  const parsePolicy = tt ? tt.createPolicy('scdo-parse', { createHTML: (s) => s }) : { createHTML: (s) => s }
  function clean (markup) {
    const tpl = document.createElement('template')
    tpl.innerHTML = parsePolicy.createHTML(String(markup))
    const walk = (node) => {
      for (const el of Array.from(node.children)) {
        const tag = el.tagName.toLowerCase()
        if (!TAGS.has(tag)) { el.remove(); continue }
        for (const a of Array.from(el.attributes)) {
          const n = a.name.toLowerCase()
          const keep = ATTRS.has(n) || /^data-[\w-]+$/.test(n) || /^aria-[\w-]+$/.test(n)
          if (!keep || (n === 'src' && !okSrc(a.value)) || (n === 'style' && /url\s*\(|expression\s*\(|@import/i.test(a.value))) el.removeAttribute(a.name)
        }
        walk(el)
      }
    }
    walk(tpl.content)
    const div = document.createElement('div'); div.appendChild(tpl.content)
    return div.innerHTML
  }
  const htmlPolicy = tt ? tt.createPolicy('scdo-html', { createHTML: (s) => clean(s) }) : { createHTML: (s) => clean(s) }
  // backstop for third-party code (qrcode.js table fallback): any other string sink is sanitized the same way
  if (tt) { try { tt.createPolicy('default', { createHTML: (s) => clean(s), createScript: () => null, createScriptURL: () => null }) } catch (e) {} }

  const SafeDom = {
    esc,
    html (el, markup) { if (el) el.innerHTML = htmlPolicy.createHTML(markup) },
    clear (el) { if (el) el.replaceChildren() },
    text (el, s) { if (el) el.textContent = s == null ? '' : String(s) },
    // "<spinner> text" status line without markup
    spin (el, s) { if (!el) return; const sp = document.createElement('span'); sp.className = 'spin'; el.replaceChildren(sp, document.createTextNode(s ? ' ' + s : '')) },
    // value + small unit span, e.g. "1.234 <span>SCDO</span>"
    valueUnit (el, v, unit) { if (!el) return; const u = document.createElement('span'); u.textContent = unit; el.replaceChildren(document.createTextNode(String(v) + ' '), u) },
    // tiny element builder: h('div', { class: 'x', text: '...' }, child, ...)
    h (tag, props, ...kids) {
      const el = document.createElement(tag)
      for (const [k, v] of Object.entries(props || {})) {
        if (v == null || v === false) continue
        if (k === 'text') el.textContent = String(v)
        else if (k === 'class') el.className = v
        else if (k === 'style') el.setAttribute('style', v)
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
        else el.setAttribute(k, v === true ? '' : String(v))
      }
      for (const c of kids.flat()) { if (c == null || c === false) continue; el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c) }
      return el
    }
  }
  window.SafeDom = Object.freeze(SafeDom)
})()
