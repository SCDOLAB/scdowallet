// 3.0.2: record the commit being packed so Settings → About can show it. Runs before electron-builder.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
let commit = ''
try { commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim() } catch (e) {}
if (!/^[0-9a-f]{7,40}$/.test(commit)) commit = process.env.SCDO_BUILD_COMMIT || ''
fs.writeFileSync(path.join(__dirname, '..', 'build-info.json'), JSON.stringify({ commit, builtAt: new Date().toISOString() }, null, 2) + '\n')
console.log('build-info.json commit=' + (commit || '(unknown)'))
