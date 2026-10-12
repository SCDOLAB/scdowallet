# Desktop backup audit (Windows / Mac)

Audit of SCDO Wallet 3.1.0 desktop, then the optional backup page added on this branch. Backup is not mandatory. There is no quiz. Nothing in the wallet waits on it.

## (1) After create, is a mnemonic or keystore backup forced?

It was not. Create wrote an encrypted keystore and closed. The new account never showed a recovery phrase, and nothing checked that the user had a copy.

Now, a new account (no pasted key) is a 12-word BIP39 phrase at `m/44'/60'/0'/0/0` with an empty passphrase. That private key is what the keystore stores. After create, the backup page shows the 12 words, the Shard0 EVM address, and the date, with four choices:

- 儲存為圖片 — PNG via a save dialog
- 儲存為檔案 — `.txt` via a save dialog
- 我已抄寫 — counts as backed up
- 稍後備份 — goes straight to Home and does not count as backed up

Saving either file also counts as backed up. The page can be closed the same way as 稍後備份. A pasted private key or an imported 12-word phrase does not open this page.

## (2) Is there a persistent reminder until backup is done?

There was not. Settings only described a manual keyfile copy.

Home now shows a small yellow banner, 溫馨提醒：這個錢包還沒備份助記詞, until that new account is saved or marked 我已抄寫. Tapping it opens the same save page. In the same session the words are still on screen; after a restart, viewing or saving them asks for the keyfile password. Older accounts, which have no phrase, get one small dismissible reminder, 溫馨提醒：帳戶檔案可以再存一份到離線的地方. Dismissing it once keeps it dismissed. Neither reminder blocks receive, send, or mining.

## (3) Does showing or exporting the phrase or private key need the password?

There is still no screen that prints a raw private key. Unlock, send, and remit decrypt only in the main process and require the keyfile password.

The phrase is shown once immediately after create, because that step just checked the new password. Saving the PNG or `.txt` on that same page uses those words. Opening the phrase again later (`phrase:show`) requires the password, and a wrong password returns no words. The saved PNG and `.txt` are plaintext copies of the phrase, the Shard0 EVM address, the date, and 溫馨提醒：這個檔案就是錢包鑰匙，建議另存一份到離線的地方. Until the user finishes, a second copy of the phrase is sealed with scrypt and AES-256-GCM under `~/.ScdoWallet/mnemonic/` and is removed when they save, tap 我已抄寫, or delete the account.

## (4) Where are keys stored, and does uninstall delete them?

Keystores stay in `~/.ScdoWallet/account/` on Windows and Mac (`os.homedir()`). Electron `userData` is a different folder, `%APPDATA%\ScdoWalletBeta` on Windows and `~/Library/Application Support/ScdoWalletBeta` on Mac (logs, miner data, update files).

The NSIS uninstaller does not delete either folder by default. `package.json` leaves `deleteAppDataOnUninstall` unset, and electron-builder's default is false (the flag is for the one-click installer; this app sets `oneClick` to false). `build/installer.nsh` has no `customUnInstall` and does not remove AppData or `~/.ScdoWallet`. Reinstall replaces the program directory only. Deleting the Mac `.zip` app does not delete `~/.ScdoWallet`.

## (5) Is there an auto backup to ~/Documents/ScdoWallet, and is it encrypted?

Not on create. The existing keyfile action copies the encrypted keystore (go-scdo v1, scrypt N=2^18, AES-128-CTR) to `~/Documents/ScdoWallet/備份/<date>/` on Mac and `%USERPROFILE%\Documents\ScdoWallet\備份\<date>\` on Windows, mode `0600`. That runs when the user taps backup, or automatically just before an account is deleted. It is not a plaintext phrase.

The new phrase save dialog defaults to `~/Documents/ScdoWallet` (`SCDO-backup-<date>.png` or `.txt`). Those files are the readable backup, so they are not encrypted. The user picks the final path in the dialog.
