// Fetches the wallet remote config. apeccapital.org first, scdoscan.io second, then the local cache.
// A missing or invalid document leaves the built-in defaults in place.
'use strict'
const fs = require('fs')
const path = require('path')
const endpoints = require('./endpoints')

async function refresh (opts) {
  opts = opts || {}
  const urls = opts.urls || endpoints.REMOTE_CONFIG_URLS
  const fetchImpl = opts.fetchImpl || (url => endpoints.getJson(url, opts.timeoutMs || 4000))
  const errors = []
  let config = null
  let from = null
  for (const url of urls) {
    try {
      const doc = endpoints.normalizeRemote(await fetchImpl(url))
      if (doc) { config = doc; from = url; break }
      errors.push(url + ': empty')
    } catch (e) { errors.push(url + ': ' + (e && e.message || e)) }
  }
  if (!config && opts.cacheFile) {
    try {
      const cached = endpoints.normalizeRemote(JSON.parse(fs.readFileSync(opts.cacheFile, 'utf8')))
      if (cached) { config = cached; from = 'cache' }
    } catch (e) { errors.push('cache: ' + (e && e.message || e)) }
  }
  if (config && opts.cacheFile && from !== 'cache') {
    try {
      fs.mkdirSync(path.dirname(opts.cacheFile), { recursive: true })
      fs.writeFileSync(opts.cacheFile, JSON.stringify(config))
    } catch (e) { errors.push('write: ' + (e && e.message || e)) }
  }
  return { config, from, errors }
}

module.exports = { refresh }
