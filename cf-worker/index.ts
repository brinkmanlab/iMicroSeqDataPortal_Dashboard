// Cloudflare Worker entry: serves /api/dashboard and static assets
import { loadDashboardData } from "./dashboard-data";

/** Worker bindings: ASSETS is the static asset fetcher (public folder) */
export interface Env {
  ASSETS: Fetcher;
}

// Cache dashboard data in memory for the lifetime of the isolate (reduces GitHub fetches)
let cachedData: Awaited<ReturnType<typeof loadDashboardData>> | null = null;

export default {
  /** Handle incoming requests: /api/dashboard returns JSON; all other paths go to static assets */
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // API route: return aggregated dashboard data (TSV/CSV from GitHub)
    if (url.pathname === "/api/dashboard") {
      try {
        if (!cachedData) {
          cachedData = await loadDashboardData();
        }
        return Response.json(cachedData, {
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
