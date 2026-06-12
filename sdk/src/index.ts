/**
 * @eigencompute/wallet-policy
 *
 * Drop-in client for the Agentic Wallet Policy Engine. Point it at your policy
 * engine sidecar (running in the same TEE as your agent) and get
 * policy-enforced signing with no extra code. Works in Node 18+ and browsers
 * (uses the global `fetch` / `WebSocket`).
 */

export interface PolicyWalletOptions {
  /** Base URL of the policy engine sidecar, e.g. "http://localhost:3100". */
  engineUrl: string;
  /** Chain hint passed through to the engine. */
  chain?: "ethereum" | "solana";
  /** Optional custom fetch (for non-browser / non-Node-18 environments). */
  fetchImpl?: typeof fetch;
}

export interface TxInput {
  to: string;
  value: string; // ETH as a decimal string, e.g. "0.05"
  data?: string; // hex calldata; omit / "0x" for a plain transfer
}

export interface Attestation {
  enclave: boolean;
  kmsKeyFingerprint: string | null;
  policyHash: string;
  signedAt: string;
}

export type SignResult =
  | {
      ok: true;
      txHash: string;
      attestation: Attestation;
      policyHash: string;
    }
  | {
      ok: false;
      error: "POLICY_VIOLATION" | "KMS_ERROR" | "BAD_REQUEST" | "NETWORK_ERROR";
      violations?: string[];
      rules?: string[];
      message?: string;
      policyHash?: string;
    };

export interface SpendingStatus {
  dailySpent: string;
  dailyCap: string;
  remainingDaily: string;
  monthlySpent: string;
  monthlyCap: string;
  txCount24h: number;
  lastTx: string | null;
}

export interface PolicyConfig {
  limits: { max_per_tx: string; daily_cap: string; monthly_cap: string };
  whitelist: { contracts: string[]; allow_eoa: boolean };
  selectors: { allowed: string[] };
  alerts: { webhook: string; on_violation: boolean; on_daily_threshold: number };
}

export type EngineEvent =
  | { type: "request"; tx: TxInput; at: string }
  | {
      type: "verdict";
      verdict: "PASS" | "BLOCKED";
      tx: TxInput;
      violations: { rule: string; message: string }[];
      txHash?: string;
      policyHash: string;
      at: string;
    }
  | { type: "status"; status: SpendingStatus; at: string }
  | { type: "alert"; level: "warn"; message: string; at: string };

export class PolicyWallet {
  private readonly engineUrl: string;
  private readonly chain: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: PolicyWalletOptions) {
    this.engineUrl = opts.engineUrl.replace(/\/+$/, "");
    this.chain = opts.chain ?? "ethereum";
    const f = opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
    if (!f) {
      throw new Error(
        "No fetch implementation available. Pass `fetchImpl` or run on Node 18+ / a browser."
      );
    }
    this.fetchImpl = f;
  }

  /** Validate a transaction against policy, then sign it via the TEE KMS. */
  async signTransaction(tx: TxInput): Promise<SignResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.engineUrl}/sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tx),
      });
    } catch (e) {
      return { ok: false, error: "NETWORK_ERROR", message: (e as Error).message };
    }
    const body = (await res.json()) as any;
    if (res.ok && body.ok) {
      return {
        ok: true,
        txHash: body.txHash,
        attestation: body.attestation,
        policyHash: body.policyHash,
      };
    }
    return {
      ok: false,
      error: body.error ?? "BAD_REQUEST",
      violations: body.violations,
      rules: body.rules,
      message: body.message,
      policyHash: body.policyHash,
    };
  }

  /** Current rolling-window spend (read-only, no signing). */
  async getSpendingStatus(): Promise<SpendingStatus> {
    const res = await this.fetchImpl(`${this.engineUrl}/status`);
    return (await res.json()) as SpendingStatus;
  }

  /** The active, immutable policy config (parsed policy.toml). */
  async getPolicy(): Promise<{ policy: PolicyConfig; policyHash: string }> {
    const res = await this.fetchImpl(`${this.engineUrl}/policy`);
    return (await res.json()) as { policy: PolicyConfig; policyHash: string };
  }

  /** The TEE-derived wallet address. */
  async getAddress(): Promise<string> {
    const res = await this.fetchImpl(`${this.engineUrl}/address`);
    const body = (await res.json()) as { address: string };
    return body.address;
  }

  /**
   * Subscribe to real-time engine events over WebSocket. Returns an
   * unsubscribe function. Used by the demo dashboard.
   */
  onEvent(cb: (ev: EngineEvent) => void): () => void {
    const WS: typeof WebSocket | undefined =
      (globalThis as any).WebSocket ?? undefined;
    if (!WS) {
      throw new Error(
        "No WebSocket implementation available. In Node, pass one via globalThis or use the `ws` package."
      );
    }
    const wsUrl = this.engineUrl.replace(/^http/, "ws") + "/ws/events";
    const sock = new WS(wsUrl);
    sock.onmessage = (ev: MessageEvent) => {
      try {
        cb(JSON.parse(ev.data as string) as EngineEvent);
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => sock.close();
  }
}

export default PolicyWallet;
