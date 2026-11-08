import { aggregate, filterDates } from './data.js';
import { financeSummary, productProfit } from './finance.js';
import { attributionSummary } from './attribution.js';
import { card, escapeHtml, fmt, plot, table, tiles } from './ui.js';

const percent = (value, total) => total > 0 && value != null ? value / total * 100 : null;
const ratio = (value, total) => total > 0 && value != null ? value / total : null;
const growth = (now, before) => before > 0 && now != null ? (now / before - 1) * 100 : null;
const points = (now, before) => now != null && before != null ? now - before : null;
const plain = value => value == null || value === '' ? '—' : escapeHtml(value);
const signed = (value, unit = '%') => value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}${unit}`;
const list = values => [...new Set(values.filter(Boolean))].sort();
const yuan = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 });
const money = value => fmt(value, 'money');
const pct = value => fmt(value, 'pct');
const count = value => fmt(value, 'number');
const roi = value => fmt(value, 'roi');

function groupBy(rows, getKey) {
  const groups = new Map();
  for (const row of rows) {
    const key = getKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function sumBy(rows, key) {
  const values = rows.map(row => row[key]).filter(Number.isFinite);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

function select(name, label, options, value = '') {
  return `<label>${escapeHtml(label)} <select name="${name}">${options.map(([key, text]) =>
    `<option value="${escapeHtml(key)}"${String(key) === String(value) ? ' selected' : ''}>${escapeHtml(text)}</option>`
  ).join('')}</select></label>`;
}

function optionList(values) {
  return [['', '全部'], ...list(values).map(value => [value, value])];
}

function dateAdd(date, days) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

function monthAdd(date, months) {
  const day = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  day.setUTCMonth(day.getUTCMonth() + months);
  return day.toISOString().slice(0, 10);
}

function monthEnd(date) {
  return dateAdd(monthAdd(date, 1), -1);
}

function daysBetween(start, end) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
}

function monday(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dateAdd(date, -((weekday + 6) % 7));
}

function previousYear(date) {
  const shifted = monthAdd(date, -12);
  return shifted.slice(0, 8) + String(Math.min(+date.slice(8), +monthEnd(shifted).slice(8))).padStart(2, '0');
}

const columns = {
  date: ['日期'], name: ['名称'], id: ['商品ID'], group: ['类型'], product: ['产品'], creator: ['达人'],
  visitors: ['访客数', 'number'], gmv: ['支付金额（元）', 'money'], buyers: ['支付买家', 'number'],
  conversion: ['转化率', 'pct'], asp: ['客单价', 'money'], uvValue: ['UV 价值', 'money'],
  receipts: ['回款（元）', 'money'], refunds: ['退款金额', 'money'], refundRate: ['退款率', 'pct'],
  orders: ['成交笔数', 'number'], spend: ['花费（元）', 'money'], profit: ['净利润（元）', 'money'],
  roi: ['ROI', 'roi'], impressions: ['展现量', 'number'], clicks: ['点击量', 'number'],
  ctr: ['点击率', 'pct'], ppc: ['PPC', 'money'], directGmv: ['直接成交（元）', 'money'],
  addCart: ['加购人数', 'number'], addCartRate: ['加购率', 'pct'], collect: ['收藏人数', 'number'],
  searchVisitors: ['搜索引导访客数', 'number'], searchConversion: ['搜索引导转化率', 'pct'],
  oldGmv: ['老买家支付金额', 'money'], oldRatio: ['老买家支付占比', 'pct'],
  level1: ['一级来源'], level2: ['二级来源'], members: ['会员总数', 'number'],
  newMembers: ['新增会员', 'number'], payingMembers: ['支付会员', 'number'],
  newPayingMembers: ['新增支付会员', 'number'], newMemberGmv: ['新会员支付（元）', 'money'],
  productCount: ['商品数', 'number'], commission: ['佣金', 'money'], pitFee: ['坑位费', 'money'],
  promoFee: ['推广费', 'money'], margin: ['净利润率', 'pct'], month: ['月份'], year: ['年份'],
  spendShare: ['花费占比', 'pct'], gmvShare: ['销售占比', 'pct'], target: ['收入目标', 'money'],
  actual: ['实际收入', 'money'], attainment: ['达成率', 'pct'], prior: ['去年同期收入', 'money'],
  yoy: ['同比', 'pct'], mom: ['环比', 'pct'], share: ['份额', 'pct'],
  path1: ['一级品类'], path2: ['二级品类'], path3: ['三级品类'], path4: ['四级品类'],
  path5: ['五级品类'], level: ['数据层级'], score: ['机会分', 'number'], volume: ['销量（件）', 'number'],
  shareChange: ['份额变化', 'points'],
};

const querySources = {
  store: { title: '店铺每日运营数据', key: 'store', cols: 'date visitors gmv buyers conversion asp uvValue refunds addCart collect', day: true },
  product: { title: '单品效果数据', key: 'products', cols: 'date id name visitors conversion asp addCart addCartRate gmv searchVisitors searchConversion oldGmv oldRatio', day: true },
  traffic: { title: '流量来源数据', key: 'traffic', cols: 'date level1 level2 visitors gmv buyers conversion asp uvValue addCart', day: true },
  port: { title: '推广端口数据', key: 'ports', cols: 'date name spend impressions clicks ctr ppc roi gmv directGmv orders', day: true },
  crowd: { title: '人群会员数据', key: 'audience', cols: 'date members newMembers payingMembers newPayingMembers gmv newMemberGmv' },
  dabo_daren: { title: '达播达人数据', key: 'ports', cols: 'date creator productCount receipts orders commission pitFee promoFee spend roi profit margin', day: true },
  dabo_product: { title: '达播产品数据', key: 'ports', cols: 'date creator product receipts orders spend roi profit margin', day: true },
  channel: { title: '渠道概况数据', key: 'channels', cols: 'year month group name spendShare gmvShare spend gmv' },
  kpi: { title: '店铺 KPI 数据', key: 'targets', cols: 'month target actual attainment prior yoy' },
  market: { title: '市场趋势数据', key: 'market', cols: 'month name path1 path2 path3 path4 path5 volume gmv level share mom yoy shareChange score' },
};

function enrichRow(row) {
  return {
    ...row,
    year: row.date.slice(0, 4), month: row.date.slice(0, 7),
    level1: row.level1 ?? row.group, level2: row.level2 ?? row.name,
    addCart: row.addCart ?? row.cartAdds, directGmv: row.directGmv ?? row.attributedSales,
    conversion: percent(row.buyers, row.visitors), asp: ratio(row.gmv, row.buyers), uvValue: ratio(row.gmv, row.visitors),
    oldRatio: percent(row.oldGmv, row.gmv), searchConversion: percent(row.searchBuyers, row.searchVisitors),
    roi: ratio(row.attributedSales ?? row.gmv, row.spend), margin: percent(row.profit, row.receipts), refundRate: percent(row.refunds, row.gmv),
    ctr: percent(row.clicks, row.impressions), ppc: ratio(row.spend, row.clicks), addCartRate: percent(row.addCart ?? row.cartAdds, row.visitors),
  };
}

function queryRows(source, data) {
  const rows = data[querySources[source].key] ?? [];
  if (source === 'market') return marketQueryRows(rows);
  if (source === 'port') {
    return attributionSummary(data, {}, { window: 1 }).daily.map(row => ({
      ...enrichRow({ ...row, name: row.scene }), ppc: row.cpc, roi: row.roi, directGmv: row.txn,
    }));
  }
  if (source === 'kpi') {
    const targets = new Map(rows.map(row => [row.date.slice(0, 7), row]));
    const months = list([...targets.keys(), ...(data.store || []).map(row => row.date.slice(0, 7)),
      ...(data.financeMonthly || []).map(row => row.date.slice(0, 7))]);
    return months.map(month => {
      const date = month + '-01';
      const start = date;
      const end = monthEnd(date);
      const store = filterDates(data.store || [], start, end);
      const financials = financeSummary(data, { start, end });
      const actual = financials.current.taxRevenue ?? sumBy(store, 'receipts');
      const priorEnd = previousYear(store.at(-1)?.date || end);
      const prior = financials.previous.taxRevenue ?? sumBy(filterDates(data.store || [], previousYear(start), priorEnd), 'receipts');
      const row = targets.get(month) || { date };
      const target = row.taxRevenue ?? row.receipts ?? row.gmv;
      return { ...enrichRow(row), target, actual, prior, attainment: percent(actual, target), yoy: growth(actual, prior) };
    });
  }
  if (source === 'channel') {
    const monthly = groupBy(rows, row => row.date.slice(0, 7));
    return rows.map(row => {
      const own = enrichRow(row);
      const peers = monthly.get(own.month);
      return { ...own, spendShare: percent(row.spend, sumBy(peers, 'spend')), gmvShare: percent(row.gmv, sumBy(peers, 'gmv')) };
    });
  }
  if (source === 'dabo_daren' || source === 'dabo_product') {
    const dabo = rows.filter(row => row.creator && row.group === '达播');
    if (source === 'dabo_product') return dabo.filter(row => row.product).map(row =>
      ({ ...enrichRow(row), roi: ratio(row.receipts, row.spend) }));
    return [...groupBy(dabo, row => JSON.stringify([row.date, row.creator])).values()].map(group => {
      const [{ date, creator }] = group;
      const record = { ...aggregate(group), date, creator, productCount: list(group.map(row => row.product)).length };
      for (const key of ['commission', 'pitFee', 'promoFee']) record[key] = sumBy(group, key);
      return { ...enrichRow(record), roi: ratio(record.receipts, record.spend) };
    });
  }
  return (source === 'crowd' ? rows.filter(row => row.name === '会员') : rows).map(enrichRow);
}

function queryFormat(value, kind) {
  if (kind === 'points') return signed(value, ' pp');
  if (kind === 'money') return value == null ? '—' : yuan.format(value);
  return kind ? fmt(value, kind) : plain(value);
}

function renderQuery(root, { tab, data, navigate }) {
  let source = Object.hasOwn(querySources, tab) ? tab : 'store';
  let results = [];
  let sortKey = '';
  let ascending = true;
  let page = 0;
  const pageSize = 100;
  root.innerHTML = `<form class="support-filters" id="query-form"></form><div id="query-results" aria-live="polite"></div>`;
  const form = root.querySelector('#query-form');
  const result = root.querySelector('#query-results');

  function showResults() {
    const keys = querySources[source].cols.split(' ');
    if (!results.length) {
      result.innerHTML = `<div class="support-empty"><div aria-hidden="true">📭</div>查询无结果，请调整筛选条件</div>`;
      return;
    }
    const pages = Math.ceil(results.length / pageSize);
    const summary = keys.filter(key => columns[key][1] === 'money' && ['gmv', 'receipts', 'spend', 'refunds', 'actual'].includes(key))
      .map(key => `${columns[key][0]}合计 ${queryFormat(sumBy(results, key), 'money')}`).join('　');
    const headers = keys.map(key => {
      const direction = key === sortKey ? ascending ? 'ascending' : 'descending' : 'none';
      const arrow = key === sortKey ? ascending ? '↑' : '↓' : '↕';
      return `<th aria-sort="${direction}"><button type="button" data-sort="${key}">${columns[key][0]} <span aria-hidden="true">${arrow}</span></button></th>`;
    }).join('');
    const rows = results.slice(page * pageSize, (page + 1) * pageSize);
    const grid = rows.map(row => `<tr>${keys.map(key =>
      `<td>${queryFormat(row[key], columns[key][1])}</td>`).join('')}</tr>`).join('');
    result.innerHTML = `<div class="support-query-summary"><strong>共 ${count(results.length)} 条记录</strong><span>${summary}</span></div>
      <div class="support-query-grid"><table><thead><tr>${headers}</tr></thead><tbody>${grid}</tbody></table></div>
      ${pages > 1 ? `<div class="support-pager"><button type="button" data-page="-1"${page === 0 ? ' disabled' : ''}>上一页</button><span>${page + 1} / ${pages}</span><button type="button" data-page="1"${page === pages - 1 ? ' disabled' : ''}>下一页</button></div>` : ''}`;
  }

  function runQuery() {
    const values = Object.fromEntries(new FormData(form));
    results = queryRows(source, data).filter(row =>
      (!values.year || row.year === values.year) &&
      (!values.month || row.month.slice(5, 7) === values.month) &&
      (!values.day || row.date === values.day) &&
      (!values.productId || String(row.id) === values.productId) &&
      (!values.portName || row.name === values.portName) &&
      (!values.level1 || row.level1 === values.level1) &&
      (!values.level2 || row.level2 === values.level2) &&
      (!values.marketLevel || row.level === values.marketLevel)
    ).sort((a, b) => a.date.localeCompare(b.date));
    sortKey = '';
    ascending = true;
    page = 0;
    showResults();
  }

  function secondaryOptions(group, chosen = '') {
    const rows = data.traffic ?? [];
    return select('level2', '二级来源', optionList(rows.filter(row =>
      !group || (row.level1 ?? row.group) === group).map(row => row.level2 ?? row.name)), chosen);
  }

  function buildForm() {
    const config = querySources[source];
    const rows = source === 'port' || source === 'kpi' ? queryRows(source, data) : data[config.key] ?? [];
    const sources = Object.entries(querySources).map(([key, entry]) => [key, entry.title]);
    const months = Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, '0'), `${i + 1}月`]);
    const products = source === 'product'
      ? [...new Map(rows.filter(row => row.id).map(row => [row.id, row.name])).entries()].map(([id, name]) => [id, `${id} · ${name}`])
      : [];
    form.innerHTML = `${select('source', '数据源', sources, source)}
      ${select('year', '年份', optionList(rows.map(row => row.date.slice(0, 4))))}
      ${select('month', '月份', [['', '全部'], ...months])}
      ${config.day ? '<label>日期 <input name="day" type="date"></label>' : ''}
      ${source === 'product' ? select('productId', '商品 ID', [['', '全部'], ...products]) : ''}
      ${source === 'port' ? select('portName', '端口', optionList(rows.map(row => row.name))) : ''}
      ${source === 'traffic' ? `${select('level1', '一级来源', optionList(rows.map(row => row.level1 ?? row.group)))}<span id="query-level2">${secondaryOptions('')}</span>` : ''}
      ${source === 'market' ? select('marketLevel', '市场层级', [['', '全部'], ['一级', '一级品类'], ['二级', '二级品类'], ['细分', '细分类目']]) : ''}
      <button type="submit" class="support-primary">🔍 查询</button><span class="support-note">导出权限已关闭</span>`;
  }

  form.addEventListener('submit', event => { event.preventDefault(); runQuery(); });
  form.addEventListener('change', event => {
    if (event.target.name === 'source') {
      const next = event.target.value;
      if (navigate && next !== 'dabo_product') {
        navigate('query', next);
        return;
      }
      source = next;
      buildForm();
      runQuery();
    }
    if (event.target.name === 'level1') {
      form.querySelector('#query-level2').innerHTML = secondaryOptions(event.target.value);
    }
    if (event.target.name === 'level2') runQuery();
  });
  result.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.sort) {
      const key = button.dataset.sort;
      ascending = sortKey === key ? !ascending : true;
      sortKey = key;
      results.sort((a, b) => {
        if (a[key] == null) return b[key] == null ? 0 : 1;
        if (b[key] == null) return -1;
        const order = typeof a[key] === 'number' && typeof b[key] === 'number'
          ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]), 'zh-CN', { numeric: true });
        return ascending ? order : -order;
      });
      page = 0;
    }
    if (button.dataset.page) page += Number(button.dataset.page);
    showResults();
    if (button.dataset.sort) result.querySelector(`[data-sort="${sortKey}"]`)?.focus();
  });
  buildForm();
  runQuery();
}

const reportPorts = ['达播', '站内付费', '淘客', '自播整体', '自播付费', '逛逛内容', '逛逛付费', 'B站'];
const reportFinanceFields = [
  ['含税收入', 'taxRevenue'], ['未税收入', 'netRevenue'], ['商品成本', 'cost'],
  ['毛利额', 'grossProfit'], ['毛利率', 'grossMargin', true], ['总费用', 'expenses'],
  ['费用率', 'expenseRate', true], ['税费', 'taxes'], ['销售利润', 'profit'], ['销售利润率', 'margin', true],
];
const reportBasis = {
  direct_15d: '15 天直接归因', direct_1d: '1 天独立分析', self_1d: '1 天自播付费',
  retained: '历史明确留存', mixed: '混合口径', missing: '暂无同口径数据',
};

function periodChoices(rows, weekly) {
  const periods = groupBy(rows, row => weekly ? monday(row.date) : row.date.slice(0, 7) + '-01');
  return [...periods.entries()].map(([start, records]) => {
    const periodEnd = weekly ? dateAdd(start, 6) : monthEnd(start);
    const end = records.reduce((latest, row) => row.date > latest ? row.date : latest, start);
    const coverage = new Set(records.map(row => row.date)).size;
    return { start, end, periodEnd, coverage, complete: coverage === daysBetween(start, periodEnd) };
  }).sort((a, b) => b.start.localeCompare(a.start));
}

function monthRange(start, end = monthEnd(start)) {
  return { start: start.slice(0, 7) + '-01', end };
}

function periodRows(rows, period) {
  return filterDates(rows ?? [], period.start, period.end);
}

function reportKpi(finance, shop) {
  return finance.taxRevenue ?? shop.receipts;
}

function numericDifference(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
}

function reportRelative(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? (a - b) / Math.abs(b) * 100 : null;
}

function reportBox(title, hint, html, span = 12, modifier = '') {
  return `<section class="report-box ${modifier}" style="--report-span:${span}">
    <header class="report-box-header"><h4>${escapeHtml(title)}</h4><span>${escapeHtml(hint)}</span></header>
    ${html}</section>`;
}

function reportList(lines) {
  return '<ul class="report-list">' + lines.map(line => `<li>${escapeHtml(line)}</li>`).join('') + '</ul>';
}

function reportChart(values, label, format = 'number', type = 'bar') {
  const scale = format === 'money' ? 10000 : 1;
  return plot(values.map(([key, series, color]) => ({ label: key, color, values: series.map(value => value == null ? null : value / scale) })),
    { labels: label, type });
}

function reportCompareRows(metrics, now, mom, yoy) {
  return metrics.map(([name, key, isRate, numberFormat]) => {
    const a = now[key], b = mom[key], c = yoy[key];
    const format = isRate ? pct : numberFormat ?? money;
    const change = previous => isRate ? signed(points(a, previous), ' pp') : signed(reportRelative(a, previous));
    return [name, format(a), format(b), change(b), format(c), change(c)];
  });
}

function reportPortRows(data, period, paid = attributionSummary(data, period, { window: 15 })) {
  const rows = periodRows(data.ports, period);
  const paidChannels = new Map(paid.channels.map(row => [row.group, row]));
  const standalone = { 达播: '达播', 淘客: '淘客', 自播整体: '自播', 逛逛内容: '种草', B站: 'B站' };
  return reportPorts.map(name => {
    const group = standalone[name];
    if (!group) {
      const channel = paidChannels.get(name);
      return {
        name, sales: channel?.txn, spend: channel?.spend, roi: channel?.roi, basis: channel?.basis, missingDays: channel?.missingDays,
        source: reportBasis[channel?.basis] ?? '暂无同口径数据',
      };
    }
    const current = rows.filter(row => row.group === group);
    const a = aggregate(current);
    const useReceipts = name === '达播';
    const sales = useReceipts ? a.receipts : a.gmv;
    return { name, sales, spend: a.spend, roi: ratio(sales, a.spend), rows: current,
      source: useReceipts ? '回款 ÷ 推广费用' : '成交 ÷ 推广费用' };
  });
}

function comparablePorts(now, before) {
  return now.basis === before.basis && now.basis !== 'mixed' && !now.missingDays && !before.missingDays;
}

function reportPortTarget(data, name, period) {
  const group = { 自播整体: '自播', 逛逛内容: '种草' }[name] ?? name;
  return sumBy(periodRows(data.portTargets, period).filter(row => row.group === group), 'gmv');
}

function reportProducts(data, current, prior, storeSales, targetMargin, financeProducts) {
  const prev = groupBy(periodRows(data.products, prior), row => String(row.id ?? row.name));
  const paid = groupBy(periodRows(data.attribution?.detail?.product, current), row => String(row.id ?? ''));
  const financials = new Map(financeProducts.map(row => [String(row.id), row.current]));
  return [...groupBy(periodRows(data.products, current), row => String(row.id ?? row.name))].map(([id, rows]) => {
    const totals = aggregate(rows);
    const previous = aggregate(prev.get(id) ?? []);
    const finance = financials.get(id);
    const grossProfit = finance?.grossProfit ?? null;
    const grossMargin = finance?.grossMargin ?? null;
    const netRevenue = finance?.netRevenue ?? null;
    const taxRevenue = finance?.taxRevenue ?? null;
    const risk = [];
    const share = percent(totals.gmv, storeSales);
    const activeDates = new Set(rows.map(row => row.date));
    const paidRows = (paid.get(id) ?? []).filter(row => activeDates.has(row.date));
    const paidTxn = sumBy(paidRows, 'directTxn');
    const paidSpend = sumBy(paidRows, 'spend');
    const paidShare = percent(paidTxn, totals.gmv);
    if (totals.refundRate > 15) risk.push('退款偏高');
    if (paidShare > 40) risk.push('付费依赖高');
    if (share > 15) risk.push('贡献集中');
    if (grossMargin != null && targetMargin != null && grossMargin < targetMargin) risk.push('毛利低于目标');
    const action = risk.includes('退款偏高') ? '拆分售后原因，核对链接权益与履约'
      : risk.includes('毛利低于目标') ? '复核促销、套组与商品成本'
        : risk.includes('付费依赖高') ? '优化搜索和自然承接，跟踪边际 ROI'
          : risk.includes('贡献集中') ? '保障供给并验证替代商品' : '保持观察，按周核对转化与利润';
    return {
      ...totals, name: rows[0].name, id, group: rows[0].group ?? '其他', previous, grossProfit, grossMargin, netRevenue, taxRevenue, risk,
      share, paidShare, paidTxn, paidSpend, action,
      shortfall: targetMargin != null && netRevenue != null && grossProfit != null
        ? Math.max(0, netRevenue * targetMargin / 100 - grossProfit) : null,
    };
  }).sort((a, b) => (b.gmv ?? 0) - (a.gmv ?? 0));
}

function reportContext(data, current, mode, weekly) {
  const monthly = monthRange(current.end);
  const monthToDate = monthRange(current.end, current.end);
  const previousMonth = monthRange(monthAdd(current.start, -1));
  const yearMonth = monthRange(monthAdd(current.start, -12));
  const prior = weekly
    ? mode === 'yoy'
      ? { start: previousYear(current.start), end: previousYear(current.end) }
      : { start: dateAdd(current.start, -7), end: dateAdd(current.end, -7) }
    : mode === 'yoy' ? yearMonth : previousMonth;
  const currentRows = periodRows(data.store, current);
  const a = aggregate(currentRows);
  const b = aggregate(periodRows(data.store, prior));
  const finance = financeSummary(data, weekly ? { start: current.start, end: current.periodEnd } : monthly, prior);
  const currentFinance = weekly && current.end !== current.periodEnd ? financeSummary(data, current, prior).current : finance.current;
  const monthlyFinance = weekly ? financeSummary(data, monthToDate) : finance;
  const monthPlan = weekly ? financeSummary(data, monthly).target : finance.target;
  const monthTarget = reportKpi(monthPlan, aggregate(periodRows(data.targets, monthly)));
  const monthActual = reportKpi(monthlyFinance.current, aggregate(periodRows(data.store, monthToDate)));
  const target = weekly ? finance.target.taxRevenue : monthTarget;
  const kpiActual = reportKpi(currentFinance, a);
  const kpiPrior = reportKpi(finance.previous, b);
  const kpiBasis = currentFinance.taxRevenue != null ? '财务含税收入' : a.receipts != null ? '店铺回款留存' : '缺少回款';
  const elapsed = daysBetween(current.start, current.end);
  const time = percent(elapsed, daysBetween(current.start, current.periodEnd));
  const monthTime = percent(daysBetween(monthly.start, monthToDate.end), daysBetween(monthly.start, monthly.end));
  const attainment = percent(kpiActual, target);
  const monthAttainment = percent(monthActual, monthTarget);
  const gap = monthActual != null && monthTarget != null ? Math.max(0, monthTarget - monthActual) : null;
  const remaining = daysBetween(dateAdd(monthToDate.end, 1), monthly.end);
  const productFinancials = productProfit(data, { ...finance, end: current.end });
  const products = reportProducts(data, current, prior, a.gmv, monthPlan.grossMargin, productFinancials);
  const paid = attributionSummary(data, current, { window: 15 });
  const ports = reportPortRows(data, current, paid);
  const priorPorts = new Map(reportPortRows(data, prior).map(row => [row.name, row]));
  const monthlyPorts = new Map((weekly ? reportPortRows(data, monthToDate) : ports).map(row => [row.name, row]));
  const risks = [];
  if (monthAttainment != null && monthAttainment < monthTime) risks.push('月度达成落后时间进度');
  if (growth(a.gmv, b.gmv) < -5) risks.push('支付金额下滑');
  if (a.refundRate > 15) risks.push('整体退款偏高');
  if (points(finance.current.grossMargin, finance.target.grossMargin) < -0.1) risks.push('毛利低于目标');
  if (paid.scenes.some(row => row.spend > 1000 && row.roi != null && row.roi < 3)) risks.push('存在低 ROI 付费场景');
  if (paid.missing.length) risks.push('推广归因存在缺项');
  if (paid.retained.length) risks.push('部分推广历史按明确留存口径');
  if (products.some(row => row.refundRate >= 20 && row.gmv >= Math.max(20000, a.gmv * 0.005))) risks.push('重点单品退款风险');
  if (!b.gmv) risks.push('缺少可比经营数据');
  return { data, current, prior, previousMonth, yearMonth, monthly, monthToDate, currentRows, a, b,
    finance: { ...finance, current: currentFinance }, monthlyFinance, monthPlan, kpiActual, kpiPrior, kpiBasis, productFinancials,
    products, ports, priorPorts, monthlyPorts, paid, target, time, attainment, monthTarget, monthActual,
    monthTime, monthAttainment, gap, remaining, mode, risks };
}

function reportPortRowsTable(rows) {
  return table(['场景', '成交', '花费', 'ROI', '点击', '口径 / 缺失'],
    rows.map(row => [row.scene, money(row.txn), money(row.spend), roi(row.roi), count(row.clicks),
      [reportBasis[row.basis], row.missingDays ? `缺 ${row.missingDays} 日` : '', row.retainedDays ? `留存 ${row.retainedDays} 日` : ''].filter(Boolean).join(' · ')]));
}

function reportCoverage(paid) {
  const note = '站内付费 / 逛逛付费采用 15 天直接成交，排除间接和预售，自播付费保留 1 天口径。渠道归因不能跨端口加总。';
  const diagnostics = [['缺失日期 × 场景', paid.missing], ['明确历史留存', paid.retained]]
    .filter(([, items]) => items.length).map(([label, items]) =>
      `<details class="report-details"><summary>${label} · ${items.length} 项</summary>${table(['日期', '场景', '端口'],
        items.map(row => [row.date, row.scene, row.group]))}</details>`).join('');
  return `<p class="report-hint">${note}${paid.scenes.some(row => row.txn != null) ? '' : ' 本期缺少可展示的推广归因。'}</p>${diagnostics}`;
}

function reportTrendImpact(a, b) {
  const required = [a.visitors, a.conversion, a.asp, b.visitors, b.conversion, b.asp];
  if (!required.every(Number.isFinite)) return [];
  const effects = [
    ['流量', (a.visitors - b.visitors) * b.conversion / 100 * b.asp, '检查流量来源与新客触达'],
    ['转化率', a.visitors * (a.conversion - b.conversion) / 100 * b.asp, '检查价格、承接和客服'],
    ['客单价', a.visitors * a.conversion / 100 * (a.asp - b.asp), '检查套组、客单和商品结构'],
  ];
  const delta = numericDifference(a.gmv, b.gmv);
  return effects.map(([name, value, hint]) => [name, money(value), delta ? signed(value / delta * 100) : '—', hint]);
}

function financeMetrics(receipts, record) {
  return [receipts, record.grossProfit, record.grossMargin, record.profit, record.margin];
}

function weeklyFinanceTable(model) {
  const { data, kpiActual, kpiPrior, finance, monthlyFinance, monthPlan, monthActual, monthTarget, productFinancials } = model;
  const fmtCells = values => values.map((value, i) => i === 2 || i === 4 ? pct(value) : money(value));
  const compareCells = (now, before) => now.map((value, i) => i === 2 || i === 4
    ? signed(points(value, before[i]), ' pp') : signed(reportRelative(value, before[i])));
  const fields = ['grossProfit', 'profit', 'netRevenue', 'taxRevenue'];
  const channel = (periodProducts, which) => {
    const rows = periodProducts.filter(row => row.group === '达播').map(row => row[which]);
    return Object.fromEntries(fields.map(field => [field, rows.every(row => Number.isFinite(row[field])) ? sumBy(rows, field) : null]));
  };
  const partition = (total, dabo) => Object.fromEntries(fields.map(field =>
    [field, numericDifference(total[field], dabo[field])]));
  const withRates = record => ({ ...record, grossMargin: percent(record.grossProfit, record.netRevenue), margin: percent(record.profit, record.netRevenue) });
  const weekDabo = channel(productFinancials, 'current');
  const prevDabo = channel(productFinancials, 'prior');
  const monthDabo = channel(productProfit(data, monthlyFinance), 'current');
  const weekShelf = withRates(partition(finance.current, weekDabo));
  const prevShelf = withRates(partition(finance.previous, prevDabo));
  const monthShelf = withRates(partition(monthlyFinance.current, monthDabo));
  const actual = financeMetrics(monthActual, monthlyFinance.current);
  const goal = financeMetrics(monthTarget, monthPlan);
  const comparator = model.mode === 'yoy' ? '周同比' : '周环比';
  const blocks = [
    ['店铺整体', [
      ['月度（本月累计）', fmtCells(actual)], ['月度目标', fmtCells(goal)],
      ['月度达成进度', actual.map((value, index) => pct(percent(value, goal[index])))],
      ['周度（本周）', fmtCells(financeMetrics(kpiActual, finance.current))],
      [comparator, compareCells(financeMetrics(kpiActual, finance.current), financeMetrics(kpiPrior, finance.previous))],
    ]],
    ...[['达播', withRates(monthDabo), withRates(weekDabo), withRates(prevDabo)], ['货架', monthShelf, weekShelf, prevShelf]]
      .map(([name, month, week, before]) => [name, [
        ['月度（本月累计）', fmtCells(financeMetrics(month.taxRevenue, month))], ['周度（本周）', fmtCells(financeMetrics(week.taxRevenue, week))],
        [comparator, compareCells(financeMetrics(week.taxRevenue, week), financeMetrics(before.taxRevenue, before))],
      ]]),
  ];
  return `<div class="table-wrap report-financial-matrix"><table><thead><tr>${['业务类型', '口径', '回款', '毛利额', '毛利率', '利润额', '利润率'].map(label =>
    `<th scope="col">${label}</th>`).join('')}</tr></thead>${blocks.map(([name, rows]) =>
      `<tbody>${rows.map(([label, values], index) => `<tr>${index === 0 ? `<th scope="rowgroup" rowspan="${rows.length}">${name}</th>` : ''}
      <th scope="row">${label}</th>${values.map(value => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody>`).join('')}</table></div>`;
}

function weeklyFunnel(model) {
  const layers = [['访客', 'visitors'], ['加购人数', 'cartAdds'], ['支付买家', 'buyers'], ['支付订单', 'orders'], ['支付金额', 'gmv']];
  const sources = periodRows(model.data.traffic, model.current);
  return `<div class="report-funnel">${layers.map(([label, key], index) => `<button type="button" data-funnel="${index}" aria-pressed="${index === 0}">
    <span>${label}</span><strong>${key === 'gmv' ? money(model.a[key]) : count(model.a[key])}</strong>
    <small>${index > 0 && key !== 'gmv' ? `访客占比 ${pct(percent(model.a[key], model.a.visitors))}` : '查看来源'}</small></button>`).join('')}</div>
    ${layers.map(([label, key], index) => {
      const rows = [...groupBy(sources, row => row.name)].map(([name, values]) =>
        [values[0].group, name, sumBy(values, key)]).sort((a, b) => (b[2] ?? 0) - (a[2] ?? 0));
      return `<div data-funnel-panel="${index}"${index ? ' hidden' : ''}><h5>${label}来源下钻</h5>${table(['一级来源', '二级来源', label, '占比'],
        rows.map(([group, name, value]) => [group, name, key === 'gmv' ? money(value) : count(value), pct(percent(value, model.a[key]))]))}</div>`;
    }).join('')}`;
}

function reportPortDetail(model, port) {
  const group = { 达播: '达播', 淘客: '淘客', 自播整体: '自播', 自播付费: '自播', 逛逛内容: '种草', 逛逛付费: '种草', B站: 'B站' }[port.name] ?? port.name;
  const rows = port.rows ?? periodRows(model.data.ports, model.current).filter(row => row.group === group);
  const byMetric = (key, limit = 5) => [...groupBy(rows.filter(row => row[key]), row => row[key])].map(([name, group]) => {
    const a = aggregate(group);
    const value = port.name === '达播' ? a.receipts : a.gmv;
    return { name, sales: value, spend: a.spend, roi: ratio(value, a.spend), orders: a.orders };
  }).sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0)).slice(0, limit);
  const scenes = model.paid.scenes.filter(row => row.group === port.name);
  const paidProduct = [...groupBy(periodRows(model.data.attribution?.detail?.product, model.current)
    .filter(row => scenes.some(scene => scene.scene === row.scene)), row => row.name)].map(([name, rows]) => {
    const sales = sumBy(rows, 'directTxn');
    const spend = sumBy(rows, 'spend');
    return { name, sales, spend, roi: ratio(sales, spend), orders: sumBy(rows, 'orders') };
  }).sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0)).slice(0, 5);
  const display = (title, rows) => `<div><h5>${title}</h5>${table(['名称', '成交 / 回款', '花费', 'ROI', '订单'],
    rows.map(row => [row.name, money(row.sales), money(row.spend), roi(row.roi), count(row.orders)]))}</div>`;
  return `<h5>${port.name}</h5><p class="report-hint">${port.source} · 成交 / 回款 ${money(port.sales)} · 花费 ${money(port.spend)} · ROI ${roi(port.roi)}</p>
    <div class="report-two">${scenes.length ? `<div><h5>场景拆分</h5>${reportPortRowsTable(scenes)}</div>`
      : display(port.name === '达播' ? '达人 TOP' : '单日成交 TOP', byMetric(port.name === '达播' ? 'creator' : 'date'))}
      ${scenes.length && port.name !== '自播付费'
        ? display('商品 TOP（1 天商品独立口径）', paidProduct) : display('商品 TOP', byMetric('product'))}</div>`;
}

function weeklyReport(model) {
  const { a, b, data, products, ports, priorPorts, monthlyPorts, monthly, mode, gap, monthAttainment, monthTime, target, attainment, time } = model;
  const channelRows = ports.map(port => {
    const before = priorPorts.get(port.name);
    const month = monthlyPorts.get(port.name);
    const goal = reportPortTarget(data, port.name, monthly);
    const comparable = comparablePorts(port, before);
    return [port.name, money(port.sales), money(port.spend), comparable ? signed(growth(port.spend, before.spend)) : '—',
      comparable ? signed(growth(port.sales, before.sales)) : '—', roi(port.roi), money(month.sales), money(month.spend), roi(month.roi), pct(percent(month.sales, goal))];
  });
  const metrics = [
    ['支付金额', 'gmv', money, '核对流量、转化与客单'], ['店铺回款', 'receipts', money, '核对退款、结算与回款时差'],
    ['访客数', 'visitors', count, '拆分来源与新老客'], ['加购人数', 'cartAdds', count, '观察商品收藏与加购'],
    ['支付买家', 'buyers', count, '核对有效购买规模'], ['支付转化率', 'conversion', pct, '核对价格机制与承接'],
    ['客单价', 'asp', money, '核对套组与连带'], ['退款率', 'refundRate', pct, '检查售后与履约'],
  ];
  const opsRows = metrics.map(([label, key, format, hint]) =>
    [label, format(a[key]), format(b[key]), format === pct ? signed(points(a[key], b[key]), ' pp') : signed(growth(a[key], b[key])), hint]);
  const actions = reportActions(model);
  const budgetAdvice = [];
  const resource = ports.filter(port => port.sales != null).map(port => {
    const prior = priorPorts.get(port.name);
    const comparable = comparablePorts(port, prior);
    const roiChange = comparable ? points(port.roi, prior.roi) : null;
    const spendDelta = comparable ? numericDifference(port.spend, prior.spend) : null;
    const salesDelta = comparable ? numericDifference(port.sales, prior.sales) : null;
    const marginal = ratio(salesDelta, spendDelta);
    const target = reportPortTarget(data, port.name, monthly);
    const progress = percent(monthlyPorts.get(port.name).sales, target);
    const isCapped = ['达播', '淘客'].includes(port.name) && progress >= 100;
    const decision = isCapped ? '目标已达成，维持效率，不追加花费'
      : marginal != null && marginal < 2 ? '压降或冻结低效预算'
        : progress != null && progress < 85 && marginal >= 2.5 ? '可小步加预算验证增量'
          : portAction(port, null);
    if (isCapped || (progress != null && progress < 85) || (marginal != null && marginal < 2)) {
      budgetAdvice.push(`${port.name}达成 ${pct(progress)}，边际 ROI ${roi(marginal)}，${decision}。`);
    }
    const top = port.rows ? [...groupBy(port.rows.filter(row => row.product), row => row.product)]
      .map(([name, rows]) => [name, sumBy(rows, port.name === '达播' ? 'receipts' : 'gmv')]).sort((a, b) => b[1] - a[1])[0]?.[0] : null;
    return [port.name, money(salesDelta), money(spendDelta), signed(roiChange, ' 点'), roi(marginal), pct(progress), top ?? '—', decision];
  });
  const productGroups = list(products.map(row => row.group));
  return reportBox('周报经营决策闭环', '月度缺口 → 周度归因 → 渠道额度 → 单品资源 → 行动验收',
    '<p>渠道归因成交分端口判断。预算复盘同时看增量花费、成交与边际 ROI。</p>') +
    reportBox('一、月度 & 周度达成情况', '业务类型：店铺整体 / 达播 / 货架',
      weeklyFinanceTable(model) + `<p class="report-hint">回款口径 ${model.kpiBasis}。月度缺口 ${money(gap)} · 达成 ${pct(monthAttainment)} · 时间进度 ${pct(monthTime)}。</p>
      <p class="report-hint">周度目标 ${money(target)}（按自然日分摊） · 达成 ${pct(attainment)} · 时间进度 ${pct(time)}。达播按财务商品业务类型归集，货架为整体减达播，仅在对应字段可用时计算。</p>`) +
    reportBox('二、本周经营数据', 'GMV = UV × 转化率 × 客单价', table(['指标', '本周', '对比期', '变化', '归因'], opsRows)
      + table(['增长因素', '影响金额', '贡献占比', '经营判断'], reportTrendImpact(a, b)) + weeklyFunnel(model)) +
    reportBox('三、渠道效率分析', '月度目标 × 本周效率', reportCoverage(model.paid)
      + table(['端口', '本周 GMV / 回款', '本周花费', mode === 'yoy' ? '花费同比' : '花费环比', mode === 'yoy' ? '成交同比' : '成交环比',
        '本周 ROI', '本月 GMV / 回款', '本月花费', '本月 ROI', '本月达成率'], channelRows)
      + '<h5>渠道 × 单品资源决策矩阵</h5>' + table(['端口', '成交增量', '花费增量', 'ROI 变化', '边际 ROI', '月达成率', '承接单品', '预算动作'], resource)
      + `<div class="report-selector" aria-label="端口详情">${ports.map((row, index) =>
        `<button type="button" data-channel="${index}" aria-pressed="${index === 0}">${row.name}</button>`).join('')}</div>`
      + ports.map((port, index) => `<div data-channel-panel="${index}"${index ? ' hidden' : ''}>${reportPortDetail(model, port)}</div>`).join('')) +
    reportBox('四、单品情况', '商品日明细 · 分类筛选', '<p class="report-hint">推广商品明细按日期和商品 ID 匹配，采用 1 天直接成交与对应花费。缺失指标保留空值。</p>'
      + select('report-product-group', '分类', optionList(productGroups)) + '<div id="report-product-table"></div>') +
    reportBox('五、优化建议', '预算与动作验收', reportList(budgetAdvice.length ? budgetAdvice : ['核对月度缺口与边际 ROI，再分配预算。'])
      + reportActionCards(actions), 12, 'report-blue') +
    reportBox('固定口径说明', '统一数据边界', reportList([
      '店铺整体、达播与货架使用财务或独立业务口径。细分端口只比较成交、花费和 ROI。',
      '投放 ROI = 直接归因成交 ÷ 对应花费；达播 ROI = 回款 ÷ 推广费用。',
      '有明确历史留存口径的记录单独标记。缺少对应日期、场景、费用或财务字段时保留空值。',
    ]));
}

function weeklyProductTable(products, category) {
  return table(['分类', '商品 ID', '商品', '本周 GMV', 'UV', '支付转化', '退款率', '毛利率', '推广成交占比',
    '推广直接成交', '推广花费', '成交变化', '诊断与动作'],
  products.filter(row => !category || row.group === category).slice(0, 80).map(row =>
    [row.group, row.id, row.name, money(row.gmv), count(row.visitors), pct(row.conversion), pct(row.refundRate), pct(row.grossMargin),
      pct(row.paidShare), money(row.paidTxn), money(row.paidSpend), signed(growth(row.gmv, row.previous.gmv)),
      [row.risk.join(' / '), row.action].filter(Boolean).join(' · ')]));
}

function portAction(port, target = null) {
  if (port.sales == null) return '补齐对应日期、场景或端口数据';
  if (port.roi != null && port.roi < 2) return '先控低效预算，复查承接与投放成本';
  if (target != null && port.sales < target * 0.8) return '优先补缺口，拆到可放量商品与确定性排期';
  if (port.roi != null && port.roi >= 3) return '保留 ROI 底线，小步测试增量';
  return '按预算跟踪，优先核对增量与毛利';
}

function reportActions(model) {
  const highRefund = model.products.find(row => row.refundRate > 15 && row.gmv >= 10000);
  const poorScenes = model.paid.scenes.filter(row => row.spend > 1000 && row.roi != null && row.roi < 3).map(row => row.scene);
  const source = model.paid.missing.length ? ['数据核对', `核对 ${model.paid.missing.length} 个归因日期和场景缺项`, '覆盖率、留存范围'] : null;
  return [
    ['目标进度', model.gap > 0 ? `拆分回款缺口 ${money(model.gap)}，核对货品供给、推广和达播排期。` : '每周核对回款、目标与货品供给。', '目标达成、剩余日均'],
    ['场景效率', poorScenes.length ? `优先复核 ${poorScenes.join('、')}，观察点击成本与直接成交。` : '按货品全站、关键词、人群分计划复核边际 ROI。', '直接成交、花费、ROI'],
    ['商品质量', highRefund ? `检查 ${highRefund.name} 的高退款原因、商品描述与客服承接。` : '核对主推品退款、毛利和库存，持续跟踪异常。', '退款率、回款率、毛利率'],
    ['渠道排期', '达播按单场产出与费用锁定达人和高毛利套组。', '回款、佣金、坑位费、净 ROI'],
    source,
  ].filter(Boolean);
}

function reportActionCards(actions) {
  return `<div class="report-action-grid">${actions.map(([name, action, check]) =>
    `<div><b>${escapeHtml(name)}</b><p>${escapeHtml(action)}</p><small>${escapeHtml(check)}</small></div>`).join('')}</div>`;
}

function monthKpis(model) {
  const { a, b, kpiActual, kpiBasis, monthTarget, monthAttainment, monthTime, finance, ports, gap, remaining } = model;
  const paid = ports.find(row => row.name === '站内付费');
  const figures = [
    ['KPI 实际回款', money(kpiActual), `目标 ${money(monthTarget)} · ${kpiBasis}`, `时间 ${pct(monthTime)}`, monthAttainment, '#2563eb'],
    ['Shop 支付金额', money(a.gmv), `对比期 ${money(b.gmv)}`, '流量 / 转化拆解', percent(a.gmv, b.gmv), '#10b981'],
    ['转化率', pct(a.conversion), `客单 ${money(a.asp)}`, `对比 ${signed(points(a.conversion, b.conversion), ' pp')}`, percent(a.conversion, b.conversion), '#06b6d4'],
    ['毛利率', pct(finance.current.grossMargin), `目标 ${pct(finance.target.grossMargin)}`, '财务口径', percent(finance.current.grossMargin, finance.target.grossMargin), '#8b5cf6'],
    ['站内付费', money(paid.sales), `花费 ${money(paid.spend)}`, `ROI ${roi(paid.roi)}`, paid.roi == null ? null : paid.roi / 5 * 100, '#f59e0b'],
    ['目标缺口', money(gap), remaining > 0 && gap != null ? `剩余日均 ${money(gap / remaining)}` : '已到期 / 待核对', '缺口', percent(gap, monthTarget), '#f43f5e'],
  ];
  return `<div class="report-kpi-grid">${figures.map(([label, value, sub, foot, rate, color]) =>
    `<div class="report-kpi"><b>${label}</b><strong>${value}</strong><span>${sub}</span>
      <div class="report-progress" aria-hidden="true"><i style="width:${Math.max(0, Math.min(rate ?? 0, 100))}%;background:${color}"></i></div>
      <div class="report-kpi-foot"><b>${foot}</b><b>${pct(rate)}</b></div></div>`).join('')}</div>`;
}

function monthProductFinance(products, targetMargin) {
  const rows = products.filter(row => row.netRevenue != null || row.taxRevenue != null).slice().sort((a, b) => (b.shortfall ?? 0) - (a.shortfall ?? 0));
  return table(['单品', 'SPU-ID', '含税收入', '未税收入', '毛利率', '低于目标', '毛利缺口', '判断 / 动作'],
    rows.map(row => [row.name, row.id, money(row.taxRevenue), money(row.netRevenue), pct(row.grossMargin),
      row.grossMargin != null && targetMargin != null ? signed(Math.max(0, targetMargin - row.grossMargin), ' pp') : '—', money(row.shortfall), row.action]));
}

function monthFinanceReview(model, mom, yoy) {
  const { finance, products } = model;
  return '<h5>二、毛利复盘分析</h5>' + table(['指标', '本月', '上月', '环比', '去年同期', '同比'],
    reportCompareRows(reportFinanceFields, finance.current, mom, yoy))
    + '<h5>单品毛利缺口</h5>' + monthProductFinance(products, finance.target.grossMargin);
}

function monthExpenses(model) {
  const { finance, a, ports } = model;
  const fields = Object.entries(finance.expenses).sort((a, b) => b[1] - a[1]);
  const rows = ports.filter(port => port.sales != null || port.spend != null);
  return '<p class="report-hint">费用率采用总费用 ÷ 未税收入。渠道费用占比对照店铺费用，成交占比对照店铺支付金额，跨端口归因有重叠。</p>'
    + '<h5>渠道费用效率矩阵</h5>'
    + table(['渠道', '成交 / 回款', '花费', '费用占比', '成交占比', 'ROI', '费投比', '有效性'],
      rows.map(row => [row.name, money(row.sales), money(row.spend), pct(percent(row.spend, finance.current.expenses)),
        pct(percent(row.sales, a.gmv)), roi(row.roi), pct(percent(row.spend, row.sales)), portAction(row)]))
    + '<h5>费用科目结构</h5>'
    + table(['费用科目', '金额', '占总费用', '判断'],
      fields.map(([name, value], index) => [name, money(value), pct(percent(value, finance.current.expenses)), index < 3 ? '重点核对预算与实际' : '持续跟踪']))
    + '<h5>费用诊断与复盘结论</h5>' + reportList([
      `当期总费用 ${money(finance.current.expenses)}，费用率 ${pct(finance.current.expenseRate)}。`,
      '结合退款率、利润率和边际 ROI 评估投放。发现高花费低回报时优先拆解计划，不直接推定某渠道利润。',
    ]);
}

function monthGoalChart(rate) {
  if (rate == null) return '<div class="empty-state">本月暂无可比较的目标</div>';
  const progress = Math.min(100, Math.max(0, rate));
  return `<div class="report-goal">
    <svg viewBox="0 0 160 160" role="img" aria-label="本月回款达成 ${pct(rate)}">
      <circle cx="80" cy="80" r="61" fill="none" stroke="#e5ebf4" stroke-width="24"/>
      <circle cx="80" cy="80" r="61" fill="none" stroke="#4f46e5" stroke-width="24" pathLength="100"
        stroke-dasharray="${progress} 100" transform="rotate(-90 80 80)"/>
      <text x="80" y="85" text-anchor="middle">${pct(rate)}</text>
    </svg>
    <span><i></i>已达成</span><span><i></i>目标缺口</span>
  </div>`;
}

function monthRiskChart(products) {
  const marginMode = products.some(row => row.grossMargin != null);
  const key = marginMode ? 'grossMargin' : 'refundRate';
  const label = marginMode ? '毛利率' : '退款率';
  const rows = products.filter(row => Number.isFinite(row[key]) && Number.isFinite(row.gmv)
    && (row.gmv > 3000 || row.refundRate > 10 || row.shortfall > 0)).slice(0, 50);
  if (!rows.length) return '<div class="empty-state">本月暂无可绘制的商品风险数据</div>';
  const maxX = Math.max(1, ...rows.map(row => row[key]));
  const minX = Math.min(0, ...rows.map(row => row[key]));
  const maxY = Math.max(1, ...rows.map(row => row.gmv / 10000));
  const minY = Math.min(0, ...rows.map(row => row.gmv / 10000));
  const xFor = value => 52 + (value - minX) / (maxX - minX) * 452;
  const yFor = value => 218 - (value - minY) / (maxY - minY) * 188;
  const grid = Array.from({ length: 5 }, (_, step) => {
    const x = minX + (maxX - minX) * step / 4;
    const y = minY + (maxY - minY) * step / 4;
    return `<line x1="${xFor(x)}" x2="${xFor(x)}" y1="30" y2="218"/><text x="${xFor(x)}" y="236" text-anchor="middle">${pct(x)}</text>
      <line x1="52" x2="504" y1="${yFor(y)}" y2="${yFor(y)}"/><text x="44" y="${yFor(y) + 4}" text-anchor="end">${count(Math.round(y))}</text>`;
  }).join('');
  return `<div class="report-scatter-wrap"><svg viewBox="0 0 520 264" role="group" aria-label="商品风险点，可选择查看单品">
    <g class="report-scatter-grid">${grid}<text x="52" y="15">成交（万元）</text><text x="504" y="255" text-anchor="end">${label}</text></g>
    ${rows.map((row, index) => `<circle cx="${xFor(row[key])}" cy="${yFor(row.gmv / 10000)}" r="6" tabindex="0"
      role="button" data-risk-product="${index}" aria-label="${escapeHtml(row.name)}">
      <title>${escapeHtml(row.name)} · ${label} ${pct(row[key])} · 成交 ${money(row.gmv)}</title></circle>`).join('')}
    </svg></div><p class="report-hint" data-risk-summary>选择图中的商品，查看毛利、退款与推广依赖。</p>
    ${rows.map((row, index) => `<p class="report-hint" data-risk-panel="${index}" hidden><strong>${escapeHtml(row.name)}</strong>
      · 支付金额 ${money(row.gmv)} · 毛利率 ${pct(row.grossMargin)} · 毛利缺口 ${money(row.shortfall)} · 退款率 ${pct(row.refundRate)}
      · 推广依赖 ${pct(row.paidShare)} · ${escapeHtml(row.action)}</p>`).join('')}`;
}

function monthlyReport(model) {
  const { a, b, current, currentRows, data, previousMonth, yearMonth, products, ports, priorPorts, paid, finance, monthly,
    monthActual, monthTarget, monthAttainment, monthTime, gap, remaining, mode } = model;
  const compareName = mode === 'yoy' ? '去年同期' : '上月';
  const mom = aggregate(periodRows(data.store, previousMonth));
  const yoy = aggregate(periodRows(data.store, yearMonth));
  const priorFinance = financeSummary(data, current, previousMonth).previous;
  const yearFinance = financeSummary(data, current, yearMonth).previous;
  const sales = currentRows.map(row => row.gmv);
  const days = currentRows.map(row => row.date.slice(5));
  let cumulative = 0;
  const cumSales = sales.map(value => { cumulative += value; return cumulative; });
  const portChanges = ports.map(port => {
    const prev = priorPorts.get(port.name);
    const comparable = comparablePorts(port, prev);
    return [port.name, money(port.sales), comparable ? signed(growth(port.sales, prev.sales)) : '—', comparable ? signed(growth(port.spend, prev.spend)) : '—',
      roi(port.roi), port.source];
  });
  const portActions = ports.map(port => {
    const target = reportPortTarget(data, port.name, monthly);
    return [port.name, money(target), money(port.sales), pct(percent(port.sales, target)),
      money(target != null && port.sales != null ? Math.max(0, target - port.sales) : null), money(port.spend), roi(port.roi), portAction(port, target)];
  });
  const summary = [
    `月度目标 ${money(monthTarget)}，已完成 ${money(monthActual)}，达成 ${pct(monthAttainment)}，时间进度 ${pct(monthTime)}。`,
    `剩余缺口 ${money(gap)}${gap != null && remaining > 0 ? `，剩余 ${remaining} 天日均需回款 ${money(gap / remaining)}` : ''}。`,
    `支付金额较${compareName} ${signed(growth(a.gmv, b.gmv))}，转化率差 ${signed(points(a.conversion, b.conversion), ' pp')}，客单价变化 ${signed(growth(a.asp, b.asp))}。`,
    `退款率 ${pct(a.refundRate)}，毛利率 ${pct(finance.current.grossMargin)}，销售利润 ${money(finance.current.profit)}。`,
    ...(current.complete ? [] : ['本期为月累计，对照上月及去年同期的整月可用数据。']),
  ];
  const trend = reportChart([['累计支付（万元）', cumSales], ['日支付（万元）', sales]], days, 'money', 'line');
  const goal = monthGoalChart(monthAttainment);
  const factor = reportCompareRows([
    ['店铺 KPI 回款', 'kpi'], ['Shop 支付金额', 'gmv'], ['访客数', 'visitors', false, count],
    ['支付转化率', 'conversion', true], ['客单价', 'asp'], ['退款率', 'refundRate', true],
  ], { ...a, kpi: model.kpiActual }, { ...mom, kpi: reportKpi(priorFinance, mom) }, { ...yoy, kpi: reportKpi(yearFinance, yoy) });
  const average = ratio(a.gmv, currentRows.length);
  const cadence = table(['日期', '支付金额', '访客', '转化率', '客单价', '退款率', '判断'], currentRows.map(row => {
    const day = aggregate([row]);
    const label = average == null ? '—' : day.gmv < average * 0.7 ? '低于日均' : day.gmv > average * 1.3 ? '高于日均' : '常规';
    return [row.date, money(day.gmv), count(day.visitors), pct(day.conversion), money(day.asp), pct(day.refundRate), label];
  }));
  const top = products.slice(0, 10);
  const riskRows = top.map(row => [row.name, pct(row.share), money(row.gmv), pct(row.refundRate),
    `${pct(row.grossMargin)} / ${pct(row.paidShare)}`, row.risk.join('、') || '观察', row.action]);
  const names = top.map(row => row.name);
  const actions = reportActions(model);
  return monthKpis(model) + reportBox('经营结论', '管理摘要', reportList(summary), 12, 'report-blue')
    + reportBox('月度节奏', '累计 / 日成交', '<h5>月度累计与日成交趋势</h5>' + trend, 8)
    + reportBox('目标达成', '回款 / 时间进度', goal + `<p class="report-hint">达成 ${pct(monthAttainment)} · 时间进度 ${pct(monthTime)}</p>`, 4)
    + reportBox('增长归因', 'UV × CVR × 客单', table(['指标', '本月', '上月', '环比', '去年同期', '同比'], factor)
      + table(['因素', '影响金额', '贡献占比', '判断'], reportTrendImpact(a, b))
      + `<details class="report-details"><summary>日度经营节奏</summary>${cadence}</details>`, 6)
    + reportBox('利润质量', '财务与商品口径', monthFinanceReview(model, priorFinance, yearFinance), 6)
    + reportBox('费用效能复盘', '营收 · 成本 · 费用 · 渠道效率', monthExpenses(model))
    + reportBox('渠道端口矩阵', '固定业务顺序', `<div class="report-port-grid">${ports.map(port =>
      `<div><b>${port.name}</b><strong>${money(port.sales)}</strong><small>花费 ${money(port.spend)} · ROI ${roi(port.roi)}</small><span>${port.source}</span></div>`).join('')}</div>`, 7)
    + reportBox('付费场景拆分', '付费窗口分开汇总', reportCoverage(paid) + table(
      ['端口', '本月成交', '成交变化', '花费变化', '本月 ROI', '拆分口径'], portChanges) + reportPortRowsTable(paid.scenes), 5)
    + reportBox('端口贡献图', '成交 / 花费 / ROI', reportChart([
      ['成交 / 回款（万元）', ports.map(row => row.sales)], ['花费（万元）', ports.map(row => row.spend)],
    ], ports.map(row => row.name), 'money') + `<details class="report-details"><summary>展开端口 ROI 图</summary>${reportChart(
      [['ROI', ports.map(row => row.roi)]], ports.map(row => row.name))}</details>`, 6)
    + reportBox('渠道动作优先级', '目标、缺口与效率', table(['渠道', '目标', '实际', '达成率', '缺口', '花费', 'ROI', '动作优先级'], portActions), 6)
    + reportBox('单品成交榜', '商品日明细', top.length ? `<ol class="report-product-list">${top.map(row =>
      `<li><b>${escapeHtml(row.name)}</b><span>${money(row.gmv)}</span><small>${escapeHtml(row.id)} · 毛利率 ${pct(row.grossMargin)}</small></li>`).join('')}</ol>`
      : '<p class="report-hint">本期缺少单品数据。</p>', 5)
    + reportBox('单品风险与利润', '成交集中、退款与付费依赖', table(['单品', '成交占比', '成交', '退款率', '毛利率 / 付费占比',
      '风险判断', '优化动作'], riskRows) + `<details class="report-details"><summary>展开单品利润明细</summary>${monthProductFinance(products, finance.target.grossMargin)}</details>`, 7)
    + reportBox('单品结构图', '成交 / 毛利 / 依赖', reportChart([
      ['支付金额（万元）', top.map(row => row.gmv)], ['毛利额（万元）', top.map(row => row.grossProfit)],
    ], names, 'money') + `<details class="report-details"><summary>查看付费依赖</summary>${reportChart(
      [['付费占比（%）', top.map(row => row.paidShare)]], names)}</details>`, 6)
    + reportBox('商品风险图', '成交规模 × 毛利率 / 退款率', monthRiskChart(products), 6)
    + reportBox('下月动作看板', '问题归因 + 执行动作', table(['问题类型', '判断信号', '可能原因', '调整方向'], [
      ['目标达成不足', '达成率低于时间进度', '核心单品或确定性排期不足', '按缺口拆到商品、渠道和日期'],
      ['成交增长乏力', '支付金额环比或同比下降', '流量、转化率、客单价下降', '按影响因素拆解定位主因'],
      ['利润质量承压', '低毛利或高退款', '成本、折扣、售后或低效投放', '复核商品价格、毛利与效率'],
    ]) + table(['优先级', '动作', '跟踪指标'], actions.map(([name, action, check], index) =>
      [`${index + 1}. ${name}`, action, check])) + reportActionCards(actions));
}

function renderReport(root, context) {
  const { tab, data, navigate } = context;
  const weekly = tab !== 'monthly';
  const short = weekly ? '周' : '月';
  const periods = periodChoices(data.store ?? [], weekly);
  const best = weekly ? periods.find(period => period.complete) ?? periods[0] : periods[0];
  root.innerHTML = `<div class="report-center">
    <div class="report-center-summary"><h2>经营报告中心</h2>
      <div class="support-report-tags">${['KPI 同源', '端口同源', '单品同源', '可视化分析', '优化建议'].map(text => `<span>${text}</span>`).join('')}</div></div>
    <div class="report-mode-selector" aria-label="报告类型">
      <button type="button" data-report="weekly" aria-pressed="${weekly}">5.1 周报</button>
      <button type="button" data-report="monthly" aria-pressed="${!weekly}">5.2 月报</button>
    </div>
    ${best ? `<form class="support-filters report-period" id="report-form"><b>周期筛选</b>
      ${select('period', `选择${short}`, periods.map(period => [period.start,
        weekly ? `自然周 ${period.start} ~ ${period.periodEnd}（周一–周日，已覆盖${period.coverage}天）`
          : `${period.start.slice(0, 4)}年${+period.start.slice(5, 7)}月`]), best.start)}
      ${select('compare', '对比基准', [['prev', `环比上${short}`], ['yoy', `同比去年同${short}`]], 'prev')}
      <button type="submit" class="support-primary">生成${short}报</button></form>` : ''}
    <div id="report-result" aria-live="polite"></div></div>`;
  const result = root.querySelector('#report-result');
  const form = root.querySelector('#report-form');
  for (const button of root.querySelectorAll('[data-report]')) {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-pressed') === 'true') return;
      if (navigate) navigate('report', button.dataset.report);
      else renderReport(root, { ...context, tab: button.dataset.report });
    });
  }
  if (!best) {
    result.innerHTML = '<div class="support-empty">没有可用于生成报告的店铺日数据</div>';
    return;
  }

  let model;
  function generate() {
    const { period: start, compare } = Object.fromEntries(new FormData(form));
    const current = periods.find(item => item.start === start);
    model = reportContext(data, current, compare, weekly);
    const span = weekly ? `${current.start} ~ ${current.end} · ${compare === 'yoy' ? '去年同期' : '上周环比'} ${model.prior.start} ~ ${model.prior.end} · 月目标 / 周效率 / 渠道 × 单品联动`
      : `${current.start.slice(0, 4)}年${+current.start.slice(5, 7)}月 · 截至 ${current.end} · KPI / 渠道 / 单品 / 利润同源`;
    result.innerHTML = `<div class="report-dashboard-local"><header class="report-dashboard-title">
      <div><h3>${weekly ? '周度经营决策报告' : '月度经营驾驶舱'}</h3><p>${span}</p></div>
      <div class="report-dashboard-chips"><span>KPI同源</span><span>${weekly ? '端口同源' : '月度达成'}</span>
      <span>${weekly ? '单品归因' : '渠道矩阵'}</span><span title="${escapeHtml(model.risks.join('、'))}">${model.risks.length} 个关注点</span></div>
      </header>${weekly ? weeklyReport(model) : monthlyReport(model)}</div>`;
    if (weekly) result.querySelector('#report-product-table').innerHTML = weeklyProductTable(model.products, '');
  }

  form.addEventListener('submit', event => { event.preventDefault(); generate(); });
  form.addEventListener('change', generate);
  result.addEventListener('change', event => {
    if (event.target.name === 'report-product-group') {
      result.querySelector('#report-product-table').innerHTML = weeklyProductTable(model.products, event.target.value);
    }
  });
  result.addEventListener('click', event => {
    const risk = event.target.closest('[data-risk-product]');
    if (risk) {
      result.querySelector('[data-risk-summary]').hidden = true;
      for (const panel of result.querySelectorAll('[data-risk-panel]')) panel.hidden = panel.dataset.riskPanel !== risk.dataset.riskProduct;
      return;
    }
    const button = event.target.closest('button[data-channel],button[data-funnel]');
    if (!button) return;
    const kind = button.hasAttribute('data-channel') ? 'channel' : 'funnel';
    for (const item of result.querySelectorAll(`button[data-${kind}]`)) item.setAttribute('aria-pressed', String(item === button));
    for (const panel of result.querySelectorAll(`[data-${kind}-panel]`)) panel.hidden = panel.getAttribute(`data-${kind}-panel`) !== button.dataset[kind];
  });
  result.addEventListener('keydown', event => {
    if (!event.target.matches('[data-risk-product]') || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    event.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  generate();
}

function marketRecords(rows) {
  return rows.filter(row => !row.brand && row.categoryPath?.length).map(row => ({
    ...row, gmv: row.sales ?? row.gmv, volume: row.volume ?? row.orders,
  }));
}

function marketBucket(rows, depth) {
  const groups = groupBy(rows.filter(row => row.categoryPath.length >= depth),
    row => JSON.stringify(row.categoryPath.slice(0, depth)));
  return new Map([...groups.entries()].map(([key, group]) => [key, {
    path: JSON.parse(key), gmv: sumBy(group, 'gmv'), volume: sumBy(group, 'volume'),
  }]));
}

function marketStats(records, start, end, depth) {
  const monthIndex = date => +date.slice(0, 4) * 12 + +date.slice(5, 7);
  const span = monthIndex(end) - monthIndex(start) + 1;
  const current = filterDates(records, start, end);
  const previous = filterDates(records, monthAdd(start, -span), monthAdd(end, -span));
  const samePeriod = filterDates(records, monthAdd(start, -12), monthAdd(end, -12));
  const prev = marketBucket(previous, depth);
  const yoy = marketBucket(samePeriod, depth);
  const currentTotal = sumBy(current, 'gmv');
  const prevTotal = sumBy(previous, 'gmv');
  const yoyTotal = sumBy(samePeriod, 'gmv');
  return [...marketBucket(current, depth).entries()].map(([key, row]) => {
    const before = prev.get(key)?.gmv;
    const lastYear = yoy.get(key)?.gmv;
    const share = percent(row.gmv, currentTotal);
    const mom = growth(row.gmv, before);
    const annualGrowth = growth(row.gmv, lastYear);
    const shareChange = points(share, percent(before, prevTotal));
    const yoyShareChange = points(share, percent(lastYear, yoyTotal));
    const positive = value => Math.max(0, value ?? 0);
    const score = 0.35 * positive(share) + 0.3 * positive(mom) + 0.35 * positive(annualGrowth) +
      6 * positive(shareChange) + Math.min(20, row.gmv / 1e6);
    return { ...row, name: row.path.at(-1), before, lastYear, share, mom, yoy: annualGrowth, shareChange, yoyShareChange, score };
  }).sort((a, b) => b.gmv - a.gmv);
}

function marketQueryRows(rows) {
  const categories = marketRecords(rows);
  const all = list(categories.map(row => row.date));
  return all.flatMap(date => [1, 2, 5].flatMap(depth => marketStats(categories, date, date, depth).map(row => ({
    ...row, date, month: date.slice(0, 7), year: date.slice(0, 4), level: depth === 1 ? '一级' : depth === 2 ? '二级' : '细分',
    path1: row.path[0], path2: row.path[1], path3: row.path[2], path4: row.path[3], path5: row.path[4],
    score: Math.round(row.score * 10) / 10,
  }))));
}

function marketDecision(row, detailed = false) {
  const highest = Math.max(row.mom ?? 0, row.yoy ?? 0);
  if (detailed && highest >= 30 && row.score >= 35) return '重点布局';
  if (detailed && highest >= 10 && row.score >= 25) return '小步加码';
  if (row.mom < 0 && row.yoy < 0) return detailed ? '谨慎投入' : '同环比下滑';
  if (!detailed && highest >= 20) return '增长较快';
  return '持续观察';
}

function renderMarket(root, { data }) {
  const records = marketRecords(data.market ?? []);
  const months = list(records.map(row => row.date));
  if (!months.length) {
    root.innerHTML = card('📈 六、市场趋势', '<div class="support-empty">当前数据没有市场品类明细。</div>');
    return;
  }
  const latest = months.at(-1);
  const firstThisYear = months.find(month => month.slice(0, 4) === latest.slice(0, 4));
  let start = firstThisYear;
  let end = latest;
  const path = ['', '', '', ''];
  root.innerHTML = card('📈 六、市场趋势', '<form class="support-market-filter" id="market-filter"></form><div id="market-overview"></div>',
    '按连续月份汇总品类规模、环比、同比和份额变化。选择品类可逐级下钻。') + '<div id="market-detail"></div>';
  const form = root.querySelector('#market-filter');
  const overview = root.querySelector('#market-overview');
  const detail = root.querySelector('#market-detail');
  const monthOptions = months.map(month => [month, month.slice(0, 7)]);
  const names = ['一级品类', '二级品类', '三级品类', '四级品类'];
  const matches = (row, levels) => levels.every((name, index) => !name || row.categoryPath[index] === name);

  function buildForm() {
    form.innerHTML = `<div class="support-filters">
      ${select('start', '时间范围', monthOptions, start)} ${select('end', '至', monthOptions, end)}
      <button type="button" data-market-reset="time">重置今年</button></div>
      <div class="support-filters">${path.map((name, index) =>
        select('path' + index, names[index], optionList(records.filter(row => matches(row, path.slice(0, index)))
          .map(row => row.categoryPath[index])), name)).join('')}
      <button type="button" data-market-reset="category">重置品类</button></div>`;
  }

  function draw() {
    const filtered = records.filter(row => matches(row, path));
    const primary = marketStats(filtered, start, end, 1);
    const rootName = path[0] || primary.find(row => row.name.includes('护肤'))?.name || primary[0]?.name;
    const focus = filtered.filter(row => row.categoryPath[0] === rootName);
    const secondary = marketStats(filtered, start, end, 2).filter(row => row.path[0] === rootName);
    const deep = marketStats(filtered, start, end, 5).filter(row => row.path[0] === rootName).sort((a, b) => b.score - a.score);
    const current = filterDates(filtered, start, end);
    const selected = path.filter(Boolean).join(' / ') || rootName || '全部品类';
    const top = primary.find(row => row.name === rootName);
    overview.innerHTML = tiles([
      { label: '市场销售额', value: money(sumBy(current, 'gmv')), detail: `${start.slice(0, 7)} 至 ${end.slice(0, 7)}` },
      { label: '关注品类', value: selected, detail: `成交 ${money(top?.gmv)}` },
      { label: '品类份额', value: pct(top?.share), detail: `同比变化 ${signed(top?.yoyShareChange, ' pp')}` },
      { label: '品类同比', value: signed(top?.yoy), detail: `区间环比 ${signed(top?.mom)}` },
    ]);
    const selectedMonths = months.filter(month => month >= start && month <= end);
    const salesByMonth = groupBy(focus, row => row.date);
    const trend = plot([
      { label: '所选品类销售额（万元）', values: selectedMonths.map(month => {
        const total = sumBy(salesByMonth.get(month) ?? [], 'gmv');
        return total == null ? null : total / 10000;
      }) },
    ], { labels: selectedMonths.map(month => month.slice(0, 7)) });
    const salesPlot = (rows, label, value) => plot([{ label, values: rows.map(value) }],
      { labels: rows.map(row => row.name), type: 'bar' });
    const commonCols = ['销售额', '同期销售额', '份额', '环比', '同比'];
    const cells = row => [money(row.gmv), money(row.lastYear), pct(row.share), signed(row.mom), signed(row.yoy)];
    const first = table(['一级品类', ...commonCols, '份额变化', '趋势判断'], primary.map(row =>
      [row.name, ...cells(row), signed(row.shareChange, ' pp'), marketDecision(row)]));
    const second = table(['一级品类', '二级品类', ...commonCols, '份额变化', '同比份额变化', '经营判断'],
      secondary.map(row => [row.path[0], row.name, ...cells(row), signed(row.shareChange, ' pp'),
        signed(row.yoyShareChange, ' pp'), marketDecision(row)]));
    const deepTable = table(['品类名称', '品类路径', ...commonCols, '机会分', '布局动作'], deep.map(row =>
      [row.name, row.path.join(' / '), ...cells(row), row.score.toFixed(1), marketDecision(row, true)]));
    const conclusions = [];
    if (top) conclusions.push(`${rootName}所选区间销售额 ${money(top.gmv)}，占所选市场 ${pct(top.share)}，同比 ${signed(top.yoy)}。`);
    if (secondary[0]) conclusions.push(`规模最大的二级品类为 ${secondary[0].name}，销售额 ${money(secondary[0].gmv)}。`);
    if (deep[0]) conclusions.push(`机会分最高的细分类目为 ${deep[0].name}，得分 ${deep[0].score.toFixed(1)}，信号为“${marketDecision(deep[0], true)}”。`);
    detail.innerHTML = card('🧴 6.1 护肤赛道大盘与一级对比', trend + first) +
      card('🧭 6.2 护肤二级结构：规模、增长与份额变化', salesPlot(secondary, '销售额（万元）', row => row.gmv / 10000) + second,
        '区间环比采用紧邻的等长月份，同比使用去年同一月份。') +
      card('🔎 6.3 护肤细分机会：三-五级布局清单', salesPlot(deep.slice(0, 10), '机会分', row => row.score) + deepTable,
        '机会分综合所选市场份额、正向增长、份额提升和销售规模。') +
      card('💡 6.4 护肤优先结论与机会补充', conclusions.length ? `<ul class="support-insights">${conclusions.map(line =>
        `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '<p class="support-muted">当前条件缺少可用数据。</p>');
  }

  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('change', event => {
    const field = event.target.name;
    if (field === 'start') start = event.target.value;
    if (field === 'end') end = event.target.value;
    if (start > end) [start, end] = [end, start];
    if (field.startsWith('path')) {
      const index = +field.slice(4);
      path[index] = event.target.value;
      path.fill('', index + 1);
    }
    buildForm();
    form.elements[field]?.focus();
    draw();
  });
  form.addEventListener('click', event => {
    const target = event.target.closest('[data-market-reset]');
    if (!target) return;
    if (target.dataset.marketReset === 'time') [start, end] = [firstThisYear, latest];
    else path.fill('');
    buildForm();
    form.querySelector(`[data-market-reset="${target.dataset.marketReset}"]`)?.focus();
    draw();
  });
  buildForm();
  draw();
}

const metricGroups = {
  店铺经营: {
    source: '店铺日数据、月度回款与利润表',
    metrics: [
      ['GMV', '订单成交规模', '订单金额合计', '与支付金额和回款同时核对'],
      ['支付金额 / 回款', '买家支付规模与经营回款', '支付金额为已支付订单金额；回款以业务回款表为准', '用于经营复盘和目标追踪'],
      ['含税收入', '含税口径下确认的经营收入', '已确认含税收入金额求和', '对账时核对回款与收入确认差异'],
      ['退款金额 / 退款率', '退款规模和相对支付金额的占比', '退款率 = 退款金额 ÷ 支付金额', '定位售后压力较高的渠道或商品'],
      ['支付订单数', '完成支付的订单笔数', '支付成功订单计数', '用于核对订单增长'],
      ['支付件数', '支付订单中的商品件数', '已支付订单商品数量求和', '分析动销和连带销售'],
      ['日均销售', '经营周期内的平均日销售金额', '周期支付金额 ÷ 周期天数', '比较不同长度周期的销售强度'],
      ['同比增长率', '较去年同期的变动比例', '（本期 − 去年同期）÷ 去年同期', '同比基数缺失时展示空值'],
    ],
  },
  流量转化: {
    source: '店铺日数据、单品数据与流量来源明细',
    metrics: [
      ['访客数 UV', '访问店铺或单品的人数', '统计范围内访客去重计数', '分析流量规模与渠道贡献'],
      ['浏览量 PV', '页面被访问的次数', '页面访问事件计数', '衡量访问深度'],
      ['支付买家数', '完成支付的用户规模', '统计范围内支付买家计数', '结合访客数拆解成交变化'],
      ['支付转化率', '访客转为支付买家的比例', '支付买家数 ÷ 访客数', '识别页面和活动的承接效率'],
      ['客单价', '每位支付买家的平均支付金额', '支付金额 ÷ 支付买家数', '分析价格带和套组贡献'],
      ['UV 价值', '每位访客对应的平均支付金额', '支付金额 ÷ 访客数', '比较不同来源的流量质量'],
      ['加购人数 / 加购率', '访问后产生加购的用户规模', '加购率 = 加购人数 ÷ 访客数', '衡量购买兴趣和蓄水'],
      ['收藏人数 / 收藏率', '访问后产生收藏的用户规模', '收藏率 = 收藏人数 ÷ 访客数', '观察商品兴趣和再触达机会'],
      ['免费流量访客', '归因于免费来源的访客', '免费来源访客数合计', '判断自然流量规模'],
      ['付费流量访客', '归因于付费来源的访客', '付费来源访客数合计', '和投入及转化效率联合查看'],
      ['免费 / 付费流量成交', '流量来源归因后的成交贡献', '对应来源支付金额合计', '拆解自然与投放成交来源'],
    ],
  },
  利润费用: {
    source: '经营利润表、成本及费用明细',
    metrics: [
      ['未税收入', '扣除价内税后的确认收入', '未税收入项目合计', '作为利润率和费用率的基数'],
      ['总成本', '与商品销售对应的成本', '商品销售成本项目合计', '跟踪货品成本结构'],
      ['成本率', '销售成本占未税收入的比例', '总成本 ÷ 未税收入', '判断成本对毛利的影响'],
      ['毛利 / 毛利率', '扣除商品销售成本后的利润', '毛利 = 未税收入 − 总成本；毛利率 = 毛利 ÷ 未税收入', '比较各周期和商品的盈利空间'],
      ['销售利润 / 销售利润率', '进一步扣减费用和税金后的结果', '销售利润 = 毛利 − 期间费用 − 税金及附加；利润率 = 销售利润 ÷ 未税收入', '核对成交带来的利润'],
      ['期间费用', '统计期内计入销售损益的经营费用', '相关经营费用科目合计', '分析费用变化来源'],
      ['期间费用率', '期间费用占未税收入的比例', '期间费用 ÷ 未税收入', '对比销售与费用增长节奏'],
      ['税金及附加', '计入损益的相关税费金额', '对应税金及附加科目合计', '完成经营利润对账'],
      ['推广服务费', '投放和推广相关的服务费用', '相关推广费用科目合计', '结合投放 ROI 查看'],
      ['达人服务费', '达人合作相关的服务费用', '相关达人费用科目合计', '核对合作成本与实际收益'],
      ['平台费用', '平台佣金和相关服务费', '平台费用科目合计', '查看平台侧扣费'],
      ['促销费用', '活动折扣、促销等相关费用', '促销费用科目合计', '复盘活动利润'],
    ],
  },
  会员老客: {
    source: '会员、人群及店铺日数据',
    metrics: [
      ['新会员数 / 入会人数', '统计周期内新加入的会员规模', '新增会员人数合计', '衡量会员资产增长'],
      ['入会率', '访客转成新会员的比例', '新增会员人数 ÷ 访客数', '核对入会入口和权益吸引力'],
      ['会员成交金额', '会员产生的支付规模', '会员支付金额合计', '衡量会员贡献'],
      ['会员成交占比', '会员支付金额占店铺支付金额的比例', '会员支付金额 ÷ 店铺支付金额', '比较会员和非会员贡献'],
      ['支付会员数', '统计范围内完成支付的会员', '支付会员计数', '作为会员客单价的分母'],
      ['会员客单价', '每位支付会员的平均成交金额', '会员成交金额 ÷ 支付会员数', '观察会员消费质量'],
      ['新客成交金额', '首次成交人群的支付金额', '新客支付金额合计', '评估拉新带来的成交'],
      ['老客成交金额', '老客户人群的支付金额', '老客支付金额合计', '观察复购规模'],
      ['新客 / 老客成交占比', '对应人群贡献店铺成交的比例', '对应人群成交金额 ÷ 店铺成交金额', '分析拉新与复购结构'],
      ['新客 / 老客客单价', '对应人群的平均支付金额', '对应人群成交金额 ÷ 对应支付买家数', '选择适配人群的商品组合'],
    ],
  },
  渠道KPI: {
    source: '店铺及渠道目标表、推广端口与达播报表',
    metrics: [
      ['目标达成率', '实际值相对目标的完成程度', '实际值 ÷ 同口径目标', '和时间进度一起判断缺口'],
      ['花费进度', '消耗金额占计划金额的比例', '实际花费 ÷ 预算花费', '判断预算使用节奏'],
      ['实际 ROI', '推广花费带来的归因成交', '归因成交金额 ÷ 推广花费', '评估投入产出效率'],
      ['去年同期 ROI', '去年同期的投入产出基准', '去年同期归因成交金额 ÷ 去年同期推广花费', '比较相同口径的推广效率'],
      ['ROI 同比', '当前与去年同期 ROI 的绝对差值', '当前 ROI − 去年同期 ROI', '用点数表示效率变化'],
      ['渠道销售贡献', '某渠道在全部渠道中的销售比重', '渠道成交 ÷ 全部渠道成交', '分析渠道结构'],
      ['达播回款', '达人合作直播相关的回款', '匹配到达播的商品回款求和', '核对合作场次收益'],
      ['达播总花费', '达人合作对应的经营支出', '佣金 + 坑位费 + 推广费', '结合达播回款分析效率'],
    ],
  },
  付费推广: {
    source: '推广端口、场景与商品投放明细',
    metrics: [
      ['站内付费成交', '站内推广归因的成交', '原站 KPI 汇总货品全站、关键词和人群推广的 15 天直接成交', '与单日归因分析区分'],
      ['货品全站推广成交', '货品全站推广场景带来的成交', '场景归因直接成交金额求和', '分析货品放量和投产'],
      ['关键词推广成交', '关键词推广归因的支付金额', '对应关键词推广记录支付金额合计', '观察搜索投放贡献'],
      ['人群推广成交', '人群定向推广归因的支付金额', '对应人群推广记录支付金额合计', '衡量定向人群的成交'],
      ['自播付费成交', '自播投流对应的归因成交', '超级直播成交 + 短直联动成交', '分析直播间投流收益'],
      ['逛逛付费成交', '逛逛短视频付费推广贡献的成交', '原站 KPI 采用超级短视频 15 天直接成交金额', '核对内容投流效果'],
      ['花费', '统计期内的推广消耗', '推广消耗金额合计', '结合成交和效率分析'],
      ['直接成交 ROI', '直接归因成交的投入产出', '直接成交金额 ÷ 花费', '比较推广主体直接效率'],
      ['总成交 ROI', '总归因成交的投入产出', '总成交金额 ÷ 花费', '衡量整体归因贡献'],
      ['展现量', '推广内容被展示的次数', '展现事件计数', '衡量触达规模'],
      ['点击量 / 点击率', '推广点击规模与展现转点击效率', '点击率 = 点击量 ÷ 展现量', '检查素材和定向的吸引力'],
      ['平均点击花费 CPC / PPC', '获得一次点击的平均成本', '花费 ÷ 点击量', '观察流量获客成本'],
      ['点击转化率', '点击转化为支付的比例', '归因成交人数或笔数 ÷ 点击量', '评估点击质量和页面承接'],
      ['新客成交占比', '投放成交中新客的金额占比', '新客成交金额 ÷ 投放成交金额', '区分拉新与复购贡献'],
    ],
  },
  自播达播: {
    source: '自播数据、达播合作场次及成本明细',
    metrics: [
      ['自播成交金额', '由店铺自播产生的成交', '自播归因的成交金额合计', '观察店铺直播贡献'],
      ['自播成交占比', '自播在去除达播成交后的占比', '自播成交 ÷（店铺支付金额 − 达播 GMV）', '核对店播贡献的变化'],
      ['直播观看人数 / 观看次数', '观看用户规模与观看事件数', '直播源中对应人数和次数字段', '判断直播流量变化'],
      ['直播转化率', '观看用户转为成交用户的比例', '直播成交人数 ÷ 观看人数', '比较不同场次承接'],
      ['直播客单价', '直播成交用户平均贡献的支付金额', '直播成交金额 ÷ 直播成交人数', '核对直播价格带'],
      ['达播净利润 / 净利润率', '达人合作回款扣减相关成本费用后的利润表现', '达播净利润率 = 达播净利润 ÷ 达播回款', '分析佣金和坑位费影响'],
    ],
  },
  内容种草: {
    source: '内容平台、商品种草及费用明细',
    metrics: [
      ['逛逛内容成交', '由内容种草归因的成交', '对应种草成交金额合计', '衡量内容带来的购买'],
      ['逛逛内容花费', '内容制作及分发相关投入', '内容费用 + 推流费用 + 采买费用', '比较内容投入产出'],
      ['内容查看人数', '查看内容的用户规模', '内容统计中的查看用户计数', '评估内容触达'],
      ['有效查看人数', '符合有效观看条件的用户规模', '单品内容有效查看人数', '作为单品种草转化分母'],
      ['种草成交人数 / 转化率', '内容查看用户转为买家的情况', '种草成交人数 ÷ 对应查看人数', '比较达人和商品种草效率'],
      ['互动率 / 停留时长', '互动和内容停留表现', '互动率 = 互动人数 ÷ 查看人数；人均停留 = 总停留时长 ÷ 查看人数', '评估内容吸引力'],
    ],
  },
};

function renderMetricLibrary(root) {
  const groups = Object.keys(metricGroups);
  let active = groups[0];
  root.innerHTML = card('📚 天猫经营指标库', `<div class="support-filters"><label>搜索指标 <input id="metric-search" type="search" placeholder="输入名称、公式或口径"></label></div>
    <div class="support-metric-layout"><div class="support-metric-nav" aria-label="指标分类"></div><div class="support-metrics" aria-live="polite"></div></div>`,
    '按店铺、流量、利润和投放等业务维度查询指标定义、公式和来源。');
  const input = root.querySelector('#metric-search');
  const nav = root.querySelector('.support-metric-nav');
  const results = root.querySelector('.support-metrics');
  function draw() {
    nav.innerHTML = groups.map(group => `<button type="button" data-group="${group}" aria-pressed="${group === active}">${group}</button>`).join('');
    const keyword = input.value.trim().toLowerCase();
    const selected = keyword ? groups : [active];
    const cards = selected.flatMap(group => metricGroups[group].metrics.filter(row =>
      !keyword || [group, metricGroups[group].source, ...row].join(' ').toLowerCase().includes(keyword))
      .map(([name, meaning, formula, use]) => `<article class="support-metric"><h3>${escapeHtml(name)}</h3>
        <p><strong>含义</strong> ${escapeHtml(meaning)}</p><p><strong>公式</strong> <code>${escapeHtml(formula)}</code></p>
        <p><strong>数据来源</strong> ${escapeHtml(metricGroups[group].source)}</p><p><strong>使用场景</strong> ${escapeHtml(use)}</p></article>`));
    results.innerHTML = cards.join('') || '<div class="support-empty">未找到匹配指标。</div>';
  }
  nav.addEventListener('click', event => {
    const button = event.target.closest('[data-group]');
    if (!button) return;
    active = button.dataset.group;
    input.value = '';
    draw();
    nav.querySelector('[aria-pressed="true"]')?.focus();
  });
  input.addEventListener('input', draw);
  draw();
}

const renderers = { query: renderQuery, report: renderReport, market: renderMarket, metriclib: renderMetricLibrary };

export function renderSupport(root, context) {
  renderers[context.page]?.(root, context);
}
