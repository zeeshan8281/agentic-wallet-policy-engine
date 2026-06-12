import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PolicyConfig, SpendingStatus } from "./types";
import { PanelHeader } from "./ActivityFeed";

export function SpendDashboard({
  status,
  policy,
  history,
}: {
  status: SpendingStatus | null;
  policy: PolicyConfig | null;
  history: { t: string; spent: number }[];
}) {
  const spent = Number(status?.dailySpent ?? 0);
  const cap = Number(status?.dailyCap ?? policy?.limits.daily_cap ?? 1);
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const threshold = (policy?.alerts.on_daily_threshold ?? 0.8) * 100;
  const barColor = pct >= threshold ? "bg-amber-400" : "bg-brand";

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Spending Dashboard" subtitle="rolling 24h window" />
      <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-5">
        {/* daily cap usage */}
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Daily cap usage
            </span>
            <span className="text-xs tabular-nums text-neutral-300">
              {spent} / {cap} ETH
            </span>
          </div>
          <div className="h-2.5 w-full rounded-sm bg-white/[0.06] overflow-hidden relative">
            <div
              className={`h-full ${barColor} transition-all duration-500`}
              style={{ width: `${pct}%` }}
            />
            <div
              className="absolute top-0 h-full w-px bg-amber-300/60"
              style={{ left: `${threshold}%` }}
              title={`alert threshold ${threshold}%`}
            />
          </div>
          <p className="text-[10px] text-neutral-500 mt-1">
            {status?.remainingDaily ?? cap} ETH remaining today
          </p>
        </div>

        {/* stat tiles */}
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Tx (24h)" value={String(status?.txCount24h ?? 0)} />
          <Stat label="Per-tx max" value={`${policy?.limits.max_per_tx ?? "—"} ETH`} />
          <Stat label="Monthly spent" value={`${status?.monthlySpent ?? "0"} ETH`} />
          <Stat label="Monthly cap" value={`${policy?.limits.monthly_cap ?? "—"} ETH`} />
        </div>

        {/* spend chart */}
        <div>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Cumulative spend
          </span>
          <div className="h-28 mt-2 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history.length ? history : [{ t: "", spent: 0 }]}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" hide />
                <YAxis hide domain={[0, cap]} />
                <Tooltip
                  contentStyle={{
                    background: "#171717",
                    border: "1px solid #ffffff1a",
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                  labelStyle={{ color: "#a3a3a3" }}
                />
                <Area
                  type="monotone"
                  dataKey="spent"
                  stroke="#818cf8"
                  strokeWidth={2}
                  fill="url(#g)"
                  isAnimationActive
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* policy summary */}
        <div className="rounded-md border border-border bg-card p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            Active policy
          </p>
          <ul className="space-y-1.5 text-[12px]">
            <PolicyRow k="allow_eoa" v={String(policy?.whitelist.allow_eoa ?? "—")} />
            <PolicyRow k="whitelisted contracts" v={String(policy?.whitelist.contracts.length ?? 0)} />
            <PolicyRow k="allowed selectors" v={String(policy?.selectors.allowed.length ?? 0)} />
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-heading text-lg font-semibold text-foreground tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function PolicyRow({ k, v }: { k: string; v: string }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-neutral-500 font-mono">{k}</span>
      <span className="text-neutral-200 font-mono">{v}</span>
    </li>
  );
}
