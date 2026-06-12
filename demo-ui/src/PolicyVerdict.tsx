import { AnimatePresence, motion } from "framer-motion";
import type { VerdictCard } from "./types";
import { PanelHeader } from "./ActivityFeed";

const short = (a: string) => (a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a);

export function PolicyVerdict({ card }: { card: VerdictCard | null }) {
  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Policy Verdict" subtitle="hardware-enforced in the TEE" />
      <div className="flex-1 flex items-center justify-center p-6 brand-grid">
        <AnimatePresence mode="wait">
          {!card ? (
            <motion.p
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-sm text-muted-foreground text-center max-w-xs"
            >
              The policy engine checks every signing request against{" "}
              <span className="font-mono text-neutral-300">policy.toml</span> before the KMS ever
              sees it.
            </motion.p>
          ) : (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, scale: 0.92, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className={`w-full max-w-md rounded-lg border p-6 bg-card ${
                card.verdict === "PASS"
                  ? "border-pass/30 shadow-[0_0_0_1px_rgba(52,211,153,0.06),0_24px_48px_-16px_rgba(52,211,153,0.18)]"
                  : "border-block/40 shadow-[0_0_0_1px_rgba(248,113,113,0.08),0_24px_48px_-16px_rgba(248,113,113,0.22)]"
              }`}
            >
              <div className="flex items-center gap-3">
                <Badge pass={card.verdict === "PASS"} />
                <div>
                  <p
                    className={`font-heading text-2xl font-bold tracking-tight ${
                      card.verdict === "PASS" ? "text-pass" : "text-block"
                    }`}
                  >
                    {card.verdict === "PASS" ? "TRANSACTION SIGNED" : "TRANSACTION BLOCKED"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {card.tx.value} ETH → <span className="font-mono">{short(card.tx.to)}</span>
                  </p>
                </div>
              </div>

              {card.verdict === "BLOCKED" ? (
                <div className="mt-5 space-y-2">
                  <p className="text-[11px] uppercase tracking-wider text-block/80 font-semibold">
                    Rules triggered
                  </p>
                  {card.violations.map((v, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.08 * i + 0.1 }}
                      className="rounded-md bg-block/[0.07] border border-block/20 px-3 py-2"
                    >
                      <p className="text-xs font-mono text-block">{v.rule}</p>
                      <p className="text-[13px] text-neutral-200 mt-0.5">{v.message}</p>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="mt-5 space-y-2">
                  <Row label="tx hash" value={short(card.txHash ?? "—")} mono />
                  <Row label="attestation" value="TEE-signed ✓" valueClass="text-pass" />
                </div>
              )}

              <div className="mt-5 pt-4 border-t border-border">
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
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ${
        pass ? "bg-pass/15 text-pass" : "bg-block/15 text-block"
      }`}
    >
      {pass ? (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
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
