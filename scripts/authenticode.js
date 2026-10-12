// Windows Authenticode: sign only when the pipeline has a certificate secret.
'use strict'

function plan (env) {
  env = env || {}
  const link = String(env.WIN_CSC_LINK || env.CSC_LINK || '').trim()
  const password = String(env.WIN_CSC_KEY_PASSWORD || env.CSC_KEY_PASSWORD || '')
  if (!link) return { sign: false, reason: 'no CSC_LINK or WIN_CSC_LINK signing secret' }
  return {
    sign: true,
    env: {
      CSC_LINK: link,
      CSC_KEY_PASSWORD: password,
      CSC_IDENTITY_AUTO_DISCOVERY: 'true'
    }
  }
}

function apply (env) {
  const p = plan(env || process.env)
  if (!p.sign) {
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    console.log('Authenticode: skipped (' + p.reason + ')')
    return p
  }
  process.env.CSC_LINK = p.env.CSC_LINK
  if (p.env.CSC_KEY_PASSWORD) process.env.CSC_KEY_PASSWORD = p.env.CSC_KEY_PASSWORD
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'true'
  console.log('Authenticode: signing (CSC_LINK is set)')
  return p
}

module.exports = { plan, apply }
