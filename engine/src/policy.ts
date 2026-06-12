import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import TOML from "@iarna/toml";
import { ethToWei, weiToEth } from "./wei.js";
import type { Ledger } from "./ledger.js";

export interface PolicyConfig {
  limits: {
    max_per_tx: string;
    daily_cap: string;
    monthly_cap: string;
  };
  whitelist: {
    contracts: string[];
    allow_eoa: boolean;
  };
  selectors: {
    allowed: string[];
  };
  alerts: {
    webhook: string;
    on_violation: boolean;
    on_daily_threshold: number;
  };
}

export interface TxRequest {
  to: string;
  value: string; // ETH as decimal string
  data?: string; // hex calldata, "0x" or empty for plain transfer
}

export interface Violation {
  rule: string; // policy.toml key that triggered, e.g. "limits.max_per_tx"
  message: string; // human-readable explanation
}

export interface PolicyVerdict {
  ok: boolean;
  violations: Violation[];
}

/** A policy plus its content hash — the hash is the on-chain-anchored identity. */
export class Policy {
  readonly config: PolicyConfig;
  readonly hash: string; // sha256 of the raw policy.toml bytes
  private readonly contractSet: Set<string>;
  private readonly selectorSet: Set<string>;

  private constructor(config: PolicyConfig, hash: string) {
    this.config = config;
    this.hash = hash;
    this.contractSet = new Set(config.whitelist.contracts.map((c) => normAddr(c)));
    this.selectorSet = new Set(config.selectors.allowed.map((s) => s.toLowerCase()));
  }

  static fromFile(path: string): Policy {
    const raw = readFileSync(path);
    const hash = "0x" + createHash("sha256").update(raw).digest("hex");
    const parsed = TOML.parse(raw.toString("utf-8")) as unknown as PolicyConfig;
    return new Policy(normalizeConfig(parsed), hash);
  }

  /**
   * Validate a transaction against every rule. Collects ALL violations (does
   * not short-circuit) so the caller can show the agent every reason at once.
   * `ledger` supplies current rolling-window spend for cap checks.
   */
  evaluate(tx: TxRequest, ledger: Ledger): PolicyVerdict {
    const violations: Violation[] = [];

    let valueWei: bigint;
    try {
      valueWei = ethToWei(tx.value);
    } catch (e) {
      return {
        ok: false,
        violations: [{ rule: "request.value", message: (e as Error).message }],
      };
    }

    // --- limits.max_per_tx ---
    const maxPerTx = ethToWei(this.config.limits.max_per_tx);
    if (valueWei > maxPerTx) {
      violations.push({
        rule: "limits.max_per_tx",
        message: `max_per_tx exceeded: ${tx.value} > ${this.config.limits.max_per_tx} ETH`,
      });
    }

    // --- limits.daily_cap (rolling 24h) ---
    const dailyCap = ethToWei(this.config.limits.daily_cap);
    const dailySpent = ledger.spentInWindow(24 * 3600 * 1000);
    if (dailySpent + valueWei > dailyCap) {
      violations.push({
        rule: "limits.daily_cap",
        message: `daily_cap exceeded: ${weiToEth(dailySpent + valueWei)} > ${this.config.limits.daily_cap} ETH (24h)`,
      });
    }

    // --- limits.monthly_cap (rolling 30d) ---
    const monthlyCap = ethToWei(this.config.limits.monthly_cap);
    const monthlySpent = ledger.spentInWindow(30 * 24 * 3600 * 1000);
    if (monthlySpent + valueWei > monthlyCap) {
      violations.push({
        rule: "limits.monthly_cap",
        message: `monthly_cap exceeded: ${weiToEth(monthlySpent + valueWei)} > ${this.config.limits.monthly_cap} ETH (30d)`,
      });
    }

    // --- whitelist + selectors ---
    const data = (tx.data ?? "0x").trim();
    const isContractCall = data.length > 2 && data !== "0x";

    if (isContractCall) {
      if (!this.contractSet.has(normAddr(tx.to))) {
        violations.push({
          rule: "whitelist.contracts",
          message: `target not whitelisted: ${tx.to}`,
        });
      }
      const selector = data.slice(0, 10).toLowerCase(); // 0x + 8 hex chars
      if (!this.selectorSet.has(selector)) {
        violations.push({
          rule: "selectors.allowed",
          message: `function selector not allowed: ${selector}`,
        });
      }
    } else {
      // Plain ETH transfer to an EOA.
      if (!this.config.whitelist.allow_eoa) {
        violations.push({
          rule: "whitelist.allow_eoa",
          message: `EOA transfers disabled (allow_eoa = false): ${tx.to}`,
        });
      }
    }

    return { ok: violations.length === 0, violations };
  }
}

function normAddr(a: string): string {
  return String(a).trim().toLowerCase();
}

/** Fill defaults so a partial policy.toml never crashes the engine. */
function normalizeConfig(p: Partial<PolicyConfig>): PolicyConfig {
  return {
    limits: {
      max_per_tx: p.limits?.max_per_tx ?? "0",
      daily_cap: p.limits?.daily_cap ?? "0",
      monthly_cap: p.limits?.monthly_cap ?? "0",
    },
    whitelist: {
      contracts: p.whitelist?.contracts ?? [],
      allow_eoa: p.whitelist?.allow_eoa ?? false,
    },
    selectors: {
      allowed: p.selectors?.allowed ?? [],
    },
    alerts: {
      webhook: p.alerts?.webhook ?? "",
      on_violation: p.alerts?.on_violation ?? true,
      on_daily_threshold: p.alerts?.on_daily_threshold ?? 0.8,
    },
  };
}
