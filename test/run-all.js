// npm test: keystore compatibility (needs cmd/linux/client) + live chain read/sign checks
const { execFileSync } = require('child_process')
for (const t of ['keystore-compat.js', 'chain-read.js']) execFileSync(process.execPath, [require('path').join(__dirname, t)], { stdio: 'inherit' })
