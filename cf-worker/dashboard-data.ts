/** Shape of the dashboard API response consumed by the frontend */
export interface DashboardData {
  summary: {
    records: number;
    sites: number;
    timeSpan: { start: number | null; end: number | null };
    organisms: number;
    dataSources: number;
  };
  growth: Array<{ year: number; records: number }>;
  breakdown: Array<{ category: string; value: number }>;
  coveragePoints: Array<{ latitude: number; longitude: number; count: number }>;
  fields: string[];
  sampleFieldSpecRows: Record<string, unknown>[];
  axisOptions: Array<{ value: string; label: string }>;
}
