const MIME = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
};

export function extOf(name) {
  const i = String(name || "").lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}
export function mimeOf(name) {
  return MIME[extOf(name)] || "application/octet-stream";
}
export function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "site";
}
export function vaultBound(env) {
  return !!(env && env.VAULT && typeof env.VAULT.put === "function");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    if (c === "&") return "\\u0026amp;";
    if (c === "<") return "\\u0026lt;";
    if (c === ">") return "\\u0026gt;";
    if (c === '"') return "\\u0026quot;";
    return "\\u0026#39;";
  });
}

export function defaultSiteHtml(name, tagline) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(name)}</title>
<style>body{margin:0;font-family:system-ui;background:#07060a;color:#f8fafc;min-height:100vh}.wrap{max-width:880px;margin:0 auto;padding:72px 24px}h1{font-size:56px;letter-spacing:-.04em}p{color:#94a3b8;font-size:20px}.badge{display:inline-block;border:1px solid rgba(255,255,255,.12);padding:6px 10px;border-radius:999px;color:#ec4899;letter-spacing:.12em;text-transform:uppercase;font-size:12px}</style>
</head><body><div class="wrap"><div class="badge">Published with HeyMia</div><h1>${escapeHtml(name)}</h1><p>${escapeHtml(tagline)}</p></div></body></html>`;
}

export async function listSites(env) {
  const listed = await env.VAULT.list({ prefix: "sites/", limit: 1000 });
  const slugs = {};
  for (const o of listed.objects || []) {
    const slug = o.key.slice(6).split("/")[0];
    if (!slug) continue;
    slugs[slug] = slugs[slug] || { slug, files: 0, bytes: 0, updated: o.uploaded };
    slugs[slug].files += 1;
    slugs[slug].bytes += o.size || 0;
  }
  const domain = env.PUBLIC_DOMAIN || "";
  return Object.values(slugs).map((s) => ({ ...s, url: domain + "/s/" + s.slug + "/" }));
}

export async function publishSite(env, { name, slug, tagline, html, files }) {
  const s = slugify(slug || name);
  const pack = Object.assign({}, files || {});
  if (html) pack["index.html"] = html;
  if (!pack["index.html"]) pack["index.html"] = defaultSiteHtml(name || s, tagline || "Published by HeyMia");
  const written = [];
  for (const [fname, content] of Object.entries(pack)) {
    const safe = fname.replace(/^\/+/, "").replace(/\.\./g, "");
    await env.VAULT.put(
      "sites/" + s + "/" + safe,
      typeof content === "string" ? new TextEncoder().encode(content) : content,
      { httpMetadata: { contentType: mimeOf(safe) } },
    );
    written.push(safe);
  }
  const url = (env.PUBLIC_DOMAIN || "") + "/s/" + s + "/";
  return { ok: true, slug: s, url, files: written, message: "Site published at " + url };
}

export async function servePublishedSite(env, path) {
  const parts = path.slice(3).split("/").filter(Boolean);
  if (!parts.length) return null;
  const slug = slugify(parts[0]);
  let filePath = parts.slice(1).join("/") || "index.html";
  if (filePath.endsWith("/")) filePath += "index.html";
  let obj = await env.VAULT.get("sites/" + slug + "/" + filePath);
  if (!obj && !filePath.includes(".")) obj = await env.VAULT.get("sites/" + slug + "/" + filePath + "/index.html");
  if (!obj) return new Response("<!doctype html><title>404</title><h1>Not found</h1>", { status: 404, headers: { "content-type": "text/html;charset=UTF-8" } });
  return new Response(await obj.arrayBuffer(), {
    headers: { "content-type": mimeOf(filePath), "cache-control": "public, max-age=60" },
  });
}
