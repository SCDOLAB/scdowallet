# SCDO Linux agent

Headless bookkeeping agent for the [SCDO Agent Ledger](https://scdo.com.au/agent-ledger/). One static binary, `scdo-agent`, runs as a systemd service. It creates a secp256k1 identity per name, registers that identity, and sends a heartbeat every five minutes.

The service keeps a ledger record. It does not start a node process. Base Sepolia USDC payments are a separate `wallet` command.

The desktop wallet is unchanged. This tree is additive.

## Install

Published files live at `https://scdo.com.au/downloads/wallet/linux/` (you publish them; this repo only builds them):

| File | What it is |
| --- | --- |
| `install.sh` | Detects x86_64 or arm64, checks `SHA256SUMS`, installs the binary and the units |
| `scdo-agent_<version>_linux_amd64.deb` | Debian package |
| `scdo-agent_<version>_linux_arm64.deb` | Debian package |
| `scdo-agent_<version>_linux_amd64.tar.gz` | Binary plus the systemd unit |
| `scdo-agent_<version>_linux_arm64.tar.gz` | Binary plus the systemd unit |
| `SHA256SUMS` | sha256 of the files above |

```sh
curl -fsSL -o install.sh https://scdo.com.au/downloads/wallet/linux/install.sh
sudo sh install.sh
```

The installer prefers the `.deb` when `dpkg` is present, and the tarball otherwise. `sha256sum -c` must succeed before anything is copied into place.

## One agent

```sh
sudo scdo-agent init --name rack-a --payout 0x<your payout address>
sudo systemctl enable --now scdo-agent@rack-a.service
scdo-agent status --name rack-a
scdo-agent logs --name rack-a
```

`init` is required because `--payout` has no default. The key is written to `/var/lib/scdo-agent/rack-a/keys/ledger.key` with mode `0600`. It is never printed and never sent. A second `init` for the same name refuses to replace that key.

`status` prints the agent address and `Online: true` or `Online: false` from `GET https://scdo.com.au/agent-ledger/api/agents/<0x>`. If that host does not answer, the client tries `https://apeccapital.org`.

`logs` prints the `journalctl` command. A foreground `scdo-agent run --name rack-a` writes the same lines to standard output.

## Several agents on one machine

Each `--name` is a separate identity, sequence counter, and systemd instance:

```sh
sudo scdo-agent init --name rack-b --payout 0x<address> --role server-node
sudo systemctl enable --now scdo-agent@rack-b.service
scdo-agent list
```

`light-node` (the default) heartbeats with `code` `light`. `server-node` heartbeats with `code` `server`. `platform` is `linux`. Optional `--ref` and `--src` are sent once on register when they match the desktop token rule.

## Ledger protocol

The client matches the desktop wallet (`src/agent/envelope.js`, `src/agent/agentService.js`):

- `POST {base}/agent-ledger/api/register` and `POST {base}/agent-ledger/api/heartbeat`
- EIP-191 `personal_sign` over `SCDO Agent Ledger v1\n` plus canonical JSON
- `chainId` 5680, version 1, checksummed agent address
- `seq` starts at 1 and increases by one per signed envelope, including across restarts
- Primary base `https://scdo.com.au/agent-ledger/api`, fallback `https://apeccapital.org/agent-ledger/api`
- Heartbeat every 5 minutes, and once as soon as register is accepted

`/heal` and `/report` use the same envelope. This build signs them in tests and does not emit them during a normal run.

Set `SCDO_AGENT_LEDGER` or `--ledger` to pin a single base (used for a local ledger). Hosts other than the two ledger origins above are rejected.

## Key file

```
/var/lib/scdo-agent/<name>/meta.json       address, payout, role (world-readable)
/var/lib/scdo-agent/<name>/state.json      sequence counter (mode 0600)
/var/lib/scdo-agent/<name>/keys/ledger.key identity (mode 0600)
```

`keys/` is mode `0700`. The keystore is one file per purpose. `keys/wallet.key` is a second key. Creating an agent from the adapter list or from `x-accounts.toml` writes that file when it is missing, and never replaces an existing one. The ledger identity stays in `ledger.key`.

Without `--passphrase-file`, the key file is unencrypted and readable only by the `scdo-agent` service user. That is the unattended systemd setup. With `--passphrase-file` (or `SCDO_AGENT_PASSPHRASE_FILE`), the file is encrypted with scrypt and AES-256-GCM. Point the unit at that file with a drop-in; do not put the passphrase on the command line.

```
# /etc/systemd/system/scdo-agent@rack-a.service.d/pass.conf
[Service]
Environment=SCDO_AGENT_PASSPHRASE_FILE=/etc/scdo-agent/rack-a.pass
```

The passphrase file should be mode `0600` and owned by `scdo-agent`.

Removing the Debian package does not delete `/var/lib/scdo-agent`.

## Bot wallet

Each agent can bind a second key, `keys/wallet.key`, as a bot wallet on Base Sepolia (`eip155:84532`). Base mainnet (`eip155:8453`) is not registered.

Payment signing and the `PAYMENT-SIGNATURE` header come from the open-source x402 SDK at <https://github.com/coinbase/x402> (Apache-2.0, Copyright 2026 x402 Foundation). The licence and notice are kept in `third_party/x402/` and installed as `/usr/share/doc/scdo-agent/x402-LICENSE` and `/usr/share/doc/scdo-agent/x402-NOTICE`. `scdo-agent --version` prints the same credit.

On top of that SDK, this agent adds the per-payment cap, the daily cap, the payee allowlist, the kill switch, and the ledger freeze.

```sh
scdo-agent wallet create --name rack-a --bot m1-bot
scdo-agent wallet pay --name rack-a https://x402.payai.network/api/base-sepolia/paid-content
scdo-agent wallet export --name rack-a
scdo-agent wallet allow --name rack-a --payee 0xE3837fE309618AE075DbeF0A20735c0615a308E6
scdo-agent wallet kill --name rack-a
scdo-agent wallet unkill --name rack-a
scdo-agent wallet record --name rack-a
```

`create` POSTs `/bind` with the wallet address and an EIP-191 wallet proof signed by that wallet. `pay` lets the SDK sign the exact EIP-3009 authorization and retry the HTTP 402, then POSTs `/ledger/spend`. `--max` and `--daily` are atomic units with 6 decimals. The defaults are `1000000` (1 USDC) per payment and `5000000` per UTC day. An empty payee list allows any Base Sepolia payee. `kill` stops signing and POSTs `/freeze`.

The wallet needs test USDC on Base Sepolia. The facilitator pays the gas. This build does not pay Base mainnet.

## ERC-8004

Shard0 (`eip155:5680`) runs the plain ERC-8004 registries from [erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) commit `b9e466c`:

| Registry | Address |
| --- | --- |
| IdentityRegistry | `0xe1A6728e467ed9Fa2F2d0d7eE425a95c9d941F4d` |
| ReputationRegistry | `0xeB49023E929bb71A4818924DffC46Eb8B46546c4` |
| ValidationRegistry | `0x5bc80C209263Fe4F0455c76eC41F663E62D814dF` |

SCDO's main agent is agent id 2. A ledger agent registers with agent URI `https://scdo.com.au/agent-ledger/api/agents/<0x>/registration.json` and metadata key `scdoLedgerAgent` set to that ledger address.

```sh
scdo-agent erc8004 register --name rack-a
```

The transaction is on Shard0. Gas is native SCDO. The key is not printed. If that address already has an identity, the command does not send another transaction.

Automatic registration on process start stays off unless `/etc/scdo-agent/config.toml` contains:

```
erc8004 = true
```

A failed registration does not stop heartbeats. The RPC is `https://scdo.com.au/rpc/0`, then `https://apeccapital.org/rpc/0`.

## Update

`upgrade-now` is the stable entry point. It needs root, except for `--dry-run`.

```sh
sudo scdo-agent upgrade-now
sudo scdo-agent upgrade-now --dry-run
```

`--dry-run` checks the signed feed and does not replace the binary.

The installer enables two units:

- `scdo-agent-update.timer` runs `upgrade-now` once a day, with up to one hour of random delay.
- `scdo-agent-boot.service` runs `upgrade-now` at boot so adapters are reconciled after a restart.

The feed is `https://scdo.com.au/downloads/wallet/linux/latest.json`, then `https://apeccapital.org/downloads/wallet/linux/latest.json`. The signature is Ed25519 over the same canonical JSON the desktop wallet uses. The package sha256 is checked before the binary is replaced. The previous binary, the config directory, and each keystore are copied to `/var/lib/scdo-agent/backups/<timestamp>/`. Only the newest five of those timestamp directories are kept. Key files are copied into the backup and are not deleted from the agent directory.

After the swap, each `scdo-agent@*` instance restarts one at a time. If a restarted instance is not active, or has no successful heartbeat within 3 minutes, the previous binary is restored and the instances restart again. The next heartbeat reports `ok` or `rolled-back`.

A feed that cannot be reached leaves the installed binary as it is.

## Adapters

On update and on boot, the agent lists graphics adapters with `nvidia-smi`, then `rocm-smi`, then `lspci`. If `nvidia-smi` is installed but the command fails, the next probe is used.

Each adapter gets its own instance `scdo-agent@gpuN`, its own identity, and its own `keys/wallet.key`. The ledger record carries the model name and the memory size. No workload is started on the adapter.

When an adapter is no longer listed, that instance is stopped and an offline report is sent. The directory and the keys stay on disk. A probe that cannot run at all leaves existing adapter instances running.

New instances need a payout address. Set it in `/etc/scdo-agent/config.toml`:

```
payout = "0x<address>"
```

If that file is absent, the payout of the first existing agent is used.

## X account file

`/etc/scdo-agent/x-accounts.toml` maps an X handle and user id to an agent name:

```
[[account]]
handle = "example"
user_id = "123"
agent = "example"
```

A new row creates that agent. Running the command again does not replace an existing key. The same row only refreshes the handle and user id stored in `meta.json`. OAuth binding is not part of this build.

## Rig hook

`linux-agent/scripts/rig-hook.sh` is a companion for a Classic node upgrader or an rtty push. That upgrader is not in this repository, and this package does not change it. The hook installs scdo-agent from `https://scdo.com.au/downloads/wallet/linux/install.sh` when the binary is missing, then runs `scdo-agent upgrade-now`.

```sh
sudo sh linux-agent/scripts/rig-hook.sh
```

## Language

English is the default. 華語 is `--lang zh`, or any `LANG` / `LC_ALL` value that starts with `zh`.

## Build

Go 1.24 or newer. `CGO_ENABLED=0` produces a static binary.

```sh
cd linux-agent
go test ./...
sh scripts/package.sh
```

`package.sh` writes both architectures, both archives, `install.sh`, and `SHA256SUMS` under `linux-agent/dist/`. GitHub Actions (`.github/workflows/linux-agent.yml`) runs the tests and uploads those files as the `scdo-agent-linux` artifact. Publish that directory to `https://scdo.com.au/downloads/wallet/linux/`. Nothing in CI uploads to that host.

## 華語

無介面的記帳代理，供 [SCDO 代理帳本](https://scdo.com.au/agent-ledger/) 使用。單一靜態執行檔 `scdo-agent`，以 systemd 服務執行。每個名稱有自己的 secp256k1 身份，向帳本登記，並每五分鐘送出一次心跳。

服務只維護帳本紀錄，不啟動節點行程。Base Sepolia 的 USDC 付款是另一個 `wallet` 命令。桌面錢包的行為沒有改動。

### 安裝

發布檔案放在 `https://scdo.com.au/downloads/wallet/linux/`。`install.sh` 會判斷 x86_64 或 arm64，核對 `SHA256SUMS`，再安裝執行檔與 systemd 單元。有 `dpkg` 時用 `.deb`，否則用壓縮檔。

```sh
curl -fsSL -o install.sh https://scdo.com.au/downloads/wallet/linux/install.sh
sudo sh install.sh
```

### 一個代理

```sh
sudo scdo-agent init --name rack-a --payout 0x<收款地址>
sudo systemctl enable --now scdo-agent@rack-a.service
scdo-agent status --name rack-a
scdo-agent logs --name rack-a
```

`--payout` 必填。金鑰寫入 `/var/lib/scdo-agent/rack-a/keys/ledger.key`，權限 `0600`，不會印出，也不會送出。同一個名稱再次 `init` 不會覆蓋金鑰。

`status` 顯示地址，以及從 `GET https://scdo.com.au/agent-ledger/api/agents/<0x>` 讀到的 `Online: true` 或 `Online: false`。該主機沒有回應時，改向 `https://apeccapital.org`。

### 同一台機器上的多個代理

每個 `--name` 是獨立的身份、序號與 systemd 實例。`light-node`（預設）心跳的 `code` 為 `light`。`server-node` 的 `code` 為 `server`。`platform` 為 `linux`。`--ref` 與 `--src` 可在登記時一併送出。

### 帳本

與桌面錢包相同：對 `{base}/agent-ledger/api/register` 與 `/heartbeat` 送出 EIP-191 簽章，前綴為 `SCDO Agent Ledger v1\n` 加上規範 JSON，`chainId` 5680，序號每次加一並在重新啟動後延續。主位址是 `https://scdo.com.au`，備援是 `https://apeccapital.org`。這兩個來源以外的主機都會被拒絕。

### 金鑰

`meta.json` 只有地址、收款地址與角色。`state.json` 是序號。`keys/ledger.key` 是身份。`keys/` 權限 `0700`。金鑰庫一個用途一個檔案。`keys/wallet.key` 是第二把金鑰。從顯示卡清單或 `x-accounts.toml` 建立代理時，若這個檔案不存在就會寫入，已存在的檔案不會被替換。帳本身份仍在 `ledger.key`。

未加 `--passphrase-file` 時，金鑰不加密，只有服務使用者 `scdo-agent` 能讀，適合無人值守。加上 `--passphrase-file`（或 `SCDO_AGENT_PASSPHRASE_FILE`）後，以 scrypt 與 AES-256-GCM 加密。不要把通行詞放在命令列上。

移除 Debian 套件不會刪除 `/var/lib/scdo-agent`。

### 機器人錢包

每個代理可以用第二把金鑰 `keys/wallet.key`，綁定成 Base Sepolia（`eip155:84532`）上的機器人錢包。Base 主網（`eip155:8453`）不會登記。

付款簽章與 `PAYMENT-SIGNATURE` 標頭來自開源的 x402 SDK：<https://github.com/coinbase/x402>（Apache-2.0，Copyright 2026 x402 Foundation）。授權條款與 NOTICE 放在 `third_party/x402/`，安裝後位於 `/usr/share/doc/scdo-agent/x402-LICENSE` 與 `/usr/share/doc/scdo-agent/x402-NOTICE`。`scdo-agent --version` 會印出同一段致謝。

在這個 SDK 之上，本代理加上單筆上限、每日上限、收款地址清單、停止開關，以及帳本凍結。

```sh
scdo-agent wallet create --name rack-a --bot m1-bot
scdo-agent wallet pay --name rack-a https://x402.payai.network/api/base-sepolia/paid-content
scdo-agent wallet export --name rack-a
scdo-agent wallet allow --name rack-a --payee 0xE3837fE309618AE075DbeF0A20735c0615a308E6
scdo-agent wallet kill --name rack-a
scdo-agent wallet unkill --name rack-a
scdo-agent wallet record --name rack-a
```

`create` 會把錢包地址與該錢包的 EIP-191 證明送到 `/bind`。`pay` 由 SDK 簽署 exact EIP-3009 授權並重試 HTTP 402，然後送到 `/ledger/spend`。`--max` 與 `--daily` 的單位是 6 位小數的最小單位。預設單筆 `1000000`（1 USDC），每個 UTC 日 `5000000`。收款清單是空的時候，允許任何 Base Sepolia 收款地址。`kill` 會停止簽章並送到 `/freeze`。

錢包需要 Base Sepolia 上的測試 USDC。燃料費由 facilitator 支付。這個版本不會在 Base 主網付款。

### ERC-8004

Shard0（`eip155:5680`）上的 ERC-8004 登記冊是 [erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) 提交 `b9e466c` 的一般合約：

| 登記冊 | 地址 |
| --- | --- |
| IdentityRegistry | `0xe1A6728e467ed9Fa2F2d0d7eE425a95c9d941F4d` |
| ReputationRegistry | `0xeB49023E929bb71A4818924DffC46Eb8B46546c4` |
| ValidationRegistry | `0x5bc80C209263Fe4F0455c76eC41F663E62D814dF` |

SCDO 的主要代理是代理編號 2。帳本代理的 URI 是 `https://scdo.com.au/agent-ledger/api/agents/<0x>/registration.json`，鏈上中繼資料鍵 `scdoLedgerAgent` 的值是該帳本地址。

```sh
scdo-agent erc8004 register --name rack-a
```

交易在 Shard0。手續費使用原生 SCDO。金鑰不會印出。這個地址若已經有身份，就不會再送出交易。

除非 `/etc/scdo-agent/config.toml` 寫了下面這一行，否則行程啟動時不會自動登記：

```
erc8004 = true
```

登記失敗不會停止心跳。RPC 先用 `https://scdo.com.au/rpc/0`，失敗時改用 `https://apeccapital.org/rpc/0`。

### 更新

`upgrade-now` 是固定的進入點。除了 `--dry-run` 之外需要 root。

```sh
sudo scdo-agent upgrade-now
sudo scdo-agent upgrade-now --dry-run
```

`--dry-run` 只檢查簽章後的發布檔，不替換執行檔。

安裝程式會啟用兩個單元：

- `scdo-agent-update.timer` 每天執行一次 `upgrade-now`，並加上最多一小時的隨機延遲。
- `scdo-agent-boot.service` 在開機時執行 `upgrade-now`，以便重新啟動後核對顯示卡。

發布檔先讀 `https://scdo.com.au/downloads/wallet/linux/latest.json`，失敗時改讀 `https://apeccapital.org/downloads/wallet/linux/latest.json`。簽章是 Ed25519，規範 JSON 與桌面錢包相同。替換執行檔之前會核對套件的 sha256。先前的執行檔、設定目錄與每份金鑰庫會複製到 `/var/lib/scdo-agent/backups/<時間戳>/`。只保留最新的五個時間戳目錄。金鑰會複製進備份，代理目錄裡的金鑰不會被刪除。

替換之後，每個 `scdo-agent@*` 實例會逐一重新啟動。若重新啟動的實例沒有處於執行中，或 3 分鐘內沒有成功的心跳，就還原先前的執行檔並再次啟動這些實例。下一次心跳會回報 `ok` 或 `rolled-back`。

連不上發布檔時，已安裝的執行檔保持不變。

### 顯示卡

更新時與開機時，會依序用 `nvidia-smi`、`rocm-smi`、`lspci` 列出顯示卡。若 `nvidia-smi` 已安裝但命令失敗，就改用下一個探測。

每張顯示卡有自己的實例 `scdo-agent@gpuN`、自己的身份，以及自己的 `keys/wallet.key`。帳本紀錄帶有型號與記憶體大小。不會在顯示卡上啟動工作。

當某張顯示卡不再出現在清單上，該實例會停止，並送出離線回報。目錄與金鑰留在磁碟上。探測完全無法執行時，既有的顯示卡實例會繼續運行。

新實例需要收款地址。寫在 `/etc/scdo-agent/config.toml`：

```
payout = "0x<地址>"
```

若沒有這個檔案，就沿用第一個既有代理的收款地址。

### X 帳號檔

`/etc/scdo-agent/x-accounts.toml` 把 X 帳號代號與使用者編號對應到代理名稱：

```
[[account]]
handle = "example"
user_id = "123"
agent = "example"
```

新的一列會建立該代理。再次執行不會替換既有金鑰。同一列只會更新 `meta.json` 裡的代號與使用者編號。這個版本不含 OAuth 綁定。

### 機台掛鉤

`linux-agent/scripts/rig-hook.sh` 是給 Classic 節點升級程式或 rtty 推送使用的伴隨腳本。那個升級程式不在這個儲存庫裡，這個套件也不會改動它。執行檔不存在時，掛鉤會從 `https://scdo.com.au/downloads/wallet/linux/install.sh` 安裝，然後執行 `scdo-agent upgrade-now`。

```sh
sudo sh linux-agent/scripts/rig-hook.sh
```

### 語言

預設英文。華語使用 `--lang zh`，或 `LANG` / `LC_ALL` 以 `zh` 開頭。
