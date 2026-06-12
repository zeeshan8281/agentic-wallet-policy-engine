import { ethToWei, weiToEth } from "./wei.js";

interface SpendEntry {
  ts: number; // epoch ms
  wei: bigint;
  to: string;
  txHash: string;
}

/**
 * In-memory rolling-window spend tracker. Volatile by design — state lives in
 * TEE memory and resets on container restart (documented v1 limitation).
 */
export class Ledger {
  private entries: SpendEntry[] = [];

  record(valueEth: string, to: string, txHash: string, now = Date.now()): void {
    this.entries.push({ ts: now, wei: ethToWei(valueEth), to, txHash });
    // Prune anything older than the longest window we care about (30d).
    const cutoff = now - 30 * 24 * 3600 * 1000;
    if (this.entries.length > 512) {
      this.entries = this.entries.filter((e) => e.ts >= cutoff);
    }
  }

  /** Total wei spent within the last `windowMs` milliseconds. */
  spentInWindow(windowMs: number, now = Date.now()): bigint {
    const cutoff = now - windowMs;
    let sum = 0n;
    for (const e of this.entries) {
      if (e.ts >= cutoff) sum += e.wei;
    }
    return sum;
  }

  txCountInWindow(windowMs: number, now = Date.now()): number {
    const cutoff = now - windowMs;
    return this.entries.filter((e) => e.ts >= cutoff).length;
  }

  lastTx(): SpendEntry | null {
    return this.entries.length ? this.entries[this.entries.length - 1] : null;
  }

  /** Snapshot used by GET /status and the SDK's getSpendingStatus(). */
  status(dailyCapEth: string, monthlyCapEth: string) {
    const day = 24 * 3600 * 1000;
    const dailySpent = this.spentInWindow(day);
    const monthlySpent = this.spentInWindow(30 * day);
    const dailyCap = ethToWei(dailyCapEth);
    const remainingDaily = dailyCap > dailySpent ? dailyCap - dailySpent : 0n;
    const last = this.lastTx();
    return {
      dailySpent: weiToEth(dailySpent),
      dailyCap: dailyCapEth,
      remainingDaily: weiToEth(remainingDaily),
      monthlySpent: weiToEth(monthlySpent),
      monthlyCap: monthlyCapEth,
      txCount24h: this.txCountInWindow(day),
      lastTx: last ? new Date(last.ts).toISOString() : null,
    };
  }
}
