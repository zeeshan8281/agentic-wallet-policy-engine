import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { Policy, type TxRequest } from "./policy.js";
import { Ledger } from "./ledger.js";
import { KmsClient } from "./kms.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3100);
const POLICY_PATH = process.env.POLICY_PATH ?? join(__dirname, "..", "policy.toml");
const KMS_ENDPOINT = process.env.KMS_ENDPOINT; // unset => mock signing
// Static UI bundle (copied into the image at build time). Optional.
const UI_DIR = process.env.UI_DIR ?? join(__dirname, "..", "public");

const policy = Policy.fromFile(POLICY_PATH);
const ledger = new Ledger();
const kms = new KmsClient(KMS_ENDPOINT);

console.log(`[engine] policy loaded  hash=${policy.hash}`);
console.log(`[engine] wallet address ${kms.getAddress()}`);
console.log(`[engine] TEE enclave    ${kms.inEnclave() ? "yes" : "no (mock signing)"}`);

const app = express();
app.use(express.json());

// Permissive CORS — the engine is a policy gateway, not an auth boundary, and
// the demo dashboard may be served from a different origin (e.g. Vercel).
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "content-type");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- event bus (WebSocket fan-out) ----------------------------------------
const wss = new WebSocketServer({ noServer: true });
const clients = new Set<WebSocket>();

// Ring buffer of recent events so clients that cannot hold a WebSocket (e.g. a
// browser behind an HTTPS reverse proxy like Vercel, where WS upgrade isn't
// proxied) can poll GET /events?since=<seq> and reconstruct the same stream.
const recentEvents: { seq: number; ev: EngineEvent }[] = [];
let eventSeq = 0;
const MAX_RECENT = 200;

type EngineEvent =
  | { type: "request"; tx: TxRequest; at: string }
  | {
      type: "verdict";
      verdict: "PASS" | "BLOCKED";
      tx: TxRequest;
      violations: { rule: string; message: string }[];
      txHash?: string;
      policyHash: string;
      at: string;
    }
  | { type: "status"; status: ReturnType<Ledger["status"]>; at: string }
  | { type: "alert"; level: "warn"; message: string; at: string };

function broadcast(ev: EngineEvent) {
  const seq = ++eventSeq;
  recentEvents.push({ seq, ev });
  if (recentEvents.length > MAX_RECENT) recentEvents.shift();
  const msg = JSON.stringify(ev);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function currentStatus() {
  return ledger.status(policy.config.limits.daily_cap, policy.config.limits.monthly_cap);
}

async function maybeAlert(message: string) {
  broadcast({ type: "alert", level: "warn", message, at: new Date().toISOString() });
  const url = policy.config.alerts.webhook;
  if (policy.config.alerts.on_violation && url) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `[AWPE] ${message}` }),
      });
    } catch {
      /* best-effort */
    }
  }
}

// --- routes ----------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({ ok: true, enclave: kms.inEnclave(), policyHash: policy.hash });
});

app.get("/policy", (_req, res) => {
  res.json({ policy: policy.config, policyHash: policy.hash });
});

app.get("/address", (_req, res) => {
  res.json({ address: kms.getAddress(), chain: process.env.CHAIN ?? "ethereum" });
});

app.get("/status", (_req, res) => {
  res.json(currentStatus());
});

// Polling fallback for the event stream (used when WebSocket isn't available).
app.get("/events", (req, res) => {
  const since = Number(req.query.since ?? 0);
  const events = recentEvents
    .filter((e) => e.seq > since)
    .map((e) => ({ seq: e.seq, ...e.ev }));
  res.json({ events, cursor: eventSeq });
});

app.post("/sign", async (req, res) => {
  const tx = req.body as TxRequest;
  if (!tx || typeof tx.to !== "string" || typeof tx.value !== "string") {
    return res.status(400).json({
      ok: false,
      error: "BAD_REQUEST",
      message: "tx must include string `to` and `value`",
    });
  }

  const at = new Date().toISOString();
  broadcast({ type: "request", tx, at });

  const verdict = policy.evaluate(tx, ledger);

  if (!verdict.ok) {
    broadcast({
      type: "verdict",
      verdict: "BLOCKED",
      tx,
      violations: verdict.violations,
      policyHash: policy.hash,
      at,
    });
    await maybeAlert(
      `BLOCKED tx to ${tx.to} (${tx.value} ETH): ${verdict.violations.map((v) => v.rule).join(", ")}`
    );
    return res.status(403).json({
      ok: false,
      error: "POLICY_VIOLATION",
      violations: verdict.violations.map((v) => v.message),
      rules: verdict.violations.map((v) => v.rule),
      policyHash: policy.hash,
    });
  }

  // Passed policy — proxy to KMS for signing.
  try {
    const signed = await kms.sign(tx, policy.hash);
    ledger.record(tx.value, tx.to, signed.txHash);

    broadcast({
      type: "verdict",
      verdict: "PASS",
      tx,
      violations: [],
      txHash: signed.txHash,
      policyHash: policy.hash,
      at,
    });
    const status = currentStatus();
    broadcast({ type: "status", status, at: new Date().toISOString() });

    // Daily-threshold alert.
    const dailyCap = Number(policy.config.limits.daily_cap);
    const dailySpent = Number(status.dailySpent);
    const threshold = policy.config.alerts.on_daily_threshold;
    if (dailyCap > 0 && dailySpent / dailyCap >= threshold) {
      await maybeAlert(
        `daily spend at ${Math.round((dailySpent / dailyCap) * 100)}% of cap (${status.dailySpent}/${status.dailyCap} ETH)`
      );
    }

    return res.json({
      ok: true,
      txHash: signed.txHash,
      attestation: signed.attestation,
      policyHash: policy.hash,
    });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      error: "KMS_ERROR",
      message: (e as Error).message,
      policyHash: policy.hash,
    });
  }
});

// --- static UI (served from same origin so WS host matches) ----------------
if (existsSync(UI_DIR)) {
  app.use(express.static(UI_DIR));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/ws") || req.path.startsWith("/api")) return next();
    res.sendFile(join(UI_DIR, "index.html"));
  });
  console.log(`[engine] serving UI from ${UI_DIR}`);
}

// --- HTTP + WS wiring ------------------------------------------------------
const server = createServer(app);

server.on("upgrade", (request, socket, head) => {
  if (request.url?.startsWith("/ws/events")) {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  clients.add(ws);
  // Send a snapshot so a freshly-connected dashboard isn't blank.
  ws.send(
    JSON.stringify({
      type: "status",
      status: currentStatus(),
      at: new Date().toISOString(),
    })
  );
  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[engine] listening on http://0.0.0.0:${PORT}`);
  console.log(`[engine] ws events at ws://0.0.0.0:${PORT}/ws/events`);
});
