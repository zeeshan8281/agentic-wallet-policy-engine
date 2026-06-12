import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { Policy, type TxRequest } from "./policy.js";
import { Ledger } from "./ledger.js";
import { KmsClient } from "./kms.js";
import { PaymentSigner, type V2Accept } from "./payments.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// EigenCompute writes sealed secrets to /tmp/.env at boot. Load them into
// process.env (without clobbering anything already set) before reading keys.
loadSealedEnv("/tmp/.env");

const PORT = Number(process.env.PORT ?? 3100);
const POLICY_PATH = process.env.POLICY_PATH ?? join(__dirname, "..", "policy.toml");
const KMS_ENDPOINT = process.env.KMS_ENDPOINT; // unset => mock signing
// The x402 payment signing key — a sealed secret, only present inside the TEE.
const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY;
// Static UI bundle (copied into the image at build time). Optional.
const UI_DIR = process.env.UI_DIR ?? join(__dirname, "..", "public");

const policy = Policy.fromFile(POLICY_PATH);
const ledger = new Ledger();
const kms = new KmsClient(KMS_ENDPOINT);

// Payment signing gateway — only active when a key + payments policy exist.
let signer: PaymentSigner | null = null;
if (policy.config.payments && SIGNER_PRIVATE_KEY) {
  signer = new PaymentSigner(SIGNER_PRIVATE_KEY as `0x${string}`, policy.config.payments);
  console.log(`[engine] payment signer ${signer.address} (x402 gateway active)`);
} else if (policy.config.payments) {
  console.log(`[engine] payment policy present but SIGNER_PRIVATE_KEY unset — /sign-payment disabled`);
}

console.log(`[engine] policy loaded  hash=${policy.hash}`);
console.log(`[engine] wallet address ${kms.getAddress()}`);
console.log(`[engine] TEE enclave    ${kms.inEnclave() ? "yes" : "no (mock signing)"}`);

function loadSealedEnv(path: string) {
  try {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* best-effort */
  }
}

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
  | { type: "alert"; level: "warn"; message: string; at: string }
  | {
      type: "payment";
      verdict: "PASS" | "BLOCKED";
      payee: string;
      amountUsdc: string;
      network: string;
      merchant?: string;
      item?: string;
      violations: { rule: string; message: string }[];
      policyHash: string;
      at: string;
    };

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

// --- x402 payment signing gateway -----------------------------------------
// The agent forwards a merchant's 402 "accept"; AWPE validates against the
// payment policy and signs the EIP-3009 USDC authorization with the sealed key
// ONLY if it passes. The agent never holds the key.
app.get("/payment-address", (_req, res) => {
  if (!signer) return res.status(404).json({ error: "signer disabled" });
  res.json({ address: signer.address });
});

app.get("/payment-status", (_req, res) => {
  if (!signer) return res.status(404).json({ error: "signer disabled" });
  res.json(signer.status());
});

app.post("/sign-payment", async (req, res) => {
  if (!signer) {
    return res.status(503).json({
      ok: false,
      error: "SIGNER_DISABLED",
      message: "no payments policy or SIGNER_PRIVATE_KEY configured",
    });
  }
  const body = req.body as { accept?: V2Accept; merchant?: string; item?: string };
  const accept = body?.accept;
  if (!accept || typeof accept.payTo !== "string" || typeof accept.network !== "string") {
    return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "missing `accept`" });
  }

  const at = new Date().toISOString();
  const pre = signer.evaluate(accept);
  if (!pre.ok) {
    broadcast({
      type: "payment",
      verdict: "BLOCKED",
      payee: accept.payTo,
      amountUsdc: pre.amountUsdc,
      network: accept.network,
      merchant: body.merchant,
      item: body.item,
      violations: pre.violations,
      policyHash: policy.hash,
      at,
    });
    await maybeAlert(
      `BLOCKED x402 payment of ${pre.amountUsdc} USDC to ${accept.payTo}: ${pre.violations.map((v) => v.rule).join(", ")}`
    );
    return res.status(403).json({
      ok: false,
      error: "POLICY_VIOLATION",
      violations: pre.violations.map((v) => v.message),
      rules: pre.violations.map((v) => v.rule),
      policyHash: policy.hash,
    });
  }

  try {
    const signed = await signer.sign(accept);
    broadcast({
      type: "payment",
      verdict: "PASS",
      payee: signed.payee,
      amountUsdc: signed.amountUsdc,
      network: signed.network,
      merchant: body.merchant,
      item: body.item,
      violations: [],
      policyHash: policy.hash,
      at,
    });
    broadcast({ type: "status", status: currentStatus(), at: new Date().toISOString() });
    return res.json({
      ok: true,
      paymentHeader: signed.paymentHeader,
      from: signed.from,
      payee: signed.payee,
      amountUsdc: signed.amountUsdc,
      policyHash: policy.hash,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SIGN_ERROR", message: (e as Error).message });
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
