import { aggregate, compare, demoData, filterDates } from './data.js';
import { attributionDiagnostics, attributionSummary, combinedPromotionRange, paidProgressStatus } from './attribution.js';
import { financeSummary, renderFinanceKpi } from './finance.js';
import { card, enableChartLegends, escapeHtml, fmt, plot, table, tiles } from './ui.js';
import { renderOperations } from './operations.js';
import { renderSupport } from './support.js';
import { renderAdmin } from './admin.js';
import { demoShops, demoShopData, getWorkspaceJson, platforms, renderShop, renderWorkspace, validDate } from './workspace.js';

const screens = {
  workspace: { title: '全渠道总览', icon: '📈' },
  shop: { title: '店铺概览', icon: '🏬' },
  overview: { title: 'KPI 总览', icon: '📊' },
  channels: { title: '一、渠道总览', icon: '🏪' },
  store: { title: '二、店铺数据', icon: '🏬', tabs: { overall: '2.1 整体数据', traffic: '2.2 流量来源', crowd: '2.3 人群运营', product: '2.4 单品数据', activity: '2.5 活动分析' } },
  ports: { title: '三、端口数据', icon: '📡', tabs: { dabo: '3.1 达播', paid: '3.2 站内付费', seeding: '3.3 种草', self: '3.4 自播', taoke: '3.5 淘客' } },
  query: { title: '四、数据查询', icon: '🔍', tabs: { store: '4.1 店铺数据', product: '4.2 单品数据', traffic: '4.3 流量来源', port: '4.4 推广端口', crowd: '4.5 人群会员', dabo_daren: '4.6 达播数据', channel: '4.7 渠道数据', kpi: '4.8 KPI达成', market: '4.9 市场数据' } },
  report: { title: '五、经营报告中心', icon: '📋', tabs: { weekly: '5.1 周报', monthly: '5.2 月报' } },
  market: { title: '六、市场趋势', icon: '📈' },
  metriclib: { title: '指标库', icon: '📚' },
  admin: { title: '管理后台', icon: '⚙️' },
};

const content = document.getElementById('content');
enableChartLegends(content);
const nav = document.getElementById('nav');
const sidebar = document.getElementById('sidebar');
const menu = document.getElementById('menu');
const switcher = document.getElementById('shop-switch');
const ranges = new Map();
const operationSettings = new Map();
const tabsByPage = new Map();
const workspaceFilters = { demo: {}, real: {} };
const shopCache = new Map();
const dayMs = 86400000;
const kpiModes = { month: '本月', quarter: '本季度', year: '全年', custom: '自定义' };
const initialPeriod = () => ({ year: '', month: '', granularity: 'day' });
const initialKpi = () => ({ mode: 'month', from: 1, to: 12, portType: '', port: '' });
let storePeriod = initialPeriod();
let kpi = initialKpi();
let workspace = null;
let workspaceError = '';
let activeShopId = '';
let lastHash = null;
let generation = 0;

async function refreshWorkspace() {
  const payload = await getWorkspaceJson('/api/workspace');
  workspace = payload;
  workspaceError = '';
  shopCache.clear();
  return payload;
}

function shopData(raw) {
  return {
    store: [], products: [], traffic: [], audience: [], ports: [], market: [], channels: [],
    targets: [], portTargets: [], activities: [], financeMonthly: [], attribution: {}, selfSessions: [],
    attributionRows: [], settlements: [], ...raw,
  };
}

const commonPages = new Set(['workspace', 'shop', 'store', 'query', 'metriclib', 'admin']);
function viewTabs(page, platform) {
  const tabs = screens[page].tabs || {};
  if (platform !== 'douyin') return tabs;
  if (page === 'store') return { overall: '整体数据' };
  if (page === 'query') return { store: '店铺日报', kpi: '店铺指标' };
  return tabs;
}

function route() {
  const [path, search = ''] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(search);
  const [page, tab] = path.split('/');
  let activePage = Object.hasOwn(screens, page) ? page : 'workspace';
  const shops = (workspace?.shops || []).filter(shop => !shop.archived);
  const requestedId = params.get('shop');
  const chosenReal = shops.find(shop => shop.id === requestedId);
  const selected = chosenReal || (!requestedId ? shops[0] : null);
  if (selected?.platform === 'douyin' && !commonPages.has(activePage)) activePage = 'shop';
  const tabs = viewTabs(activePage, selected?.platform);
  const start = params.get('from');
  const end = params.get('to');
  const range = validDate(start) && validDate(end) && start <= end && daysBetween(start, end) <= 731 ? { start, end } : null;
  return {
    page: activePage, tab: Object.hasOwn(tabs, tab) ? tab : Object.keys(tabs)[0], tabs,
    shop: selected, shops, range, explicitDemo: false,
    demo: true,
  };
}

function href(page, tab, shopId, range) {
  const params = new URLSearchParams();
  if (shopId && page !== 'workspace' && page !== 'admin') params.set('shop', shopId);
  if (range) {
    params.set('from', range.start);
    params.set('to', range.end);
  }
  return '#' + page + (tab ? '/' + tab : '') + (params.toString() ? '?' + params : '');
}

function navigate(page, tab, shopId = activeShopId, range) {
  const next = href(page, tab, shopId, range);
  if (location.hash !== next) location.hash = next;
  else render();
}

function dateKey(year, month, day = 1) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.toISOString().slice(0, 10);
}

function monthRange(year, from, to = from) {
  return { start: dateKey(year, from), end: dateKey(year, to + 1, 0) };
}

function dateRange(data, includeSettlement = false) {
  const settlementDates = includeSettlement ? (data.settlements || []).map(row => row.date) : [];
  const end = [...storeCalendar(data), ...settlementDates].sort().at(-1)
    || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  return { start: end.slice(0, 7) + '-01', end };
}

function previousDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  const lastDay = Number(dateKey(year - 1, month + 1, 0).slice(-2));
  return dateKey(year - 1, month, Math.min(day, lastDay));
}

function group(rows, getKey) {
  return Map.groupBy(rows, getKey);
}

function daysBetween(start, end) {
  if (end < start) return 0;
  return Math.round((Date.parse(end) - Date.parse(start)) / dayMs) + 1;
}

function signedChange(value) {
  return value == null ? '同期无数据' : (value >= 0 ? '+' : '') + fmt(value, 'pct') + ' YoY';
}

function achievement(value, goal) {
  return value != null && goal > 0 ? value / goal * 100 : null;
}

function kpiIncome(data, range) {
  if (range.start > range.end) return null;
  const months = new Map(financeSummary(data, range).months.map(item => [item.month, item.current.taxRevenue]));
  const daily = group(filterDates(data.store, range.start, range.end), row => row.date.slice(0, 7));
  const values = [...new Set([...months.keys(), ...daily.keys()])].map(month =>
    months.get(month) ?? aggregate(daily.get(month) || []).receipts).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function summarize(data, range, latest) {
  const actualEnd = range.end < latest ? range.end : latest;
  const days = daysBetween(range.start, range.end);
  const elapsed = daysBetween(range.start, actualEnd);
  const actual = aggregate(filterDates(data.store, range.start, actualEnd));
  const income = kpiIncome(data, { start: range.start, end: actualEnd });
  const priorIncome = kpiIncome(data, { start: previousDate(range.start), end: previousDate(actualEnd) });
  const goal = aggregate(filterDates(data.targets, range.start, range.end));
  const target = goal.taxRevenue ?? goal.receipts ?? goal.gmv;
  return {
    actual, income, target, elapsed, days,
    elapsedPct: elapsed / days * 100,
    completion: achievement(income, target),
    yoy: compare(income, priorIncome),
  };
}

function progressTile(label, summary) {
  const { income, target, completion, elapsedPct, yoy, days, elapsed } = summary;
  const behind = completion !== null && completion < elapsedPct;
  const gap = completion === null ? null : Math.max(0, target - income);
  const remainDays = days - elapsed;
  const remainDaily = remainDays && gap != null ? gap / remainDays : null;
  return `<article class="progress-card ${behind ? 'behind' : ''}">
    <div class="progress-title">${escapeHtml(label)}</div>
    <div class="progress-numbers"><div class="progress-value">${fmt(income, 'money')}</div><small>目标 <b>${fmt(target, 'money')}</b></small></div>
    <div class="track" aria-hidden="true"><i style="width:${Math.min(100, Math.max(0, completion ?? 0))}%"></i></div>
    <div class="progress-meta"><b class="${behind ? 'negative' : 'positive'}">${fmt(completion, 'pct')}</b><b class="${yoy != null && yoy < 0 ? 'negative' : 'positive'}">${signedChange(yoy)}</b></div>
    <div class="progress-detail">剩余目标 ${fmt(gap, 'money')} · 剩余 ${remainDays} 天 · 日均 ${fmt(remainDaily, 'money')}</div>
  </article>`;
}

function monthOptions(selected) {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    return '<option value="' + month + '"' + (selected === month ? ' selected' : '') + '>' + month + '月</option>';
  }).join('');
}

const onSite = new Set(['站内付费', '自播']);

const overviewPortNames = [
  ['达播', '站外', '达播', 'receipts'], ['站内付费', '站内', '站内付费', 'txn'],
  ['淘客', '站外', '淘客', 'gmv'], ['自播整体', '站内', '自播', 'gmv'],
  ['自播付费', '站内', '自播', 'txn'], ['逛逛内容', '站内', '种草', 'gmv'],
  ['逛逛付费', '站内', '种草', 'txn'], ['b站', '站外', 'b站', 'gmv'],
];

function overviewPorts(data, selection, latest) {
  const range = combinedPromotionRange(selection);
  const end = range.end < latest ? range.end : latest;
  const priorRange = { start: previousDate(range.start), end: previousDate(end) };
  const source = attributionSummary(data, { start: range.start, end }, { window: 15 });
  const previousSource = attributionSummary(data, priorRange, { window: 15 });
  const ports = group(filterDates(data.ports, range.start, end), row => row.group);
  const previous = group(filterDates(data.ports, priorRange.start, priorRange.end), row => row.group);
  const targets = group(filterDates(data.portTargets, range.start, range.end), row => row.group);
  const timeProgress = daysBetween(range.start, end) / daysBetween(range.start, range.end) * 100;
  const combined = range.start.slice(0, 7) !== range.end.slice(0, 7) && [
    '05-01/06-30', '10-01/11-30',
  ].includes(range.start.slice(5) + '/' + range.end.slice(5));
  const available = overviewPortNames.filter(([name, type, group, basis]) =>
    (!kpi.portType || kpi.portType === type)
    && (data === demoData || ports.has(group) || (basis === 'txn' && source.channels.some(row => row.group === name && row.txn !== null))));
  const selected = available.some(([name]) => name === kpi.port) ? kpi.port : '';
  const chosen = available.filter(([name]) => !selected || name === selected);
  const rows = chosen.map(([name, type, groupName, basis]) => {
    const own = source.channels.find(item => item.group === name);
    const priorOwn = previousSource.channels.find(item => item.group === name);
    const organic = rows => rows.filter(row => name !== '逛逛内容' || row.name !== '超级短视频');
    const actual = basis === 'txn' ? own : aggregate(organic(ports.get(groupName) || []));
    const prior = basis === 'txn' ? priorOwn : aggregate(organic(previous.get(groupName) || []));
    const target = aggregate(targets.get(groupName) || []);
    const ratio = name === '逛逛付费' ? 0.28 : name === '逛逛内容' ? 0.72 : name === '自播付费' ? 0.52 : 1;
    const base = basis === 'receipts' ? target.receipts : target.gmv;
    const goal = base == null ? null : base * ratio;
    const spendGoal = target.spend == null ? null : target.spend * ratio;
    const roi = basis === 'txn' ? actual?.roi : actual?.spend > 0 ? (actual[basis] ?? NaN) / actual.spend : null;
    const priorRoi = basis === 'txn' ? prior?.roi : prior?.spend > 0 ? (prior[basis] ?? NaN) / prior.spend : null;
    const sales = actual?.[basis];
    const spend = actual?.spend;
    const rate = achievement(sales, goal);
    const spendRate = achievement(spend, spendGoal);
    const targetRoi = goal != null && spendGoal > 0 ? goal / spendGoal : null;
    const status = own?.missingDays ? '口径缺项' : paidProgressStatus({ rate, spendRate, roi, targetRoi, timeProgress });
    return {
      sales, spend, goal, spendGoal, status,
      cells: [name, type, fmt(goal, 'money'), fmt(sales, 'money'), fmt(rate, 'pct'),
        signedChange(compare(sales, prior?.[basis])), fmt(spendGoal, 'money'), fmt(spend, 'money'), fmt(spendRate, 'pct'),
        fmt(targetRoi, 'roi'), fmt(roi, 'roi'), roi == null || priorRoi == null ? '—' : fmt(roi - priorRoi, 'roi'), status],
    };
  });
  const options = available.map(([name]) => `<option${name === selected ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('');
  const filter = `<div class="form-row kpi-port-filters"><label class="filter-label">端口类型 <select id="kpi-port-type"><option value="">全部</option>
    <option${kpi.portType === '站内' ? ' selected' : ''}>站内</option><option${kpi.portType === '站外' ? ' selected' : ''}>站外</option>
    </select></label><select id="kpi-port" aria-label="端口"><option value="">全端口</option>${options}</select></div>`;
  const total = field => {
    const values = rows.map(row => row[field]).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const info = '<div class="analysis-box kpi-port-summary">共 <b>' + chosen.length + '</b> 个端口 · 目标合计 <b>'
    + fmt(total('goal'), 'money') + '</b> · 实际合计 <b>' + fmt(total('sales'), 'money')
    + '</b> · 花费目标 ' + fmt(total('spendGoal'), 'money') + ' · 实际花费 ' + fmt(total('spend'), 'money')
    + '<p>时间进度 ' + fmt(timeProgress, 'pct') + '　口径 ' + range.start + ' 至 ' + end
    + '　实际 ROI = 实际成交 ÷ 实际花费。自播付费属于自播整体，分项合计用于端口检查。</p></div>';
  const title = '📡 各渠道达成情况' + (combined ? ' · ' + Number(range.start.slice(5, 7)) + '+' + Number(range.end.slice(5, 7)) + '月双月口径' : '');
  return card(title, filter + info + table(
    ['端口', '类型', '目标', '实际', '达成率', '同比', '目标花费', '实际花费', '花费进度', '目标 ROI', '实际 ROI', 'ROI 同比', '预警'],
    rows.map(row => row.cells)) + attributionDiagnostics(source));
}

function renderOverview(data, latest) {
  const [year, month] = latest.split('-').map(Number);
  const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
  const monthPeriod = monthRange(year, month);
  const quarterPeriod = monthRange(year, quarterStart, quarterStart + 2);
  const annualPeriod = monthRange(year, 1, 12);
  const periods = {
    month: monthPeriod, quarter: quarterPeriod, year: annualPeriod,
    custom: monthRange(year, Math.min(kpi.from, kpi.to), Math.max(kpi.from, kpi.to)),
  };
  const current = summarize(data, periods[kpi.mode], latest);
  const { completion, elapsedPct, actual, income, target, yoy } = current;
  const behind = completion != null && completion < elapsedPct;
  const note = completion == null
    ? '本期暂缺目标或实绩。导入日表后会计算实绩，演示目标单独保存。'
    : (behind ? '🟡 略落后' : '🟢 已达时间进度') + ' · 达成率 ' + fmt(completion, 'pct') + ' · 时间进度 ' + fmt(elapsedPct, 'pct');
  const modeButtons = Object.entries(kpiModes).map(([value, label]) => `<button type="button" data-mode="${value}"
    class="${value === kpi.mode ? 'active' : ''}" aria-pressed="${value === kpi.mode}">${label}</button>`).join('');
  const monthSelects = kpi.mode === 'custom' ? `<label>月份范围 <select id="kpi-from" aria-label="开始月份">${monthOptions(kpi.from)}</select>
    至 <select id="kpi-to" aria-label="结束月份">${monthOptions(kpi.to)}</select></label>` : '';
  const bar = `<div class="filter-bar" aria-label="KPI 筛选">
    <span class="filter-label">时间维度</span><div class="segmented">${modeButtons}</div>${monthSelects}
    <span class="filter-label">今日</span><span class="chip">${latest} 数据截止 · 时间进度 ${fmt(elapsedPct, 'pct')}</span></div>`;
  const displayPeriods = kpi.mode === 'custom'
    ? [['📅 自定义期间', periods.custom], ['📊 季度累计', quarterPeriod], ['📈 全年进度', annualPeriod]]
    : [['📅 ' + month + '月 · 销售额', monthPeriod], ['📊 Q' + Math.ceil(month / 3) + ' 季度累计', quarterPeriod], ['📈 全年进度', annualPeriod]];
  const tileHtml = displayPeriods.map(([label, range]) => progressTile(label, summarize(data, range, latest))).join('');
  const rangeLabel = current.elapsed
    ? periods[kpi.mode].start + ' ～ ' + (periods[kpi.mode].end > latest ? latest : periods[kpi.mode].end)
    : '所选周期尚未开始';
  const dailyRows = filterDates(data.store, periods[kpi.mode].start, periods[kpi.mode].end).slice().reverse();
  const summary = `<div class="analysis-box">
    <p><b>📋 ${kpiModes[kpi.mode]}达成情况总结</b> <span class="hint">${rangeLabel}</span></p>
    <p>📊 <b>整体达成</b>　目标 ${fmt(target, 'money')}，实际 <b>${fmt(income, 'money')}</b>，达成率 ${fmt(completion, 'pct')}，同比 ${signedChange(yoy)}。<span class="hint"> 含税收入，缺少时使用回款。</span></p>
    <p>🟡 <b>时间进度</b>　已过 ${current.elapsed} / ${current.days} 天，当前进度 ${fmt(elapsedPct, 'pct')}。</p>
    <p>🎯 <b>目标缺口</b>　${fmt(completion == null ? null : Math.max(0, target - income), 'money')}。</p>
  </div><details><summary>${kpiModes[kpi.mode]}单日回款进度</summary>${table(
    ['日期', '支付金额', '回款', '广告花费', '归因 ROI'], dailyRows.map(row =>
      [row.date, fmt(row.gmv, 'money'), fmt(row.receipts, 'money'), fmt(row.spend, 'money'), fmt(aggregate([row]).roi, 'roi')]))}</details>`;
  const analysis = card('📈 店铺经营指标', tiles([
    { label: '店铺支付金额', value: fmt(actual.gmv, 'money') }, { label: '回款', value: fmt(actual.receipts, 'money') }, { label: '含税收入', value: fmt(actual.taxRevenue, 'money') },
    { label: '访客人数', value: fmt(actual.visitors) }, { label: '支付转化率', value: fmt(actual.conversion, 'pct') },
    { label: '退款率', value: fmt(actual.refundRate, 'pct') }, { label: '经营利润', value: fmt(actual.profit, 'money') },
  ]));
  content.innerHTML = bar + card('🎯 店铺整体达成情况',
    `<div class="status${behind ? ' warning' : ''}">${note}</div><div class="progress-grid">${tileHtml}</div>${summary}`)
    + overviewPorts(data, periods[kpi.mode], latest) + renderFinanceKpi(data, periods[kpi.mode]) + analysis;
  content.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    kpi.mode = button.dataset.mode;
    renderOverview(data, latest);
    content.querySelector('[data-mode="' + kpi.mode + '"]').focus();
  }));
  for (const [id, field] of [['kpi-from', 'from'], ['kpi-to', 'to'], ['kpi-port-type', 'portType'], ['kpi-port', 'port']]) {
    content.querySelector('#' + id)?.addEventListener('change', event => {
      kpi[field] = field === 'from' || field === 'to' ? Number(event.target.value) : event.target.value;
      if (field === 'portType') kpi.port = '';
      renderOverview(data, latest);
      content.querySelector('#' + id)?.focus();
    });
  }
}

function channelChart(title, series, options) {
  return '<div class="chart-title">' + escapeHtml(title) + '</div>' + plot(series, options);
}

function renderChannels(data, latest) {
  const annual = group(data.channels, row => row.date.slice(0, 4));
  const years = [...annual.keys()].sort();
  const currentYear = years.at(-1) || latest.slice(0, 4);
  const lastYear = String(Number(currentYear) - 1);
  const months = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
  const monthLabels = months.map(month => Number(month) + '月');
  const tmall = year => (annual.get(year) || []).filter(row => row.name === '天猫');
  const perYear = new Map(years.map(year => [year, aggregate(annual.get(year))]));
  const platformGroups = group(data.channels, row => row.name);
  const shares = [...platformGroups].map(([name, rows]) => {
    const yearly = group(rows, row => row.date.slice(0, 4));
    return { label: name, values: years.map(year => achievement(aggregate(yearly.get(year) || []).gmv, perYear.get(year).gmv)), kind: 'pct' };
  });
  const dateEnd = currentYear === latest.slice(0, 4) ? latest : currentYear + '-12-31';
  const priorEnd = previousDate(dateEnd);
  const currentProducts = group(filterDates(data.products, currentYear + '-01-01', dateEnd), row => row.id);
  const priorProducts = group(filterDates(data.products, lastYear + '-01-01', priorEnd), row => row.id);
  const allProducts = group(data.products, row => row.id);
  const ranked = [...currentProducts].map(([id, rows]) => ({
    name: rows[0].name, rows, all: allProducts.get(id), current: aggregate(rows).gmv,
    previous: aggregate(priorProducts.get(id) || []).gmv,
  })).sort((a, b) => b.current - a.current).slice(0, 10);
  const portRows = filterDates(data.ports, currentYear + '-01-01', dateEnd);
  const portTotals = [...group(portRows, row => row.group)].map(([name, rows]) => [name, aggregate(rows)]);
  const priorPorts = group(filterDates(data.ports, lastYear + '-01-01', priorEnd), row => row.group);
  const targetPorts = group(filterDates(data.portTargets, currentYear + '-01-01', dateEnd), row => row.group);
  const money = value => value == null ? null : Math.round(value / 100) / 100;
  const salesByYear = years.map(year => money(aggregate(tmall(year)).gmv));
  const shareChart = year => channelChart(year + '年渠道占比', [{
    label: '各渠道销售份额', values: shares.map(item => item.values[years.indexOf(year)]),
  }], { labels: shares.map(item => item.label), type: 'ring', height: 250 });
  const saleByMonth = years.map(year => ({
    label: year, values: months.map(month => money(tmall(year).find(row => row.date.slice(5, 7) === month)?.gmv)),
  }));
  const productYearSeries = ranked.map(({ name, all }) => ({
    label: name, values: years.map(year => money(aggregate(all.filter(row => row.date.startsWith(year))).gmv)),
  }));
  const productMonthSeries = ranked.map(({ name, rows }) => ({
    label: name, values: months.map(month => money(aggregate(rows.filter(row => row.date.slice(5, 7) === month)).gmv)),
  }));
  const tableTop = table(['排名', '单品名称', '累计销售额', currentYear + '年累计', lastYear + '年同期', '同比变化'],
    ranked.map(({ name, all, current, previous }, index) =>
      [index + 1, name, fmt(aggregate(all).gmv, 'money'), fmt(current, 'money'), fmt(previous, 'money'), signedChange(compare(current, previous))]));
  content.innerHTML = [
    card('📈 1. 天猫渠道销售趋势 & 销售构成',
      channelChart('图表① 天猫年度销售额趋势（万元）', [{ label: '天猫年度销售额', values: salesByYear }], { labels: years, type: 'bar', height: 280 })
      + channelChart('图表② 天猫月度销售额趋势（万元）', saleByMonth, { labels: monthLabels, height: 320 })
      + channelChart('图表③ 天猫旗舰店 & 天猫超市年度销售额对比（万元）', ['旗舰店', '天猫超市'].map((label, index) => ({
        label, values: years.map(year => {
          const rows = tmall(year);
          const field = index ? 'supermarket' : 'flagship';
          const values = rows.map(row => row[field]).filter(Number.isFinite);
          return values.length ? money(values.reduce((sum, value) => sum + value, 0)) : null;
        }),
      })), { labels: years, type: 'bar', stacked: true, height: 270 })),
    card('📊 2. 渠道销售份额变化趋势',
      channelChart('图表④ 全渠道年度总销售额对比（万元）', [{ label: '全渠道销售额', values: years.map(year => money(perYear.get(year).gmv)) }],
        { labels: years, type: 'bar', height: 260 })
      + channelChart('图表⑤ 核心渠道年度销售占比趋势', shares, { labels: years, height: 300 })
      + (years.length ? '<div class="two-col">' + shareChart(lastYear) + shareChart(currentYear) + '</div>' : '')),
    card('📦 3. 重点单品分析',
      channelChart('图表⑥ TOP10 单品累计销售额排名（万元）', [{ label: '累计销售额', values: ranked.map(item => money(item.current)) }],
        { labels: ranked.map(item => item.name), type: 'bar', height: 290 })
      + channelChart('图表⑦ TOP10 单品年度销售额趋势（万元）', productYearSeries, { labels: years, height: 310 })
      + channelChart('图表⑧ TOP10 单品分月销售趋势（万元）', productMonthSeries, { labels: monthLabels, height: 310 })
      + '<h3>TOP10 单品同比变化</h3>' + tableTop),
    card('🎯 4. 核心渠道销售贡献 & ROI',
      channelChart('图表⑨ 核心渠道销售贡献与 ROI', [
        { label: '成交额（万元）', type: 'bar', values: portTotals.map(([, row]) => money(row.attributedSales)) },
        { label: 'ROI', axis: 'right', kind: 'roi', values: portTotals.map(([, row]) => row.roi) },
      ], { labels: portTotals.map(([name]) => name) })
      + '<h3>核心渠道达成明细</h3>' + table(['端口', '类型', '合计销售', '合计花费', '实际 ROI', '目标 ROI', 'ROI 达成', '同期销售', '销售同比'],
        portTotals.map(([name, row]) => {
          const prior = aggregate(priorPorts.get(name) || []);
          const target = aggregate(targetPorts.get(name) || []);
          const targetRoi = target.spend > 0 ? target.gmv / target.spend : null;
          return [name, onSite.has(name) ? '站内' : '站外', fmt(row.attributedSales, 'money'), fmt(row.spend, 'money'),
            fmt(row.roi, 'roi'), fmt(targetRoi, 'roi'), fmt(achievement(row.roi, targetRoi), 'pct'),
            fmt(prior.attributedSales, 'money'), signedChange(compare(row.attributedSales, prior.attributedSales))];
        }))),
  ].join('');
}

function storeCalendar(data) {
  return [...data.store.map(row => row.date), ...(data.financeMonthly || []).map(row => {
    const [year, month] = row.date.split('-').map(Number);
    return dateKey(year, month + 1, 0);
  })].sort();
}

function periodPicker(data, page, range) {
  const calendar = storeCalendar(data);
  const years = [...new Set(calendar.map(date => date.slice(0, 4)))].sort().reverse();
  const year = years.includes(storePeriod.year) ? storePeriod.year : years[0];
  const months = [...new Set(calendar.filter(date => date.startsWith(year)).map(date => date.slice(5, 7)))].sort();
  const defaultMonth = months.at(-1) || 'all';
  const selectedMonth = storePeriod.month === 'all' || months.includes(storePeriod.month) ? storePeriod.month : defaultMonth;
  const option = (value, label, selected) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`;
  const picker = page === 'store'
    ? `<div class="operation-period" id="store-period">
      <label>维度 <select id="storeViewMode">${option('day', '按日', storePeriod.granularity)}${option('month', '按月', storePeriod.granularity)}</select></label>
      <label>年份 <select id="storeYearFilter">${years.map(value => option(value, value + '年', year)).join('')}</select></label>
      <label>月份 <select id="storeMonthFilter">${option('all', '全部', selectedMonth)}${months.map(value => option(value, Number(value) + '月', selectedMonth)).join('')}</select></label>
      <span class="chip">${year ? '同比基准 ' + (Number(year) - 1) + '年' : '待导入数据'}</span></div>` : '';
  return picker + `<details class="operation-custom"${ranges.has(page) ? ' open' : ''}>
    <summary>自定义日期${ranges.has(page) ? ' · 已应用' : ''}</summary>
    <form class="form-row" id="range-filter">
      <label>开始日期 <input required name="start" type="date" value="${range.start}"></label>
      <label>结束日期 <input required name="end" type="date" value="${range.end}"></label>
      <button type="submit" class="button primary">应用筛选</button><button type="button" class="button" id="reset-range">恢复月份筛选</button>
    </form></details>`;
}

function storeRange(data) {
  const calendar = storeCalendar(data);
  const latest = calendar.at(-1);
  if (!latest) return dateRange(data);
  const years = [...new Set(calendar.map(date => date.slice(0, 4)))].sort();
  const year = years.includes(storePeriod.year) ? storePeriod.year : years.at(-1);
  const yearRows = calendar.filter(date => date.startsWith(year));
  const lastMonth = yearRows.at(-1).slice(5, 7);
  const month = yearRows.some(date => date.slice(5, 7) === storePeriod.month) ? storePeriod.month : lastMonth;
  const selected = storePeriod.month === 'all' ? monthRange(Number(year), 1, 12) : monthRange(Number(year), Number(month));
  selected.end = selected.end < latest ? selected.end : latest;
  return selected;
}

function bindPeriodPicker(page) {
  const form = content.querySelector('#range-filter');
  if (!form) return;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const { start, end } = Object.fromEntries(new FormData(form));
    const endInput = form.elements.end;
    endInput.setCustomValidity(start > end ? '结束日期必须等于或晚于开始日期。' : '');
    if (!form.reportValidity()) return;
    ranges.set(page, { start, end });
    render();
  });
  form.elements.end.addEventListener('input', event => event.target.setCustomValidity(''));
  form.elements.start.addEventListener('input', () => form.elements.end.setCustomValidity(''));
  content.querySelector('#reset-range').addEventListener('click', () => { ranges.delete(page); render(); });
  const controls = { storeViewMode: 'granularity', storeYearFilter: 'year', storeMonthFilter: 'month' };
  for (const [id, field] of Object.entries(controls)) {
    content.querySelector('#' + id)?.addEventListener('change', event => {
      storePeriod[field] = event.target.value;
      if (field === 'year') storePeriod.month = '';
      ranges.delete(page);
      render();
      content.querySelector('#' + id)?.focus();
    });
  }
}

function setShopContext(view) {
  const shopId = view.shop?.id || '';
  if (shopId !== activeShopId) {
    activeShopId = shopId;
    ranges.clear();
    operationSettings.clear();
    tabsByPage.clear();
    storePeriod = initialPeriod();
    kpi = initialKpi();
  }
  if (location.hash !== lastHash && view.range) {
    ranges.set(view.page, view.range);
    if (view.page === 'shop') ranges.set('store', view.range);
  }
  lastHash = location.hash;
}

function renderFrame(view) {
  const { page, tab, shop, shops, tabs } = view;
  const title = key => shop?.platform === 'douyin'
    ? screens[key].title.replace(/^[二四]、/, '') : screens[key].title;
  if (tab) tabsByPage.set(page, tab);
  const workspacePage = page === 'workspace' || page === 'admin';
  const scope = workspacePage ? '' : shop?.id || '';
  const visible = Object.entries(screens).filter(([key]) => {
    if (workspacePage) return ['workspace', 'shop', 'overview', 'store', 'ports', 'query', 'report', 'market', 'metriclib', 'admin'].includes(key)
      && (shop?.platform !== 'douyin' || commonPages.has(key));
    return shop?.platform !== 'douyin' || commonPages.has(key);
  });
  nav.innerHTML = visible.map(([key, item]) => {
    const selected = key === page;
    const preferred = tabsByPage.get(key);
    const routeTabs = viewTabs(key, shop?.platform);
    const url = href(key, Object.hasOwn(routeTabs, preferred) ? preferred : undefined, scope || shop?.id);
    const parent = `<a class="nav-link${selected ? ' active' : ''}" href="${url}"${selected && !item.tabs ? ' aria-current="page"' : ''}><span aria-hidden="true" class="nav-icon">${item.icon}</span>${title(key)}</a>`;
    const sub = selected && Object.keys(tabs).length ? '<div class="nav-sub">' + Object.entries(tabs).map(([value, title]) =>
      `<a class="sub-link${value === tab ? ' active' : ''}" href="${href(page, value, scope)}"${value === tab ? ' aria-current="page"' : ''}>${title}</a>`).join('') + '</div>' : '';
    return parent + sub;
  }).join('');
  const option = item => '<option value="' + escapeHtml(item.id) + '"' + (item.id === scope ? ' selected' : '') + '>'
    + escapeHtml(platforms[item.platform] + ' · ' + item.name) + '</option>';
  switcher.innerHTML = '<option value="">全渠道</option>'
    + (shops.length ? '<optgroup label="工作空间店铺">' + shops.map(option).join('') + '</optgroup>' : '')
;
  document.getElementById('breadcrumb').textContent = title(page) + (tab ? ' / ' + tabs[tab] : '');
  const latest = shop?.latestDate;
  const label = '客户演示';
  document.getElementById('updated').textContent = label;
  document.getElementById('freshness').textContent = page === 'admin' || page === 'workspace'
    ? label : (latest ? '日报截至 ' + latest : '日报待导入');
}

function showLoading(text = '正在读取工作空间…') {
  content.innerHTML = '<p class="workspace-loading" role="status">' + text + '</p>';
}

function showFailure(message) {
  content.innerHTML = '<p class="status warning">' + escapeHtml(message) + '</p>'
    + '<div class="workspace-shortcuts"><button type="button" class="button primary" id="workspace-retry">重新读取</button>'
    + '<a class="button" href="#workspace?demo=1">查看演示</a></div>';
  content.querySelector('#workspace-retry').addEventListener('click', bootstrap);
}

function renderShopScope(view, data) {
  const { page, tab, shop, tabs } = view;
  const defaultRange = dateRange(data, page === 'shop');
  const latest = defaultRange.end;
  const range = ranges.get(page) || (page === 'store' ? storeRange(data) : defaultRange);
  if (page === 'shop') return renderShop(content, {
    data, shop, range, href, demo: view.demo,
    onRange: value => {
      ranges.set(page, value);
      ranges.set('store', value);
      navigate('shop', undefined, shop.id, value);
    },
  });
  if (page === 'overview') return renderOverview(data, latest);
  if (page === 'channels') return renderChannels(data, latest);
  if (page === 'store' || page === 'ports') {
    const bar = page === 'ports' ? '<nav class="operation-tabs" aria-label="端口数据页">' + Object.entries(tabs)
      .map(([value, title]) => `<a href="${href(page, value, shop.id)}"${value === tab ? ' class="active" aria-current="page"' : ''}>${title}</a>`).join('') + '</nav>' : '';
    content.innerHTML = bar + '<div id="operation-body"></div>';
    const scope = page + '/' + tab;
    if (!operationSettings.has(scope)) operationSettings.set(scope, {});
    renderOperations(content.querySelector('#operation-body'), {
      page, tab, data, range, latest, platform: shop.platform, options: operationSettings.get(scope),
      toolbar: periodPicker(data, page, range), granularity: storePeriod.granularity, customRange: ranges.has(page),
      bindToolbar: () => bindPeriodPicker(page),
    });
    return;
  }
  renderSupport(content, { page, tab, data, range, navigate, platform: shop.platform });
}

async function render() {
  const run = ++generation;
  const view = route();
  const { page, shop, shops, explicitDemo } = view;
  setShopContext(view);
  renderFrame(view);
  if (!workspace && !explicitDemo && !(shop?.id.startsWith('demo-') && location.hash.includes('shop='))) {
    if (workspaceError) showFailure(workspaceError);
    else showLoading();
    return;
  }
  if (page === 'workspace') {
    const demo = false;
    renderWorkspace(content, { shops, demo, href, filters: workspaceFilters[demo ? 'demo' : 'real'], adminHref: '#admin',
      allowDemoToggle: false });
    return;
  }
  if (page === 'admin') {
    if (!workspace) return showFailure(workspaceError || '工作空间尚未加载。');
    renderAdmin(content, { shops: workspace.shops, onChanged: refreshWorkspace, legacyData: null, navigate });
    return;
  }
  if (!shop) {
    content.innerHTML = card('店铺不可用', '<p>该店铺已归档或不存在。请返回全渠道总览选择店铺。</p><a class="button" href="#workspace">返回全渠道总览</a>');
    return;
  }
  try {
    const sample = demoShopData(shop.id);
    if (sample) return renderShopScope(view, shop.id === 'demo-tmall' ? sample : shopData(sample));
    let data = shopCache.get(shop.id);
    if (!data) {
      data = getWorkspaceJson('/api/shops/' + encodeURIComponent(shop.id) + '/data');
      shopCache.set(shop.id, data);
      showLoading('正在读取所选店铺数据…');
    }
    const payload = await data;
    if (run === generation) renderShopScope(view, shopData(payload.data));
  } catch (error) {
    shopCache.delete(shop.id);
    if (run === generation) showFailure(error.message);
  }
}

async function bootstrap() {
  try {
    await refreshWorkspace();
  } catch (error) {
    workspaceError = error.message;
  }
  render();
}

switcher.addEventListener('change', event => {
  const id = event.target.value;
  if (id) navigate('shop', undefined, id);
  else navigate('workspace', undefined, '');
});

function closeMenu() {
  sidebar.classList.remove('open');
  menu.setAttribute('aria-expanded', 'false');
}
menu.addEventListener('click', () => menu.setAttribute('aria-expanded', String(sidebar.classList.toggle('open'))));
nav.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
window.addEventListener('hashchange', () => {
  closeMenu();
  render();
  window.scrollTo(0, 0);
});
render();
bootstrap();
