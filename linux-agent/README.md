# SCDO Linux agent

Headless bookkeeping agent for the [SCDO Agent Ledger](https://scdo.com.au/agent-ledger/). One static binary, `scdo-agent`, runs as a systemd service. It creates a secp256k1 identity per name, registers that identity, and sends a heartbeat every five minutes.

The service keeps a ledger record. It does not start a node process. Base USDC payments (`--network base` for Base mainnet, `--network base-sepolia` for the testnet) are separate `wallet`, `pay` and `serve-paywall` commands. The payer signs an EIP-3009 authorization; the facilitator pays the gas, so a wallet needs USDC but no ETH.

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
| `scdo-ethash-verify_<version>_linux_amd64` | Ledger ethash-light checker for amd64 |
| `scdo-ethash-verify_<version>_linux_arm64` | Ledger ethash-light checker for arm64 |
| `SHA256SUMS` | sha256 of the files above |

```sh
curl -fsSL -o install.sh https://scdo.com.au/downloads/wallet/linux/install.sh
sudo sh install.sh
```

The installer prefers the `.deb` when `dpkg` is present, and the tarball otherwise. `sha256sum -c` must succeed before anything is copied into place.

Without root, install for the current user. The binary is `~/.local/bin/scdo-agent`, the data root is `~/.local/share/scdo-agent`, and the units are systemd user units:

```sh
sh install.sh --user
scdo-agent --data-dir ~/.local/share/scdo-agent init --name rack-a --payout 0x<your payout address>
systemctl --user enable --now scdo-agent@rack-a.service
loginctl enable-linger "$USER"
```

`loginctl enable-linger` keeps those user units running after logout. `upgrade-now` then replaces `~/.local/bin/scdo-agent` and restarts `scdo-agent@*` on the user bus. It does not need root, and it does not touch a system install. A name that is already enabled as a system unit is not started a second time. `scdo-agent --version` and `scdo-agent -v` print the same line as `scdo-agent version`.

The user unit does not set `PrivateTmp`, `ProtectSystem`, `ProtectKernelTunables`, `ProtectKernelModules`, or `ProtectControlGroups`. Those options need a user namespace or capabilities, and recent Ubuntu blocks unprivileged user namespaces (`kernel.apparmor_restrict_unprivileged_userns=1`), which makes the user manager fail the unit with `status=218/CAPABILITIES`. The system unit keeps that hardening. `install.sh --user` starts the user timer, checks that it is active, and prints that hint if a user unit does not come up.

## One agent

```sh
sudo scdo-agent init --name rack-a --payout 0x<your payout address>
sudo systemctl enable --now scdo-agent@rack-a.service
scdo-agent status --name rack-a
scdo-agent logs --name rack-a
```

`init` is required before the first run. Since 0.5.7 `--payout` is optional: without it the agent uses its own ledger address as payout. The SCDO Agent Ledger lists only agents with a real payout address, so zero, placeholder (0x1111…1111, repeated digits), burn (0x…dEaD) and public test addresses are refused, and a mixed-case address must have a valid EIP-55 checksum. The agent sends its payout on every register and heartbeat; a 0.5.6 meta.json with a placeholder payout is repaired to the agent's own address. The key is written to `/var/lib/scdo-agent/rack-a/keys/ledger.key` with mode `0600`. It is never printed and never sent. A second `init` for the same name refuses to replace that key.

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

`keys/` is mode `0700`. The keystore is one file per purpose. `keys/wallet.key` is a second key. `wallet create` writes that file when it is missing, and never replaces an existing one. The ledger identity stays in `ledger.key`.

Without `--passphrase-file`, the key file is unencrypted and readable only by the `scdo-agent` service user. That is the unattended systemd setup. With `--passphrase-file` (or `SCDO_AGENT_PASSPHRASE_FILE`), the file is encrypted with scrypt and AES-256-GCM. Point the unit at that file with a drop-in; do not put the passphrase on the command line.

```
# /etc/systemd/system/scdo-agent@rack-a.service.d/pass.conf
[Service]
Environment=SCDO_AGENT_PASSPHRASE_FILE=/etc/scdo-agent/rack-a.pass
```

The passphrase file should be mode `0600` and owned by `scdo-agent`.

Removing the Debian package does not delete `/var/lib/scdo-agent`.

## Bot wallet

Each agent can bind a second key, `keys/wallet.key`, as a bot wallet on Base Sepolia (`eip155:84532`). Base mainnet (`eip155:8453`) is not registered. The ledger identity stays in `keys/ledger.key`.

Payment signing and the `PAYMENT-SIGNATURE` header come from the open-source x402 SDK at <https://github.com/coinbase/x402> (Apache-2.0, Copyright 2026 x402 Foundation). The licence and notice are kept in `third_party/x402/` and installed as `/usr/share/doc/scdo-agent/x402-LICENSE` and `/usr/share/doc/scdo-agent/x402-NOTICE`. `scdo-agent --version` prints the same credit.

On top of that SDK, this agent adds the per-payment cap, the rolling 24 hour cap, the payee and domain allowlists, the kill switch, and the ledger freeze. Your keys stay on your machine. SCDO never holds them.

```sh
scdo-agent wallet create --bot rack-a --email bot@example.com
scdo-agent wallet show --bot rack-a
scdo-agent wallet limit --bot rack-a --per-payment 1 --daily 5 --allow-domain api.example.com --allow-payto 0xE3837fE309618AE075DbeF0A20735c0615a308E6
scdo-agent pay https://x402.payai.network/api/base-sepolia/paid-content --bot rack-a
scdo-agent serve-paywall --bot rack-a --price 0.01 --path /answer --port 8410
scdo-agent wallet export --bot rack-a --out ks.json --export-passphrase-file /etc/scdo-agent/export.pass
scdo-agent wallet bind-email --bot rack-a
scdo-agent wallet confirm-email --bot rack-a --code 123456
scdo-agent wallet bind-x --bot rack-a
scdo-agent wallet freeze --bot rack-a
scdo-agent wallet unfreeze --bot rack-a
```

`--bot` is the agent name when `--name` is omitted. `create` POSTs `/bind` with the wallet address, an EIP-191 wallet proof signed by that wallet, and `emailCommit`. The commitment is `keccak256("scdo-bot-email-v1" ‖ salt32 ‖ lower(trim(email)))`. The 32-byte salt is `email.salt` in the agent directory, mode `0600`. The normalised address is kept in `email.txt`, mode `0600`, so `bind-email` can send it. Neither file is printed.

`pay` lets the SDK sign the exact payment and retry the HTTP 402. A 402 whose `maxTimeoutSeconds` is above 120 is capped before that signature. Policy refusals exit with status 3 and do not sign. `--max` on one payment can only tighten the cap. Amounts on `create --max`, `create --daily`, `limit`, and `pay --max` are decimal amounts of the selected asset. USDC uses 6 decimals, so `1` is `1000000`. WSCDO uses 18 decimals, so `1` is `1000000000000000000`. Defaults are 1 per payment and 5 across a rolling 24 hours, in that asset's own units. The two caps are not mixed. An empty payee list allows any payee on the enabled networks. An empty domain list allows any host. `freeze` stops signing and POSTs `/freeze`.

```sh
scdo-agent wallet create --bot rack-a --asset wscdo --max 1 --daily 5
```

`--asset wscdo` turns on Wrapped SCDO (`WSCDO3009`) at `0xea830FF078410C22342a39e8985E439dc0035cf5` on Shard0 (`eip155:5680`). The built-in allowlist entry is that contract. It is EIP-3009. The EIP-712 domain name is `Wrapped SCDO` and the version is `1`. `pay` and `serve-paywall` both accept it. A requirement whose domain name or version does not match is refused before a signature. Base mainnet (`eip155:8453`) stays off. Native SCDO is not a payment asset in this build.

`serve-paywall` is a receiver for one path. It uses the official SDK middleware. A USDC wallet uses `https://x402.org/facilitator`. A WSCDO wallet uses `https://scdo.com.au/x402-scdo`, and the settle endpoint is `https://scdo.com.au/x402-scdo/settle`. The facilitator settle wait is 120 seconds, so a Shard0 confirmation that takes longer than 30 seconds is still booked. Each settled payment is appended to `receipts.jsonl` and posted to `/ledger/income` with the full x402 payload (the authorization and the settlement response). USDC income is `eip155:84532`. WSCDO income is `eip155:5680` and the asset must be that Wrapped SCDO contract. The ledger books a Sepolia credit as tUSDC.

`export` writes a Web3 Secret Storage v3 keystore (scrypt n=2^18) under a new passphrase from `--export-passphrase-file`. A raw key is printed only on a terminal, and only with `--raw` plus `--i-understand-raw-key` (or `--i-understand-this-reveals-the-key`). Each completed export appends a line to `export-audit.log` without the key.

The wallet needs test USDC on Base Sepolia. The facilitator pays the gas. This build does not pay Base mainnet.

`wallet bind-email` POSTs `/bind/email/start` with `{agent, email, salt}`. The salt is the file `email.salt` and must match the `emailCommit` already sent on `/bind`. The salt is not logged. When the ledger answers `delivery: "todo_no_sender"`, the command reports that the commitment was accepted and no code was sent, because the ledger has no mail sender yet. `wallet confirm-email --code` POSTs a bot-signed `emailconfirm` envelope `{nonce, code}` to `/bind/email/confirm`. A sixth try is not sent.

`wallet bind-x` POSTs `/bind/x/start`. When the ledger returns an https auth URL, the command prints it. Until an X app is configured the ledger returns 503, and the command reports `X binding not yet enabled on the ledger`. The `xbind` attestation is not sent.

`operator batch --name OPERATOR --bot BOT` signs `/operator/batch` and prints the `merkleRoot` and the ledger receipt. Each bot must already be bound with `operator` set to that agent's address. The merkle root is those bind hashes in the given order: each pair is sorted, hashed, and an odd hash is carried up. One bot's root is its bind hash.

`wallet limit` updates the local policy and the local `limitsCommit`. The next `wallet create` sends that hash. The server stores the hash and does not enforce the caps. Base mainnet stays off.

## ERC-8004

Shard0 (`eip155:5680`) runs the plain ERC-8004 registries from [erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) commit `b9e466c`:

| Registry | Address |
| --- | --- |
| IdentityRegistry | `0xe1A6728e467ed9Fa2F2d0d7eE425a95c9d941F4d` |
| ReputationRegistry | `0xeB49023E929bb71A4818924DffC46Eb8B46546c4` |
| ValidationRegistry | `0x5bc80C209263Fe4F0455c76eC41F663E62D814dF` |

SCDO's main agent is agent id 2. A ledger agent registers with agent URI `https://scdo.com.au/agent-ledger/api/agents/<0x>/registration.json` and metadata key `scdoLedgerAgent` set to that ledger address.

```sh
scdo-agent erc8004 register --name rack-a --self
scdo-agent erc8004 register --name rack-a --sponsor-key-file /etc/scdo-agent/sponsor.key
```

The identity registry is an ERC-721. Pass exactly one of `--self` or `--sponsor-key-file`. `--self` sends the registration from the agent key when that account has native SCDO for gas. `--sponsor-key-file` reads a mode `0600` key file. The file may be a Web3 keystore, or a raw hex scalar: 64 hex characters, an optional `0x` prefix, and an optional trailing newline. The key is not embedded in the program and is not printed. The sponsor calls `register(uri)`, then `safeTransferFrom` of the new agent id to the agent address. That is one or two transactions, both from the sponsor. The command checks that `ownerOf` is the agent before it saves `erc8004.json`. Shard0 only. Base mainnet is not used. Before a new registration, `--self` and `status` ask IdentityRegistry whether this agent address already owns an agent id (`ownerOf` and `Transfer` logs). An owned id is reported and no second identity is sent.

An encrypted sponsor file needs `--sponsor-passphrase-file`. That passphrase is not the agent passphrase.

Automatic registration on process start stays off unless `/etc/scdo-agent/config.toml` contains:

```
erc8004 = true
```

A failed registration does not stop heartbeats. The RPC is `https://scdo.com.au/rpc/0`, then `https://apeccapital.org/rpc/0`.

## Update

`upgrade-now` is the stable entry point. A system install needs root, except for `--dry-run`. A user install (`install.sh --user`) updates without root.

```sh
sudo scdo-agent upgrade-now
sudo scdo-agent upgrade-now --dry-run
scdo-agent upgrade-now
```

`--dry-run` checks the signed feed and does not replace the binary. The last command is the user-install form: it writes `~/.local/bin/scdo-agent` and restarts user units.

The installer enables two units:

- `scdo-agent-update.timer` runs `upgrade-now` once a day, with up to one hour of random delay.
- `scdo-agent-boot.service` runs `upgrade-now` at boot so adapters are reconciled after a restart.

The feed is `https://scdo.com.au/downloads/wallet/linux/latest.json`, then `https://apeccapital.org/downloads/wallet/linux/latest.json`. The signature is Ed25519 over the same canonical JSON the desktop wallet uses: sorted keys, compact JSON, with the `signature` field removed. A `files.<arch>` object supplies `url`, `sha256`, and `size` for that CPU. The updater uses `files.amd64` or `files.arm64` for the host and falls back to the top-level fields when that entry is absent. The package sha256 is checked before the binary is replaced. The previous binary, the config directory, and each keystore are copied to `<data>/backups/<timestamp>/`. A system install uses `/var/lib/scdo-agent`. A user install uses `~/.local/share/scdo-agent`. Only the newest five of those timestamp directories are kept. Key files are copied into the backup and are not deleted from the agent directory.

After the swap, each `scdo-agent@*` instance restarts one at a time. If a restarted instance is not active, or has no successful heartbeat within 3 minutes, the previous binary is restored and the instances restart again. The next heartbeat reports `ok` or `rolled-back`.

A feed that cannot be reached leaves the installed binary as it is.

## Adapters

On update and on boot, the agent lists graphics adapters with `nvidia-smi`, then `rocm-smi`, then `lspci`. If `nvidia-smi` is installed but the command fails, the next probe is used.

`upgrade-now` does not create agents. An adapter with no agent prints a hint. Create that agent yourself, then enable it:

```sh
scdo-agent init --name gpu0 --payout 0x<address>
sudo systemctl enable --now scdo-agent@gpu0.service
```

An existing `gpuN` agent gets its model name and memory size refreshed in `meta.json` when the adapter is NVIDIA or ROCm. No workload is started on the adapter, and `upgrade-now` does not start a new unit. An adapter reported only by `lspci`, including an Intel integrated adapter, does not print a create hint. An existing directory for that name is left in place, including `meta.json`.

When an existing NVIDIA or ROCm adapter is no longer listed, that instance is stopped and an offline report is sent. The directory and the keys stay on disk. A probe that cannot run at all leaves existing adapter instances running.

## Graphics adapter proof

A NVIDIA adapter can attest to the ledger and answer an ethash challenge. Intel integrated adapters and `lspci`-only listings do not attest.

After register succeeds, and again on each heartbeat, an agent named `gpuN` (or any agent whose meta records an adapter) does this when `nvidia-smi` returns a real UUID:

1. `POST /gpu/attest` with a signed `gpuattest` envelope. The body is `{uuid, model, vramMiB, pciBusId}`.
2. `GET /gpu/challenge?agent=<address>`. An open challenge is `{id, epoch, header, target, difficulty, gpuClass, deadline}`. `scdo-ethash-gpu` searches on that NVIDIA adapter. A hit is `POST /gpu/solve` with a signed `gpusolve` body `{challengeId, nonce, mixHash}`.

No NVIDIA adapter, no helper, or a missed deadline sends nothing. The agent does not invent a nonce. The difficulty is whatever target the ledger sent.

`scdo-ethash-gpu` is a separate binary. `solve` runs only when `nvidia-smi -L` lists an adapter and OpenCL exposes a NVIDIA GPU. Install it at `/usr/lib/scdo-agent/scdo-ethash-gpu`, beside `scdo-agent`, or point `SCDO_ETHASH_GPU` at it. It needs `libOpenCL.so.1`. It is not in the reproducible package hashes. CI publishes it as the `scdo-ethash-gpu` artifact.

`scdo-ethash-verify` is the ledger checker. Set `LEDGER_GPU_CHALLENGE_VERIFY` to that binary. It holds no keys. One JSON object on stdin:

```json
{"epoch":0,"header":"0x<64 hex>","target":"0x<64 hex>","nonce":"0x<hex>","mixHash":"0x<64 hex>"}
```

stdout is `{"ok":true}` or `{"ok":false}`. The check is one ethash-light hashimoto. `nonce` is the integer (`0x` plus hex digits), not a little-endian byte string. Exit 0 means the check ran. Exit 2 is malformed input. CI publishes `scdo-ethash-verify_<version>_linux_amd64` and `scdo-ethash-verify_<version>_linux_arm64`, and their sha256 lines are in `SHA256SUMS`.

## X account file

`/etc/scdo-agent/x-accounts.toml` maps an X handle and user id to an agent name:

```
[[account]]
handle = "example"
user_id = "123"
agent = "example"
```

A new row does not create an agent. `upgrade-now` prints a hint. Create the agent with `init --name` and `--payout`, then run `upgrade-now` again. An existing row only refreshes the handle and user id stored in `meta.json` and does not replace the key. OAuth binding is not part of this build.

## Rig hook

`linux-agent/scripts/rig-hook.sh` is a companion for a Classic node upgrader or an rtty push. That upgrader is not in this repository, and this package does not change it. The hook installs scdo-agent from `https://scdo.com.au/downloads/wallet/linux/install.sh` when the binary is missing, then runs `scdo-agent upgrade-now`.

```sh
sudo sh linux-agent/scripts/rig-hook.sh
```

## Language

English is the default. 華語 is `--lang zh`, or any `LANG` / `LC_ALL` value that starts with `zh`.

## Build

Go 1.24.1, checked against `scripts/toolchain.sum`. `package.sh` downloads that tarball itself.

```sh
cd linux-agent
go test ./...
sh scripts/package.sh
```

`package.sh` writes both architectures, both archives, both `scdo-ethash-verify` binaries, `install.sh`, and `SHA256SUMS` under `linux-agent/dist/`. The build sets `CGO_ENABLED=0`, `-trimpath`, `-buildvcs=false`, and `-ldflags '-s -w -buildid='` with the version string from `internal/buildinfo`. `GOFLAGS=-mod=readonly` is set after `go mod verify`. `GOROOT` and `GOMODCACHE` are fixed paths, because an assembly include otherwise records the home directory. `SOURCE_DATE_EPOCH` pins archive mtimes. The tarball is written by `scripts/mktar` with the pinned Go toolchain and members sorted by name, because Ubuntu 22.04 and 24.04 tar write different ustar headers. Deb mtimes use the same epoch. GitHub Actions (`.github/workflows/linux-agent.yml`) builds that script on `ubuntu-24.04` and `ubuntu-22.04` and fails if the SHA-256 files differ. The published hashes are the `scdo-agent-linux` artifact from that job. Publish that directory to `https://scdo.com.au/downloads/wallet/linux/`. Nothing in CI uploads to that host. `scripts/build-ethash-gpu.sh` builds the OpenCL helper; that job uploads `scdo-ethash-gpu` separately.

## 華語

無介面的記帳代理，供 [SCDO 代理帳本](https://scdo.com.au/agent-ledger/) 使用。單一靜態執行檔 `scdo-agent`，以 systemd 服務執行。每個名稱有自己的 secp256k1 身份，向帳本登記，並每五分鐘送出一次心跳。

服務只維護帳本紀錄，不啟動節點行程。Base Sepolia 的 USDC 付款是另一個 `wallet` 命令。桌面錢包的行為沒有改動。

### 安裝

發布檔案放在 `https://scdo.com.au/downloads/wallet/linux/`。`install.sh` 會判斷 x86_64 或 arm64，核對 `SHA256SUMS`，再安裝執行檔與 systemd 單元。有 `dpkg` 時用 `.deb`，否則用壓縮檔。同一份 `SHA256SUMS` 也列出 `scdo-ethash-verify_<版本>_linux_amd64` 與 `scdo-ethash-verify_<版本>_linux_arm64`。這兩個檔案是帳本用的 ethash-light 檢查程式，安裝程式不會把它們複製進代理目錄。

```sh
curl -fsSL -o install.sh https://scdo.com.au/downloads/wallet/linux/install.sh
sudo sh install.sh
```

沒有 root 時，安裝到目前的使用者。執行檔是 `~/.local/bin/scdo-agent`，資料目錄是 `~/.local/share/scdo-agent`，單元是 systemd 的使用者單元：

```sh
sh install.sh --user
scdo-agent --data-dir ~/.local/share/scdo-agent init --name rack-a --payout 0x<收款地址>
systemctl --user enable --now scdo-agent@rack-a.service
loginctl enable-linger "$USER"
```

`loginctl enable-linger` 讓這些使用者單元在登出後繼續執行。`upgrade-now` 會替換 `~/.local/bin/scdo-agent`，並在使用者匯流排上重啟 `scdo-agent@*`。它不需要 root，也不會改動系統安裝。已經在系統單元裡啟用的名稱不會再啟動第二次。`scdo-agent --version` 與 `scdo-agent -v` 印出的內容和 `scdo-agent version` 相同。

使用者單元不設定 `PrivateTmp`、`ProtectSystem`、`ProtectKernelTunables`、`ProtectKernelModules`、`ProtectControlGroups`。這些選項需要使用者命名空間或權限。較新的 Ubuntu 預設 `kernel.apparmor_restrict_unprivileged_userns=1`，使用者管理員會以 `status=218/CAPABILITIES` 失敗。系統單元仍保留這些限制。`install.sh --user` 會啟動使用者計時器，確認它處於執行中，若使用者單元沒有起來就印出這個提示。

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

`meta.json` 只有地址、收款地址與角色。`state.json` 是序號。`keys/ledger.key` 是身份。`keys/` 權限 `0700`。金鑰庫一個用途一個檔案。`keys/wallet.key` 是第二把金鑰。`wallet create` 在這個檔案不存在時寫入，已存在的檔案不會被替換。帳本身份仍在 `ledger.key`。

未加 `--passphrase-file` 時，金鑰不加密，只有服務使用者 `scdo-agent` 能讀，適合無人值守。加上 `--passphrase-file`（或 `SCDO_AGENT_PASSPHRASE_FILE`）後，以 scrypt 與 AES-256-GCM 加密。不要把通行詞放在命令列上。

移除 Debian 套件不會刪除 `/var/lib/scdo-agent`。

### 機器人錢包

每個代理可以用第二把金鑰 `keys/wallet.key`，綁定成 Base Sepolia（`eip155:84532`）上的機器人錢包。Base 主網（`eip155:8453`）不會登記。帳本身份仍在 `keys/ledger.key`。

付款簽章與 `PAYMENT-SIGNATURE` 標頭來自開源的 x402 SDK：<https://github.com/coinbase/x402>（Apache-2.0，Copyright 2026 x402 Foundation）。授權條款與 NOTICE 放在 `third_party/x402/`，安裝後位於 `/usr/share/doc/scdo-agent/x402-LICENSE` 與 `/usr/share/doc/scdo-agent/x402-NOTICE`。`scdo-agent --version` 會印出同一段致謝。

在這個 SDK 之上，本代理加上單筆上限、滾動 24 小時上限、收款地址與網域清單、停止開關，以及帳本凍結。金鑰只存在你的機器上，SCDO 不保管。

```sh
scdo-agent wallet create --bot rack-a --email bot@example.com
scdo-agent wallet show --bot rack-a
scdo-agent wallet limit --bot rack-a --per-payment 1 --daily 5 --allow-domain api.example.com --allow-payto 0xE3837fE309618AE075DbeF0A20735c0615a308E6
scdo-agent pay https://x402.payai.network/api/base-sepolia/paid-content --bot rack-a
scdo-agent serve-paywall --bot rack-a --price 0.01 --path /answer --port 8410
scdo-agent wallet export --bot rack-a --out ks.json --export-passphrase-file /etc/scdo-agent/export.pass
scdo-agent wallet bind-email --bot rack-a
scdo-agent wallet confirm-email --bot rack-a --code 123456
scdo-agent wallet bind-x --bot rack-a
scdo-agent wallet freeze --bot rack-a
scdo-agent wallet unfreeze --bot rack-a
```

未加 `--name` 時，`--bot` 就是代理名稱。`create` 會把錢包地址、該錢包的 EIP-191 證明，以及 `emailCommit` 送到 `/bind`。承諾是 `keccak256("scdo-bot-email-v1" ‖ salt32 ‖ lower(trim(email)))`。32 位元組的鹽在代理目錄的 `email.salt`，權限 `0600`。正規化後的信箱存在 `email.txt`，權限 `0600`，供 `bind-email` 送出。這兩個檔案都不會印出。

`pay` 由 SDK 簽署 exact 付款並重試 HTTP 402。若 402 的 `maxTimeoutSeconds` 大於 120，會先改成 120 再簽章。政策拒絕時結束代碼為 3，而且不會簽章。單次 `--max` 只能把上限調得更低。`create --max`、`create --daily`、`limit` 與 `pay --max` 的金額是所選資產的十進位數量。USDC 是 6 位小數，`1` 是 `1000000`。WSCDO 是 18 位小數，`1` 是 `1000000000000000000`。預設單筆 1、滾動 24 小時 5，單位屬於該資產自己。兩組上限不會混用。收款清單是空的時候，允許已啟用網路上的任何收款地址。網域清單是空的時候，允許任何主機。`freeze` 會停止簽章並送到 `/freeze`。

```sh
scdo-agent wallet create --bot rack-a --asset wscdo --max 1 --daily 5
```

`--asset wscdo` 啟用 Shard0（`eip155:5680`）上的 Wrapped SCDO（`WSCDO3009`），合約 `0xea830FF078410C22342a39e8985E439dc0035cf5`。內建允許清單就是這個合約。它使用 EIP-3009。EIP-712 領域名稱是 `Wrapped SCDO`，版本是 `1`。`pay` 與 `serve-paywall` 都接受它。領域名稱或版本不符的要求會在簽章前被拒絕。Base 主網（`eip155:8453`）保持關閉。這個版本不以原生 SCDO 作為付款資產。

`serve-paywall` 是單一路徑的收款端。它使用官方 SDK 中介層。USDC 錢包使用 `https://x402.org/facilitator`。WSCDO 錢包使用 `https://scdo.com.au/x402-scdo`，結算端點是 `https://scdo.com.au/x402-scdo/settle`。結算等候時間是 120 秒，所以超過 30 秒才在 Shard0 確認的付款仍會入帳。每筆已結算的付款會附加到 `receipts.jsonl`，並把完整的 x402 內容（授權與結算回應）送到 `/ledger/income`。USDC 的入帳網路是 `eip155:84532`。WSCDO 的入帳網路是 `eip155:5680`，資產必須是這個 Wrapped SCDO 合約。帳本把 Sepolia 的貸方記成 tUSDC。

`export` 以新的通行詞（來自 `--export-passphrase-file`）寫出 Web3 Secret Storage v3 金鑰庫（scrypt n=2^18）。原始金鑰只在終端機上印出，而且必須加上 `--raw` 與 `--i-understand-raw-key`（或 `--i-understand-this-reveals-the-key`）。每次完成的匯出都會在 `export-audit.log` 附加一行，裡面沒有金鑰。

錢包需要 Base Sepolia 上的測試 USDC。燃料費由 facilitator 支付。這個版本不會在 Base 主網付款。

`wallet bind-email` 把 `{agent, email, salt}` 送到 `/bind/email/start`。鹽來自 `email.salt`，必須對上先前 `/bind` 送出的 `emailCommit`。鹽不會寫進紀錄。帳本若回 `delivery: "todo_no_sender"`，命令會說明承諾已接受、驗證碼尚未寄出，因為帳本還沒有寄信程式。`wallet confirm-email --code` 送出機器人簽署的 `emailconfirm` 信封 `{nonce, code}` 到 `/bind/email/confirm`。第 6 次不會送出。

`wallet bind-x` 送到 `/bind/x/start`。帳本若回傳 https 授權網址，命令會印出它。在 X 應用程式設定好之前，帳本回 503，命令回報 `X binding not yet enabled on the ledger`。不會送出 `xbind` 證明。

`operator batch --name 操作者 --bot 機器人` 簽署 `/operator/batch`，並印出 `merkleRoot` 與帳本回執。每個機器人綁定時的 `operator` 必須是這個代理的地址。根是這些綁定雜湊，順序與參數相同：每一對先排序再雜湊，落單的雜湊原樣往上。只有一個機器人時，根就是它的綁定雜湊。

`wallet limit` 更新本機政策與本機 `limitsCommit`。下一次 `wallet create` 會送出這個雜湊。伺服器只保存雜湊，不執行上限。Base 主網保持關閉。

### ERC-8004

Shard0（`eip155:5680`）上的 ERC-8004 登記冊是 [erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) 提交 `b9e466c` 的一般合約：

| 登記冊 | 地址 |
| --- | --- |
| IdentityRegistry | `0xe1A6728e467ed9Fa2F2d0d7eE425a95c9d941F4d` |
| ReputationRegistry | `0xeB49023E929bb71A4818924DffC46Eb8B46546c4` |
| ValidationRegistry | `0x5bc80C209263Fe4F0455c76eC41F663E62D814dF` |

SCDO 的主要代理是代理編號 2。帳本代理的 URI 是 `https://scdo.com.au/agent-ledger/api/agents/<0x>/registration.json`，鏈上中繼資料鍵 `scdoLedgerAgent` 的值是該帳本地址。

```sh
scdo-agent erc8004 register --name rack-a --self
scdo-agent erc8004 register --name rack-a --sponsor-key-file /etc/scdo-agent/sponsor.key
```

身份登記冊是 ERC-721。`--self` 與 `--sponsor-key-file` 必須正好指定一個。`--self` 在代理帳戶有原生 SCDO 可付手續費時，由代理金鑰送出登記。`--sponsor-key-file` 讀取權限 `0600` 的金鑰檔。檔案可以是 Web3 金鑰庫，也可以是原始十六進位純量：64 個十六進位字元，可加 `0x`，可有結尾換行。金鑰不會內嵌在程式裡，也不會印出。贊助者呼叫 `register(uri)`，再以 `safeTransferFrom` 把新的代理編號轉給代理地址。這是一筆或兩筆交易，都由贊助者送出。命令在寫入 `erc8004.json` 之前會檢查 `ownerOf` 就是該代理。只在 Shard0。Base 主網不會使用。`--self` 與 `status` 會先向 IdentityRegistry 查這個代理地址是否已經擁有代理編號（`ownerOf` 與 `Transfer` 紀錄）。已經擁有就回報該編號，不再送出第二個身份。

加密的贊助者金鑰需要 `--sponsor-passphrase-file`。那份通行詞不是代理的通行詞。

除非 `/etc/scdo-agent/config.toml` 寫了下面這一行，否則行程啟動時不會自動登記：

```
erc8004 = true
```

登記失敗不會停止心跳。RPC 先用 `https://scdo.com.au/rpc/0`，失敗時改用 `https://apeccapital.org/rpc/0`。

### 更新

`upgrade-now` 是固定的進入點。系統安裝除了 `--dry-run` 之外需要 root。`install.sh --user` 的安裝不需要 root。

```sh
sudo scdo-agent upgrade-now
sudo scdo-agent upgrade-now --dry-run
scdo-agent upgrade-now
```

`--dry-run` 只檢查簽章後的發布檔，不替換執行檔。最後一條是使用者安裝的形式：寫入 `~/.local/bin/scdo-agent`，並重啟使用者單元。

安裝程式會啟用兩個單元：

- `scdo-agent-update.timer` 每天執行一次 `upgrade-now`，並加上最多一小時的隨機延遲。
- `scdo-agent-boot.service` 在開機時執行 `upgrade-now`，以便重新啟動後核對顯示卡。

發布檔先讀 `https://scdo.com.au/downloads/wallet/linux/latest.json`，失敗時改讀 `https://apeccapital.org/downloads/wallet/linux/latest.json`。簽章是 Ed25519，規範 JSON 與桌面錢包相同：排序後的緊湊 JSON，並拿掉 `signature`。`files.<架構>` 提供該處理器的 `url`、`sha256` 與 `size`。更新程式依主機使用 `files.amd64` 或 `files.arm64`，沒有該項目時改用最外層欄位。替換執行檔之前會核對套件的 sha256。先前的執行檔、設定目錄與每份金鑰庫會複製到 `<資料目錄>/backups/<時間戳>/`。系統安裝用 `/var/lib/scdo-agent`。使用者安裝用 `~/.local/share/scdo-agent`。只保留最新的五個時間戳目錄。金鑰會複製進備份，代理目錄裡的金鑰不會被刪除。

替換之後，每個 `scdo-agent@*` 實例會逐一重新啟動。若重新啟動的實例沒有處於執行中，或 3 分鐘內沒有成功的心跳，就還原先前的執行檔並再次啟動這些實例。下一次心跳會回報 `ok` 或 `rolled-back`。

連不上發布檔時，已安裝的執行檔保持不變。

### 顯示卡

更新時與開機時，會依序用 `nvidia-smi`、`rocm-smi`、`lspci` 列出顯示卡。若 `nvidia-smi` 已安裝但命令失敗，就改用下一個探測。

`upgrade-now` 不會建立代理。沒有代理的顯示卡只會印出提示。請自行建立，再啟用：

```sh
scdo-agent init --name gpu0 --payout 0x<地址>
sudo systemctl enable --now scdo-agent@gpu0.service
```

既有的 `gpuN` 代理，在顯示卡是 NVIDIA 或 ROCm 時，會在 `meta.json` 更新型號與記憶體大小。不會在顯示卡上啟動工作，`upgrade-now` 也不會啟動新的單元。只由 `lspci` 回報的顯示卡（包含 Intel 內建）不會印出建立提示。該名稱若已有目錄，目錄與 `meta.json` 會保留。

既有的 NVIDIA 或 ROCm 顯示卡若不再出現在清單上，該實例會停止，並送出離線回報。目錄與金鑰留在磁碟上。探測完全無法執行時，既有的顯示卡實例會繼續運行。

### 顯示卡證明

NVIDIA 顯示卡可以向帳本證明自己，並回答 ethash 題目。Intel 內建與只由 `lspci` 列出的顯示卡不會送出證明。

登記成功之後，以及每一次心跳，名稱是 `gpuN` 的代理（或 `meta` 裡記錄了顯示卡的代理）在 `nvidia-smi` 回傳真實 UUID 時會做兩件事：

1. 以簽署過的 `gpuattest` 信封 `POST /gpu/attest`。內容是 `{uuid, model, vramMiB, pciBusId}`。
2. `GET /gpu/challenge?agent=<地址>`。開放的題目是 `{id, epoch, header, target, difficulty, gpuClass, deadline}`。`scdo-ethash-gpu` 在該 NVIDIA 顯示卡上搜尋。找到後以簽署過的 `gpusolve` 內容 `{challengeId, nonce, mixHash}` `POST /gpu/solve`。

沒有 NVIDIA 顯示卡、沒有這個輔助程式，或超過期限，就什麼都不送。代理不會編造 nonce。難度就是帳本送來的 target。

`scdo-ethash-gpu` 是另一個執行檔。`solve` 只在 `nvidia-smi -L` 列出顯示卡，而且 OpenCL 看得到 NVIDIA GPU 時才搜尋。把它放到 `/usr/lib/scdo-agent/scdo-ethash-gpu`、與 `scdo-agent` 同一目錄，或用 `SCDO_ETHASH_GPU` 指向它。它需要 `libOpenCL.so.1`。它不在可重現套件的雜湊裡。CI 以 `scdo-ethash-gpu` 成品另外發布。

`scdo-ethash-verify` 是帳本的檢查程式。把 `LEDGER_GPU_CHALLENGE_VERIFY` 設成這個執行檔。它沒有金鑰。標準輸入是一個 JSON：

```json
{"epoch":0,"header":"0x<64 hex>","target":"0x<64 hex>","nonce":"0x<hex>","mixHash":"0x<64 hex>"}
```

標準輸出是 `{"ok":true}` 或 `{"ok":false}`。檢查是一次 ethash-light hashimoto。`nonce` 是整數（`0x` 加十六進位），不是小端位元組。結束代碼 0 表示檢查已執行。結束代碼 2 是輸入格式不對。CI 發布 `scdo-ethash-verify_<版本>_linux_amd64` 與 `scdo-ethash-verify_<版本>_linux_arm64`，它們的 sha256 寫在 `SHA256SUMS`。

### X 帳號檔

`/etc/scdo-agent/x-accounts.toml` 把 X 帳號代號與使用者編號對應到代理名稱：

```
[[account]]
handle = "example"
user_id = "123"
agent = "example"
```

新的一列不會建立代理。`upgrade-now` 只會印出提示。請用 `init --name` 與 `--payout` 建立代理，再執行一次 `upgrade-now`。既有的一列只會更新 `meta.json` 裡的代號與使用者編號，不會替換金鑰。這個版本不含 OAuth 綁定。

### 機台掛鉤

`linux-agent/scripts/rig-hook.sh` 是給 Classic 節點升級程式或 rtty 推送使用的伴隨腳本。那個升級程式不在這個儲存庫裡，這個套件也不會改動它。執行檔不存在時，掛鉤會從 `https://scdo.com.au/downloads/wallet/linux/install.sh` 安裝，然後執行 `scdo-agent upgrade-now`。

```sh
sudo sh linux-agent/scripts/rig-hook.sh
```

### 語言

預設英文。華語使用 `--lang zh`，或 `LANG` / `LC_ALL` 以 `zh` 開頭。

### 建置

`scripts/package.sh` 核對 Go 1.24.1 官方壓縮檔的 sha256，再用 `CGO_ENABLED=0`、`-trimpath`、空的 `-buildid`、`SOURCE_DATE_EPOCH` 與排序後的檔案順序打包。壓縮檔由固定的 Go 工具鏈寫出，不使用主機的 tar。模組快取路徑是固定的。GitHub Actions 在 `ubuntu-24.04` 與 `ubuntu-22.04` 各建置一次，SHA-256 不同就失敗。對外公布的雜湊是該 `scdo-agent-linux` 成品。
