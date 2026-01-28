// Inline TSV/CSV parsers (no eval/new Function) — Workers disallow code generation
function parseTSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t");
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split("\t");
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVRow(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function parseCSVRow(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let field = "";
      i++;
      while (i < line.length && line[i] !== '"') {
        field += line[i];
        i++;
      }
      if (line[i] === '"') i++;
      out.push(field);
    } else {
      const comma = line.indexOf(",", i);
      if (comma === -1) {
        out.push(line.slice(i));
        break;
      }
      out.push(line.slice(i, comma));
      i = comma + 1;
    }
  }
  return out;
}

const DATA_URL =
  "https://raw.githubusercontent.com/bfjia/iMicroSeq_Dashboard/refs/heads/main/data/imicroseq.tsv";
const PROVINCE_COORDS_URL =
  "https://raw.githubusercontent.com/bfjia/iMicroSeq_Dashboard/refs/heads/main/data/ProvinceCapitalCoords.csv";

// GitHub raw requires a User-Agent; Workers do not send one by default
const GITHUB_FETCH_OPTIONS: RequestInit = {
  headers: { "User-Agent": "iMicroSeq-Dashboard/1.0 (Cloudflare Worker)" },
};

function parseLatLon(
  raw: string | number | undefined | null,
  kind: "lat" | "lon"
): number | null {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (
    !str ||
    str === "--" ||
    str.toLowerCase().includes("not provided")
  ) {
    return null;
  }
  const match = str.match(/(-?\d+(?:\.\d+)?)\s*([NSEW])?/i);
  if (!match) return null;
  let value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const hemi = (match[2] || "").toUpperCase();
  if (hemi === "S" || hemi === "W") value = -Math.abs(value);
  if (hemi === "N" || hemi === "E") value = Math.abs(value);
  if (kind === "lat" && (value < -90 || value > 90)) return null;
  if (kind === "lon" && (value < -180 || value > 180)) return null;
  return value;
}

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

export async function loadDashboardData(): Promise<DashboardData> {
  const [tsvRes, csvRes] = await Promise.all([
    fetch(DATA_URL, GITHUB_FETCH_OPTIONS),
    fetch(PROVINCE_COORDS_URL, GITHUB_FETCH_OPTIONS),
  ]);
  if (!tsvRes.ok)
    throw new Error(`Failed to load TSV: ${tsvRes.status} ${tsvRes.statusText}`);
  const raw = await tsvRes.text();
  const rows = parseTSV(raw);

  const provinceCoords = new Map<string, { lat: number; lon: number }>();
  try {
    if (!csvRes.ok)
      throw new Error(`${csvRes.status} ${csvRes.statusText}`);
    const provinceCsv = await csvRes.text();
    const provinceRows = parseCSV(provinceCsv);
    provinceRows.forEach((r) => {
      const name = (r.Province || "").trim();
      const lat = Number(r.Latitude);
      const lon = Number(r.Longitude);
      if (name && Number.isFinite(lat) && Number.isFinite(lon)) {
        provinceCoords.set(name, { lat, lon });
      }
    });
  } catch {
    // Province fallback disabled
  }

  const totalRecords = rows.length;
  const siteSet = new Set<string>();
  const orgSet = new Set<string>();
  const organismsSet = new Set<string>();
  const coordCounts = new Map<string, number>();
  let minYear = Infinity;
  let maxYear = -Infinity;
  const growthByYear = new Map<number, number>();

  for (const row of rows) {
    const site = row["geo loc name (site)"];
    if (site?.trim()) siteSet.add(site.trim());
    const organisms = row["organism"];
    if (organisms?.trim()) organismsSet.add(organisms.trim());
    const org = row["sample collected by organisation name"];
    if (org?.trim()) orgSet.add(org.trim());

    let lat = parseLatLon(row["geo loc latitude"], "lat");
    let lon = parseLatLon(row["geo loc longitude"], "lon");
    if (lat == null || lon == null) {
      const stateProvince = (
        row["geo loc name (state/province/territory)"] || ""
      ).trim();
      const fallback = stateProvince
        ? provinceCoords.get(stateProvince)
        : undefined;
      if (fallback) {
        lat = fallback.lat;
        lon = fallback.lon;
      }
    }
    if (lat != null && lon != null) {
      const key = `${lat},${lon}`;
      coordCounts.set(key, (coordCounts.get(key) || 0) + 1);
    }

    const dateStr = row["sample collection start date"];
    if (dateStr?.trim()) {
      const yearMatch = dateStr.trim().match(/^(\d{4})/);
      if (yearMatch) {
        const year = Number(yearMatch[1]);
        if (!Number.isNaN(year)) {
          if (year < minYear) minYear = year;
          if (year > maxYear) maxYear = year;
          growthByYear.set(year, (growthByYear.get(year) || 0) + 1);
        }
      }
    }
  }

  const growth: Array<{ year: number; records: number }> = [];
  let cumulative = 0;
  for (let y = minYear; y <= maxYear; y++) {
    const count = growthByYear.get(y) || 0;
    cumulative += count;
    growth.push({ year: y, records: cumulative });
  }

  const orgCounts: Record<string, number> = {};
  for (const row of rows) {
    const org = row["assay type"] || "Unknown";
    orgCounts[org] = (orgCounts[org] || 0) + 1;
  }
  const topOrgs = Object.entries(orgCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name]) => name);
  const categoryCounts: Record<string, number> = {};
  for (const row of rows) {
    const org = row["assay type"] || "Unknown";
    const category = topOrgs.includes(org) ? org : "Other";
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }
  const breakdown = Object.entries(categoryCounts).map(([category, value]) => ({
    category,
    value,
  }));

  const coveragePoints = Array.from(coordCounts.entries())
    .map(([key, count]) => {
      const [latStr, lonStr] = key.split(",");
      return {
        latitude: Number(latStr),
        longitude: Number(lonStr),
        count,
      };
    })
    .sort((a, b) => b.count - a.count);

  const sampleFieldSpecRows = rows.map((row) => {
    const dateStr = row["sample collection start date"];
    let year: number | null = null;
    let yearMonth: string | null = null;
    if (dateStr?.trim()) {
      const yearMatch = dateStr.trim().match(/^(\d{4})/);
      if (yearMatch) year = Number(yearMatch[1]);
      const yearMonthMatch = dateStr.trim().match(/^(\d{4})-(\d{2})/);
      if (yearMonthMatch)
        yearMonth = `${yearMonthMatch[1]}-${yearMonthMatch[2]}`;
    }
    return {
      organism: row.organism ?? "",
      "purpose of sampling": row["purpose of sampling"] ?? "",
      "geo loc name (state/province/territory)":
        row["geo loc name (state/province/territory)"] ?? "",
      "environmental site": row["environmental site"] ?? "",
      "collection device": row["collection device"] ?? "",
      "assay type": row["assay type"] ?? "",
      Year: year,
      "Year-Month": yearMonth,
    };
  });

  return {
    summary: {
      records: totalRecords,
      sites: siteSet.size,
      timeSpan: {
        start: Number.isFinite(minYear) ? minYear : null,
        end: Number.isFinite(maxYear) ? maxYear : null,
      },
      organisms: organismsSet.size,
      dataSources: orgSet.size,
    },
    growth,
    breakdown,
    coveragePoints,
    fields: ["All Records"],
    sampleFieldSpecRows,
    axisOptions: [
      { value: "organism", label: "organism" },
      { value: "purpose of sampling", label: "purpose of sampling" },
      {
        value: "geo loc name (state/province/territory)",
        label: "geo loc name (state/province/territory)",
      },
      { value: "environmental site", label: "environmental site" },
      { value: "collection device", label: "collection device" },
      { value: "assay type", label: "assay type" },
      { value: "Year", label: "Year" },
      { value: "Year-Month", label: "Year-Month" },
    ],
  };
}
