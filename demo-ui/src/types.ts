export interface TxInput {
  to: string;
  value: string;
  data?: string;
}

export interface Violation {
  rule: string;
  message: string;
}

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
      violations: Violation[];
      txHash?: string;
      policyHash: string;
      at: string;
    }
  | { type: "status"; status: SpendingStatus; at: string }
  | { type: "alert"; level: "warn"; message: string; at: string };

// A normalized item for the activity feed.
export interface FeedItem {
  id: string;
  kind: "request" | "pass" | "blocked" | "alert";
  at: string;
  text: string;
  detail?: string;
}

// A verdict shown in the center panel.
export interface VerdictCard {
  id: string;
  verdict: "PASS" | "BLOCKED";
  tx: TxInput;
  violations: Violation[];
  txHash?: string;
  policyHash: string;
  at: string;
}
