// Home 開始記帳 (Agent card #agentBookBtn, data-act="isleStart") must use the bookkeeping
// page's device start/stop. A click while already bookkeeping used to return immediately,
// so the button stayed on Start and did nothing. An empty shard pick must say so.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'src/js/app112.js'), 'utf8')
const join = fs.readFileSync(path.join(root, 'src/js/agentJoin.js'), 'utf8')

assert.ok(/id="agentBookBtn" data-act="isleStart"/.test(join), 'Agent panel button dispatches isleStart')
const i = app.indexOf("case 'isleStart':")
assert.ok(i > 0, 'isleStart case exists')
const body = app.slice(i, app.indexOf('break\n      }', i))
assert.ok(body.includes('agentBookToggle()'), 'isleStart runs the home bookkeeping toggle')
assert.ok(!/miningBusy\(\)/.test(body), 'already-running click must not be swallowed')
const start = app.indexOf('async function agentBookToggle')
const fn = app.slice(start, app.indexOf('async function homeMineToggle ()', start))
assert.ok(fn.includes('planHomeBookClick'), 'toggle asks the bookkeeping-page click plan')
assert.ok(fn.includes('homeMineToggleDevice(device)'), 'toggle starts and stops through the bookkeeping page')
assert.ok(fn.includes("toast(T('shellNeedChain')"), 'an empty shard pick is visible')

// applyCatPlan must toast the combined say + failure text when opt.toast is set.
const a = app.indexOf('async function applyCatPlan')
const ap = app.slice(a, app.indexOf('\n  }\n', a))
assert.ok(/fails\.join/.test(ap) && /opt && opt\.toast\) toast\(say/.test(ap), 'applyCatPlan toasts failures')

// Behavioural check of the same contract with a tiny harness.
async function applyCatPlan (plan, opt, runCatAction, toast) {
  const fails = []
  for (const action of plan.actions || []) { const r = await runCatAction(action); if (r && r.fail) fails.push(r.fail) }
  const say = (plan.say || '') + fails.join('')
  if (say && opt && opt.toast) toast(say)
}
const toasts = []
applyCatPlan({ say: '', actions: [{ do: 'start' }] }, { quiet: true, toast: true }, async () => ({ fail: '記帳池還沒開放' }), (m) => toasts.push(m))
  .then(() => { assert.deepStrictEqual(toasts, ['記帳池還沒開放']); console.log('start-bookkeeping-feedback: ok') })
  .catch((e) => { console.error(e); process.exit(1) })
