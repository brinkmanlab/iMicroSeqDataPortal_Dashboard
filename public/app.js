// Fetch aggregated dashboard data from the Cloudflare Worker API
async function fetchDashboardData() {
  const res = await fetch('/api/dashboard');
  if (!res.ok) {
    throw new Error('Failed to load dashboard data');
  }
  return res.json();
}

// Format large numbers as K/M for summary cards
function formatNumber(value) {
  if (value == null) return '–';
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toString();
}

// Animate a numeric element from 0 to targetValue over durationMs (easeOutCubic)
function animateCount(el, targetValue, durationMs = 900) {
  if (!el) return;
  if (targetValue == null || !Number.isFinite(targetValue)) {
    el.textContent = '–';
    return;
  }

  const startValue = 0;
  const startTime = performance.now();

  const tick = (now) => {
    const t = Math.min(1, (now - startTime) / durationMs);
    // easeOutCubic
    const eased = 1 - Math.pow(1 - t, 3);
    const current = Math.round(startValue + (targetValue - startValue) * eased);
    el.textContent = formatNumber(current);
    if (t < 1) requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

// Populate the four hero cards with animated counts from API summary
function populateSummary(summary) {
  animateCount(document.getElementById('records-count'), summary.records);
  animateCount(document.getElementById('countries-count'), summary.sites);
  animateCount(document.getElementById('organism-count'), summary.organisms);
  animateCount(document.getElementById('data-sources'), summary.dataSources);
}

// Vega-Lite spec: cumulative growth area chart (year vs samples)
function createGrowthSpec(data) {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    width: 'container',
    autosize: {type: 'fit', contains: 'padding'},

    description: 'Database growth area chart',
    data: { values: data },
    mark: {
      type: 'area',
      line: { color: '#4A63E7', strokeWidth: 4 },
      color: {
        x1: 1,
        y1: 1,
        x2: 1,
        y2: 0,
        gradient: 'linear',
        stops: [
          { offset: 0, color: '#4A63E710' },
          { offset: 1, color: '#4A63E744' }
        ]
      },
      interpolate: 'monotone'
    },
    encoding: {
      x: {
        field: 'year',
        type: 'ordinal',
        axis: { title: 'Year', grid: false }
      },
      y: {
        field: 'records',
        type: 'quantitative',
        axis: { title: 'Samples', grid: true },
        scale: { nice: true }
      },
      tooltip: [
        { field: 'year', type: 'ordinal', title: 'Year' },
        { field: 'records', type: 'quantitative', title: 'Samples' }
      ]
    }
  };
}

// Vega-Lite spec: stacked bar chart by year and category (unused; pie used instead)
function createBreakdownBarSpec(data) {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    description: 'Category breakdown stacked bars',
    width: 'container',
    autosize: {type: 'fit', contains: 'padding'},
    data: { values: data },
    mark: { type: 'bar', cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 },
    encoding: {
      x: {
        field: 'year',
        type: 'ordinal',
        axis: { title: 'Year', labelAngle: 0 }
      },
      y: {
        aggregate: 'sum',
        field: 'value',
        type: 'quantitative',
        axis: { title: 'Samples' }
      },
      color: {
        field: 'category',
        type: 'nominal',
        scale: {
          range: ['#4A63E7', '#8B9BFF', '#A3B5FF', '#D3DCF8']
        },
        legend: null,//{
        //  "orient" : "top",   
          //"labelExpr": "length(datum.label) > 12 ? slice(datum.label, 0, 12) + '\\n' + slice(datum.label, 12) : datum.label",
          //"labelLineHeight": 14
        //}
      },
      tooltip: [
        { field: 'year', type: 'ordinal' },
        { field: 'category', type: 'nominal' },
        { field: 'value', type: 'quantitative', title: 'Value' }
      ]
    }
  };
}

// Vega-Lite spec: category breakdown pie chart
function createBreakdownPieSpec(data) {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    description: 'Category breakdown pie chart',
    width: 'container',
    autosize: {type: 'fit', contains: 'padding'},
    data: { values: data },
    mark: { type: 'arc', tooltip: true },
    encoding: {
      theta: { field: 'value', type: 'quantitative' }, // Pie slice size
      color: { 
        field: 'category', 
        type: 'nominal',
        scale: {
          range: ['#4A63E7', '#8B9BFF', '#A3B5FF', '#D3DCF8']
        },
        legend: null,
      },
      tooltip: [
        { field: 'category', type: 'nominal' },
        { field: 'value', type: 'quantitative', title: 'Value' }
      ]
    }
  };
}

// Initialize Leaflet map: CARTO basemap, Canada GeoJSON overlay, circle markers for sample density
function initLeafletMap(container, points) {
  if (!container || typeof L === 'undefined') return;
  container.innerHTML = '';
  const map = L.map(container, { scrollWheelZoom: true }).setView([62.5, -96], 3);
  // CARTO light basemap
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>', 
    maxZoom: 19
  }).addTo(map);
  // Add circle markers scaled by sample count; tooltip shows count and lat/lon
  function addPoints() {
    if (!points || points.length === 0) return;
    console.log(points);

    const maxCount = Math.max(...points.map((d) => d.count), 1);
    points.forEach((d) => {
      const radius = Math.max(6, Math.min(30, 4 + (d.count / maxCount) * 10));
      const fillOpacity = Math.min(0.8, 0.1 + (d.count / 10000));
      const marker = L.circleMarker([d.latitude, d.longitude], {
        radius,
        fillColor: '#000080',
        color: '#fff',
        weight: 1,
        opacity: 1,
        fillOpacity
      }).addTo(map);
      marker.bindTooltip(
        `<strong># of Samples</strong>: ${d.count}`,
        { permanent: false, direction: 'top', className: 'coverage-tooltip' }
      );
      /*marker.bindTooltip(
        `<strong>Samples</strong>: ${d.count}<br>Lat: ${d.latitude.toFixed(4)}<br>Lon: ${d.longitude.toFixed(4)}`,
        { permanent: false, direction: 'top', className: 'coverage-tooltip' }
      );*/
    });
  }

  // Canada GeoJSON overlay (simplified shape); then add sample points
  fetch('https://raw.githubusercontent.com/bfjia/iMicroSeq_Dashboard/refs/heads/main/data/CAN.geo.json')
    .then((r) => r.json())
    .then((geojson) => {
      L.geoJSON(geojson, {
        style: {
          fillColor: '#D80621',
          color: '#a00',
          weight: 1.5,
          fillOpacity: 0.15
        }
      }).addTo(map);
      addPoints();
    })
    .catch(() => {
      addPoints();
    });
}


// Max number of top categories to show in Explore chart (rest collapsed)
const SAMPLE_FIELD_SPEC_MAX_LINES = 12;

// Axis field options for Explore chart dropdowns (fallback if API doesn't provide)
const AXIS_OPTIONS = [
  { value: 'organism', label: 'organism' },
  { value: 'purpose of sampling', label: 'purpose of sampling' },
  { value: 'geo loc name (state/province/territory)', label: 'geo loc name (state/province/territory)' },
  { value: 'environmental site', label: 'environmental site' },
  { value: 'collection device', label: 'collection device' },
  { value: 'assay type', label: 'assay type' },
  { value: 'Year', label: 'Year' },
  { value: 'Year-Month', label: 'Year-Month' }
];

// Get display value for a field from a sample row (handles Year/Year-Month and empty/–)
function getAxisValue(row, field) {
  const v = field === 'Year' ? row.Year : field === 'Year-Month' ? row['Year-Month'] : row[field];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' || s === '--' ? null : (field === 'Year' ? v : s);
}

// Aggregate sample rows into x/y/count for stacked bar; top N y-categories, sorted by total
function aggregateForSampleChart(rows, xField, yField) {
  const countBy = new Map();
  const xValues = new Set();
  const yValues = new Set();

  rows.forEach((row) => {
    const xVal = getAxisValue(row, xField);
    const yVal = getAxisValue(row, yField);
    if (xVal == null || yVal == null) return;
    const key = `${xVal}\t${yVal}`;
    countBy.set(key, (countBy.get(key) || 0) + 1);
    xValues.add(xVal);
    yValues.add(yVal);
  });

  const data = [];
  countBy.forEach((count, key) => {
    const [x, y] = key.split('\t');
    data.push({
      x: xField === 'Year' ? Number(x) : x,
      yCategory: y,
      count
    });
  });

  const xSorted = Array.from(xValues);
  if (xField === 'Year') xSorted.sort((a, b) => Number(a) - Number(b));
  else if (xField === 'Year-Month') xSorted.sort((a, b) => String(a).localeCompare(String(b)));
  else xSorted.sort((a, b) => String(a).localeCompare(String(b)));

  const yOrder = Array.from(yValues);
  const yTotals = new Map();
  data.forEach((d) => {
    yTotals.set(d.yCategory, (yTotals.get(d.yCategory) || 0) + d.count);
  });
  yOrder.sort((a, b) => (yTotals.get(b) || 0) - (yTotals.get(a) || 0));
  const topY = yOrder.slice(0, SAMPLE_FIELD_SPEC_MAX_LINES);
  const topYSet = new Set(topY);

  const filtered = data.filter((d) => topYSet.has(d.yCategory));

  const xIsYear = xField === 'Year';
  const xIsYearMonth = xField === 'Year-Month';
  return { data: filtered, xSorted, xIsYear, xIsYearMonth };
}

// Aggregate sample rows into x/count for line chart
function aggregateForLineChart(rows, xField) {
  const countBy = new Map();
  const xValues = new Set();

  rows.forEach((row) => {
    const xVal = getAxisValue(row, xField);
    if (xVal == null) return;
    countBy.set(xVal, (countBy.get(xVal) || 0) + 1);
    xValues.add(xVal);
  });

  const data = [];
  countBy.forEach((count, xVal) => {
    data.push({
      x: xField === 'Year' ? Number(xVal) : xVal,
      count
    });
  });

  const xSorted = Array.from(xValues);
  if (xField === 'Year') xSorted.sort((a, b) => Number(a) - Number(b));
  else if (xField === 'Year-Month') xSorted.sort((a, b) => String(a).localeCompare(String(b)));
  else xSorted.sort((a, b) => String(a).localeCompare(String(b)));

  const xIsYear = xField === 'Year';
  return { data, xSorted, xIsYear };
}

// Vega-Lite spec: line chart for Explore (single axis); empty state shows "No data for selected axis"
function createLineSpec(aggregated, xField) {
  const { data, xSorted, xIsYear } = aggregated;
  if (!data || data.length === 0) {
    return {
      $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
      description: 'SampleFieldSpec line chart',
      data: { values: [{}] },
      mark: { type: 'text', align: 'center', fontSize: 14 },
      encoding: { text: { value: 'No data for selected axis' } }
    };
  }

  const xScale = xIsYear
    ? { type: 'linear', domain: [Math.min(...xSorted), Math.max(...xSorted)] }
    : { type: 'ordinal', sort: xSorted };

  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    description: 'SampleFieldSpec line chart',
    width: 'container',
    height: 640,
    autosize: { type: 'fit', contains: 'padding' },
    data: { values: data },
    mark: { type: 'line', point: true, interpolate: 'monotone', strokeWidth: 2, color: '#4A63E7' },
    encoding: {
      x: {
        field: 'x',
        type: xIsYear ? 'quantitative' : 'ordinal',
        scale: xScale,
        axis: { title: xField === 'Year' ? 'Year' : xField }
      },
      y: {
        field: 'count',
        type: 'quantitative',
        axis: { title: 'Samples' },
        scale: { nice: true, zero: true }
      },
      tooltip: [
        { field: 'x', type: xIsYear ? 'quantitative' : 'nominal', title: xField },
        { field: 'count', type: 'quantitative', title: 'Samples' }
      ]
    }
  };
}

// Vega-Lite spec: stacked bar for Explore (x vs yCategory, count); empty state shows "No data for selected axes"
function createSampleFieldSpec(aggregated, xField, yField) {
  const { data, xSorted, xIsYear } = aggregated;
  if (!data || data.length === 0) {
    return {
      $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
      description: 'SampleFieldSpec stacked bar chart',
      data: { values: [{}] },
      mark: { type: 'text', align: 'center', fontSize: 14 },
      encoding: { text: { value: 'No data for selected axes' } }
    };
  }

  const xScale = xIsYear
    ? { type: 'linear', domain: [Math.min(...xSorted), Math.max(...xSorted)] }
    : { type: 'ordinal', sort: xSorted, paddingInner: 0.05, paddingOuter: 0.05 };

  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    description: 'SampleFieldSpec stacked bar chart',
    width: 'container',
    height: 640,
    autosize: { type: 'fit', contains: 'padding' },
    config: { bar: { continuousBandSize: 30 } },
    data: { values: data },
    mark: { type: 'bar', cornerRadiusTopLeft: 2, cornerRadiusTopRight: 2 },
    encoding: {
      x: {
        field: 'x',
        type: xIsYear ? 'quantitative' : 'ordinal',
        scale: xScale,
        axis: { title: xField === 'Year' ? 'Year' : xField }
      },
      y: {
        aggregate: 'sum',
        field: 'count',
        type: 'quantitative',
        axis: { title: 'Samples' },
        scale: { nice: true, zero: true }
      },
      color: {
        field: 'yCategory',
        type: 'nominal',
        scale: {
          range: [
            '#4A63E7', '#8B9BFF', '#A3B5FF', '#D3DCF8', '#6B7FD7', '#9CA9FF',
            '#7B8FEB', '#5A72E0', '#B8C4F0', '#3D55C4', '#8A9EE8', '#2E45A8'
          ]
        },
        legend: { title: yField === 'Year' ? 'Year' : yField }
      },
      tooltip: [
        { field: 'x', type: xIsYear ? 'quantitative' : 'nominal', title: xField },
        { field: 'yCategory', type: 'nominal', title: yField },
        { field: 'count', type: 'quantitative', title: 'Samples' }
      ]
    }
  };
}

// Render growth area chart in #growth-chart
function initGrowthChart(data) {
  return vegaEmbed('#growth-chart', createGrowthSpec(data.growth), {
    actions: false
  });
}

// Render breakdown pie chart in #breakdown-chart
function initBreakdownChart(data) {
  return vegaEmbed('#breakdown-chart', createBreakdownPieSpec(data.breakdown), {
    actions: false
  });
}

// Render coverage map in #coverage-chart using Leaflet
function initCoverageMap(data) {
  const container = document.getElementById('coverage-chart');
  initLeafletMap(container, data.coveragePoints || []);
}

// Set up Explore chart: axis selects, plot type (line vs stacked bar), and lazy vegaEmbed on change
function initSampleChart(data) {
  const plotTypeSelect = document.getElementById('sample-chart-plot-type');
  const xSelect = document.getElementById('sample-chart-x');
  const ySelect = document.getElementById('sample-chart-y');
  const rows = data.sampleFieldSpecRows || [];
  const axisOptions = data.axisOptions && data.axisOptions.length > 0 ? data.axisOptions : AXIS_OPTIONS;

  axisOptions.forEach((opt) => {
    const xOpt = document.createElement('option');
    xOpt.value = opt.value;
    xOpt.textContent = opt.label;
    xSelect.appendChild(xOpt);
    const yOpt = document.createElement('option');
    yOpt.value = opt.value;
    yOpt.textContent = opt.label;
    ySelect.appendChild(yOpt);
  });

  plotTypeSelect.value = 'stacked-bar';
  xSelect.value = 'Year-Month';
  ySelect.value = 'organism';

  const yWrap = document.getElementById('sample-chart-y-wrap');

  // Re-aggregate and re-render when plot type or axes change
  const updateSampleChart = async () => {
    const plotType = plotTypeSelect.value;
    const xField = xSelect.value;
    const yField = ySelect.value;

    if (plotType === 'line') {
      yWrap.classList.add('hidden');
    } else {
      yWrap.classList.remove('hidden');
    }

    if (plotType === 'line') {
      const aggregated = aggregateForLineChart(rows, xField);
      await vegaEmbed(
        '#sample-chart',
        createLineSpec(aggregated, xField),
        { actions: false }
      );
    } else {
      const aggregated = aggregateForSampleChart(rows, xField, yField);
      await vegaEmbed(
        '#sample-chart',
        createSampleFieldSpec(aggregated, xField, yField),
        { actions: false }
      );
    }
  };

  plotTypeSelect.addEventListener('change', updateSampleChart);
  xSelect.addEventListener('change', updateSampleChart);
  ySelect.addEventListener('change', updateSampleChart);
  return updateSampleChart();
}

function hideLoadingOverlay() {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('aria-busy', 'false');
}

// Entry: fetch data, populate summary, lazy-load charts when sections scroll into view
async function initDashboard() {
  try {
    const data = await fetchDashboardData();

    populateSummary(data.summary);
    hideLoadingOverlay();

    const loadedCharts = new Set();

    // Lazy-load each chart only when its .lazy-section becomes visible
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          el.classList.add('visible');

          const chart = el.dataset.chart;
          if (!chart || loadedCharts.has(chart)) return;
          loadedCharts.add(chart);

          if (chart === 'growth') {
            initGrowthChart(data).catch((err) => console.error('Growth chart:', err));
          } else if (chart === 'breakdown') {
            initBreakdownChart(data).catch((err) => console.error('Breakdown chart:', err));
          } else if (chart === 'coverage') {
            try {
              initCoverageMap(data);
            } catch (coverageErr) {
              console.error('Error rendering coverage map:', coverageErr);
            }
          } else if (chart === 'sample') {
            initSampleChart(data).catch((err) => console.error('Sample chart:', err));
          }
        });
      },
      { rootMargin: '80px 0px', threshold: 0.01 }
    );

    document.querySelectorAll('.lazy-section').forEach((section) => {
      observer.observe(section);
    });
  } catch (err) {
    hideLoadingOverlay();
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

window.addEventListener('DOMContentLoaded', initDashboard);

