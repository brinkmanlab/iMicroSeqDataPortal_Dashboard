## iMicroSeq Dashboard

POPULATE WITH TEXT :)

### Testing and Deploying to Cloudflare Workers

The app can run as a Cloudflare Worker with static assets:

1. **Prerequisites**: [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) and a Cloudflare account. Log in with `npx wrangler login`.

2. **Local dev**: `npm run cf:dev` (TEST first locally before deploying).

3. **Deploy**: `npm run cf:deploy` (DEPLOY to cloudflare's edge network. The site will be live at imicroseq-dashboard.bfjia.net).

**Viral Loads data:** The dashboard’s Viral Loads section loads `public/data/quant.json.gz`. Generate it with `python scripts/build_quant_tsv.py` (reads `data/imicroseq.csv.xz`, writes `data/quant.json.gz` and copies to `public/data/quant.json.gz`). For local testing, serve over HTTP (e.g. `npx serve public` or `python -m http.server --directory public`); opening the HTML file directly (file://) will not load data.


# HOW CLOUDFLARE WORKER WORKS WITH THIS APP:

## 1. What gets deployed

When you run `wrangler deploy` (or `npm run cf:deploy`):

- **Worker script**  
  Your `cf-worker/index.ts` (and bundled `dashboard-data.ts`) is compiled and deployed as the daemon that runs on every matching request.

- **Static assets**  
  Everything under `public/` (HTML, CSS, JS, images) is uploaded and attached to the Worker via the **ASSETS** binding (`[assets]` in `wrangler.toml`). Those files are stored on Cloudflare’s edge; they are **not** served by your own server.

So: one deployment = one Worker + one set of static files, both at the edge.

---

## 2. What happens on each request

All requests to your domain (e.g. `https://imicroseq-dashboard.bfjia.net`) that match your **routes** in `wrangler.toml` are sent to this Worker. The Worker’s **fetch** handler runs and decides how to respond.

```
Request → Cloudflare edge → Your Worker fetch() → Response
```

Inside the Worker:

1. **URL is checked**  
   `const url = new URL(request.url)` so you can branch on path (and host, etc.).

2. **`/api/dashboard`**  
   - If pathname is exactly `/api/dashboard`:
     - The Worker calls `loadDashboardData()` (unless it’s already cached).
     - That function `fetch()`es the TSV/CSV from GitHub, parses them in memory, and builds the JSON your frontend expects.
     - The result is cached in a module-level variable (`cachedData`) for the lifetime of that Worker isolate, so later requests don’t re-fetch from GitHub.
     - The Worker returns **JSON** with `Response.json(cachedData)` and a `Cache-Control` header.
   - So **this path is fully handled by your Worker code**; no static file is involved.

3. **Everything else (HTML, CSS, JS, images)**  
   - For any other path (e.g. `/`, `/styles.css`, `/app.js`, `/img/...`):
     - The Worker does **not** serve a file itself.
     - It forwards the request to the **ASSETS** binding: `return env.ASSETS.fetch(request)`.
   - **ASSETS** is a built-in binding that:
     - Looks up the requested path in the uploaded `public/` files.
     - Serves the matching file (with correct content-type, caching, etc.).
     - Returns 404 if there’s no matching asset.

So:

- **API:** Worker runs your TypeScript, fetches from GitHub, parses, caches, returns JSON.
- **Static content:** Worker delegates to ASSETS, which serves from the `public/` snapshot uploaded at deploy time.

---

## 3. Flow in one picture

```
Browser
   │
   ├─ GET /                    → Worker → ASSETS.fetch(request) → index.html
   ├─ GET /styles.css           → Worker → ASSETS.fetch(request) → styles.css
   ├─ GET /app.js               → Worker → ASSETS.fetch(request) → app.js
   ├─ GET /api/dashboard        → Worker → loadDashboardData() (or cache) → JSON
   └─ GET /img/imicroseq-logo.png → Worker → ASSETS.fetch(request) → image
```

---

## 4. Important details

- **Edge execution**  
  The Worker runs in Cloudflare’s data centers (edge), close to users. There is no long-lived server; each request triggers a short run of your `fetch` handler.

- **No Node/Express at runtime**  
  The Worker uses the **Fetch API** (Request/Response) and **env.ASSETS**. Local and production both run the same Worker (via `wrangler dev` or Cloudflare).

- **Caching**  
  - **Dashboard API:** In-memory cache in the Worker (per isolate) + `Cache-Control: public, max-age=300` so browsers can cache the JSON for 5 minutes.
  - **Static assets:** Cloudflare can cache them at the edge based on the ASSETS binding’s behavior.

- **Custom domain**  
  The `routes` in `wrangler.toml` (e.g. `pattern = "imicroseq-dashboard.bfjia.net"` with `zone_name = "bfjia.net"`) tell Cloudflare to run this Worker for that host. DNS for `imicroseq-dashboard.bfjia.net` points to Cloudflare, so traffic hits the edge and then your Worker.

In short: **the Worker is the only “server” in production**—it either runs your API logic for `/api/dashboard` or hands the request to ASSETS to deliver the static files from `public/`.