// 3.0.2: record the commit being packed so Settings → About can show it. Runs before electron-builder.
// The packed version is package.json. A second number fails the release.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { VERSION, checkRuntime } = require('../src/version')
const pkg = require('../package.json')
const check = checkRuntime(pkg.version)
if (!check.ok || VERSION !== String(pkg.version)) {
  console.error(check.error || ('release self-check failed: reported ' + VERSION + ' != package ' + pkg.version))
  process.exit(1)
}
const root = path.join(__dirname, '..')
const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
const updaterSrc = fs.readFileSync(path.join(root, 'src', 'updater.js'), 'utf8')
if (/displayVersion\s*\|\|\s*app\.getVersion/.test(mainSrc) || /electron\.app\.getVersion\(\)/.test(updaterSrc)) {
  console.error('release self-check failed: a second version is still reported')
  process.exit(1)
}
let commit = ''
try { commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() } catch (e) {}
if (!/^[0-9a-f]{7,40}$/.test(commit)) commit = process.env.SCDO_BUILD_COMMIT || ''
fs.writeFileSync(path.join(root, 'build-info.json'), JSON.stringify({ version: VERSION, commit, builtAt: new Date().toISOString() }, null, 2) + '\n')
console.log('build-info.json version=' + VERSION + ' commit=' + (commit || '(unknown)'))
