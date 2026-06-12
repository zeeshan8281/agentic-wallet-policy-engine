import { useEffect, useRef, useState, useCallback } from "react";
import type {
  EngineEvent,
  FeedItem,
  PolicyConfig,
  SpendingStatus,
  VerdictCard,
} from "./types";

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a);

let idSeq = 0;
const nextId = () => `${Date.now()}-${idSeq++}`;

interface EngineState {
  connected: boolean;
  status: SpendingStatus | null;
  policy: PolicyConfig | null;
  policyHash: string | null;
  address: string | null;
  feed: FeedItem[];
  latestVerdict: VerdictCard | null;
  history: { t: string; spent: number }[];
}

export function useEngine() {
  const [state, setState] = useState<EngineState>({
    connected: false,
    status: null,
    policy: null,
    policyHash: null,
    address: null,
    feed: [],
    latestVerdict: null,
    history: [],
  });
  const wsRef = useRef<WebSocket | null>(null);

  const pushFeed = useCallback((item: FeedItem) => {
    setState((s) => ({ ...s, feed: [item, ...s.feed].slice(0, 60) }));
  }, []);

  // One-time REST fetches for policy + address + initial status.
  useEffect(() => {
    (async () => {
      try {
        const [p, a, st] = await Promise.all([
          fetch("/policy").then((r) => r.json()),
          fetch("/address").then((r) => r.json()),
          fetch("/status").then((r) => r.json()),
        ]);
        setState((s) => ({
          ...s,
          policy: p.policy,
          policyHash: p.policyHash,
          address: a.address,
          status: st,
        }));
      } catch {
        /* engine may not be up yet; WS reconnect will fill in */
      }
    })();
  }, []);

  // WebSocket event stream with auto-reconnect.
  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/events`);
      wsRef.current = ws;

      ws.onopen = () => setState((s) => ({ ...s, connected: true }));
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        let ev: EngineEvent;
        try {
          ev = JSON.parse(e.data);
        } catch {
          return;
        }
        handleEvent(ev);
      };
    };

    const handleEvent = (ev: EngineEvent) => {
      switch (ev.type) {
        case "request":
          pushFeed({
            id: nextId(),
            kind: "request",
            at: ev.at,
            text: `Agent requested ${ev.tx.value} ETH → ${short(ev.tx.to)}`,
            detail: ev.tx.data && ev.tx.data !== "0x" ? `selector ${ev.tx.data.slice(0, 10)}` : "plain transfer",
          });
          break;
        case "verdict": {
          const card: VerdictCard = {
            id: nextId(),
            verdict: ev.verdict,
            tx: ev.tx,
            violations: ev.violations,
            txHash: ev.txHash,
            policyHash: ev.policyHash,
            at: ev.at,
          };
          setState((s) => ({ ...s, latestVerdict: card }));
          if (ev.verdict === "PASS") {
            pushFeed({
              id: nextId(),
              kind: "pass",
              at: ev.at,
              text: `PASS — signed ${ev.tx.value} ETH`,
              detail: ev.txHash ? short(ev.txHash) : undefined,
            });
          } else {
            pushFeed({
              id: nextId(),
              kind: "blocked",
              at: ev.at,
              text: `BLOCKED — ${ev.tx.value} ETH → ${short(ev.tx.to)}`,
              detail: ev.violations.map((v) => v.rule).join(", "),
            });
          }
          break;
        }
        case "status":
          setState((s) => ({
            ...s,
            status: ev.status,
            history: [
              ...s.history,
              { t: new Date(ev.at).toLocaleTimeString(), spent: Number(ev.status.dailySpent) },
            ].slice(-30),
          }));
          break;
        case "alert":
          pushFeed({ id: nextId(), kind: "alert", at: ev.at, text: `⚠ ${ev.message}` });
          break;
      }
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [pushFeed]);

  return state;
}
