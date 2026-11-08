import { demoData, filterDates } from './data.js';
import { renderFinance } from './finance.js';
import { card, escapeHtml, fmt, plot, table } from './ui.js';

export const platforms = Object.freeze({ tmall: '天猫', douyin: '抖音' });
const labels = { gmv: '支付金额', refunds: '退款金额', net: '退款后支付额', receipts: '运营回款', settled: '实际结算', spend: '推广花费' };
const cents = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 });
const dayMs = 86_400_000;
const dateFormat = /^\d{4}-\d{2}-\d{2}$/;

export function validDate(value) {
  if (typeof value !== 'string' || !dateFormat.test(value) || value.startsWith('0000')) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function dateString(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function sameMonthStart(date) {
  return date.slice(0, 7) + '-01';
}

function money(value) {
  return Number.isFinite(value) ? cents.format(value) : '—';
}

function sum(values) {
  let total = 0;
  let count = 0;
  for (const value of values) {
    if (Number.isFinite(value)) {
      total += Math.round(value * 100);
      count++;
    }
  }
  return count ? total / 100 : null;
}

function metric(rows, key) {
  return sum(rows.map(row => row[key]));
}

function paired(rows, left, right) {
  return rows.length && rows.every(row => Number.isFinite(row[left]) && Number.isFinite(row[right]));
}

function ratio(numerator, denominator) {
  return Number.isFinite(numerator) && denominator > 0 ? numerator / denominator * 100 : null;
}

function days(range) {
  return Math.floor((Date.parse(range.end) - Date.parse(range.start)) / dayMs) + 1;
}

function groups(rows, key) {
  return Map.groupBy(rows, key);
}

function segment(rows, range) {
  const monthly = days(range) > 62;
  const key = date => monthly ? date.slice(0, 7) : date;
  const bins = new Map();
  for (let time = Date.parse(range.start); time <= Date.parse(range.end); time += dayMs) {
    const date = dateString(time);
    const name = key(date);
    if (!bins.has(name)) bins.set(name, []);
  }
  for (const row of rows) bins.get(key(row.date))?.push(row);
  return bins;
}

function chart(rows, range, specs) {
  const bins = segment(rows, range);
  return plot(specs.map(([name, measure, options = {}]) => ({
    label: name, values: [...bins.values()].map(measure), ...options,
  })), {
    labels: [...bins.keys()].map(key => key.length === 10 ? key.slice(5) : key),
    height: 270,
  });
}

const douyinRows = demoData.store.slice(-66).map((row, index) => {
  const scale = 0.42 + 0.09 * Math.sin(index / 4);
  const gmv = Math.round(row.gmv * scale);
  const refunds = Math.round(gmv * (0.12 + 0.02 * Math.cos(index)));
  return {
    date: row.date, gmv, refunds, receipts: Math.round((gmv - refunds) * 0.94),
    spend: Math.round(gmv * 0.17), buyers: Math.round(row.buyers * scale), visitors: Math.round(row.visitors * scale),
    orders: Math.round(row.orders * scale),
  };
});

function demoSettlements(rows) {
  return rows.slice(-44, -2).map(({ date, receipts }) => ({
    date, receipts, settled: Math.round(receipts * 0.94), fees: Math.round(receipts * 0.06),
  }));
}

const demoTmall = demoData;
demoTmall.settlements = demoSettlements(demoData.store);
demoTmall.attributionRows = Object.entries(demoData.attribution)
  .filter(([key, rows]) => ['oneDay', 'fifteenDay', 'history'].includes(key) && Array.isArray(rows))
  .flatMap(([window, rows]) => rows.map(row => ({ ...row, window })));
const demoDouyin = {
  store: douyinRows, settlements: demoSettlements(douyinRows), financeMonthly: [],
  attributionRows: douyinRows.slice(-35).map(row => ({
    date: row.date, scene: '千川商品推广（演示）', window: 'sevenDay', directTxn: Math.round(row.gmv * 0.42), spend: row.spend,
  })),
};

export const demoShops = [
  { id: 'demo-tmall', name: '天猫旗舰店 · 演示', platform: 'tmall', code: 'TM-DEMO', data: demoTmall },
  { id: 'demo-douyin', name: '抖音旗舰店 · 演示', platform: 'douyin', code: 'DY-DEMO', data: demoDouyin },
].map(({ data, ...shop }) => ({
  ...shop,
  earliestDate: data.store[0].date,
  latestDate: data.store.at(-1).date,
  counts: { daily: data.store.length, settlement: data.settlements.length },
}));

export function demoShopData(id) {
  return id === 'demo-tmall' ? demoTmall : id === 'demo-douyin' ? demoDouyin : null;
}

import { readDemo as getWorkspaceJson } from './demo-workspace.js';
export { getWorkspaceJson };

function totals(store, settlements) {
  const gmv = metric(store, 'gmv');
  const refunds = metric(store, 'refunds');
  const comparable = paired(store, 'gmv', 'refunds');
  return {
    gmv, refunds, net: comparable ? sum([gmv, -refunds]) : null,
    receipts: metric(store, 'receipts'), settled: metric(settlements, 'settled'),
    spend: metric(store, 'spend'), orders: metric(store, 'orders'),
    refundRate: comparable ? ratio(refunds, gmv) : null,
  };
}

function dateBounds(shops) {
  const dates = shops.flatMap(shop => [shop.latestDate, shop.settlementLatestDate]).filter(validDate).sort();
  const end = dates.at(-1) || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  return { start: sameMonthStart(end), end };
}

function dateFields(range) {
  return '<label>开始 <input name="start" type="date" required value="' + range.start + '"></label>'
    + '<label>结束 <input name="end" type="date" required value="' + range.end + '"></label>';
}

function rangeFrom(form) {
  const { start, end } = Object.fromEntries(new FormData(form));
  const message = !validDate(start) || !validDate(end) || start > end
    ? '请选择有效起止日期。' : days({ start, end }) > 731 ? '一次最多查看 731 天。' : '';
  form.elements.end.setCustomValidity(message);
  return form.reportValidity() ? { start, end } : null;
}

function metricTiles(results, coverage) {
  return '<div class="workspace-metrics">' + Object.keys(labels).map(key => {
    const value = results[key];
    return '<article class="workspace-metric"><div>' + labels[key] + '</div><strong>' + money(value)
      + '</strong><small>' + coverage(key) + '</small></article>';
  }).join('') + '</div>';
}

function selectedShops(shops, filters) {
  return shops.filter(shop => (!filters.platform || shop.platform === filters.platform)
    && (!filters.shopId || shop.id === filters.shopId));
}

function option(value, label, active) {
  return '<option value="' + escapeHtml(value) + '"' + (active === value ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
}

function overviewResults(rows, range) {
  const byShop = rows.map(item => ({ ...item, result: totals(item.store, item.settlements) }));
  const overall = totals(byShop.flatMap(item => item.store), byShop.flatMap(item => item.settlements));
  const byPlatform = [...groups(byShop, item => item.shop.platform)].map(([platform, items]) => ({
    platform, items, result: totals(items.flatMap(item => item.store), items.flatMap(item => item.settlements)),
  }));
  const coverage = key => {
    const count = byShop.filter(item => Number.isFinite(item.result[key])).length;
    if (key === 'net' && overall.net === null) return '支付与退款需在同一日报行齐全';
    return count + '/' + byShop.length + ' 家店有该数据';
  };
  const trendRows = byShop.flatMap(item => item.store.map(row => ({ ...row, platform: item.shop.platform })));
  const trend = chart(trendRows, range, byPlatform.map(({ platform }) => [
    platforms[platform] + '支付金额', bin => metric(bin.filter(row => row.platform === platform), 'gmv'),
    { kind: 'money', color: platform === 'tmall' ? '#4f46e5' : '#0ea5e9' },
  ]));
  const fields = ['gmv', 'refunds', 'net', 'receipts', 'settled', 'spend'];
  const platformFields = ['gmv', 'refunds', 'settled'];
  const platformTable = table(['平台', '店铺数', ...platformFields.map(key => labels[key]), '退款率'],
    byPlatform.map(({ platform, result, items }) => [platforms[platform], items.length,
      ...platformFields.map(key => money(result[key])), fmt(result.refundRate, 'pct')]));
  const storeTable = table(['店铺', '平台', '日报覆盖', '结算覆盖', ...fields.map(key => labels[key]), '支付退款率'],
    byShop.map(({ shop, store, settlements, result }) => [shop.name, platforms[shop.platform],
      store.length + '/' + days(range) + ' 天', settlements.length + ' 天', ...fields.map(key => money(result[key])), fmt(result.refundRate, 'pct')]));
  return metricTiles(overall, coverage)
    + '<div class="workspace-grid">' + card('平台支付趋势', trend, '按支付统计日汇总，未导入日期保留为空。')
    + card('平台经营拆分', platformTable, '结算按结算统计日单列。') + '</div>'
    + card('店铺明细与下钻', storeTable, '日报覆盖按筛选的自然日计数，金额为已导入部分。');
}

function linkShopRows(target, rows, href, range) {
  const tables = target.querySelectorAll('table');
  const cells = tables[tables.length - 1]?.querySelectorAll('tbody tr > td:first-child') || [];
  rows.forEach(({ shop }, index) => {
    const cell = cells[index];
    if (!cell) return;
    const link = document.createElement('a');
    link.className = 'shop-drill-link';
    link.href = href('shop', undefined, shop.id, range);
    link.textContent = shop.name + ' ↗';
    cell.replaceChildren(link);
  });
}

export function renderWorkspace(root, { shops, demo, href, filters, adminHref, allowDemoToggle }) {
  const available = demo ? demoShops : shops.filter(shop => !shop.archived);
  const defaults = dateBounds(available);
  const state = filters;
  if (!state.manualDates || !state.start || !state.end) Object.assign(state, defaults);
  if (!available.some(shop => shop.id === state.shopId)) state.shopId = '';
  root.innerHTML = `<section class="workspace-hero">
    <div><p class="workspace-eyebrow">经营驾驶舱 <span>演示数据</span></p>
    <h1>全渠道经营总览</h1><p>天猫与抖音统一查看，按平台、店铺与统计日期追踪经营。</p></div>
    <div class="workspace-hero-actions"><a class="button" href="${adminHref}">管理后台</a>
    ${allowDemoToggle ? `<a class="button workspace-ghost" href="${demo ? '#workspace' : '#workspace?demo=1'}">${demo ? '查看工作空间' : '查看演示'}</a>` : ''}</div>
  </section>
  <nav class="demo-shortcuts" aria-label="快速体验">
    ${(() => {
      const tmall = available.find(shop => shop.id === 'sample-tmall') || available.find(shop => shop.platform === 'tmall');
      const douyin = available.find(shop => shop.id === 'sample-douyin') || available.find(shop => shop.platform === 'douyin');
      const link = (label, page, tab, shop, section = '') => shop ? '<a class="button" href="' + href(page, tab, shop.id) + section + '">' + label + '</a>' : '';
      return link('天猫 KPI', 'overview', undefined, tmall)
        + link('抖音店铺', 'shop', undefined, douyin)
        + link('财务细表', 'shop', undefined, tmall, '&amp;section=finance')
        + link('推广归因', 'ports', 'paid', tmall)
        + link('经营周报', 'report', 'weekly', tmall)
        + link('经营月报', 'report', 'monthly', tmall)
        + '<a class="button" href="#admin?view=imports">Excel / CSV 对账</a>';
    })()}
  </nav>
  <form id="workspace-filter" class="filter-bar workspace-filter" aria-label="全渠道筛选">
    <label>平台 <select name="platform">${option('', '全部平台', state.platform)}${Object.entries(platforms).map(([key,label]) => option(key,label,state.platform)).join('')}</select></label>
    <label>店铺 <select name="shopId"></select></label>
    ${dateFields(state)}<button type="submit" class="button primary">应用筛选</button>
    <button type="button" class="button" data-reset>最近月份</button>
  </form><div data-overview-result aria-live="polite"></div>`;
  const form = root.querySelector('form');
  const result = root.querySelector('[data-overview-result]');
  result.addEventListener('click', event => {
    if (!event.target.closest('[data-demo-export]')) return;
    const grid = [...result.querySelectorAll('table')].at(-1);
    const cell = item => {
      const value = item.textContent.replace(/ ↗$/, '');
      const safe = /^[=+@-]/.test(value) ? "'" + value : value;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    const csv = [...grid.rows].map(row => [...row.cells].map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = '全渠道店铺明细.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  function storeOptions() {
    const selector = form.elements.shopId;
    const stores = available.filter(shop => !form.elements.platform.value || shop.platform === form.elements.platform.value);
    const selected = stores.some(shop => shop.id === state.shopId) ? state.shopId : '';
    selector.innerHTML = option('', '全部店铺', selected) + stores.map(shop => option(shop.id, shop.name, selected)).join('');
  }
  storeOptions();
  let revision = 0;
  async function draw() {
    const current = ++revision;
    const scope = { ...state };
    result.innerHTML = '<p class="empty-state">正在汇总各店铺数据…</p>';
    try {
      const params = new URLSearchParams({ start: scope.start, end: scope.end });
      if (scope.platform) params.set('platform', scope.platform);
      if (scope.shopId) params.set('shopId', scope.shopId);
      const endpoint = '/api/overview?' + params;
      const selected = new Set(selectedShops(available, scope).map(shop => shop.id));
      const items = demo
        ? available.map(shop => ({ shop, ...demoShopData(shop.id) }))
        : (await getWorkspaceJson(endpoint)).shops;
      if (!result.isConnected || current !== revision) return;
      const rows = items.filter(({ shop }) => selected.has(shop.id)).map(({ shop, store, settlements }) => ({
        shop, store: filterDates(store || [], scope.start, scope.end), settlements: filterDates(settlements || [], scope.start, scope.end),
      }));
      const covered = rows.filter(item => item.store.length || item.settlements.length);
      const note = covered.length ? '' : '<div class="workspace-empty">所选区间暂无记录。可切换日期或进入 <a href="#admin">管理后台</a> 导入。</div>';
      result.innerHTML = note + overviewResults(rows, scope);
      linkShopRows(result, rows, href, scope);
      if (rows.length) result.lastElementChild.insertAdjacentHTML('afterbegin',
        '<button class="button demo-export" type="button" data-demo-export>导出店铺 CSV</button>');
    } catch (error) {
      if (result.isConnected && current === revision) result.innerHTML = '<p class="status warning">' + escapeHtml(error.message) + '</p>';
    }
  }
  form.addEventListener('change', event => {
    form.elements.end.setCustomValidity('');
    if (event.target.name === 'platform') {
      state.shopId = '';
      storeOptions();
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const range = rangeFrom(form);
    if (!range) return;
    Object.assign(state, range, {
      platform: form.elements.platform.value, shopId: form.elements.shopId.value,
      manualDates: range.start !== defaults.start || range.end !== defaults.end,
    });
    draw();
  });
  form.querySelector('[data-reset]').addEventListener('click', () => {
    Object.assign(state, defaults, { manualDates: false });
    form.elements.start.value = defaults.start;
    form.elements.end.value = defaults.end;
    form.elements.end.setCustomValidity('');
    draw();
  });
  draw();
}

function compareSettlement(store, settlements) {
  const operating = new Map(store.map(row => [row.date, row]));
  return table(['结算日期', '实际结算', '结算费用', '结算源回款', '日报回款', '回款差额'],
    [...settlements].reverse().map(row => {
      const daily = operating.get(row.date)?.receipts;
      const difference = Number.isFinite(row.receipts) && Number.isFinite(daily) ? sum([row.receipts, -daily]) : null;
      return [row.date, money(row.settled), money(row.fees), money(row.receipts), money(daily), money(difference)];
    }));
}

function attributionDetail(rows) {
  const windows = { oneDay: '1 天', sevenDay: '7 天', fifteenDay: '15 天', history: '历史留存' };
  const summaries = [...groups(rows, row => row.window)].map(([window, items]) => {
    const txn = metric(items, 'directTxn');
    const spend = metric(items, 'spend');
    return [windows[window] || window, money(txn), money(spend), fmt(spend > 0 && txn !== null ? txn / spend : null, 'roi')];
  });
  return table(['窗口', '归因成交', '花费', '同口径 ROI'], summaries)
    + '<details><summary>查看统计日与场景</summary>' + table(['日期', '场景', '归因窗口', '归因成交', '花费'],
      [...rows].reverse().map(row => [row.date, row.scene, windows[row.window] || row.window, money(row.directTxn), money(row.spend)]))
    + '</details>';
}

export function renderShop(root, { data, shop, range, onRange, href, demo }) {
  const store = filterDates(data.store, range.start, range.end);
  const settlements = filterDates(data.settlements || [], range.start, range.end);
  const attribution = filterDates(data.attributionRows || [], range.start, range.end);
  const result = totals(store, settlements);
  const scopes = shop.platform === 'tmall' ? [['overview', undefined, 'KPI 总览'], ['store', 'overall', '店铺详情'], ['report', 'weekly', '经营报告']]
    : [['store', 'overall', '店铺详情'], ['query', 'store', '日报查询']];
  root.innerHTML = `<section class="workspace-hero workspace-store-hero">
    <div><p class="workspace-eyebrow">${platforms[shop.platform]} <span>${demo ? '演示数据' : escapeHtml(shop.code)}</span></p>
    <h1>${escapeHtml(shop.name)}</h1><p>支付、退款和结算按独立口径呈现。</p></div>
    <div class="workspace-hero-actions"><a class="button" href="#workspace${demo ? '?demo=1' : ''}">全渠道总览</a>
    <a class="button workspace-ghost" href="#admin">管理后台</a></div>
  </section>
  <form class="filter-bar workspace-filter" aria-label="店铺日期筛选">
    ${dateFields(range)}<button type="submit" class="button primary">应用筛选</button>
    <span class="hint">日报 ${store.length} 天 · 结算 ${settlements.length} 天</span>
  </form>
  <div class="workspace-shortcuts">${scopes.map(([page, tab, label]) =>
    `<a class="button" href="${href(page, tab, shop.id, range)}">${label} ↗</a>`).join('')}</div>`
    + metricTiles(result, key => key === 'settled' ? '按结算日期' : key === 'net' ? '日报同区间支付减退款' : '按日报日期')
    + card('支付与退款趋势', chart(store, range, [['支付金额', rows => metric(rows, 'gmv'), { kind: 'money' }],
      ['退款金额', rows => metric(rows, 'refunds'), { kind: 'money' }]]))
    + card('分日店铺明细', table(['日期', '支付金额', '退款金额', '运营回款', '推广花费', '支付笔数'],
      [...store].reverse().map(row => [row.date, money(row.gmv), money(row.refunds), money(row.receipts), money(row.spend), fmt(row.orders)])))
    + card('结算与回款核对', compareSettlement(store, settlements), '对同一天的两个回款字段核对差额，实际结算独立展示。')
    + (attribution.length ? card('平台推广归因', attributionDetail(attribution), '每个窗口分别汇总。') : '')
    + ((data.financeMonthly?.length || store.some(row => row.netRevenue != null || row.profit != null))
      ? renderFinance(data, range) : '');
  const form = root.querySelector('form');
  if (new URLSearchParams(location.hash.split('?')[1]).get('section') === 'finance') {
    const finance = [...root.querySelectorAll('.card')].find(card => card.querySelector('h2')?.textContent.includes('财务'));
    if (finance) requestAnimationFrame(() => finance.scrollIntoView({ block: 'start' }));
  }
  form.addEventListener('input', () => form.elements.end.setCustomValidity(''));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const selected = rangeFrom(form);
    if (selected) onRange(selected);
  });
}
