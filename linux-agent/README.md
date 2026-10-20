# SCDO Linux agent

Headless bookkeeping agent for the [SCDO Agent Ledger](https://scdo.com.au/agent-ledger/). One static binary, `scdo-agent`, runs as a systemd service. It creates a secp256k1 identity per name, registers that identity, and sends a heartbeat every five minutes.

This is a ledger record only. It does not start a node process and it does not move funds.

The desktop wallet is unchanged. This tree is additive.

## Install

Published files live at `https://scdo.com.au/downloads/wallet/linux/` (you publish them; this repo only builds them):

| File | What it is |
| --- | --- |
| `install.sh` | Detects x86_64 or arm64, checks `SHA256SUMS`, installs the binary and the unit |
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

`keys/` is mode `0700`. The keystore is one file per purpose, so a second key file can be added beside `ledger.key` later without changing this identity or its sequence counter.

Without `--passphrase-file`, the key file is unencrypted and readable only by the `scdo-agent` service user. That is the unattended systemd setup. With `--passphrase-file` (or `SCDO_AGENT_PASSPHRASE_FILE`), the file is encrypted with scrypt and AES-256-GCM. Point the unit at that file with a drop-in; do not put the passphrase on the command line.

```
# /etc/systemd/system/scdo-agent@rack-a.service.d/pass.conf
[Service]
Environment=SCDO_AGENT_PASSPHRASE_FILE=/etc/scdo-agent/rack-a.pass
```

The passphrase file should be mode `0600` and owned by `scdo-agent`.

Removing the Debian package does not delete `/var/lib/scdo-agent`.

## Language

English is the default. 華語 is `--lang zh`, or any `LANG` / `LC_ALL` value that starts with `zh`.

## Build

Go 1.22 or newer. `CGO_ENABLED=0` produces a static binary.

```sh
cd linux-agent
go test ./...
sh scripts/package.sh
```

`package.sh` writes both architectures, both archives, `install.sh`, and `SHA256SUMS` under `linux-agent/dist/`. GitHub Actions (`.github/workflows/linux-agent.yml`) runs the tests and uploads those files as the `scdo-agent-linux` artifact. Publish that directory to `https://scdo.com.au/downloads/wallet/linux/`. Nothing in CI uploads to that host.

## 華語

無介面的記帳代理，供 [SCDO 代理帳本](https://scdo.com.au/agent-ledger/) 使用。單一靜態執行檔 `scdo-agent`，以 systemd 服務執行。每個名稱有自己的 secp256k1 身份，向帳本登記，並每五分鐘送出一次心跳。

它只維護帳本紀錄，不啟動節點行程，也不移動資金。桌面錢包的行為沒有改動。

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

`meta.json` 只有地址、收款地址與角色。`state.json` 是序號。`keys/ledger.key` 是身份。`keys/` 權限 `0700`。金鑰庫一個用途一個檔案，之後可以在 `ledger.key` 旁邊再放另一把金鑰，而不改動這把身份與序號。

未加 `--passphrase-file` 時，金鑰不加密，只有服務使用者 `scdo-agent` 能讀，適合無人值守。加上 `--passphrase-file`（或 `SCDO_AGENT_PASSPHRASE_FILE`）後，以 scrypt 與 AES-256-GCM 加密。不要把通行詞放在命令列上。

移除 Debian 套件不會刪除 `/var/lib/scdo-agent`。

### 語言

預設英文。華語使用 `--lang zh`，或 `LANG` / `LC_ALL` 以 `zh` 開頭。
