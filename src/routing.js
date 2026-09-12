const PAGES = ["studio", "work", "play", "landing", "admin"];

export async function serveUI(env, r2Key, fallbackHtml, uiName) {
  if (env.VAULT) {
    try {
      const obj = await env.VAULT.get(r2Key);
      if (obj) {
        return new Response(obj.body, {
          headers: {
            "Content-Type": "text/html;charset=UTF-8",
            "Cache-Control": "no-cache",
            "X-HeyMia-UI": uiName + "-r2",
          },
        });
      }
    } catch {}
  }
  return new Response(fallbackHtml, {
    headers: {
      "Content-Type": "text/html;charset=UTF-8",
      "Cache-Control": "no-cache",
      "X-HeyMia-UI": uiName,
    },
  });
}

export async function handleUiAdmin(request, env, path) {
  if (path === "/ui/status" && request.method === "GET") {
    if (!env.VAULT) return { error: "VAULT not bound" };
    const status = {};
    for (const k of PAGES) {
      const head = await env.VAULT.head("ui/" + k + "-active.html");
      status[k] = { active: !!head, uploaded: head?.uploaded || null };
    }
    return { ...status, hint: "Upload HTML via /files then POST /ui/activate { target, key }" };
  }
  if (path === "/ui/activate" && request.method === "POST") {
    if (!env.VAULT) return { error: "VAULT not bound", status: 500 };
    const body = await request.json().catch(() => ({}));
    const target = (body.target || "work").toLowerCase();
    const key = body.key;
    if (!key) return { error: "key required", status: 400 };
    if (!PAGES.includes(target)) return { error: "invalid target", status: 400 };
    const obj = await env.VAULT.get(key);
    if (!obj) return { error: "source key not found in R2", status: 404 };
    const activeKey = "ui/" + target + "-active.html";
    await env.VAULT.put(activeKey, await obj.arrayBuffer(), {
      httpMetadata: { contentType: "text/html;charset=UTF-8" },
      customMetadata: { sourceKey: key, activatedAt: new Date().toISOString() },
    });
    return { ok: true, target, activeKey, sourceKey: key, message: "UI activated. Hard refresh." };
  }
  if (path === "/ui/reset" && request.method === "POST") {
    if (!env.VAULT) return { error: "VAULT not bound", status: 500 };
    const body = await request.json().catch(() => ({}));
    const target = (body.target || "work").toLowerCase();
    if (!PAGES.includes(target)) return { error: "invalid target", status: 400 };
    const activeKey = "ui/" + target + "-active.html";
    await env.VAULT.delete(activeKey);
    return { ok: true, reset: activeKey, message: "Reverted to embedded UI." };
  }
  return null;
}

export function matchHtmlPage(path) {
  if (path === "/" || path === "/studio" || path === "/jess" || path === "/5minsession" || path === "/index.html" || path === "/work") {
    return { r2Key: "ui/work-active.html", name: "work" };
  }
  if (path === "/play") return { r2Key: "ui/play-active.html", name: "play" };
  if (path === "/home" || path === "/landing") return { r2Key: "ui/landing-active.html", name: "landing" };
  if (path === "/admin") return { r2Key: "ui/admin-active.html", name: "admin" };
  return null;
}
