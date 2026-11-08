const integer = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const colors = ['#4f46e5', '#0ea5e9', '#f59e0b', '#10b981', '#e11d48', '#a855f7'];

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export function fmt(value, kind = 'number') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  if (kind === 'pct') return number.toFixed(1) + '%';
  if (kind === 'roi') return number.toFixed(2);
  if (kind === 'money') {
    if (Math.abs(number) >= 1e8) return (number / 1e8).toFixed(2) + '亿';
    if (Math.abs(number) >= 1e4) return (number / 1e4).toFixed(1) + '万';
    return '¥' + integer.format(number);
  }
  return decimal.format(number);
}

export function card(title, html, hint = '') {
  return '<section class="card"><h2>' + escapeHtml(title) + '</h2>'
    + (hint ? '<p class="hint">' + escapeHtml(hint) + '</p>' : '') + html + '</section>';
}

export function tiles(items) {
  return '<div class="tiles">' + items.map(({ label, value, detail }) =>
    '<div class="tile"><div class="tile-label">' + escapeHtml(label) + '</div><div class="tile-value">'
    + escapeHtml(value) + '</div>' + (detail ? '<div class="tile-detail">' + escapeHtml(detail) + '</div>' : '')
    + '</div>').join('') + '</div>';
}

export function table(headers, rows) {
  const header = headers.map(value => '<th scope="col">' + escapeHtml(value) + '</th>').join('');
  const body = rows.map(row => '<tr>' + row.map(value => '<td>' + escapeHtml(value ?? '—') + '</td>').join('') + '</tr>').join('')
    || '<tr><td class="empty-cell" colspan="' + headers.length + '">当前条件暂无数据</td></tr>';
  return '<div class="table-wrap"><table><thead><tr>' + header + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

function seriesColor(item, index) {
  return /^#[a-f\d]{3,8}$/i.test(item.color || '') ? item.color : colors[index % colors.length];
}

function chartLegend(series) {
  return '<figcaption>' + series.map((item, index) =>
    '<button type="button" class="plot-legend" data-series-toggle="' + index + '" aria-pressed="true">'
    + '<i style="background:' + item.color + '"></i>' + escapeHtml(item.label) + '</button>').join('') + '</figcaption>';
}

function chartFrame(series, svg, className = '', height) {
  return '<figure class="plot ' + className + '"' + (Number.isFinite(height) ? ' style="--plot-height:' + height + 'px"' : '')
    + '>' + chartLegend(series) + '<div class="plot-area">' + svg + '</div></figure>';
}

function ring(series, labels, height) {
  const slices = labels.map((label, index) => {
    const value = series[0]?.values[index];
    return { label, value: Number.isFinite(value) ? Math.max(0, value) : 0, color: seriesColor({}, index) };
  }).filter(slice => slice.value > 0);
  const total = slices.reduce((sum, item) => sum + item.value, 0);
  if (!total) return '<div class="empty-state">当前条件暂无可绘制的数据</div>';
  let offset = 0;
  const segments = slices.map(({ label, value, color }, index) => {
    const share = value / total * 100;
    const circle = '<circle data-chart-series="' + index + '" cx="120" cy="96" r="66" pathLength="100" fill="none" stroke="' + color
      + '" stroke-width="31" stroke-dasharray="' + share + ' ' + (100 - share) + '" stroke-dashoffset="' + -offset
      + '" transform="rotate(-90 120 96)"><title>' + escapeHtml(label + ' · ' + fmt(value) + ' (' + fmt(share, 'pct') + ')')
      + '</title></circle>';
    offset += share;
    return circle;
  }).join('');
  return chartFrame(slices, '<svg viewBox="0 0 240 192" role="img" aria-label="构成占比图">'
    + '<circle cx="120" cy="96" r="66" fill="none" stroke="#e5eaf1" stroke-width="31"/>' + segments
    + '<text x="120" y="101" text-anchor="middle">' + escapeHtml(fmt(total)) + '</text></svg>', 'plot-ring', height);
}

function axisLimits(data, stacked, labels) {
  const values = [0];
  if (stacked) {
    for (let index = 0; index < labels.length; index++) {
      let positive = 0;
      let negative = 0;
      for (const item of data) {
        const value = item.values[index];
        if (value === null) continue;
        if (item.type !== 'bar') values.push(value);
        else if (value >= 0) positive += value;
        else negative += value;
      }
      values.push(positive, negative);
    }
  } else {
    for (const item of data) for (const value of item.values) if (value !== null) values.push(value);
  }
  let min = 0;
  let max = 0;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const interval = (max - min) / 4;
  if (!interval) return { min: 0, max: 1 };
  const factor = 10 ** Math.floor(Math.log10(interval));
  const normalized = interval / factor;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * factor;
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step };
}

export function plot(series, { labels = [], type = 'line', stacked = false, height } = {}) {
  if (type === 'ring' || type === 'doughnut') return ring(series, labels, height);
  const data = series.map((item, index) => ({
    ...item,
    type: item.type || type,
    axis: item.axis === 'right' ? 'right' : 'left',
    color: seriesColor(item, index),
    values: labels.map((_, offset) => {
      const value = item.values[offset];
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    }),
  })).filter(item => item.values.some(value => value !== null));
  if (!labels.length || !data.length) return '<div class="empty-state">当前条件暂无可绘制的数据</div>';

  const width = 1000;
  const heightSvg = 260;
  const left = 78;
  const top = 19;
  const bottom = 222;
  const secondary = data.some(item => item.axis === 'right');
  const right = secondary ? 934 : 974;
  const limits = Object.fromEntries(['left', 'right'].map(axis =>
    [axis, axisLimits(data.filter(item => item.axis === axis), stacked, labels)]));
  const y = (value, axis) => {
    const { min, max } = limits[axis];
    return bottom - (value - min) / (max - min) * (bottom - top);
  };
  const stride = (right - left) / labels.length;
  const x = index => left + (index + 0.5) * stride;
  const axis = Array.from({ length: 5 }, (_, index) => {
    const value = (name) => limits[name].min + (limits[name].max - limits[name].min) * index / 4;
    const level = y(value('left'), 'left');
    return '<line x1="' + left + '" x2="' + right + '" y1="' + level + '" y2="' + level
      + '" stroke="#e5eaf1"/><text x="' + (left - 10) + '" y="' + (level + 4) + '" text-anchor="end">'
      + decimal.format(value('left')) + '</text>' + (secondary
        ? '<text x="' + (right + 10) + '" y="' + (level + 4) + '">' + decimal.format(value('right')) + '</text>' : '');
  }).join('');
  const step = Math.max(1, Math.ceil(labels.length / 12));
  const axisLabels = labels.map((label, index) => index % step === 0
    ? '<text x="' + x(index) + '" y="246" text-anchor="middle">' + escapeHtml(label) + '</text>'
    : '').join('');

  const bars = data.filter(item => item.type === 'bar');
  const barWidth = Math.min(48, stride * 0.68 / (stacked ? 1 : bars.length || 1));
  const offsets = { left: new Map(), right: new Map() };
  const marks = data.map((item, seriesIndex) => {
    let path = '';
    let connected = false;
    const points = item.values.map((value, index) => {
      if (value === null) {
        connected = false;
        return '';
      }
      const tip = '<title>' + escapeHtml(labels[index] + ' · ' + item.label + ' ' + fmt(value, item.kind)) + '</title>';
      const valueY = y(value, item.axis);
      if (item.type === 'bar') {
        const position = x(index) + (stacked ? -barWidth / 2 : (bars.indexOf(item) - bars.length / 2) * barWidth);
        const offsetKey = index + (value < 0 ? '-' : '+');
        const base = stacked ? offsets[item.axis].get(offsetKey) || 0 : 0;
        if (stacked) offsets[item.axis].set(offsetKey, base + value);
        const a = y(base, item.axis);
        const b = y(base + value, item.axis);
        return '<rect x="' + position + '" y="' + Math.min(a, b) + '" width="' + Math.max(0.5, barWidth - 1)
          + '" height="' + Math.abs(a - b) + '" rx="2">' + tip + '</rect>';
      }
      path += (connected ? ' L' : ' M') + x(index) + ',' + valueY;
      connected = true;
      return '<circle cx="' + x(index) + '" cy="' + valueY + '" r="' + (labels.length > 80 ? 1.8 : 3)
        + '">' + tip + '</circle>';
    }).join('');
    return '<g data-chart-series="' + seriesIndex + '" fill="' + item.color + '">' + (path
      ? '<path d="' + path + '" fill="none" stroke="' + item.color + '" stroke-width="2.3" stroke-linejoin="round"/>' : '') + points + '</g>';
  }).join('');
  return chartFrame(data, '<svg viewBox="0 0 ' + width + ' ' + heightSvg + '" role="img" aria-label="'
    + escapeHtml(data.map(item => item.label).join('、')) + '图表">' + axis + axisLabels + marks + '</svg>', '', height);
}

export function enableChartLegends(root) {
  root.addEventListener('click', event => {
    const toggle = event.target.closest('[data-series-toggle]');
    if (!toggle) return;
    const marks = toggle.closest('.plot').querySelector('[data-chart-series="' + toggle.dataset.seriesToggle + '"]');
    if (!marks) return;
    const shown = toggle.getAttribute('aria-pressed') === 'true';
    toggle.setAttribute('aria-pressed', String(!shown));
    marks.classList.toggle('plot-series-hidden', shown);
  });
}
