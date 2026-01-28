async function fetchDashboardData() {
  const res = await fetch('/api/dashboard');
  if (!res.ok) {
    throw new Error('Failed to load dashboard data');
  }
  return res.json();
}

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

function populateSummary(summary) {
  animateCount(document.getElementById('records-count'), summary.records);
  animateCount(document.getElementById('countries-count'), summary.sites);
  animateCount(document.getElementById('organism-count'), summary.organisms);
  animateCount(document.getElementById('data-sources'), summary.dataSources);
}

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

function createBreakdownPieSpec(data) {
  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    description: 'Category breakdown pie chart',
    width: 'container',
    autosize: {type: 'fit', contains: 'padding'},
    data: { values: data },
    mark: { type: 'arc', tooltip: true },
    encoding: {
      theta: { field: 'value', type: 'quantitative' },   // Pie slice size
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


function initLeafletMap(container, points) {
  if (!container || typeof L === 'undefined') return;
  container.innerHTML = '';
  const map = L.map(container, { scrollWheelZoom: true }).setView([62.5, -96], 3);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {//draw the world map using the CARTO maps
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>', 
    maxZoom: 19
  }).addTo(map);
  function addPoints() {
    if (!points || points.length === 0) return;
    const maxCount = Math.max(...points.map((d) => d.count), 1);
    points.forEach((d) => {
      const radius = Math.max(4, Math.min(20, 4 + (d.count / maxCount) * 10));
      const fillOpacity = 0.1 + (d.count / maxCount) * 0.7;
      const marker = L.circleMarker([d.latitude, d.longitude], {
        radius,
        fillColor: '#4A63E7',
        color: '#fff',
        weight: 1,
        opacity: 1,
        fillOpacity
      }).addTo(map);
      marker.bindTooltip(
        `<strong>Samples</strong>: ${d.count}<br>Lat: ${d.latitude.toFixed(4)}<br>Lon: ${d.longitude.toFixed(4)}`,
        { permanent: false, direction: 'top', className: 'coverage-tooltip' }
      );
    });
  }

  fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries/CAN.geo.json') //Nice guy who have a json file for Canada shape. Not the most precise, but good enough. Blessh im.
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


const SAMPLE_FIELD_SPEC_MAX_LINES = 12;

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

function getAxisValue(row, field) {
  const v = field === 'Year' ? row.Year : field === 'Year-Month' ? row['Year-Month'] : row[field];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' || s === '--' ? null : (field === 'Year' ? v : s);
}

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

function initGrowthChart(data) {
  return vegaEmbed('#growth-chart', createGrowthSpec(data.growth), {
    actions: false
  });
}

function initBreakdownChart(data) {
  return vegaEmbed('#breakdown-chart', createBreakdownPieSpec(data.breakdown), {
    actions: false
  });
}

function initCoverageMap(data) {
  const container = document.getElementById('coverage-chart');
  initLeafletMap(container, data.coveragePoints || []);
}

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

async function initDashboard() {
  try {
    const data = await fetchDashboardData();

    populateSummary(data.summary);

    const loadedCharts = new Set();

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
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

window.addEventListener('DOMContentLoaded', initDashboard);

