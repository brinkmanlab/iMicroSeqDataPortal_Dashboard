const path = require('path');
const express = require('express');
const { tsvParse, csvParse } = require('d3-dsv');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_URL = 'https://raw.githubusercontent.com/bfjia/iMicroSeq_Dashboard/refs/heads/main/data/imicroseq.tsv';
const PROVINCE_COORDS_URL = 'https://raw.githubusercontent.com/bfjia/iMicroSeq_Dashboard/refs/heads/main/data/ProvinceCapitalCoords.csv';

function parseLatLon(raw, kind) {
  // Handles values like "43.8278276418 N" or "79.0364341912 W"
  // Returns signed decimal degrees or null.
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str || str === '--' || str.toLowerCase().includes('not provided')) {
    return null;
  }

  const match = str.match(/(-?\d+(?:\.\d+)?)\s*([NSEW])?/i);
  if (!match) return null;

  let value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;

  const hemi = (match[2] || '').toUpperCase();
  if (hemi === 'S' || hemi === 'W') value = -Math.abs(value);
  if (hemi === 'N' || hemi === 'E') value = Math.abs(value);

  if (kind === 'lat' && (value < -90 || value > 90)) return null;
  if (kind === 'lon' && (value < -180 || value > 180)) return null;

  return value; //Math.round(value * 100) / 100;;
}

/**
 * Parse the TSV/CSV from URLs and compute the structures used by the dashboard.
 * Data is fetched from GitHub on startup. If the file becomes very large or
 * changes frequently, you could add caching or periodic refresh.
 */
async function loadDashboardData() {
  const [tsvRes, csvRes] = await Promise.all([
    fetch(DATA_URL),
    fetch(PROVINCE_COORDS_URL)
  ]);
  if (!tsvRes.ok) throw new Error(`Failed to load TSV: ${tsvRes.status} ${tsvRes.statusText}`);
  const raw = await tsvRes.text();
  const rows = tsvParse(raw);

  // Province/state name -> { lat, lon } for fallback when row has no lat/long
  const provinceCoords = new Map();
  try {
    if (!csvRes.ok) throw new Error(`${csvRes.status} ${csvRes.statusText}`);
    const provinceCsv = await csvRes.text();
    const provinceRows = csvParse(provinceCsv);
    provinceRows.forEach((r) => {
      const name = (r.Province || '').trim();
      const lat = Number(r.Latitude);
      const lon = Number(r.Longitude);
      if (name && Number.isFinite(lat) && Number.isFinite(lon)) {
        provinceCoords.set(name, { lat, lon });
      }
    });
  } catch (err) {
    console.warn('ProvinceCapitalCoords.csv not loaded, map fallback disabled:', err.message);
  }

  const totalRecords = rows.length;

  const siteSet = new Set();
  const orgSet = new Set();
  const organismsSet = new Set();
  const coordCounts = new Map();

  let minYear = Infinity;
  let maxYear = -Infinity;

  const growthByYear = new Map();

  rows.forEach((row) => {
    // Sites
    const site = row['geo loc name (site)'];
    if (site && site.trim()) {
      siteSet.add(site.trim());
    }

    const organisms = row['organism'];
    if (organisms && organisms.trim()) {
      organismsSet.add(organisms.trim());
    }

    // Organisations / data sources
    const org = row['sample collected by organisation name'];
    if (org && org.trim()) {
      orgSet.add(org.trim());
    }

    // Coverage points (lat/long): use row coords if present, else province/state from ProvinceCapitalCoords.csv
    let lat = parseLatLon(row['geo loc latitude'], 'lat');
    let lon = parseLatLon(row['geo loc longitude'], 'lon');
    if (lat == null || lon == null) {
      const stateProvince = (row['geo loc name (state/province/territory)'] || '').trim();
      if (stateProvince && provinceCoords.has(stateProvince)) {
        const fallback = provinceCoords.get(stateProvince);
        lat = fallback.lat;
        lon = fallback.lon;
      }
    }
    if (lat != null && lon != null) {
      const key = `${lat},${lon}`;
      coordCounts.set(key, (coordCounts.get(key) || 0) + 1);
    }

    // Time span & growth
    const dateStr = row['sample collection start date'];
    if (dateStr && dateStr.trim()) {
      const yearMatch = dateStr.trim().match(/^(\d{4})/);
      if (yearMatch) {
        const year = Number(yearMatch[1]);
        if (!Number.isNaN(year)) {
          if (year < minYear) minYear = year;
          if (year > maxYear) maxYear = year;

          const current = growthByYear.get(year) || 0;
          growthByYear.set(year, current + 1);
        }
      }
    }
  });

  let cumulative = 0;
  const growth = [];
  for (let y = minYear; y <= maxYear; y++) {
    const count = growthByYear.get(y) || 0; // fill missing year with 0
    cumulative += count;                     // add to cumulative
    growth.push({
      year: y,
      records: cumulative                    // cumulative count
    });
  }

  /*
  // Basic category breakdown stacked bar: by assay type and year
  const breakdown = [];
  const orgCounts = {};
  rows.forEach((row) => {
    const org = row['assay type'] || 'Unknown';
    orgCounts[org] = (orgCounts[org] || 0) + 1;
  });

  const topOrgs = Object.entries(orgCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name]) => name);

  const yearBuckets = new Map();
  rows.forEach((row) => {
    const dateStr = row['sample collection start date'];
    const yearMatch = dateStr && dateStr.trim().match(/^(\d{4})/);
    if (!yearMatch) return;
    const year = Number(yearMatch[1]);
    if (Number.isNaN(year)) return;

    const org = row['assay type'] || 'Unknown';
    const category =
      topOrgs.indexOf(org) !== -1 ? org : 'Other';

    const key = `${year}:${category}`;
    yearBuckets.set(key, (yearBuckets.get(key) || 0) + 1);
  });

  yearBuckets.forEach((value, key) => {
    const [yearStr, category] = key.split(':');
    breakdown.push({
      category,
      year: Number(yearStr),
      value
    });
  }); */

  //breakdown by pie chart
  // Category breakdown without year
  const breakdown = [];
  const orgCounts = {};

  // Count occurrences per assay type
  rows.forEach((row) => {
    const org = row['assay type'] || 'Unknown';
    orgCounts[org] = (orgCounts[org] || 0) + 1;
  });

  // Get top 6 assay types, rest will be "Other"
  const topOrgs = Object.entries(orgCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name]) => name);

  // Sum values per category (top 6 + Other)
  const categoryCounts = {};
  rows.forEach((row) => {
    const org = row['assay type'] || 'Unknown';
    const category = topOrgs.includes(org) ? org : 'Other';
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  });

  // Build the breakdown array
  Object.entries(categoryCounts).forEach(([category, value]) => {
    breakdown.push({ category, value });
  });

  // Data coverage map, get the value for the points
  const coveragePoints = Array.from(coordCounts.entries())
    .map(([key, count]) => {
      const [latStr, lonStr] = key.split(',');
      return {
        latitude: Number(latStr),
        longitude: Number(lonStr),
        count
      };
    })
    .sort((a, b) => b.count - a.count);

  const fields = ['All Records'];

  // Rows for SampleFieldSpec: chosen columns + Year and Year-Month from sample collection start date
  const sampleFieldSpecRows = rows.map((row) => {
    const dateStr = row['sample collection start date'];
    let year = null;
    let yearMonth = null;
    if (dateStr && dateStr.trim()) {
      const trimmed = dateStr.trim();
      const yearMatch = trimmed.match(/^(\d{4})/);
      if (yearMatch) year = Number(yearMatch[1]);
      const yearMonthMatch = trimmed.match(/^(\d{4})-(\d{2})/);
      if (yearMonthMatch) yearMonth = `${yearMonthMatch[1]}-${yearMonthMatch[2]}`;
    }
    return {
      organism: row.organism ?? '',
      'purpose of sampling': row['purpose of sampling'] ?? '',
      'geo loc name (state/province/territory)': row['geo loc name (state/province/territory)'] ?? '',
      'environmental site': row['environmental site'] ?? '',
      'collection device': row['collection device'] ?? '',
      'assay type': row['assay type'] ?? '',
      Year: year,
      'Year-Month': yearMonth
    };
  });

  const axisOptions = [
    { value: 'organism', label: 'organism' },
    { value: 'purpose of sampling', label: 'purpose of sampling' },
    { value: 'geo loc name (state/province/territory)', label: 'geo loc name (state/province/territory)' },
    { value: 'environmental site', label: 'environmental site' },
    { value: 'collection device', label: 'collection device' },
    { value: 'assay type', label: 'assay type' },
    { value: 'Year', label: 'Year' },
    { value: 'Year-Month', label: 'Year-Month' }
  ];

  const result = {
    summary: {
      records: totalRecords,
      sites: siteSet.size,
      timeSpan: {
        start: Number.isFinite(minYear) ? minYear : null,
        end: Number.isFinite(maxYear) ? maxYear : null
      },
      organisms: organismsSet.size,
      dataSources: orgSet.size
    },
    growth,
    breakdown,
    coveragePoints,
    fields,
    sampleFieldSpecRows,
    axisOptions
  };
  return result;
}

let dashboardData = null;

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/dashboard', (_req, res) => {
  if (dashboardData == null) {
    return res.status(503).json({ error: 'Dashboard data not yet loaded' });
  }
  res.json(dashboardData);
});

(async () => {
  try {
    dashboardData = await loadDashboardData();
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Dashboard server listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to load dashboard data:', err.message);
    process.exitCode = 1;
  }
})();

