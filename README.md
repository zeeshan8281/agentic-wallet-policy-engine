# 🛡️ Agentic Wallet Policy Engine (AWPE)

**TEE-enforced spending policies for agent wallets on EigenCompute.**

Autonomous agents need wallets. EigenCompute already derives a persistent
keypair for every deployed container via its in-TEE KMS. The missing piece is a
**policy layer between "the model decided to send 50 ETH" and the transaction
hitting the chain.**

Software guardrails live in the same context as the model — a jailbreak that
fools the model fools the guard. AWPE moves enforcement *outside* the model's
execution context, into a separate process inside the same TEE enclave. The
model can be fully prompt-injected and still cannot move funds that violate
policy.

> The injection succeeds at the model layer and **fails at the wallet layer.**

---

## How it works

```
Agent (LLM) ── signTransaction(tx) ──▶ Policy Engine (sidecar, TEE)
                                          │  load policy.toml
                                          │  ✓ max_per_tx
                                          │  ✓ daily / monthly cap
                                          │  ✓ contract whitelist
                                          │  ✓ function selector
                                  PASS ───┴─── FAIL
                                   │            │
                            KMS.sign(tx)   REJECT + LOG + ALERT
                                   │
                            signed tx ──▶ broadcast
```

The policy engine is the **only** path to the KMS. `policy.toml` is baked into
the Docker image at build time and is immutable at runtime — changing it
requires a new deployment, which records a new image digest on-chain. Anyone can
verify exactly which policy was active when a transaction was signed.

---

## Repository layout

| Path | What |
|------|------|
| `engine/` | Express + WebSocket policy engine (the deployable). `policy.ts` holds the validation logic, `ledger.ts` the rolling-window spend tracker, `kms.ts` the KMS abstraction. |
| `sdk/` | `@eigencompute/wallet-policy` — drop-in TypeScript client. |
| `demo-ui/` | React + Tailwind + Recharts dashboard. Three panels: activity feed, policy verdict, spending dashboard. |
| `simulate/` | `demo.ts` — fires the three demo scenarios against a running engine. |
| `Dockerfile` | Multi-stage build: compiles UI + engine, ships a runtime image that serves both. |

---

## Quick start (local)

```bash
# 1. build + run the engine (serves API on :3100)
cd engine && npm install && npm run build && npm start

# 2. in another terminal — run the dashboard (proxies API to :3100)
cd demo-ui && npm install && npm run dev      # http://localhost:5173

# 3. drive the three demo scenarios
cd simulate && npm install && npm run demo
```

Or run the whole thing as the production image:

```bash
docker run --platform linux/amd64 -p 3100:3100 zeeshan8281/awpe-engine:latest
# dashboard + API both at http://localhost:3100
```

---

## The three demo scenarios

| # | Request | Verdict | Why |
|---|---------|---------|-----|
| 1 | 0.05 ETH swap on whitelisted Uniswap router | ✅ **PASS** | Under all limits, whitelisted target + selector |
| 2 | 2.0 ETH transfer to an EOA | ⛔ **BLOCKED** | `max_per_tx` exceeded **and** `allow_eoa = false` |
| 3 | Prompt-injected drain to attacker address | ⛔ **BLOCKED** | Target not whitelisted, selector not allowed — the engine doesn't care *why* the agent asked |

---

## SDK usage

```ts
import { PolicyWallet } from "@eigencompute/wallet-policy";

const wallet = new PolicyWallet({
  engineUrl: "http://localhost:3100", // the sidecar inside your TEE
  chain: "ethereum",
});

const result = await wallet.signTransaction({
  to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  value: "0.05",
  data: "0x38ed1739...", // swapExactTokensForTokens calldata
});

if (result.ok) {
  console.log(result.txHash, result.attestation);
} else {
  console.log(result.error, result.violations, result.policyHash);
}

await wallet.getSpendingStatus(); // { dailySpent, dailyCap, remainingDaily, ... }
await wallet.getPolicy();         // parsed policy.toml + hash
```

| Method | Returns |
|--------|---------|
| `signTransaction(tx)` | `SignResult { ok, txHash?, attestation?, error?, violations?, policyHash }` |
| `getSpendingStatus()` | `SpendingStatus` |
| `getPolicy()` | `{ policy, policyHash }` |
| `getAddress()` | `string` |
| `onEvent(cb)` | unsubscribe fn (WebSocket stream) |

---

## Policy config

`engine/policy.toml` — baked into the image, immutable at runtime:

```toml
[limits]
max_per_tx  = "0.1"
daily_cap   = "1.0"
monthly_cap = "10.0"

[whitelist]
contracts = ["0x7a250d56...", "0xd9e1cE17..."]
allow_eoa = false

[selectors]
allowed = ["0x38ed1739", "0x7ff36ab5", "0x095ea7b3"]

[alerts]
webhook            = ""
on_violation       = true
on_daily_threshold = 0.8
```

---

## API

| Endpoint | Purpose |
|----------|---------|
| `POST /sign` | Validate against policy, sign via KMS if it passes. `403` + violations if not. |
| `GET /status` | Rolling-window spend snapshot. |
| `GET /policy` | Active policy + its SHA-256 hash. |
| `GET /address` | TEE-derived wallet address. |
| `GET /health` | Liveness + enclave status. |
| `WS /ws/events` | Real-time `request` / `verdict` / `status` / `alert` events. |

---

## Deploy to EigenCompute

The image must be `linux/amd64`, `EXPOSE` its port, and listen on `0.0.0.0`
(this one does — port `3100`).

```bash
# build + push
docker buildx build --platform linux/amd64 -t <user>/awpe-engine:latest --push .

# deploy (requires an active EigenCompute billing subscription)
ecloud billing subscribe          # one-time, enables app quota
ecloud compute app deploy \
  --name awpe \
  --image-ref docker.io/<user>/awpe-engine:latest \
  --skip-profile --env-file .env \
  --instance-type g1-standard-4t \
  --log-visibility public \
  --resource-usage-monitoring enable --force
```

After deploy, verify the on-chain digest + attestation at
`https://verify-sepolia.eigencloud.xyz/app/<APP_ID>`.

Inside the TEE the engine reads the KMS signing public key from
`/usr/local/bin/kms-signing-public-key.pem`; its presence flips the engine from
mock signing to real KMS-attested signing, and every `/sign` response carries a
TEE attestation.

---

## Why this only works on EigenCompute

- **TEE isolation** — the policy engine runs in the same enclave as the agent
  but as a separate process. The LLM cannot read or modify its memory. Hardware
  enforcement (Intel TDX / AMD SEV-SNP), not a software sandbox.
- **Deterministic KMS** — keys are derived from the app ID inside the TEE, and
  the policy engine is the only path to them. No escape hatch.
- **On-chain deployment records** — the image digest (which contains
  `policy.toml`) is recorded on-chain. Verifiable after the fact.
- **Attestation** — signing responses include a TEE attestation proving the
  policy check happened inside the enclave.

---

## Out of scope (v1)

In-memory spend ledger (resets on restart), ETH only, immutable policy per
deployment, no multi-sig, no gas policy, no ERC-20/NFT-specific rules. See the
design doc for the v2 list.

---

*Built on EigenCompute · Verifiable Offchain Compute · eigencompute.com*
