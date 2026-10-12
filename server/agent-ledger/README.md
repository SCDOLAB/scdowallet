# SCDO AI Agent Ledger v1 (server)

Key-free ledger for wallet/miner agents. Each wallet generates its own secp256k1 agent key locally
(`<userData>/agent/agent-key.json`, never sent) and signs EIP-191 envelopes
(`"SCDO Agent Ledger v1\n" + canonical JSON`, chainId 5680). The agent ID is the EVM address, the
same identity type used by AgentLedger v0.1 (`0x377a…a2aa`) and ComputeLedger `registerBySig`, so
agents can later be registered/anchored on Shard0 without a new key.

This server only verifies signatures and stores envelopes (append-only `envelopes.jsonl`). It holds no keys.

API (behind nginx at `/agent-ledger/api/`, upstream 127.0.0.1:8147):
- `POST /register`, `POST /heartbeat`, `POST /heal`: body = `{ payload, sig }`. Checks: signature, chainId,
  ±10 min clock, strictly increasing seq per agent (replay), registered first, 8 KB body, rate limits.
- `GET /agents`, `GET /agents/<0xaddr>`, `GET /health`.

Pages: `/agent-ledger/` (English), `/agent-ledger/zh/` (華語繁體). One language per page. Regenerate with `node public/gen.js`.

Deploy (.88, root): copy this folder, then `cd deploy && ./apply.sh`. It backs up to
`/root/backups/agent-ledger-20261012/`, aborts and restores if `nginx -t` fails. Rollback: `/root/backups/agent-ledger-20261012/rollback.sh`.
Tests: `npm test` at the repo root (`test/agent-ledger.js`).
