import { privateKeyToAccount } from "viem/accounts";
import { getAddress, toHex, type Hex, type LocalAccount } from "viem";
import { randomBytes } from "node:crypto";

/**
 * The x402 v2 "accept" entry from a merchant's 402 challenge — the thing the
 * agent forwards to AWPE asking it to sign. AWPE, not the agent, holds the key.
 */
export interface V2Accept {
  scheme: string;
  network: string; // CAIP-2, e.g. "eip155:8453"
  amount?: string; // base units (USDC = 6 decimals)
  maxAmountRequired?: string;
  asset: string; // token contract (USDC)
  payTo: string; // merchant settlement address — the thing we allowlist
  maxTimeoutSeconds?: number;
  description?: string;
  extra?: { name?: string; version?: string };
}

export interface PaymentPolicyConfig {
  max_per_payment_usdc: string;
  daily_budget_usdc: string;
  networks: string[]; // allowed CAIP-2 networks
  assets: string[]; // allowed token contracts (USDC)
  payees: string[]; // allowlisted payTo addresses
}

export interface Violation {
  rule: string;
  message: string;
}

const NETWORK_CHAIN: Record<string, number> = {
  "eip155:8453": 8453, // Base
  "eip155:84532": 84532, // Base Sepolia
};

// EIP-3009 TransferWithAuthorization — the typed data x402 settles via.
const AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const USDC_DECIMALS = 6n;
const SCALE = 10n ** USDC_DECIMALS;

export function baseUnitsToUsdc(v: string | bigint): string {
  const n = typeof v === "bigint" ? v : BigInt(v);
  const whole = n / SCALE;
  const frac = (n % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function usdcToBaseUnits(s: string): bigint {
  const [w, f = ""] = String(s).trim().split(".");
  return BigInt(w || "0") * SCALE + BigInt((f + "000000").slice(0, 6) || "0");
}

interface SpendEntry {
  ts: number;
  baseUnits: bigint;
  payee: string;
}

export interface SignedPayment {
  paymentHeader: string; // base64url envelope to attach as PAYMENT-SIGNATURE / X-PAYMENT
  from: `0x${string}`;
  payee: `0x${string}`;
  amountUsdc: string;
  network: string;
}

/**
 * Holds the signing key (a sealed secret, only present inside the TEE) and is
 * the ONLY thing that can authorize a USDC payment. The agent forwards a
 * merchant's `accept`; AWPE validates it against policy and either signs the
 * EIP-3009 authorization or refuses. The agent never sees the key.
 */
export class PaymentSigner {
  readonly address: `0x${string}`;
  private readonly account: LocalAccount;
  private spend: SpendEntry[] = [];

  constructor(
    privateKey: Hex,
    readonly policy: PaymentPolicyConfig,
  ) {
    this.account = privateKeyToAccount(privateKey);
    this.address = this.account.address;
  }

  private amountOf(a: V2Accept): bigint {
    const v = a.maxAmountRequired ?? a.amount;
    if (!v) throw new Error("accept has neither maxAmountRequired nor amount");
    return BigInt(v);
  }

  spentTodayBaseUnits(now = Date.now()): bigint {
    const cutoff = now - 24 * 3600 * 1000;
    let sum = 0n;
    for (const e of this.spend) if (e.ts >= cutoff) sum += e.baseUnits;
    return sum;
  }

  /** Collect ALL policy violations for an accept (does not sign). */
  evaluate(accept: V2Accept): { ok: boolean; violations: Violation[]; amountUsdc: string } {
    const violations: Violation[] = [];
    let amount: bigint;
    try {
      amount = this.amountOf(accept);
    } catch (e) {
      return { ok: false, violations: [{ rule: "request.amount", message: (e as Error).message }], amountUsdc: "0" };
    }
    const amountUsdc = baseUnitsToUsdc(amount);

    // per-payment cap
    if (amount > usdcToBaseUnits(this.policy.max_per_payment_usdc)) {
      violations.push({
        rule: "payments.max_per_payment_usdc",
        message: `payment ${amountUsdc} USDC exceeds cap ${this.policy.max_per_payment_usdc}`,
      });
    }

    // daily budget (rolling 24h)
    const projected = this.spentTodayBaseUnits() + amount;
    if (projected > usdcToBaseUnits(this.policy.daily_budget_usdc)) {
      violations.push({
        rule: "payments.daily_budget_usdc",
        message: `daily budget exceeded: ${baseUnitsToUsdc(projected)} > ${this.policy.daily_budget_usdc} USDC (24h)`,
      });
    }

    // payee allowlist — the core defense against a redirected/injected payment
    const payee = safeAddr(accept.payTo);
    if (!payee || !this.policy.payees.map(lc).includes(lc(payee))) {
      violations.push({
        rule: "payments.payees",
        message: `payee not allowlisted: ${accept.payTo}`,
      });
    }

    // network allowlist
    if (!this.policy.networks.includes(accept.network)) {
      violations.push({
        rule: "payments.networks",
        message: `network not allowed: ${accept.network}`,
      });
    }

    // asset allowlist (must be a known USDC contract)
    const asset = safeAddr(accept.asset);
    if (!asset || !this.policy.assets.map(lc).includes(lc(asset))) {
      violations.push({
        rule: "payments.assets",
        message: `payment asset not allowed: ${accept.asset}`,
      });
    }

    return { ok: violations.length === 0, violations, amountUsdc };
  }

  /**
   * Validate then sign. Throws { violations } if policy fails — the caller maps
   * it to a 403. On success records the spend and returns the x402 header.
   */
  async sign(accept: V2Accept): Promise<SignedPayment> {
    const verdict = this.evaluate(accept);
    if (!verdict.ok) {
      const err = new Error("POLICY_VIOLATION") as Error & { violations: Violation[] };
      err.violations = verdict.violations;
      throw err;
    }

    const chainId = NETWORK_CHAIN[accept.network];
    const value = this.amountOf(accept).toString();
    const timeout = accept.maxTimeoutSeconds ?? 300;
    const now = Math.floor(Date.now() / 1000);
    const authorization = {
      from: this.address,
      to: getAddress(accept.payTo),
      value,
      validAfter: "0",
      validBefore: String(now + timeout),
      nonce: toHex(randomBytes(32)),
    };

    const signature = await this.account.signTypedData({
      domain: {
        name: accept.extra?.name ?? "USD Coin",
        version: accept.extra?.version ?? "2",
        chainId,
        verifyingContract: getAddress(accept.asset),
      },
      types: AUTH_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from,
        to: authorization.to as `0x${string}`,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce as `0x${string}`,
      },
    });

    const envelope = {
      x402Version: 2,
      scheme: "exact",
      network: accept.network,
      accepted: accept,
      payload: { signature, authorization },
    };
    const paymentHeader = Buffer.from(JSON.stringify(envelope), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    this.spend.push({ ts: Date.now(), baseUnits: BigInt(value), payee: getAddress(accept.payTo) });

    return {
      paymentHeader,
      from: this.address,
      payee: getAddress(accept.payTo),
      amountUsdc: verdict.amountUsdc,
      network: accept.network,
    };
  }

  status() {
    const day = 24 * 3600 * 1000;
    const spent = this.spentTodayBaseUnits();
    const budget = usdcToBaseUnits(this.policy.daily_budget_usdc);
    const remaining = budget > spent ? budget - spent : 0n;
    const todayCount = this.spend.filter((e) => e.ts >= Date.now() - day).length;
    return {
      dailySpentUsdc: baseUnitsToUsdc(spent),
      dailyBudgetUsdc: this.policy.daily_budget_usdc,
      remainingUsdc: baseUnitsToUsdc(remaining),
      paymentsToday: todayCount,
      address: this.address,
    };
  }
}

const lc = (s: string) => s.toLowerCase();
function safeAddr(a: string): `0x${string}` | null {
  try {
    return getAddress(a);
  } catch {
    return null;
  }
}
