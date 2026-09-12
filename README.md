# HeyMia Worker

AI agent command center on Cloudflare Workers. Powers Work mode, File Vault, website publish, LiveAvatar, and Stripe.

## Agent (v3)

- **Primary:** Gemini 3.8 Flash (`gemini-3.8-flash`) — function calling
- **Fallback:** Gemini 3.6 Flash → Gemini 2.5 Flash
- **Edge fallback:** Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
- **Tools:** `worker_status`, `list_vault`, `publish_site`, `route_file`, `create_room`

Gemini 2.0 Flash is retired (shutdown 1 Jun 2026). Do not point the Worker at it.

## Routes

| Path | Purpose |
|------|---------|
| `/` `/work` | Workflow Command Center (R2 `ui/work-active.html` or embedded UI) |
| `/chat` `POST` | Mia agent (tools + Gemini 3.8) |
| `/files` | Vault upload/list (R2 `VAULT`, KV fallback) |
| `/api/sites` | Publish static sites |
| `/s/{slug}/` | Live published site |
| `/route` | File classifier |
| `/ui/activate` | Swap live HTML from vault |
| `/session` `/start` `/stop` | LiveAvatar |
| `/checkout` | Stripe |

## Deploy

```bash
npm i
wrangler login
wrangler kv namespace create MEMORY
wrangler r2 bucket create heymia-vault
# paste the IDs into wrangler.toml, then:
wrangler secret put GEMINI_API_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put LIVEAVATAR_API_KEY
wrangler deploy
```

Custom domain: Workers → heymia → Domains → `heymia.lensflow.au`  
`www.glimr.com.au` must be added on the **same** Cloudflare account (Error 1014 = cross-account CNAME).

Connect this GitHub repo in Cloudflare **Workers → Settings → Builds** so every push deploys.
