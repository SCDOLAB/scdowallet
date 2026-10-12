# ScdoWalletBeta 1.1.4 (2026-09-29)

- Fix: in the top-right network menu, choosing SCDO Shard1 (Classic), SCDO Shard2 (Classic), SCDO Shard3 (Classic) or SCDO Shard4 (Classic) did nothing. Root cause: the invisible
  click-away backdrop of the dropdown menus reused the modal `.overlay` class (z-index 50), which sat above the
  menu itself (`.dd`, z-index 40). Every click on a menu item therefore landed on the backdrop and only closed the menu.
  The same bug made the account-switcher menu items (switch account, create, import, manage) unclickable with a mouse.
  The backdrop now has its own class `.ddov` (z-index 39, below the menu).
- Network menu: lists **SCDO Shard0 (EVM)** (chain ID 5680) and **SCDO Shard1 (Classic)**, **SCDO Shard2 (Classic)**, **SCDO Shard3 (Classic)**, **SCDO Shard4 (Classic)**.
  Picking a shard opens the shard accounts view filtered to that shard (accounts, balances, receive and send); chips
  on that page switch between SCDO Shard1 (Classic), SCDO Shard2 (Classic), SCDO Shard3 (Classic) and SCDO Shard4 (Classic), or show all Classic accounts. Picking SCDO Shard0 (EVM) goes back to Home. The choice (network,
  shard and tab) is stored in `~/.ScdoWallet/ui112.json` and restored after a restart.
- Names: the UI (中文 and English) no longer uses the earlier chain nicknames. Shard0 is **SCDO Shard0 (EVM)**; the other shards are
  named individually **SCDO Shard1 (Classic)**, **SCDO Shard2 (Classic)**, **SCDO Shard3 (Classic)** and **SCDO Shard4 (Classic)**.
  The tab that lists all of them is "Classic 账户" / "Classic accounts". Balance labels renamed the same way.
- Account names: keyfiles are no longer shown with their internal ".<timestamp>" suffix. Accounts without a real name
  (including earlier placeholder names) are shown as "账户 1", "账户 2" … / "Account 1", "Account 2" …; a new account with an
  empty name gets the next number. Every account has a Rename (改名) button; only the displayed name changes, the keyfile
  itself is never renamed.
- Mining page: the block reward / node service fee address list shows account names, starts with "请选择地址 / Choose an
  address" instead of silently preselecting an account, and has "其他地址 / Other address" to paste any SCDO Shard0 (EVM)
  0x address (for example a company address whose keyfile is not on this PC). The choice is kept after a restart.
- Mining wording: the reward address label is now "出块奖励地址" (block reward address).
- No changes to keyfiles, signing, mining, node or network code.
