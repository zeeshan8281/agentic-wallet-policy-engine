import { AnimatePresence, motion } from "framer-motion";
import type { VerdictCard } from "./types";
import { PanelHeader } from "./ActivityFeed";

const short = (a: string) => (a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a);

export function PolicyVerdict({ card }: { card: VerdictCard | null }) {
  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Policy Verdict" subtitle="hardware-enforced in the TEE" />
      <div className="flex-1 flex items-center justify-center p-6">
        <AnimatePresence mode="wait">
          {!card ? (
            <motion.p
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-sm text-neutral-500 text-center max-w-xs"
            >
              The policy engine checks every signing request against{" "}
              <span className="font-mono text-neutral-400">policy.toml</span> before the KMS ever
              sees it.
            </motion.p>
          ) : (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, scale: 0.92, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className={`w-full max-w-md rounded-2xl border p-6 ${
                card.verdict === "PASS"
                  ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                  : "border-rose-500/40 bg-rose-500/[0.07]"
              }`}
            >
              <div className="flex items-center gap-3">
                <Badge pass={card.verdict === "PASS"} />
                <div>
                  <p
                    className={`text-2xl font-bold tracking-tight ${
                      card.verdict === "PASS" ? "text-emerald-300" : "text-rose-300"
                    }`}
                  >
                    {card.verdict === "PASS" ? "TRANSACTION SIGNED" : "TRANSACTION BLOCKED"}
                  </p>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    {card.tx.value} ETH → <span className="font-mono">{short(card.tx.to)}</span>
                  </p>
                </div>
              </div>

              {card.verdict === "BLOCKED" ? (
                <div className="mt-5 space-y-2">
                  <p className="text-[11px] uppercase tracking-wider text-rose-300/80 font-semibold">
                    Rules triggered
                  </p>
                  {card.violations.map((v, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.08 * i + 0.1 }}
                      className="rounded-lg bg-rose-950/40 border border-rose-500/20 px-3 py-2"
                    >
                      <p className="text-xs font-mono text-rose-300">{v.rule}</p>
                      <p className="text-[13px] text-neutral-200 mt-0.5">{v.message}</p>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="mt-5 space-y-2">
                  <Row label="tx hash" value={short(card.txHash ?? "—")} mono />
                  <Row label="attestation" value="TEE-signed ✓" valueClass="text-emerald-300" />
                </div>
              )}

              <div className="mt-5 pt-4 border-t border-white/5">
                <Row label="policy hash" value={short(card.policyHash)} mono dim />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Badge({ pass }: { pass: boolean }) {
  return (
    <div
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
        pass ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
      }`}
    >
      {pass ? (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  dim,
  valueClass,
}: {
  label: string;
  value: string;
  mono?: boolean;
  dim?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</span>
      <span
        className={`text-xs ${mono ? "font-mono" : ""} ${dim ? "text-neutral-500" : "text-neutral-200"} ${valueClass ?? ""}`}
      >
        {value}
      </span>
    </div>
  );
}
