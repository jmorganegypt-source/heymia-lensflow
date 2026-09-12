import workHtml from "./ui/work.html.js";
import { handleAgentChat, routeFile } from "./ai.js";
import { handleUiAdmin, matchHtmlPage, serveUI } from "./routing.js";
import { listSites, mimeOf, publishSite, servePublishedSite, vaultBound } from "./sites.js";

const VERSION = "3.0.0";
const AVATAR_ID = "3559b3f9-29e3-48eb-a4ff-7a7dc5b47ca9";
const AVATAR_URL = "https://embed.liveavatar.com/v1/" + AVATAR_ID;
const WS_URL = "wss://embed.liveavatar.com/v1/" + AVATAR_ID + "/ws";

const corsH = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-File-Name, X-Filename, X-Category, X-Site, X-Path",
  "Access-Control-Max-Age": "86400",
};

function jsonR(d, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...corsH, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

const jobs = new Map();
const sessions = new Map();

async function saveMem(e, a, c, k, v) {
  if (!e.MEMORY) return;
  await e.MEMORY.put("mem:" + a + ":" + c + ":" + k, JSON.stringify({ value: v, t: Date.now() }));
}
async function listKvFiles(e, c) {
  if (!e.MEMORY) return [];
  const l = await e.MEMORY.list({ prefix: "file:" });
  const f = [];
  for (const k of l.keys) {
    const v = await e.MEMORY.get(k.name);
    if (!v) continue;
    const d = JSON.parse(v);
    if (!c || d.category === c) f.push({ id: d.id, name: d.name, type: d.type, category: d.category, created_at: d.created_at });
  }
  return f;
}
async function listR2Files(env, prefix = "files/") {
  if (!vaultBound(env)) return [];
  const listed = await env.VAULT.list({ prefix, limit: 1000 });
  return (listed.objects || []).map((o) => ({
    key: o.key,
    name: o.key.replace(/^files\//, ""),
    size: o.size,
    uploaded: o.uploaded,
    category: "vault",
  }));
}

async function statusPayload(env) {
  let vault = "missing";
  if (vaultBound(env)) {
    vault = "bound";
    try { await env.VAULT.list({ prefix: "", limit: 1 }); }
    catch (e) { vault = "error:" + (e.message || e); }
  }
  return {
    ok: vault === "bound", status: "ok", service: "heymia", version: VERSION,
    ai_model: env.GEMINI_MODEL || "gemini-3.8-flash", vault,
    ai: env.AI ? "bound" : "missing",
    gemini: env.GEMINI_API_KEY || env.GEMINI ? "set" : "unset",
    liveavatar: env.LIVEAVATAR_API_KEY || env.LIVEAVATAR ? "set" : "unset",
    stripe: env.STRIPE_SECRET_KEY || env.STRIPE ? "set" : "unset",
    domain: env.PUBLIC_DOMAIN || null, avatar_id: AVATAR_ID,
    secrets_configured: {
      liveavatar: !!(env.LIVEAVATAR_API_KEY || env.LIVEAVATAR),
      stripe: !!(env.STRIPE_SECRET_KEY || env.STRIPE),
      ai: !!(env.GEMINI_API_KEY || env.GEMINI),
      workers_ai: !!env.AI,
    },
  };
}

async function putVaultFile(env, name, body, type, category) {
  const safe = String(name || "upload.bin").replace(/^\/+/, "").replace(/\.\./g, "");
  if (vaultBound(env)) {
    const key = "files/" + safe;
    await env.VAULT.put(key, body, { httpMetadata: { contentType: type || mimeOf(safe) } });
    return { ok: true, key, name: safe, size: body.byteLength || body.length || 0, category: category || "vault" };
  }
  if (env.MEMORY) {
    const id = crypto.randomUUID();
    const content = typeof body === "string" ? body : new TextDecoder().decode(body);
    await env.MEMORY.put("file:" + id, JSON.stringify({ id, name: safe, type, category, content, created_at: new Date().toISOString() }));
    return { ok: true, id, name: safe, status: "saved-kv" };
  }
  return { error: "VAULT and MEMORY unbound", status: 503 };
}

async function handleCheckout(e, body) {
  const stripeKey = e.STRIPE_SECRET_KEY || e.STRIPE;
  if (!stripeKey) return { error: "Stripe not configured" };
  const origin = e.PUBLIC_DOMAIN || "https://heymia.lensflow.au";
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Bearer " + stripeKey },
    body: new URLSearchParams({
      mode: "payment",
      "line_items[0][price]": body.price_id || "price_1Tx8hkEHzw6rVQI2QnfDm6Kl",
      "line_items[0][quantity]": "1",
      success_url: body.success_url || origin + "/credits?payment=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: body.cancel_url || origin + "/credits?payment=cancelled",
    }).toString(),
  });
  const data = await res.json();
  if (data.url) return { checkout_url: data.url, session_id: data.id };
  return { error: data.error?.message || "Checkout failed" };
}

function createJob(t, d) {
  const id = crypto.randomUUID();
  const j = { id, type: t, data: d, status: "queued", created_at: new Date().toISOString() };
  jobs.set(id, j);
  return j;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsH });
    try {
      if (path === "/health" || path === "/api/status" || (path === "/" && url.searchParams.get("format") === "json")) {
        return jsonR(await statusPayload(env));
      }
      if (path === "/config" && method === "GET") return jsonR({ avatar_url: AVATAR_URL, ws_url: WS_URL, avatar_id: AVATAR_ID, version: VERSION, model: env.GEMINI_MODEL || "gemini-3.8-flash" });
      if (path === "/env-check" && method === "GET") return jsonR(await statusPayload(env));
      const uiAdmin = await handleUiAdmin(request, env, path);
      if (uiAdmin) return jsonR(uiAdmin, uiAdmin.status || 200);
      if (path === "/route" && method === "POST") {
        const body = await request.json();
        return jsonR(routeFile(body.fileName, body.fileType, body.category));
      }
      if ((path === "/chat" || path === "/api/chat") && method === "POST") {
        const body = await request.json();
        const helpers = {
          listFiles: async () => (await listR2Files(env)).concat(await listKvFiles(env)),
          runTool: async (name, args) => {
            args = args || {};
            if (name === "worker_status") return statusPayload(env);
            if (name === "list_vault") return { files: await listR2Files(env, args.prefix || "files/") };
            if (name === "publish_site") {
              if (!vaultBound(env)) return { error: "VAULT unbound" };
              return publishSite(env, args);
            }
            if (name === "route_file") return routeFile(args.fileName, args.fileType, args.category);
            if (name === "create_room") {
              if (!vaultBound(env)) return { error: "VAULT unbound" };
              const rec = { id: "room-" + crypto.randomUUID().slice(0, 8), name: args.name, theme: args.theme || "", prompt: args.prompt || "", created: new Date().toISOString() };
              await env.VAULT.put("rooms/" + rec.id + ".json", JSON.stringify(rec), { httpMetadata: { contentType: "application/json" } });
              return rec;
            }
            return { error: "unknown tool " + name };
          },
        };
        const result = await handleAgentChat(env, body, helpers);
        if (env.MEMORY && body.messages && body.messages.length) {
          await saveMem(env, body.agent || "Mia", body.mode || "work", "last", String(body.messages[body.messages.length - 1].content || "").slice(0, 200));
        }
        return jsonR(result);
      }
      if (path === "/files" || path === "/api/vault") {
        if (method === "GET") {
          const key = url.searchParams.get("key");
          if (key && vaultBound(env)) {
            const obj = await env.VAULT.get(key.startsWith("files/") ? key : "files/" + key);
            if (!obj) return jsonR({ error: "not found" }, 404);
            return new Response(obj.body, { headers: { ...corsH, "Content-Type": obj.httpMetadata && obj.httpMetadata.contentType || mimeOf(key) } });
          }
          const cat = url.searchParams.get("category");
          const files = vaultBound(env) ? await listR2Files(env) : await listKvFiles(env, cat);
          return jsonR({ ok: true, files: files, objects: files });
        }
        if (method === "POST") {
          const name = request.headers.get("X-File-Name") || request.headers.get("X-Filename");
          const category = request.headers.get("X-Category") || "vault";
          const type = request.headers.get("Content-Type") || "application/octet-stream";
          if (name) {
            const body = await request.arrayBuffer();
            const saved = await putVaultFile(env, name, body, type, category);
            return jsonR(saved, saved.status || 200);
          }
          const body = await request.json().catch(function(){ return {}; });
          const saved = await putVaultFile(env, body.name, body.content || "", body.type, body.category);
          return jsonR(saved, saved.status || 200);
        }
        if (method === "DELETE") {
          const key = url.searchParams.get("key");
          if (!key || !vaultBound(env)) return jsonR({ error: "key required" }, 400);
          await env.VAULT.delete(key.startsWith("files/") ? key : "files/" + key);
          return jsonR({ ok: true, deleted: key });
        }
      }
      if (path.startsWith("/api/sites")) {
        if (!vaultBound(env)) return jsonR({ error: "VAULT missing. Cannot publish sites." }, 503);
        if (path === "/api/sites" && method === "GET") return jsonR({ ok: true, sites: await listSites(env) });
        if (path === "/api/sites" && method === "POST") {
          const body = await request.json();
          return jsonR(await publishSite(env, body));
        }
        const one = path.match(/^\/api\/sites\/([^/]+)$/);
        if (one && method === "DELETE") {
          const slug = one[1];
          const listed = await env.VAULT.list({ prefix: "sites/" + slug + "/", limit: 1000 });
          for (const o of listed.objects || []) await env.VAULT.delete(o.key);
          return jsonR({ ok: true, deleted: slug });
        }
      }
      if (path.startsWith("/s/") && method === "GET") {
        if (!vaultBound(env)) return jsonR({ error: "VAULT unbound" }, 503);
        return servePublishedSite(env, path);
      }
      if (path === "/session" && method === "GET") {
        const sessionId = crypto.randomUUID();
        const token = crypto.randomUUID();
        const companion = url.searchParams.get("companion") || "jess";
        sessions.set(sessionId, { id: sessionId, token: token, companion: companion, status: "created", created_at: new Date().toISOString() });
        return jsonR({ session_id: sessionId, token: token, companion: companion, avatar_url: AVATAR_URL, ws_url: WS_URL });
      }
      if (path === "/start" && method === "POST") {
        const body = await request.json();
        const s = sessions.get(body.session_id);
        if (!s) return jsonR({ error: "Session not found" }, 404);
        s.status = "active";
        return jsonR({ status: "started", session_id: s.id, avatar_url: AVATAR_URL });
      }
      if (path === "/stop" && method === "POST") {
        const body = await request.json();
        const s = sessions.get(body.session_id);
        if (!s) return jsonR({ error: "Session not found" }, 404);
        s.status = "stopped";
        return jsonR({ status: "stopped", session_id: s.id });
      }
      if (path === "/jobs" && method === "GET") return jsonR({ jobs: Array.from(jobs.values()) });
      if (path === "/jobs" && method === "POST") {
        const body = await request.json();
        return jsonR(createJob(body.type, body.data));
      }
      if ((path === "/checkout" || path === "/api/checkout") && method === "POST") return jsonR(await handleCheckout(env, await request.json()));
      if (path === "/verify-payment" && method === "POST") {
        const stripeKey = env.STRIPE_SECRET_KEY || env.STRIPE;
        if (!stripeKey) return jsonR({ error: "Stripe not configured" }, 503);
        const body = await request.json();
        const res = await fetch("https://api.stripe.com/v1/checkout/sessions/" + body.session_id, { headers: { Authorization: "Bearer " + stripeKey } });
        const data = await res.json();
        return jsonR({ payment_status: data.payment_status, amount_total: data.amount_total, currency: data.currency });
      }
      const page = matchHtmlPage(path);
      if (page && method === "GET") return serveUI(env, page.r2Key, workHtml, page.name);
      if (method === "GET" && (path === "/" || path.endsWith(".html"))) return serveUI(env, "ui/work-active.html", workHtml, "work");
      return jsonR({ error: "Not found", path: path }, 404);
    } catch (err) {
      return jsonR({ error: String(err && err.message || err) }, 500);
    }
  },
};
