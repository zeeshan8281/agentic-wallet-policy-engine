import { AnimatePresence, motion } from "framer-motion";
import type { FeedItem } from "./types";

const KIND_STYLE: Record<FeedItem["kind"], { dot: string; label: string; labelColor: string }> = {
  request: { dot: "bg-sky-400", label: "REQUEST", labelColor: "text-sky-300" },
  pass: { dot: "bg-emerald-400", label: "PASS", labelColor: "text-emerald-300" },
  blocked: { dot: "bg-rose-500", label: "BLOCKED", labelColor: "text-rose-300" },
  alert: { dot: "bg-amber-400", label: "ALERT", labelColor: "text-amber-300" },
};

function time(at: string) {
  try {
    return new Date(at).toLocaleTimeString([], { hour12: false });
  } catch {
    return "";
  }
}

export function ActivityFeed({ items }: { items: FeedItem[] }) {
  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Agent Activity" subtitle="live signing requests" />
      <div className="flex-1 overflow-y-auto scroll-thin px-3 py-2 space-y-1.5">
        {items.length === 0 && (
          <p className="text-xs text-neutral-500 px-1 py-4">
            Waiting for agent activity… run the simulation to begin.
          </p>
        )}
        <AnimatePresence initial={false}>
          {items.map((it) => {
            const st = KIND_STYLE[it.kind];
            return (
              <motion.div
                key={it.id}
                layout
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                  <span className={`text-[10px] font-semibold tracking-wider ${st.labelColor}`}>
                    {st.label}
                  </span>
                  <span className="ml-auto text-[10px] text-neutral-500 tabular-nums">
                    {time(it.at)}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-neutral-200 leading-snug">{it.text}</p>
                {it.detail && (
                  <p className="mt-0.5 text-[11px] text-neutral-500 font-mono break-all">
                    {it.detail}
                  </p>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function PanelHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-4 py-3 border-b border-white/5">
      <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
      {subtitle && <p className="text-[11px] text-neutral-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}
