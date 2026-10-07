// npm test: keystore compatibility (platform client binary) + live chain read/sign checks
const { execFileSync } = require('child_process')
for (const t of ['zpow-mining.js', 'gpu-preflight.js', 'keystore-compat.js', 'chain-read.js', 'remit-session.js']) execFileSync(process.execPath, [require('path').join(__dirname, t)], { stdio: 'inherit' })
