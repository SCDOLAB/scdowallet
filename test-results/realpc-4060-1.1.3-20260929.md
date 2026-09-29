# ScdoWalletBeta 1.1.3 real-PC test – 2026-09-29 (UTC+8)
Upgrade on 4060 PC: 1.1.1 -> 1.1.3 (per-user /S install, exit 0). Backup: C:\SCDO\backups\wallet-20260929-160801\
All 11 accounts kept. Installer SHA256 fdf0e0eb3c1d40c26c2d935bc55cd9a0ade359db50fb6ba797099b1192c7e5fa

| Test | Result |
|---|---|
| Version shown | PASS (1.1.3) |
| Accounts 11/11 | PASS |
| Balance vs RPC (542.000 SCDO) | PASS |
| Send asset dropdown (SCDO/tUSDT/tAUD, step 1+2, keyboard) | PASS |
| Real send 0.001 SCDO -> T14 test acct, tx 0xf7991af3...9ef4, block 19920 | PASS |
| NVIDIA RTX 4060 detected | PASS |
| Node-only start/stop (graceful) | PASS |
| GPU mining from wallet (29.2-29.7 MH/s, 0 rejected, 10 blocks) | PASS |
| Graceful stop of rigel/proxy/geth | PASS |
| T14 upgrade 1.1.2 -> 1.1.3 from public URL (hash OK, backup C:\SCDO\backups\wallet-20260929-190007 T14-local time) | PASS |

Screenshots: /workspace/scdo-shots/wallet-113-4060/
Download: https://scdoscan.io/downloads/wallet/ScdoWalletBeta-1.1.3-win-x64-setup.exe (served from 104.254.244.44)
