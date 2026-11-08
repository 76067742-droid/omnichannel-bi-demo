import { aggregate, compare, filterDates } from './data.js';
import { card, escapeHtml, fmt, plot, table, tiles } from './ui.js';
import { renderFinance } from './finance.js';
import { renderAttribution, attributionSummary, attributionDiagnostics, combinedPromotionRange, paidProgressStatus, renderPaidDrilldowns } from './attribution.js';

const palette = ['#8b5cf6', '#06b6d4', '#f97316', '#14b8a6', '#4f46e5'];
const portNames = {
  dabo: '达播',
  paid: '站内付费',
  seeding: '种草',
  self: '自播',
  taoke: '淘客',
};

const labels = {
  gmv: ['成交金额', 'money'],
  receipts: ['回款', 'money'],
  visitors: ['访客数', 'number'],
  buyers: ['支付买家', 'number'],
  orders: ['支付笔数', 'number'],
  spend: ['花费', 'money'],
  profit: ['利润额', 'money'],
  refunds: ['退款额', 'money'],
  clicks: ['点击量', 'number'],
  netRevenue: ['未税收入', 'money'],
  cost: ['成本', 'money'],
  expenses: ['费用', 'money'],
  taxes: ['税费', 'money'],
  conversion: ['转化率', 'pct'],
  refundRate: ['退货率', 'pct'],
  oldRatio: ['老客占比', 'pct'],
  margin: ['利润率', 'pct'],
  ctr: ['点击率', 'pct'],
  cpc: ['平均点击花费', 'money'],
  asp: ['客单价', 'money'],
  roi: ['ROI', 'roi'],
  attributedSales: ['直接成交', 'money'],
};

function rowsInRange(rows, { start, end }) {
  return filterDates(rows, start, end);
}

function priorYear(date) {
  const year = Number(date.slice(0, 4)) - 1;
  const month = Number(date.slice(5, 7));
  const day = Math.min(Number(date.slice(8, 10)), new Date(year, month, 0).getDate());
  return `${year}-${date.slice(5, 7)}-${String(day).padStart(2, '0')}`;
}

function priorYearRange(range) {
  return { start: priorYear(range.start), end: priorYear(range.end) };
}

function groupRows(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function summaries(rows, keyOf) {
  return Array.from(groupRows(rows, keyOf), ([key, items]) => ({
    key, items, totals: aggregate(items),
  }));
}

function timeSeries(rows, monthly = false) {
  return summaries(rows, row => monthly ? row.date.slice(0, 7) : row.date)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function formatMetric(totals, key) {
  const value = totals[key];
  return Number.isFinite(value) ? fmt(value, labels[key][1]) : '—';
}

function ratio(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator * 100 : null;
}

function percent(value) {
  return Number.isFinite(value) ? fmt(value, 'pct') : '—';
}

function tileMetrics(totals, keys, names = {}) {
  return tiles(keys.map(key => ({
    label: names[key] || labels[key][0], value: formatMetric(totals, key),
  })));
}

function dataTable(keyTitle, entries, keys) {
  return table([keyTitle, ...keys.map(key => labels[key][0])], entries.map(({ key, totals }) => [
    key, ...keys.map(metric => formatMetric(totals, metric)),
  ]));
}

function ranking(entries, key, maximum) {
  return entries.sort((a, b) => (b.totals[key] ?? 0) - (a.totals[key] ?? 0)).slice(0, maximum);
}

function selectControl(key, label, options, current) {
  return `<label><span class="filter-label">${escapeHtml(label)}</span> <select data-operation-control="${escapeHtml(key)}">${options
    .map(([value, name]) => `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(name)}</option>`)
    .join('')}</select></label>`;
}

function periodText({ start, end }) {
  return `${start} 至 ${end}`;
}

function storeSummaryRow(title, totals, metrics) {
  return `<div class="store-summary-row"><strong>${escapeHtml(title)}</strong>`
    + metrics.map((key, i) => `<span class="store-metric"><i style="background:${palette[i % palette.length]}"></i>`
      + `${escapeHtml(labels[key][0])} <b>${escapeHtml(formatMetric(totals, key))}</b></span>`).join('')
    + '</div>';
}

function panel(title, body) {
  return '<section class="chart-panel"><h3>' + escapeHtml(title) + '</h3>' + body + '</section>';
}

function seriesValues(entries, key, options = {}) {
  return { label: labels[key]?.[0] || key, values: entries.map(({ totals }) => totals[key]), ...options };
}

function entryChart(entries, specs, options = {}) {
  return plot(specs.map(spec => Array.isArray(spec) ? seriesValues(entries, ...spec) : seriesValues(entries, spec)),
    { labels: entries.map(({ key }) => key), ...options });
}

function checkedRange(rows, range) {
  return rows.length ? { start: rows[0].date, end: rows.at(-1).date } : range;
}

function renderStoreBreakdown(data, rows, range) {
  const ports = rowsInRange(data.ports, range);
  if (!ports.length) return panel('店铺类型拆解', '<p class="hint">当前数据缺少达播和淘客明细，暂不能拆分货架。</p>');
  const names = ['货架', '达播', '淘客'];
  const byDate = groupRows(ports.filter(port => names.includes(port.group)), port => port.date);
  const split = new Map();
  for (const row of rows) {
    const result = [];
    const remainder = { ...row, name: '货架' };
    const parts = byDate.get(row.date) || [];
    for (const name of names.slice(1)) {
      const matching = parts.filter(port => port.group === name);
      const source = aggregate(matching);
      const fields = ['gmv', 'receipts', 'spend'];
      const line = { date: row.date, name };
      for (const field of fields) {
        line[field] = source[field];
        if (Number.isFinite(remainder[field]) && Number.isFinite(source[field])) remainder[field] -= source[field];
      }
      result.push(line);
    }
    split.set(row.date, [remainder, ...result]);
  }
  const daily = [...split].reverse();
  const months = groupRows([...split.values()].flat(), row => row.date.slice(0, 7));
  const chart = plot(names.map((name, index) => ({
    label: name, color: palette[index], values: [...split.values()].map(items => items.find(row => row.name === name)?.receipts),
  })), { labels: [...split.keys()].map(date => date.slice(5)), height: 270 });
  const headers = ['周期', ...names.flatMap(name => [name + '成交', name + '回款', name + '花费'])];
  const amounts = groups => names.flatMap(name => {
    const values = aggregate(groups.filter(row => row.name === name));
    return ['gmv', 'receipts', 'spend'].map(key => fmt(values[key], 'money'));
  });
  return panel('店铺类型拆解（货架 = 整体 − 达播 − 淘客）',
    '<p class="hint">分端口金额使用各自的成交与回款字段，差额用于核对店铺整体。</p><h3>🗓️ 日维度</h3>'
    + '<div class="table-scroll">' + table(headers, daily.map(([date, parts]) => [date, ...amounts(parts)])) + '</div>'
    + '<h3>📊 月维度</h3>' + table(headers, [...months].reverse().map(([month, parts]) => [month, ...amounts(parts)]))
    + '<h3>各类型回款日趋势</h3>' + chart);
}

function renderStoreOverall({ data, range, toolbar, granularity }) {
  const rows = rowsInRange(data.store, range).slice().sort((a, b) => a.date.localeCompare(b.date));
  const window = checkedRange(rows, range);
  const previous = aggregate(rowsInRange(data.store, priorYearRange(window)));
  const totals = aggregate(rows);
  const monthly = granularity === 'month';
  const entries = timeSeries(rows, monthly);
  const keys = ['visitors', 'gmv', 'receipts', 'conversion', 'asp', 'oldRatio', 'refundRate', 'spend', 'roi'];
  const moneyTrend = entryChart(entries, ['gmv', 'receipts', ['refundRate', { axis: 'right', kind: 'pct' }]], { height: 335 });
  const visitsTrend = entryChart(entries, ['visitors', 'buyers', ['conversion', { axis: 'right', kind: 'pct' }],
    ['asp', { axis: 'right', kind: 'money' }]], { height: 355 });
  const overview = '<div class="store-summary">'
    + (rows.length ? storeSummaryRow('最近完整日（' + rows.at(-1).date + '）', aggregate(rows.slice(-1)), keys) : '')
    + storeSummaryRow('区间累计（' + rows.length + '天）', totals, keys)
    + '<p>成交同比 ' + percent(compare(totals.gmv, previous.gmv)) + ' · 回款同比 ' + percent(compare(totals.receipts, previous.receipts)) + '</p></div>';
  return card('📊 2.1 整体数据', toolbar + overview
    + panel('GMV、回款 & 退货率趋势', moneyTrend)
    + panel('UV、支付买家、转化率 & 客单价趋势', visitsTrend)
    + '<details><summary>查看店铺明细</summary>' + dataTable(monthly ? '月份' : '日期', [...entries].reverse(), keys) + '</details>'
    + renderStoreBreakdown(data, rows, window) + renderFinance(data, range));
}

function renderTraffic({ data, range, toolbar }) {
  const rows = rowsInRange(data.traffic, range);
  const bySource = ranking(summaries(rows, row => row.name), 'visitors', 10);
  const days = [...new Set(rows.map(row => row.date))].sort();
  const buckets = groupRows(rows, row => row.group);
  const groups = [...buckets].map(([label, values], index) => {
    const visits = new Map(timeSeries(values).map(({ key, totals }) => [key, totals.visitors]));
    return { label, color: ['#16ad8b', '#f45f63', '#a5b4fc'][index], values: days.map(day => visits.get(day)) };
  });
  const paid = attributionSummary(data, range, { window: 1 }).scenes;
  const shares = plot([{ label: '访客数', values: bySource.map(({ totals }) => totals.visitors) }],
    { labels: bySource.map(({ key }) => key), type: 'ring', height: 290 });
  return card('🔍 2.2 流量来源', toolbar
    + '<div class="store-subhead">免费 vs 付费流量对比（访客数）</div>'
    + plot(groups, { labels: days.map(day => day.slice(5)), type: 'bar', stacked: true, height: 310 })
    + '<div class="two-col">' + panel('TOP10 流量来源（访客量）', shares)
    + panel('TOP10 来源明细', dataTable('来源', bySource, ['visitors', 'conversion', 'gmv', 'asp'])) + '</div>'
    + panel('推广端口明细（独立 1 天归因）', table(
      ['端口', '花费', '直接成交', 'ROI', '点击量', '点击率', '平均点击花费'], paid.map(item =>
        [item.scene, fmt(item.spend, 'money'), fmt(item.txn, 'money'), fmt(item.roi, 'roi'), fmt(item.clicks), fmt(item.ctr, 'pct'), fmt(item.cpc, 'money')]))),
  periodText(range));
}

function renderCrowd({ data, range, toolbar }) {
  const rows = rowsInRange(data.audience, range);
  const memberships = rows.filter(row => row.group === '会员');
  const members = memberships.filter(row => row.name === '会员');
  const previous = rowsInRange(data.audience, priorYearRange(range)).filter(row => row.name === '会员');
  const customers = rows.filter(row => row.group === '新老客');
  const memberTotals = aggregate(members);
  const memberDays = timeSeries(members);
  const membershipsGmv = aggregate(memberships).gmv;
  const customerDays = [...new Set(customers.map(row => row.date))].sort();
  const customerGroups = [...groupRows(customers, row => row.name)];
  const byCustomer = (key, type = 'line') => plot(customerGroups.map(([label, items]) => {
    const dates = new Map(timeSeries(items).map(({ key: date, totals }) => [date, totals[key]]));
    return { label: label + ' ' + (labels[key]?.[0] || key), values: customerDays.map(day => dates.get(day)) };
  }), { labels: customerDays.map(day => day.slice(5)), type, stacked: type === 'bar' });
  const membershipTiles = [
    { label: '入会率', value: percent(ratio(memberTotals.newMembers, memberTotals.visitors)), detail: '入会 ' + fmt(memberTotals.newMembers) + ' 人' },
    { label: '会员成交', value: fmt(memberTotals.gmv, 'money'), detail: '同比 ' + percent(compare(memberTotals.gmv, aggregate(previous).gmv)) },
    { label: '成交贡献率', value: percent(ratio(memberTotals.gmv, membershipsGmv)) },
    { label: '会员客单', value: fmt(memberTotals.asp, 'money'), detail: '支付买家 ' + fmt(memberTotals.buyers) },
  ];
  const details = table(['日期', '入会人数', '会员成交', '支付买家', '会员客单'], [...memberDays].reverse().map(({ key, totals }) =>
    [key, fmt(totals.newMembers), fmt(totals.gmv, 'money'), fmt(totals.buyers), fmt(totals.asp, 'money')]));
  return card('👥 2.3 人群运营', toolbar + panel('会员分析',
    '<div class="port-cards">' + tiles(membershipTiles) + '</div><div class="two-col">'
    + panel('会员成交与入会趋势', entryChart(memberDays, ['gmv', ['newMembers', { label: '入会人数', axis: 'right' }]]))
    + panel('会员数据明细', '<div class="table-scroll">' + details + '</div>') + '</div>'
    + panel('新会员与老会员成交构成', entryChart(memberDays.map(item => {
      const current = item.totals;
      return { ...item, totals: { ...current, existingMemberGmv: current.gmv != null && current.newMemberGmv != null ? current.gmv - current.newMemberGmv : null } };
    }), [['newMemberGmv', { label: '新会员成交' }], ['existingMemberGmv', { label: '老会员成交' }]], { type: 'bar', stacked: true })))
    + panel('新老客分析',
      '<div class="two-col">' + panel('新老客成交金额对比', byCustomer('gmv', 'bar')) + panel('新老客客单价趋势', byCustomer('asp')) + '</div>'
      + dataTable('人群', summaries(customers, row => row.name), ['gmv', 'buyers', 'asp', 'conversion'])), periodText(range));
}

function renderProducts({ data, range, options, toolbar }) {
  const rows = rowsInRange(data.products, range);
  const categories = ranking(summaries(rows, row => row.group || '未分类'), 'gmv', Infinity);
  const category = categories.some(({ key }) => key === options.productCategory) ? options.productCategory : '';
  const selectedRows = category ? rows.filter(row => (row.group || '未分类') === category) : rows;
  const products = ranking(summaries(selectedRows, row => row.id || row.name), 'gmv', 10);
  const categoryControl = selectControl('productCategory', '单品分类', [['', '全部分类'], ...categories.map(({ key }) => [key, key])], category);
  const metrics = ['gmv', 'receipts', 'refundRate', 'visitors', 'conversion', 'asp', 'spend'];
  const days = [...new Set(rows.map(row => row.date))].sort();
  const trends = plot(products.map(({ items }) => {
    const values = new Map(timeSeries(items).map(({ key, totals }) => [key, totals.gmv]));
    return { label: items[0].name, values: days.map(day => values.get(day)) };
  }), { labels: days.map(day => day.slice(5)), height: 315 });
  const paidShare = (spend, sales) => percent(ratio(spend, sales));
  const summary = '<div class="analysis-box">' + categories.map(({ key, totals, items }) =>
    escapeHtml(key) + ' ' + new Set(items.map(row => row.id)).size + ' 款 · ' + fmt(totals.gmv, 'money')).join('　') + '</div>';
  return card('📦 2.4 单品数据', toolbar + '<div class="form-row">' + categoryControl + '</div>' + summary
    + '<div class="table-scroll">' + table(['排名', '商品ID', '商品简称', '业务类型', '单品分类', ...metrics.map(key => labels[key][0]), '付费占比', '日均成交'],
      products.map(({ key, items, totals }, i) => [i + 1, key, items[0].name, items[0].businessType || items[0].group,
        items[0].group || '未分类', ...metrics.map(metric => formatMetric(totals, metric)), paidShare(totals.spend, totals.gmv),
        fmt(totals.gmv == null ? null : totals.gmv / days.length, 'money')])) + '</div>' + trends, periodText(range))
    + card('🧭 2.4 单品分类明细', '<div class="product-board">' + categories.map(({ key, items, totals }) =>
      '<article class="product-lane"><h3>' + escapeHtml(key) + ' · ' + fmt(totals.gmv, 'money') + '</h3><ul>'
      + ranking(summaries(items, row => row.id), 'gmv', Infinity).map(item =>
        '<li><span>' + escapeHtml(item.items[0].name) + '</span><b>' + fmt(item.totals.gmv, 'money') + '</b></li>').join('')
      + '</ul></article>').join('') + '</div>', '全量分类池 · 不受 TOP10 限制');
}

function renderActivities({ data, range, options, toolbar }) {
  const active = data.activities.filter(({ start, end }) => start <= range.end && end >= range.start);
  const selected = active.find(activity => activity.start === options.activityStart) || active[0];
  const aligned = options.activityCompareMode === 'event';
  const control = '<div class="operation-period">'
    + selectControl('activityStart', '活动', active.length ? active.map(({ start, name }) => [start, start.slice(0, 4) + ' ' + name]) : [['', '全部活动']], selected?.start || '')
    + selectControl('activityCompareMode', '口径', [['date', '同月同日同比'], ['event', '同活动同期']], aligned ? 'event' : 'date') + '</div>';
  const stats = active.map(activity => {
    const window = { start: activity.start > range.start ? activity.start : range.start, end: activity.end < range.end ? activity.end : range.end };
    const rows = rowsInRange(data.store, window);
    const previousEvent = data.activities.find(item => item.name === activity.name && item.start.slice(0, 4) === priorYear(activity.start).slice(0, 4));
    const shift = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
    const priorWindow = aligned && previousEvent ? {
      start: shift(previousEvent.start, (Date.parse(window.start) - Date.parse(activity.start)) / 86400000),
      end: shift(previousEvent.start, (Date.parse(window.end) - Date.parse(activity.start)) / 86400000),
    } : priorYearRange(window);
    const prior = aligned && !previousEvent ? [] : rowsInRange(data.store, priorWindow);
    return { activity, window, rows, totals: aggregate(rows), prior: aggregate(prior) };
  });
  const result = stats.find(item => item.activity === selected);
  const keys = ['gmv', 'receipts', 'visitors', 'conversion', 'asp', 'refundRate'];
  return [
    card('🎯 2.5 活动分析', toolbar + control + '<h3>活动汇总表（点击活动查看明细）</h3>' + table(
      ['活动', '周期', '天数', '成交同比', ...keys.map(key => labels[key][0])],
      stats.map(({ activity, window, rows, totals, prior }) => [
        activity.name, periodText(window), rows.length, percent(compare(totals.gmv, prior.gmv)), ...keys.map(key => formatMetric(totals, key)),
      ])), periodText(range)),
    result && card(selected.name + ' · 整体表现', tileMetrics(result.totals, keys) + entryChart(timeSeries(result.rows), ['gmv', 'receipts'])
      + dataTable('日期', timeSeries(result.rows), keys)),
    result && card('推广端口贡献', dataTable('端口', ranking(summaries(rowsInRange(data.ports, result.window), row => row.group), 'gmv', Infinity),
      ['gmv', 'receipts', 'spend', 'roi'])),
    result && card('流量与会员表现', '<div class="two-col">' + panel('流量构成', dataTable('来源',
      summaries(rowsInRange(data.traffic, result.window), row => row.group), ['visitors', 'gmv', 'conversion']))
      + panel('人群结构', dataTable('人群', summaries(rowsInRange(data.audience, result.window), row => row.name), ['buyers', 'gmv', 'asp'])) + '</div>'),
    result && card('单品贡献', dataTable('商品', ranking(summaries(rowsInRange(data.products, result.window), row => row.name), 'gmv', 10),
      ['gmv', 'receipts', 'conversion'])),
  ].filter(Boolean).join('');
}

const storeViews = {
  overall: renderStoreOverall,
  traffic: renderTraffic,
  crowd: renderCrowd,
  product: renderProducts,
  activity: renderActivities,
};

const portViews = {
  dabo: { icon: '📊', ranking: '👤 达人分层分析', entity: '达人', field: 'creator', trend: '日趋势与同比变化', metrics: ['gmv', 'receipts', 'refundRate', 'asp', 'spend', 'roi', 'profit', 'margin'], top: 20, roiBasis: 'receipts' },
  paid: { icon: '📊', ranking: '🧭 分场景端口数据', entity: '推广场景', field: 'name', trend: '📈 整体分日趋势', metrics: ['spend', 'attributedSales', 'roi', 'clicks', 'ctr', 'cpc', 'orders', 'gmv'], top: 20, roiBasis: 'attributedSales' },
  seeding: { icon: '🌱', ranking: '🧩 逛逛内容细分', entity: '内容来源', field: 'contentType', trend: '📈 最新月日成交趋势', metrics: ['visitors', 'buyers', 'conversion', 'gmv', 'spend', 'roi'], top: 10, roiBasis: 'gmv' },
  self: { icon: '🎙️', ranking: '👤 主播分析', entity: '主播', field: 'creator', trend: '📈 单日数据趋势', metrics: ['visitors', 'buyers', 'gmv', 'conversion', 'asp', 'refundRate'], top: 50, roiBasis: 'gmv' },
  taoke: { icon: '📊', ranking: '📦 单品数据', entity: '商品', field: 'product', trend: '分日数据', metrics: ['gmv', 'orders', 'spend', 'asp', 'roi'], top: 50, roiBasis: 'gmv' },
};

function portTotals(totals, port) {
  const roiPercent = ratio(totals[port.roiBasis], totals.spend);
  return {
    ...totals,
    roi: roiPercent === null ? null : roiPercent / 100,
    margin: port.roiBasis === 'receipts' ? ratio(totals.profit, totals.receipts) : totals.margin,
  };
}

function monthEnd(key) {
  const date = new Date(key + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

function sumField(rows, field) {
  const values = rows.map(row => row[field]).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function monthSetting(context) {
  const { data, options, latest, range, customRange } = context;
  const months = [...new Set(data.store.map(row => row.date.slice(0, 7)))].sort().reverse();
  const month = months.includes(options.portMonth) ? options.portMonth : latest.slice(0, 7);
  const end = monthEnd(month);
  const selected = customRange ? range : { start: month + '-01', end: end < latest ? end : latest };
  const control = selectControl('portMonth', '月份', months.map(key => [key, key.slice(0, 4) + '年' + Number(key.slice(5)) + '月']), month);
  return { month, control, selected };
}

function groupKpi(data, name, group, field, current, previous, range, multiplier = 1) {
  const goalRange = { start: range.start.slice(0, 7) + '-01', end: range.end };
  const target = aggregate(rowsInRange(data.portTargets, goalRange).filter(row => row.group === group));
  const targetField = field === 'receipts' ? 'receipts' : 'gmv';
  const goal = target[targetField] == null ? null : target[targetField] * multiplier;
  const spendGoal = target.spend == null ? null : target.spend * multiplier;
  const rate = ratio(current?.[field], goal);
  const spendRate = ratio(current?.spend, spendGoal);
  const targetRoi = goal != null && spendGoal > 0 ? goal / spendGoal : null;
  const timeProgress = ratio(Date.parse(range.end) - Date.parse(range.start) + 86400000,
    Date.parse(monthEnd(range.end.slice(0, 7))) - Date.parse(range.start) + 86400000);
  const roi = current?.roi;
  return { name, rate, goal, spendGoal, spendRate, roi, actual: current?.[field], spend: current?.spend,
    targetRoi, yoy: compare(current?.[field], previous?.[field]), missing: current?.missingDays,
    status: current?.missingDays ? '口径缺项' : paidProgressStatus({ rate, spendRate, roi, targetRoi, timeProgress }) };
}

function kpiRows(items, leading = '') {
  const cards = leading || '<div class="tiles">' + items.map(item => {
    const { name, rate, goal, spendGoal, roi, actual, targetRoi, status } = item;
    const warning = /预警|缺项/.test(status);
    return `<article class="progress-card${warning ? ' behind' : ''}">
      <div class="progress-numbers"><b class="progress-title">${escapeHtml(name)}</b><small class="${warning ? 'negative' : 'positive'}">${status}</small></div>
      <div class="progress-value">${fmt(actual, 'money')}</div>
      <div class="progress-detail">目标 ${fmt(goal, 'money')} · 达成 ${fmt(rate, 'pct')} · 花费目标 ${fmt(spendGoal, 'money')}</div>
      <div class="progress-detail">ROI ${fmt(roi, 'roi')} / 目标 ${fmt(targetRoi, 'roi')}</div>
      <div class="track" aria-hidden="true"><i style="width:${Math.max(0, Math.min(rate ?? 0, 100))}%"></i></div></article>`;
  }).join('') + '</div>';
  return '<h3>KPI 达成进度</h3>' + cards + '<h3>目标与费用效率明细</h3>' + table(
    ['板块', '目标', '实际成交', '达成率', '目标花费', '实际花费', '花费进度', '目标 ROI', '实际 ROI', '成交同比', '预警'],
    items.map(item => [item.name, fmt(item.goal, 'money'), fmt(item.actual, 'money'), fmt(item.rate, 'pct'), fmt(item.spendGoal, 'money'),
      fmt(item.spend, 'money'), fmt(item.spendRate, 'pct'), fmt(item.targetRoi, 'roi'), fmt(item.roi, 'roi'), percent(item.yoy), item.status]));
}

function paidKpi(data, selected, latest, groups) {
  const range = combinedPromotionRange(selected);
  const effective = { ...range, end: range.end < latest ? range.end : latest };
  const current = attributionSummary(data, effective, { window: 15 });
  const previous = attributionSummary(data, priorYearRange(effective), { window: 15 });
  const targetGroups = { 站内付费: ['站内付费', 1], 自播付费: ['自播', 0.52], 逛逛付费: ['种草', 0.28] };
  const rows = groups.map(group => {
    const [target, multiplier] = targetGroups[group];
    return groupKpi(data, group, target, 'txn', current.channels.find(item => item.group === group),
      previous.channels.find(item => item.group === group), effective, multiplier);
  });
  return { rows, diagnostics: attributionDiagnostics(current), range: effective };
}

function renderPaid(context, dates) {
  const { data, toolbar, latest } = context;
  const { selected } = dates;
  const { rows, diagnostics, range } = paidKpi(data, selected, latest, ['站内付费', '自播付费', '逛逛付费']);
  const evaluation = '<div class="port-judgments">' + rows.map(item =>
    '<div><b>' + escapeHtml(item.name) + '</b><p>' + escapeHtml(item.status) + ' · 实际 ROI ' + fmt(item.roi, 'roi')
    + ' · 花费进度 ' + fmt(item.spendRate, 'pct') + '</p></div>').join('') + '</div>';
  return card('📊 整体数据', toolbar + kpiRows(rows) + evaluation + diagnostics,
    'KPI 与报告使用 ' + periodText(range) + ' 的 15 天直接归因，自播付费使用 1 天。')
    + renderAttribution(data, selected, { window: 1, showTrend: true })
    + renderPaidDrilldowns(data, selected);
}

function renderPort(context) {
  const { data, options, tab, toolbar, latest } = context;
  const dates = monthSetting(context);
  const key = Object.hasOwn(portViews, tab) ? tab : 'dabo';
  if (key === 'paid') return renderPaid(context, dates);
  const { selected, month, control } = dates;
  const port = portViews[key];
  const name = portNames[key];
  const allRows = data.ports.filter(row => row.group === name && (key !== 'seeding' || row.contentType));
  const rows = rowsInRange(allRows, selected);
  const withRoi = entries => entries.map(entry => ({ ...entry, totals: portTotals(entry.totals, port) }));
  const totals = portTotals(aggregate(rows), port);
  const prior = portTotals(aggregate(rowsInRange(allRows, priorYearRange(selected))), port);
  const series = withRoi(timeSeries(rows));
  const entities = ranking(withRoi(summaries(rows.filter(row => row[port.field]), row => row[port.field])), 'gmv', port.top);
  const products = ranking(withRoi(summaries(rows.filter(row => row.product), row => row.product)), 'gmv', port.top);
  const entity = entities.find(item => item.key === options.portEntity);
  const entityControl = selectControl('portEntity', port.entity + '趋势', [['', '选择查看'], ...entities.map(item => [item.key, item.key])], entity?.key || '');
  const organicName = key === 'seeding' ? '逛逛内容' : key === 'self' ? '自播整体' : name;
  const paidGroup = key === 'seeding' ? '逛逛付费' : key === 'self' ? '自播付费' : '';
  const basis = key === 'dabo' ? 'receipts' : 'gmv';
  const topGroups = paidGroup ? paidKpi(data, selected, latest, [paidGroup]) : null;
  const kpiActual = topGroups ? portTotals(aggregate(rowsInRange(allRows, topGroups.range)), port) : totals;
  const kpiPrior = topGroups ? portTotals(aggregate(rowsInRange(allRows, priorYearRange(topGroups.range))), port) : prior;
  const core = groupKpi(data, organicName, name, basis, kpiActual, kpiPrior, topGroups?.range || selected, key === 'seeding' ? 0.72 : 1);
  const leading = key === 'dabo' || key === 'taoke' ? '<div class="port-cards">' + tileMetrics(totals,
    key === 'dabo' ? ['receipts', 'spend', 'roi', 'profit', 'margin'] : ['gmv', 'spend', 'roi', 'asp'],
    key === 'taoke' ? { gmv: '付款金额', spend: '支出费用' } : {}) + '</div>' : '';
  const head = card(key === 'taoke' ? 'TK 整体数据' : port.icon + ' 整体数据',
    '<div class="operation-period">' + control + '<span class="hint">' + escapeHtml(periodText(selected)) + '</span></div>'
    + toolbar + kpiRows([core, ...(topGroups?.rows || [])], leading) + (topGroups?.diagnostics || '')
    + '<div class="analysis-box">' + organicName + '成交 ' + fmt(kpiActual[basis], 'money') + '，实际 ROI ' + fmt(kpiActual.roi, 'roi')
    + '。本页独立明细使用所选月份数据。</div>');
  const expanded = entity ? panel(entity.key + ' · 分日趋势',
    entryChart(withRoi(timeSeries(entity.items)), ['gmv', ['spend', { type: 'bar' }], ['roi', { axis: 'right' }]])
    + dataTable('日期', withRoi(timeSeries(entity.items)), port.metrics)) : '';

  if (key === 'dabo') {
    const chart = entryChart(series, ['receipts', ['spend', { type: 'bar' }], ['roi', { axis: 'right' }]], { height: 280 });
    const details = '<div class="two-col">' + chart + '<div class="table-scroll">' + dataTable('日期', [...series].reverse(), port.metrics) + '</div></div>';
    return head + card('日趋势与同比变化', details)
      + card('👤 达人分层分析', entryChart(entities, [['gmv', { type: 'bar' }], ['conversion', { axis: 'right' }]], { height: 260 })
        + '<div class="form-row">' + entityControl + '</div>' + dataTable('达人', entities, port.metrics) + expanded)
      + card('📦 商品维度分析', entryChart(products, [['gmv', { type: 'bar' }], ['refundRate', { axis: 'right' }]], { height: 260 })
        + dataTable('商品', products, port.metrics)
        + '<h3>达人 × 商品明细</h3>' + dataTable('达人 / 商品', ranking(withRoi(summaries(
          rows.filter(row => row.product), row => row.creator + ' / ' + row.product)), 'gmv', 20), port.metrics));
  }

  if (key === 'taoke') {
    const keys = [['gmv', { label: '付款金额', type: 'bar' }], ['spend', { label: '支出费用', type: 'bar' }], ['asp', { axis: 'right' }], ['roi', { axis: 'right' }]];
    return head + card('D 分日数据', entryChart(series, keys) + dataTable('日期', [...series].reverse(), port.metrics))
      + card('P 分商品数据', '<div class="form-row">' + entityControl + '</div>' + dataTable('商品', products, port.metrics)
        + (expanded || entryChart(withRoi(timeSeries(products[0]?.items || [])), keys)));
  }

  if (key === 'seeding') {
    const creators = ranking(withRoi(summaries(rows.filter(row => row.creator), row => row.creator)), 'gmv', 10);
    const comparison = withRoi(timeSeries(allRows.filter(row => row.date.startsWith(month.slice(0, 4))), true));
    return head + card('📈 最新月日成交趋势', entryChart(series, [['gmv', { type: 'bar' }], ['buyers', { axis: 'right' }]]))
      + card('达人合作内容 / 自制内容 / 其他用户内容', '<div class="two-col">'
        + panel('内容成交结构', plot([{ label: '内容成交', values: entities.map(item => item.totals.gmv) }],
          { labels: entities.map(item => item.key), type: 'ring' }))
        + panel('最新月内容成交结构', entryChart(entities, [['gmv', { type: 'bar' }], ['conversion', { axis: 'right' }]])) + '</div>'
        + dataTable('内容来源', entities, port.metrics))
      + card('达人与单品种草能力', '<div class="two-col">'
        + panel('种草达人 TOP10', entryChart(creators, [['gmv', { type: 'bar' }], ['conversion', { axis: 'right' }]]))
        + panel('内容来源成交效率', entryChart(entities, [['visitors', { type: 'bar' }], ['roi', { axis: 'right' }]])) + '</div>'
        + dataTable('达人', creators, ['visitors', 'buyers', 'conversion', 'gmv', 'roi']))
      + card('📈 月度成交趋势', entryChart(comparison, ['gmv', ['spend', { type: 'bar' }]]));
  }

  const sessions = rowsInRange(data.selfSessions || [], selected);
  const sessionEntries = withRoi(timeSeries(sessions));
  const avgDuration = items => {
    const sum = items.reduce((total, row) => total + row.averageSeconds * row.visitors, 0);
    const visitors = sumField(items, 'visitors');
    return visitors ? sum / visitors : null;
  };
  const ownMetrics = sessionEntries.map(item => ({ ...item, totals: {
    ...item.totals, views: sumField(item.items, 'views'), duration: avgDuration(item.items),
    share: ratio(item.totals.gmv, aggregate(data.store.filter(row => row.date === item.key)).gmv),
  } }));
  const byType = summaries(sessions, row => row.sessionType);
  const anchors = ranking(summaries(sessions, row => row.creator), 'gmv', 50);
  const dayPart = options.selfDayPart === '晚间' ? '晚间' : '下午';
  const samePeriod = ranking(summaries(sessions.filter(row => row.dayPart === dayPart), row => row.creator), 'gmv', 50)
    .sort((a, b) => b.totals.gmv / b.items.length - a.totals.gmv / a.items.length);
  const sessionTable = table(['日期', '开播', '场次类型', '主播', '观看人数', '观看次数', '成交', '转化率', '平均观看时长'],
    [...sessions].sort((a, b) => b.gmv - a.gmv).slice(0, 50).map(row =>
      [row.date, row.time, row.sessionType, row.creator, fmt(row.visitors), fmt(row.views), fmt(row.gmv, 'money'),
        percent(ratio(row.buyers, row.visitors)), fmt(row.averageSeconds) + '秒']));
  return head + card('📈 单日数据趋势', '<div class="two-col">'
    + panel('观看人数 / 观看次数 / 成交金额', entryChart(ownMetrics,
      ['visitors', ['views', { label: '观看次数' }], ['gmv', { axis: 'right' }]]))
    + panel('转化率 / 人均观看时长 / 客单价 / 自播占比', entryChart(ownMetrics,
      ['conversion', ['share', { label: '自播占比' }], ['duration', { label: '人均观看时长', axis: 'right' }], ['asp', { axis: 'right' }]]))
    + '</div>' + dataTable('日期', [...sessionEntries].reverse(), ['visitors', 'buyers', 'gmv', 'conversion', 'asp']))
    + card('真人 / AI 数字人场次对比', '<div class="two-col">'
      + entryChart(byType, [['gmv', { type: 'bar' }], ['conversion', { axis: 'right' }]])
      + dataTable('场次类型', byType, ['visitors', 'buyers', 'gmv', 'conversion', 'asp']) + '</div>',
    '23:00 后至次日 08:00 前开播归为 AI 数字人（按样本场次标签统计）。')
    + card('本月场次明细 TOP50', '<div class="table-scroll">' + sessionTable + '</div>')
    + card('直播商品数据', dataTable('商品', products, ['visitors', 'gmv', 'conversion', 'asp', 'refundRate']))
    + card('本月主播个人数据', '<div class="two-col">'
      + panel('主播成交与效率', entryChart(anchors, [['gmv', { type: 'bar' }], ['conversion', { axis: 'right' }]]))
      + panel('直播商品表现', entryChart(products, [['gmv', { type: 'bar' }], ['refundRate', { axis: 'right' }]])) + '</div>'
      + dataTable('主播', anchors, ['visitors', 'gmv', 'conversion', 'asp'])
      + '<h3>相同时段主播对比（按平均单场成交排序）</h3><div class="form-row">'
      + selectControl('selfDayPart', '时段', [['下午', '下午'], ['晚间', '晚间']], dayPart) + '</div>'
      + entryChart(samePeriod, [['gmv', { type: 'bar' }], ['conversion', { axis: 'right' }]])
      + table(['主播', '场次数', '单场均成交', '总成交'], samePeriod.map(item =>
        [item.key, item.items.length, fmt(item.totals.gmv / item.items.length, 'money'), fmt(item.totals.gmv, 'money')])));
}

export function renderOperations(root, context) {
  const { page, tab, options, bindToolbar } = context;
  const draw = () => {
    const render = page === 'ports' ? renderPort : (storeViews[tab] || renderStoreOverall);
    root.innerHTML = render(context);
    bindToolbar();
  };
  root.onchange = event => {
    const select = event.target.closest('select[data-operation-control]');
    if (!select) return;
    const key = select.dataset.operationControl;
    options[key] = select.value;
    if (key === 'portMonth') options.portEntity = '';
    draw();
    root.querySelector('[data-operation-control="' + key + '"]')?.focus();
  };
  root.onclick = event => {
    if (page !== 'store' || tab !== 'activity') return;
    const row = event.target.closest('.card:first-child tbody tr');
    if (!row) return;
    const select = root.querySelector('[data-operation-control="activityStart"]');
    const selected = [...select.options].find(option => option.textContent.endsWith(' ' + row.cells[0].textContent));
    if (!selected) return;
    options.activityStart = selected.value;
    draw();
  };
  draw();
}
