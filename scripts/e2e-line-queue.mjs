// One-off acceptance checks for the durable LINE queue against the local
// dev server. Uses an unlinked LINE user id and fake reply tokens so no
// real user data or messages are touched.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    }),
);

const secret = env.LINE_CHANNEL_SECRET;
const base = process.env.E2E_BASE ?? "http://localhost:3000";

if (!secret) {
  console.error("FAIL: LINE_CHANNEL_SECRET missing from .env.local");
  process.exit(1);
}

function event(id, text, token = "fake-reply-token-e2e") {
  return {
    type: "message",
    webhookEventId: id,
    replyToken: token,
    source: { userId: "e2e-line-user-not-linked" },
    message: { type: "text", id: `msg-${id}`, text },
  };
}

async function sendWebhook(events) {
  const body = JSON.stringify({ destination: "e2e", events });
  const signature = createHmac("sha256", secret).update(body).digest("base64");
  const res = await fetch(`${base}/api/line/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": signature },
    body,
  });
  return res.status;
}

async function sendWorker(token) {
  const res = await fetch(`${base}/api/line/worker`, {
    method: "POST",
    headers: { "x-worker-token": token },
    body: "{}",
  });
  const text = await res.text();
  return `${res.status} ${text}`;
}

const results = [];
const check = (name, actual, expected) => {
  const pass = String(actual).startsWith(String(expected));
  results.push(`${pass ? "PASS" : "FAIL"} ${name}: ${actual}`);
};

check("tampered signature rejected", await (async () => {
  const res = await fetch(`${base}/api/line/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": "deadbeef==" },
    body: JSON.stringify({ events: [] }),
  });
  return res.status;
})(), 401);

check("first delivery → 200", await sendWebhook([event("e2e-dup-1", "กินข้าว 60")]), 200);
check("duplicate redelivery → 200 (no 500 loop)", await sendWebhook([event("e2e-dup-1", "กินข้าว 60")]), 200);
check(
  "mixed batch (dup + new) → 200, new event saved",
  await sendWebhook([event("e2e-dup-1", "กินข้าว 60"), event("e2e-mixed-2", "สวัสดี")]),
  200,
);

// Give after() a moment to claim and process (fake reply token → delivery retry).
await new Promise((resolve) => setTimeout(resolve, 4000));

check("worker rejects bad token", await sendWorker("wrong-token"), 401);
check("worker accepts valid token", await sendWorker("e2e-dev-token-delete-me"), 200);

console.log(results.join("\n"));
const failed = results.filter((line) => line.startsWith("FAIL"));
process.exit(failed.length > 0 ? 1 : 0);
