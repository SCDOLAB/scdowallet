// npm test: keystore compatibility (needs cmd/linux/client) + live chain read/sign checks
const { execFileSync } = require('child_process')
for (const t of ['renderer-scope.js', 'zpow-mining.js', 'wallet-v8.js', 'parity-304.js', 'ai-cat.js', 'remit-route.js', 'gpu-preflight.js', 'miner-start-error.js', 'keystore-compat.js', 'chain-read.js', 'remit-session.js']) execFileSync(process.execPath, [require('path').join(__dirname, t)], { stdio: 'inherit' })
