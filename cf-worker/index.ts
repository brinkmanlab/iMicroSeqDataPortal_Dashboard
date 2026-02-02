// Cloudflare Worker entry: serves /api/dashboard and static assets
import type { DashboardData } from "./dashboard-data";

/** Worker bindings: ASSETS is the static asset fetcher (public folder) */
export interface Env {
  ASSETS: Fetcher;
}

/** Decompress gzip stream and parse JSON (built-in DecompressionStream) */
async function decompressJsonFromGz(
  body: ReadableStream<Uint8Array>
): Promise<DashboardData> {
  const decompressed = new Response(
    body.pipeThrough(new DecompressionStream("gzip"))
  );
  const text = await decompressed.text();
  return JSON.parse(text) as DashboardData;
}

/** Load dashboard data from static data/portalData.json.gz (built by scripts/build_dashboard_data.py) */
async function getDashboardData(
  request: Request,
  env: Env
): Promise<DashboardData> {
  const dataUrl = new URL("/data/portalData.json.gz", request.url);
  const staticRes = await env.ASSETS.fetch(dataUrl);
  if (staticRes.ok && staticRes.body) {
    return decompressJsonFromGz(staticRes.body as ReadableStream<Uint8Array>);
  }
  throw new Error(
    "Dashboard data not available; deploy public/data/portalData.json.gz"
  );
}

export default {
  /** Handle incoming requests: /api/dashboard returns JSON; all other paths go to static assets */
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // API route: return aggregated dashboard data from static portalData.json.gz
    if (url.pathname === "/api/dashboard") {
      try {
        const data = await getDashboardData(request, env);
        return Response.json(data, {
          headers: {
            "Cache-Control": "public, max-age=300", // 5 min cache
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return Response.json(
          { error: "Failed to load dashboard data", detail: message },
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // All other paths: serve static files from ASSETS (public/)
    return env.ASSETS.fetch(request);
  },
};
