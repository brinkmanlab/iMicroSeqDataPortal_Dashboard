import { loadDashboardData } from "./dashboard-data";

export interface Env {
  ASSETS: Fetcher;
}

// Cache dashboard data in memory for the lifetime of the isolate (reduces GitHub fetches)
let cachedData: Awaited<ReturnType<typeof loadDashboardData>> | null = null;

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

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

    return env.ASSETS.fetch(request);
  },
};
