// 3.1.15 RC3: the 開始記帳 button (Agent panel #agentBookBtn and status island, data-act="isleStart")
// must surface the start result as a toast. Before, it called askCat('開始記帳') with no options,
// so a failed start (NO_POOL) only went into the closed AI cat log and the click looked dead.
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
const call = body.match(/askCat\('開始記帳'(,\s*\{[^}]*\})?\)/)
assert.ok(call, 'isleStart asks the cat to start bookkeeping')
assert.ok(call[1] && /toast:\s*true/.test(call[1]), 'isleStart must pass { toast: true } so failures are visible')

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
