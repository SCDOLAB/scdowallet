// npm test: keystore compatibility (needs cmd/linux/client) + live chain read/sign checks
const { execFileSync } = require('child_process')
for (const t of ['gpu-preflight.js', 'keystore-compat.js', 'chain-read.js', 'remit-session.js']) execFileSync(process.execPath, [require('path').join(__dirname, t)], { stdio: 'inherit' })
