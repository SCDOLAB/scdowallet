# 3.1.0 copy tone

On-screen notes remind. They do not prohibit, accuse, threaten, or enforce.

No user-facing line said 嚴禁, 禁止, 違者, 將被封, 後果自負, 不得, 警告！, "strictly prohibited", "will be banned", "you must not", or "not available in some regions". No region-exclusion line was removed because none was present. Home, mining, and receive had no KYC wording. Identity fields stay only on the remittance step, and that sentence is now a neutral reminder.

Safety facts stay: keep the keyfile and password, look at the address, a send on the chain cannot be taken back, eight decimal places, the official miner check.

## src/js/i18n112.js (華語)

- warnContract: 收款方是智慧合約，不是一般帳戶。如果合約無法處理，傳送到合約的幣可能會遺失。 → 溫馨提醒：收款方是智慧合約，不是一般帳戶。如果合約沒有處理這筆的方式，幣可能到不了你想去的地方。
- warnTokenContract: 收款方就是這個代幣的合約本身。傳送到代幣自身合約的代幣通常會永久遺失。 → 溫馨提醒：收款方就是這個代幣的合約本身。轉到代幣自己的合約，通常沒辦法再拿回來。
- warnNoChecksum: 這個地址全是小寫或全是大寫，沒有可以發現打錯字的校驗碼。請逐一核對每個字元。 → 溫馨提醒：這個地址全是小寫或全是大寫，沒有可以發現打錯字的校驗碼。可以逐字再看一次。
- ackWarnings: 我已閱讀上面的警告，要繼續 → 我看過上面的提醒，要繼續
- errZeroAddr: 零地址（0x000…000）不能接收轉帳。 → 溫馨提醒：零地址（0x000…000）收不到轉帳。
- errBcastTimeout: 網路沒有及時回應。轉帳可能仍會成功：它在「交易記錄」裡顯示為待確認，錢包會持續檢查並重新傳送。請不要再傳送一次。 → 溫馨提醒：網路沒有及時回應。轉帳可能仍會成功，它在「交易記錄」裡顯示為待確認，錢包會持續檢查並重新傳送。可以先看那一筆，再決定要不要重送。
- delHasBal: 這個帳戶還有餘額！刪除後，如果丟失備份和密碼，這些幣將永遠無法找回。建議先把幣轉到其他帳戶。 → 溫馨提醒：這個帳戶還有餘額。可以先把幣轉到別的帳戶，並留好備份和密碼。
- backupHint: 把帳戶檔案複製到「文件\ScdoWallet\備份」。帳戶檔案和密碼一起才能恢復帳戶，請另外再存一份到隨身碟。 → 溫馨提醒：把帳戶檔案複製到「文件\ScdoWallet\備份」。帳戶檔案和密碼放在一起才恢復得了，另外再存一份到隨身碟。
- backupHintDarwin: 把帳戶檔案複製到「~/Documents/ScdoWallet」。帳戶檔案和密碼一起才能恢復帳戶，請另外再存一份到隨身碟。 → 溫馨提醒：把帳戶檔案複製到「~/Documents/ScdoWallet」。帳戶檔案和密碼放在一起才恢復得了，另外再存一份到隨身碟。
- updVerifyFail: 已連線到更新伺服器，但更新資訊的簽名驗證沒有通過，為了安全不會安裝。請稍後再試，或到 scdoscan.io 下載最新版。 → 溫馨提醒：已連上更新伺服器，但更新資訊的簽名對不上，所以這次沒有安裝。可以稍後再試，或到 scdoscan.io 下載最新版。
- isleTipWaitExplain: 帳本還沒下載完。下載完之後會自己開始挖，不用再按一次。 → 溫馨提醒：帳本還沒下載完。下載完之後會自己開始挖，不用再按一次。
- receiveNew: 這是 Shard0 EVM 收款地址（0x 開頭）（鏈 ID 5680）。只用來接收 Shard0 EVM 的 SCDO 和代幣，Shard1–Shard4 帳戶的地址不能收 Shard0 EVM 資產。 → 溫馨提醒：這是 Shard0 EVM 收款地址（0x 開頭，鏈 ID 5680），用來收 Shard0 EVM 的 SCDO 和代幣。Shard1–Shard4 的地址收的是那一條鏈自己的 SCDO。
- receiveOld: 這是 Shard{n} 地址。只用來接收 Shard{n} 的 SCDO。 → 溫馨提醒：這是 Shard{n} 地址，用來接收 Shard{n} 的 SCDO。
- errOldAddrToNew: 這是 Shard1–Shard4 帳戶的地址。Shard0 EVM 只能轉到 0x 開頭的地址。 → 溫馨提醒：這是 Shard1–Shard4 帳戶的地址。Shard0 EVM 轉到 0x 開頭的地址。
- errCross: 不支援跨分片轉帳：只能轉到 Shard{n} 的地址（{n}S0…）。 → 溫馨提醒：這筆留在同一條分片。收款地址用 Shard{n}（{n}S0…）。
- reviewNote: 請仔細核對收款地址，轉出後無法撤回。 → 溫馨提醒：送出前再看一次收款地址。鏈上轉出之後沒辦法收回。
- pwRule: 密碼必須包含大小寫字母、數字和特殊字元，8-15位 → 溫馨提醒：密碼用大小寫字母、數字和特殊字元，長度 8–15 位。
- createSave: 請記住密碼並備份帳戶檔案：忘記密碼就無法取回資產。 → 溫馨提醒：密碼和帳戶檔案請另外留一份。少了其中一樣，這個帳戶就恢復不了。
- errName: 檔名不能為空 → 溫馨提醒：檔名再填一個字。
- errShard: 分片號須為 1、2、3 或 4 → 溫馨提醒：分片號是 1、2、3 或 4。
- errKey: 私鑰須為以0x開頭66位數字字母字串 → 溫馨提醒：私鑰是 0x 後面 64 位數字或字母。
- delWarnBal: 這個帳戶還有 {v}！刪除後，如果丟失備份和密碼，這些幣將永遠無法找回。建議先把幣轉到其他帳戶。 → 溫馨提醒：這個帳戶還有 {v}。可以先把幣轉到別的帳戶，並留好備份和密碼。
- delHint: 密碼正確且勾選後才能繼續；下一步還會再確認一次。 → 溫馨提醒：填對密碼並勾選之後，就可以到下一步再確認一次。
- aboutHashHow: 核對方法：Windows 在命令提示字元執行 certutil -hashfile 安裝檔名稱 SHA256，Mac 執行 shasum -a 256 安裝檔名稱，結果要和上面完全一樣。 → 溫馨提醒：核對時，Windows 在命令提示字元執行 certutil -hashfile 安裝檔名稱 SHA256，Mac 執行 shasum -a 256 安裝檔名稱。算出來的結果和上面那一串對得上就可以。
- wizNeedAmt: 金額要大於 0 → 溫馨提醒：金額大於 0。
- shellAmtLimit: 最多小數點後 8 位 → 溫馨提醒：小數點後最多 8 位
- st_SHA256_MISSING: 沒辦法確認挖礦程式是不是官方版本，為了安全已經停止啟動。請重新安裝 SCDO Wallet。 → 溫馨提醒：還沒能確認挖礦程式是不是官方版本，所以這次沒有啟動。重新安裝 SCDO Wallet 就可以。
- st_SHA256_MISMATCH: 下載的挖礦程式跟官方版本對不上，為了安全已經停止啟動。請重新安裝或再試一次。 → 溫馨提醒：下載的挖礦程式跟官方版本對不上，所以這次沒有啟動。重新安裝或再試一次就可以。
- remitZero: 進入匯款不需要填寫姓名、證件、電話或任何身份資料。只要解鎖這個錢包並簽名。 → 匯款這一步不需要填寫姓名、證件或電話。解鎖這個錢包並簽名即可。
- remitZeroEn: No identity form. Unlock this wallet and sign. The signature is not a coin transfer. → This step does not ask for a name, an ID or a phone number. Unlock this wallet and sign. The signature is not a coin transfer.
- remitAddr: 登入地址（只能是這個地址） → 登入地址（就是這個地址）
- remitForeign: 不能用別人的地址登入。地址 A 的簽名無法開啟地址 B 的工作階段或帳本。 → 溫馨提醒：登入用的是你自己的地址。地址 A 的簽名會打開地址 A 的工作階段和帳本。
- remitOwnOnly: 帳本只屬於簽名的那個地址。換成別人的地址不會登入成功。 → 溫馨提醒：帳本跟著簽名的那個地址。用同一個地址就能讀到。
- relNotes 3.1.0 first item (new): 畫面上的說明改成溫馨提醒。助記詞、私鑰和密碼只留在你自己的設備。送出前可以再看一次收款地址。

## src/js/i18n112.js (English)

- warnContract: The recipient is a smart contract, not a normal account. Coins sent to a contract may be lost if it cannot handle them. → A reminder: the recipient is a smart contract, not a normal account. If the contract has no way to handle this transfer, the coins may not arrive where you expect.
- warnTokenContract: The recipient is the token contract itself. Tokens sent to their own contract are usually lost for good. → A reminder: the recipient is the token contract itself. Tokens sent to their own contract are usually not recoverable.
- warnNoChecksum: This address is all lower-case or all upper-case, so it carries no checksum that could catch a typo. Compare every character. → A reminder: this address is all lower-case or all upper-case, so it carries no checksum that could catch a typo. You can compare every character.
- ackWarnings: I have read the warnings above and want to continue → I have read the reminders above and want to continue
- errZeroAddr: The zero address (0x000…000) cannot receive transfers. → A reminder: the zero address (0x000…000) does not receive transfers.
- delHasBal: This account still holds coins! If you lose the backup and the password after deleting, these coins are gone forever. Move them to another account first. → A reminder: this account still holds coins. You can move them to another account first, and keep the backup and the password.
- backupHint: Copies keyfiles to the backup folder below (inside Documents\ScdoWallet). A keyfile plus its password restores the account; keep another copy on a USB stick. → A reminder: copies keyfiles to the backup folder below (inside Documents\ScdoWallet). A keyfile and its password together restore the account. Another copy on a USB stick is handy.
- backupHintDarwin: Copies keyfiles to the backup folder below (inside ~/Documents/ScdoWallet). A keyfile plus its password restores the account; keep another copy on a USB stick. → A reminder: copies keyfiles to the backup folder below (inside ~/Documents/ScdoWallet). A keyfile and its password together restore the account. Another copy on a USB stick is handy.
- updVerifyFail: The update server was reached, but the update information failed its signature check, so nothing will be installed. Try again later or download the latest version from scdoscan.io. → A reminder: the update server was reached, but the update information did not pass its signature check, so this update was not installed. You can try again later, or download the latest version from scdoscan.io.
- isleTipWaitExplain: The ledger has not finished downloading. Mining starts by itself when the download finishes. You do not press again. → A reminder: the ledger has not finished downloading. Mining starts by itself when the download finishes. There is no need to press again.
- errBcastTimeout: The network did not answer in time. The transfer may still go through: it is listed in Activity as Pending and the wallet keeps checking and re-sending it. Do not send it again. → A reminder: the network did not answer in time. The transfer may still go through. It is listed in Activity as Pending and the wallet keeps checking and re-sending it. You can look at that entry before sending another.
- receiveNew: This is a Shard0 EVM receiving address (starts with 0x, chain ID 5680). Use it only for Shard0 EVM SCDO and tokens; Shard1–Shard4 account addresses cannot receive Shard0 EVM assets. → A reminder: this is a Shard0 EVM receiving address (starts with 0x, chain ID 5680), for Shard0 EVM SCDO and tokens. A Shard1–Shard4 address receives that shard’s own SCDO.
- receiveOld: This is an Shard{n} address. Use it only for Shard{n} SCDO. → A reminder: this is a Shard{n} address, for Shard{n} SCDO.
- errOldAddrToNew: That is a Shard1–Shard4 account address. Shard0 EVM can only send to addresses starting with 0x. → A reminder: that is a Shard1–Shard4 account address. Shard0 EVM sends to addresses starting with 0x.
- errCross: Cross-shard transfers are not supported: send to an Shard{n} address ({n}S0…). → A reminder: this transfer stays on one shard. The receiving address is a Shard{n} address ({n}S0…).
- errTooMuch: Not enough balance (the fee must be covered too). → Not enough balance (leave room for the fee too).
- reviewNote: Check the address carefully: a transfer cannot be undone. → A reminder: look at the receiving address once more before you send. After it is on the chain, it cannot be taken back.
- pwRule: Must contain letter,number and special char,length 8-15 → A reminder: use upper and lower case letters, a number and a special character, 8–15 characters.
- createSave: Remember the password and back up the keyfile: without the password the funds cannot be recovered. → A reminder: keep the password and a copy of the keyfile. Without either one, this account cannot be restored.
- errName: Please enter name for keyfile → A reminder: add a name for the keyfile.
- errShard: Shard number must be 1, 2, 3 or 4 → A reminder: the shard number is 1, 2, 3 or 4.
- errKey: Privatekey should be 64 alphanumeric characters after 0x → A reminder: a private key is 64 letters or digits after 0x.
- delWarnBal: This account still holds {v}! If you lose the backup and the password after deleting, these coins are gone forever. Move them to another account first. → A reminder: this account still holds {v}. You can move them to another account first, and keep the backup and the password.
- delHint: Continue needs the correct password and the checkbox; you will be asked once more. → A reminder: after the password is right and the box is checked, the next step asks once more.
- aboutHashHow: To check: on Windows run certutil -hashfile <installer file> SHA256 in Command Prompt, on a Mac run shasum -a 256 <installer file>; the result must match the value above exactly. → A reminder: on Windows run certutil -hashfile <installer file> SHA256 in Command Prompt, on a Mac run shasum -a 256 <installer file>. The result lines up with the value above.
- shellAmtLimit: At most 8 digits after the decimal point → A reminder: at most 8 digits after the decimal point
- wizNeedAmt: The amount must be more than 0 → A reminder: the amount is more than 0.
- st_SHA256_MISSING: The wallet could not check that the mining program is the official version, so for safety it was not started. Please reinstall SCDO Wallet. → A reminder: the wallet could not yet check that the mining program is the official version, so this start did not go ahead. Reinstalling SCDO Wallet takes care of it.
- st_SHA256_MISMATCH: The mining program does not match the official version, so for safety it was not started. Please reinstall or try again. → A reminder: the mining program does not match the official version, so this start did not go ahead. Reinstalling or trying again takes care of it.
- remitZero: No name, ID, phone, or other identity form. Unlock this wallet and sign. → This step does not ask for a name, an ID or a phone number. Unlock this wallet and sign.
- remitZeroEn: This is a remittance service. You don't fill in any identity details to start; you only unlock the wallet and sign. → This is a remittance service. This step does not ask for a name, an ID or a phone number. Unlock this wallet and sign.
- remitAddr: Sign-in address (this address only) → Sign-in address (this one)
- remitForeign: Another address cannot sign in. A signature from address A cannot open address B’s session or ledger. → A reminder: sign-in uses your own address. A signature from address A opens address A’s session and ledger.
- remitOwnOnly: The ledger belongs only to the address that signed. A different address will not sign in. → A reminder: the ledger follows the address that signed. The same address reads it.
- relNotes 3.1.0 first item (new): On-screen notes are friendly reminders. A recovery phrase, a private key and a password stay on your own device. You can look at the receiving address once more before you send.

## src/js/minerStartError.js

- SHA256_MISSING CN: 沒辦法確認挖礦程式是不是官方版本，為了安全已經停止啟動。請重新安裝 SCDO Wallet。 → 溫馨提醒：還沒能確認挖礦程式是不是官方版本，所以這次沒有啟動。重新安裝 SCDO Wallet 就可以。
- SHA256_MISSING EN: The wallet could not check that the mining program is the official version, so for safety it was not started. Please reinstall SCDO Wallet. → A reminder: the wallet could not yet check that the mining program is the official version, so this start did not go ahead. Reinstalling SCDO Wallet takes care of it.
- SHA256_MISMATCH CN: 下載的挖礦程式跟官方版本對不上，為了安全已經停止啟動。請重新安裝或再試一次。 → 溫馨提醒：下載的挖礦程式跟官方版本對不上，所以這次沒有啟動。重新安裝或再試一次就可以。
- SHA256_MISMATCH EN: The mining program does not match the official version, so for safety it was not started. Please reinstall or try again. → A reminder: the mining program does not match the official version, so this start did not go ahead. Reinstalling or trying again takes care of it.

## src/js/aiCat.js

- planHeal (low memory, nothing else to restart): 先不要再啟動新的節點 → 可以先等一下，再啟動新的節點
- planBackup: 帳戶要靠帳戶檔案和密碼才能恢復。小貓不會顯示種子、私鑰或密碼，也不會把它寫進紀錄。請在接下來的清單裡自己按「立即備份」，並另外複製到隨身碟。 → 溫馨提醒：帳戶要靠帳戶檔案和密碼才能恢復。小貓不會顯示種子、私鑰或密碼，也不會把它寫進紀錄。接下來的清單裡可以自己按「立即備份」，並另外複製到隨身碟。
- refuseSecret: 請不要把種子、私鑰或密碼貼在這裡。小貓不會顯示，也不會記錄。 → 溫馨提醒：助記詞、私鑰和密碼只存在你自己的設備，我們不會向你索取。小貓不會顯示，也不會記錄。
- import: 已開啟「匯入錢包」。可以選帳戶檔案，或用私鑰匯入；私鑰只在隱藏輸入視窗裡輸入，請不要貼在這裡。 → 已開啟「匯入錢包」。可以選帳戶檔案，或用私鑰匯入。私鑰只在隱藏輸入視窗裡輸入。溫馨提醒：助記詞和私鑰只存在你自己的設備，貼在聊天裡小貓也看不到。
- sayContact ending: SCDO 實驗室不會向你索取種子、私鑰或密碼。 → 溫馨提醒：助記詞、私鑰和密碼只存在你自己的設備，我們不會向你索取。

## src/js/sendError.js

- TOO_MANY_DECIMALS CN: 最多小數點後 8 位。 → 溫馨提醒：小數點後最多 8 位。
- NUMERIC_FAULT CN: 這個金額的小數位數太多。最多小數點後 8 位。 → 溫馨提醒：這個金額的小數位數比較多。小數點後最多 8 位。
- TOO_MANY_DECIMALS EN: At most 8 digits after the decimal point. → A reminder: at most 8 digits after the decimal point.
- NUMERIC_FAULT EN: This amount has too many decimal places. Use at most 8. → A reminder: this amount has more decimal places than the wallet keeps. At most 8.

## stopping-zh.html

- 請不要關機或結束程式。完成後這個視窗會自動關閉（最多約 1 分鐘）。 → 溫馨提醒：這時先讓程式自己存完。完成後這個視窗會自動關閉（最多約 1 分鐘）。

## stopping.html

- Please don't shut down or end the process. This window closes by itself when done (up to about 1 minute). → A reminder: leave this window open while the data is saved. It closes by itself when done (up to about 1 minute).

## src/json/lang.json (English)

- createWarning: Secure your PASSWORD and KEYS, password must be 10+ characters long and include numbers, alphabets and special symbols → A reminder: keep the password and the keys. A password of 10 or more characters, with letters, numbers and a special symbol, works here.
- passwordWarning.invalid: Must contain letter,number and special char,length 8-15 → A reminder: use a letter, a number and a special character, 8-15 characters.
- passwordWarning.length: Password must contain at least 10 characters → A reminder: use at least 10 characters.
- passwordWarning.uppercase: Password must contain at least 1 uppercase letter → A reminder: include at least 1 uppercase letter.
- passwordWarning.letter: Password must contain at least 1 letter → A reminder: include at least 1 letter.
- passwordWarning.number: Password must contain at least 1 number → A reminder: include at least 1 number.
- passwordWarning.specialChar: Password must contain at least 1 special char → A reminder: include at least 1 special character.
- shardWarning.1: NOTE: <br/>Send funds From Shard → A reminder: <br/>Send funds From Shard
- createKeyfileWarning.stringEmpty: Please enter name for keyfile → A reminder: add a name for the keyfile.
- createKeyfileWarning.shardInvalid: Shard number must be 1-4 → A reminder: the shard number is 1-4.
- createKeyfileWarning.keyInvalid: Privatekey should be 64 alphanumeric characters after 0x → A reminder: a private key is 64 letters or digits after 0x.

## src/json/lang.json (華語)

- createWarning: 請儲存密碼和密帳戶件，密碼要10位以上含字母數字特殊字元 → 溫馨提醒：請另外留好密碼和帳戶檔案。密碼用 10 位以上，含字母、數字和特殊字元。
- passwordWarning.invalid: 密碼必須包含大小寫字母、數字和特殊字元，8-15位 → 溫馨提醒：密碼用大小寫字母、數字和特殊字元，長度 8-15 位。
- passwordWarning.length: 密碼必須含至少10個字元 → 溫馨提醒：密碼至少 10 個字元。
- passwordWarning.uppercase: 密碼必須含至少1個大寫字母 → 溫馨提醒：密碼裡放至少 1 個大寫字母。
- passwordWarning.letter: 密碼必須含至少1個字母 → 溫馨提醒：密碼裡放至少 1 個字母。
- passwordWarning.number: 密碼必須含至少1個數字 → 溫馨提醒：密碼裡放至少 1 個數字。
- passwordWarning.specialChar: 密碼必須含至少1個特殊字元 → 溫馨提醒：密碼裡放至少 1 個特殊字元。
- shardWarning.1: 注意: <br/>數額將從片 → 溫馨提醒：<br/>數額將從片
- createKeyfileWarning.stringEmpty: 檔名不能為空 → 溫馨提醒：檔名再填一個字。
- createKeyfileWarning.shardInvalid: 片號須為1-4 → 溫馨提醒：片號是 1-4。
- createKeyfileWarning.keyInvalid: 私鑰須為以0x開頭66位數字字母字串 → 溫馨提醒：私鑰是 0x 後面 64 位數字或字母。
