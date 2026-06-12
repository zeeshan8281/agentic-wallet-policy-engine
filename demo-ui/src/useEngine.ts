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

  // Event stream: prefer WebSocket (instant, used locally / same-origin). When
  // WS can't connect — e.g. the dashboard is served through an HTTPS reverse
  // proxy that doesn't forward the WS upgrade (Vercel) — fall back to polling
  // GET /events?since=<cursor>, which replays the exact same event stream.
  useEffect(() => {
    let stopped = false;
    let wsConnected = false;
    let cursor = 0;
    let firstPoll = true;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let wsRetry: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | undefined;

    const poll = async () => {
      if (stopped || wsConnected) return;
      try {
        const r = await fetch(`/events?since=${cursor}`);
        const data = (await r.json()) as { events: (EngineEvent & { seq: number })[]; cursor: number };
        // On first connect, don't replay the whole server backlog — that would
        // flicker the verdict card through history. Show just the recent tail.
        let batch = data.events;
        if (firstPoll && batch.length > 8) batch = batch.slice(-8);
        firstPoll = false;
        for (const e of batch) {
          cursor = e.seq;
          handleEvent(e);
        }
        if (typeof data.cursor === "number" && batch.length === 0) cursor = data.cursor;
        setState((s) => (s.connected ? s : { ...s, connected: true }));
      } catch {
        setState((s) => ({ ...s, connected: false }));
      }
      if (!stopped && !wsConnected) pollTimer = setTimeout(poll, 1500);
    };

    const connect = () => {
      if (stopped) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws/events`);
      wsRef.current = ws;

      ws.onopen = () => {
        wsConnected = true;
        if (pollTimer) clearTimeout(pollTimer);
        setState((s) => ({ ...s, connected: true }));
      };
      ws.onclose = () => {
        wsConnected = false;
        setState((s) => ({ ...s, connected: false }));
        if (!stopped) {
          poll(); // fall back to polling immediately
          wsRetry = setTimeout(connect, 5000); // and keep trying WS in the background
        }
      };
      ws.onerror = () => ws?.close();
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
    // Safety net: if WS neither opens nor closes within 2.5s (silent proxy
    // black-hole), start polling anyway.
    const kick = setTimeout(() => {
      if (!wsConnected) poll();
    }, 2500);

    return () => {
      stopped = true;
      clearTimeout(kick);
      if (pollTimer) clearTimeout(pollTimer);
      if (wsRetry) clearTimeout(wsRetry);
      ws?.close();
    };
  }, [pushFeed]);

  return state;
}
