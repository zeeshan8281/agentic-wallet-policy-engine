# @eigencompute/wallet-policy

Drop-in TypeScript client for the [Agentic Wallet Policy Engine](https://github.com/zeeshan8281/agentic-wallet-policy-engine) —
TEE-enforced spending policies for agent wallets on EigenCompute.

```bash
npm install @eigencompute/wallet-policy
```

```ts
import { PolicyWallet } from "@eigencompute/wallet-policy";

const wallet = new PolicyWallet({ engineUrl: "http://localhost:3100", chain: "ethereum" });

const result = await wallet.signTransaction({
  to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  value: "0.05",
  data: "0x38ed1739...",
});

if (result.ok) console.log(result.txHash, result.attestation);
else console.log(result.error, result.violations); // e.g. ["max_per_tx exceeded: 0.5 > 0.1 ETH"]
```

| Method | Returns |
|--------|---------|
| `signTransaction(tx)` | `SignResult` — `{ ok, txHash?, attestation?, error?, violations?, policyHash }` |
| `getSpendingStatus()` | `SpendingStatus` |
| `getPolicy()` | `{ policy, policyHash }` |
| `getAddress()` | `string` |
| `onEvent(cb)` | unsubscribe fn (WebSocket event stream) |

Works on Node 18+ and in the browser (uses global `fetch` / `WebSocket`). Pass
`fetchImpl` to inject a custom fetch in other environments.

MIT.
