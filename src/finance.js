import { aggregate, compare, demoData, filterDates } from './data.js';
import { card, escapeHtml, fmt, plot, table } from './ui.js';
import { attributionSummary } from './attribution.js';

const amounts = ['taxRevenue', 'netRevenue', 'cost', 'expenses', 'taxes', 'grossProfit', 'profit'];
const pnlLines = [
  ['taxRevenue', '含税收入'], ['netRevenue', '未税收入'], ['cost', '总成本'],
  ['grossProfit', '毛利额'], ['grossMargin', '毛利率', true], ['expenses', '期间费用'],
  ['taxes', '税金及附加'], ['profit', '销售利润'], ['margin', '销售利润率', true],
  ['costRate', '成本率', true], ['expenseRate', '费用率', true],
];
const expenseShares = [
  ['平台费用', 0.32], ['达人服务费', 0.20], ['促销费用', 0.16], ['运营服务费', 0.14],
  ['商品流转费', 0.11], ['软件服务费', 0.07],
];
const dayMs = 86_400_000;

function valid(value) {
  return Number.isFinite(value);
}

function ratio(value, base) {
  return valid(value) && valid(base) && base > 0 ? value / base * 100 : null;
}

function difference(value, prior) {
  return valid(value) && valid(prior) ? value - prior : null;
}

function relativeChange(value, prior) {
  return valid(value) && valid(prior) && prior !== 0 ? (value - prior) / Math.abs(prior) * 100 : null;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthEnd(month) {
  const date = new Date(month + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return dateKey(date);
}

function priorYear(date) {
  const year = String(Number(date.slice(0, 4)) - 1).padStart(4, '0');
  const month = year + date.slice(4, 7);
  return Math.min(Number(date.slice(8)), Number(monthEnd(month).slice(8))) === Number(date.slice(8))
    ? year + date.slice(4) : monthEnd(month);
}

function financialRow(row, demo) {
  const { netRevenue, cost, expenses, taxes, spend } = row;
  const grossProfit = row.grossProfit ?? difference(netRevenue, cost);
  const profit = row.profit ?? (valid(grossProfit) && valid(expenses) && valid(taxes) ? grossProfit - expenses - taxes : null);
  const output = { ...row, grossProfit, profit };
  if (demo && valid(expenses) && valid(spend) && expenses >= spend && spend >= 0) {
    output.expenseBreakdown = Object.fromEntries(expenseShares.map(([label, share]) => [label, (expenses - spend) * share]));
    output.expenseBreakdown['推广服务费'] = spend;
  }
  return output;
}

function financialTotals(rows) {
  const values = Object.fromEntries(amounts.map(key => {
    const known = rows.length && rows.every(row => valid(row[key]));
    return [key, known ? rows.reduce((sum, row) => sum + row[key], 0) : null];
  }));
  return {
    ...values,
    grossMargin: ratio(values.grossProfit, values.netRevenue),
    margin: ratio(values.profit, values.netRevenue),
    costRate: ratio(values.cost, values.netRevenue),
    expenseRate: ratio(values.expenses, values.netRevenue),
  };
}

function expenseTotals(rows) {
  const knownRows = rows.filter(row => row.expenseBreakdown && Object.values(row.expenseBreakdown).some(valid));
  if (!knownRows.length || knownRows.length !== rows.length) return {};
  const totals = new Map();
  for (const row of knownRows) {
    for (const [name, value] of Object.entries(row.expenseBreakdown)) {
      if (valid(value)) totals.set(name, (totals.get(name) ?? 0) + value);
    }
  }
  return Object.fromEntries(totals);
}

function groupByMonth(rows) {
  const months = new Map();
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(row);
  }
  return months;
}

export const demoDays = demoData.store.map(row => financialRow(row, true));
export const demoMonthly = Array.from(groupByMonth(demoDays), ([month, rows]) => {
  if (rows.length !== Number(monthEnd(month).slice(8))) return null;
  return { date: month + '-01', ...financialTotals(rows), expenseBreakdown: expenseTotals(rows), source: '演示闭月快照' };
}).filter(Boolean);

function financialSource(data) {
  if (data === demoData) return { daily: demoDays, monthly: demoMonthly };
  return {
    daily: (data.financeDaily?.length ? data.financeDaily : data.store ?? []).map(row => financialRow(row, false)),
    monthly: (data.financeMonthly ?? []).map(row => financialRow(row, false)),
  };
}

function latestDate({ daily, monthly }) {
  const dates = [
    ...daily.filter(row => amounts.some(key => valid(row[key]))).map(row => row.date),
    ...monthly.filter(row => amounts.some(key => valid(row[key]))).map(row => monthEnd(row.date.slice(0, 7))),
  ];
  return dates.sort().at(-1);
}

function periodsForRange({ daily, monthly }, start, end, cutoff) {
  if (!end || start > end) return [];
  const byMonth = groupByMonth(filterDates(daily, start, end));
  const monthlyByKey = new Map(monthly.map(row => [row.date.slice(0, 7), row]));
  const selectedMonths = new Set([...byMonth.keys(), ...monthlyByKey.keys()]);
  const months = [];
  for (const month of [...selectedMonths].sort()) {
    const first = month + '-01';
    const last = monthEnd(month);
    if (last < start || first > end) continue;
    const snapshot = monthlyByKey.get(month);
    const closed = snapshot && start <= first && end >= last;
    const rows = closed ? [snapshot] : (byMonth.get(month) ?? []);
    if (!rows.some(row => amounts.some(key => valid(row[key])))) continue;
    const mode = closed ? 'closed' : month === cutoff?.slice(0, 7) && cutoff < last ? 'mtd' : 'daily';
    const source = closed ? snapshot.source || '闭月实际' : mode === 'mtd' ? '本月日表 MTD' : '日表区间';
    const days = rows.map(row => row.date).sort();
    months.push({
      month, mode, source, rows,
      start: closed ? first : days[0], end: closed ? last : days.at(-1),
      current: financialTotals(rows),
    });
  }
  return months;
}

function budgetForRange(data, { start, end }) {
  const targets = data.financeTargets ?? data.targets ?? [];
  return financialTotals(targets.flatMap(row => {
    const first = row.date.slice(0, 7) + '-01';
    const last = monthEnd(first.slice(0, 7));
    const a = first > start ? first : start;
    const b = last < end ? last : end;
    if (a > b) return [];
    const scale = ((Date.parse(b) - Date.parse(a)) / dayMs + 1) / Number(last.slice(8));
    let source = row;
    if (data === demoData || data.demoProfile === "tmall") {
      const netRevenue = Math.round(row.taxRevenue / 1.13);
      const cost = Math.round(netRevenue * 0.355);
      const taxes = Math.round(netRevenue * 0.012);
      source = { ...row, netRevenue, cost, taxes, expenses: netRevenue - cost - taxes - row.profit };
    }
    const normalized = financialRow(source, false);
    return [Object.fromEntries(amounts.map(key => [key, valid(normalized[key]) ? normalized[key] * scale : null]))];
  }));
}

export function financeSummary(data, range, comparisonRange) {
  const source = financialSource(data);
  const cutoff = latestDate(source);
  const end = cutoff && cutoff < range.end ? cutoff : range.end;
  const currentPeriods = periodsForRange(source, range.start, end, cutoff);
  const prior = comparisonRange ?? { start: priorYear(range.start), end: priorYear(end) };
  const previousPeriods = currentPeriods.length ? periodsForRange(source, prior.start, prior.end, cutoff) : [];
  const currentRows = currentPeriods.flatMap(period => period.rows);
  const previousRows = previousPeriods.flatMap(period => period.rows);
  const previousByMonth = new Map(previousPeriods.map(period => [period.month, period.current]));
  const months = currentPeriods.map(({ rows, ...period }) => ({
    ...period,
    previous: previousByMonth.get(priorYear(period.month + '-01').slice(0, 7)) ?? financialTotals([]),
  }));
  return {
    start: range.start, end, hasData: currentPeriods.length > 0, cutoff, months,
    comparison: prior,
    current: financialTotals(currentRows), previous: financialTotals(previousRows), target: budgetForRange(data, range),
    expenses: expenseTotals(currentRows), previousExpenses: expenseTotals(previousRows),
  };
}

function money(value) {
  return valid(value) ? (value / 10000).toFixed(2) + '万' : '—';
}

function points(value) {
  if (!valid(value)) return '—';
  const displayed = Number(value.toFixed(2));
  return (displayed > 0 ? '+' : '') + displayed.toFixed(2) + ' pp';
}

function deltaMoney(value) {
  return valid(value) ? (value > 0 ? '+' : '') + money(value) : '—';
}

function deltaPercent(value) {
  return valid(value) ? (value > 0 ? '+' : '') + fmt(value, 'pct') : '—';
}

function financeTiles(items) {
  return '<div class="finance-tiles">' + items.map(({ label, value, detail, color }) =>
    `<div class="finance-tile" style="--tile-accent:${color ?? '#4f46e5'}">
      <div>${escapeHtml(label)}</div><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small>
    </div>`).join('') + '</div>';
}

function sourceText(summary) {
  const sources = [...new Set(summary.months.map(period => period.source))];
  if (!sources.length) return '暂无财务数据';
  return sources.join(' + ') + ' · 实际区间 ' + summary.months[0].start + ' 至 ' + summary.months.at(-1).end;
}

function financialTable({ current, previous, target }) {
  return table(['财务项目', '本期实际', '去年同期', '同比差额 / 点数', '同比变化', '本期目标', '达成 / 目标差'],
    pnlLines.map(([key, label, rate]) => {
      const format = rate ? value => fmt(value, 'pct') : money;
      return [label, format(current[key]), format(previous[key]),
        rate ? points(difference(current[key], previous[key])) : deltaMoney(difference(current[key], previous[key])),
        rate ? '—' : deltaPercent(relativeChange(current[key], previous[key])),
        format(target[key]),
        rate ? points(difference(current[key], target[key])) : fmt(ratio(current[key], target[key]), 'pct'),
      ];
    }));
}

function expenseBreakdown(summary) {
  const names = new Set([...Object.keys(summary.expenses), ...Object.keys(summary.previousExpenses)]);
  const rows = [...names].map(name => {
    const value = summary.expenses[name];
    const prior = summary.previousExpenses[name];
    return { name, value, prior, delta: difference(value, prior) };
  }).sort((a, b) => Math.abs(b.delta ?? b.value ?? 0) - Math.abs(a.delta ?? a.value ?? 0));
  if (!rows.length) return '<p class="hint">本期没有可核算的费用子项。</p>';
  const change = difference(summary.current.expenses, summary.previous.expenses);
  return table(['费用子项', '本期', '去年同期', '变动', '变动率', '对费用变化贡献'],
    rows.map(({ name, value, prior, delta }) => [
      name, money(value), money(prior), deltaMoney(delta), deltaPercent(relativeChange(value, prior)),
      valid(delta) && valid(change) && change !== 0 ? fmt(delta / change * 100, 'pct') : '—',
    ]));
}

function profitDrivers({ current, previous }) {
  const lines = [
    ['未税收入', difference(current.netRevenue, previous.netRevenue)],
    ['总成本', difference(previous.cost, current.cost)],
    ['期间费用', difference(previous.expenses, current.expenses)],
    ['税金及附加', difference(previous.taxes, current.taxes)],
  ].filter(([, value]) => valid(value));
  const profitChange = difference(current.profit, previous.profit);
  if (lines.length === 4 && valid(profitChange)) {
    const residual = profitChange - lines.reduce((sum, [, value]) => sum + value, 0);
    if (Math.abs(residual) >= 0.01) lines.push(['其他损益或核算差异', residual]);
  }
  if (!lines.length) return '';
  return '<ul class="finance-bridge">' + lines.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([label, value]) => '<li>' + label + '对利润同比的影响 <b class="'
    + (value >= 0 ? 'positive' : 'negative') + '">' + deltaMoney(value) + '</b></li>').join('') + '</ul>';
}

function financeCharts(months) {
  const labels = months.map(({ month, mode }) => Number(month.slice(5)) + '月' + (mode === 'mtd' ? ' MTD' : ''));
  const series = (label, key, color, period = 'current') => ({
    label, color, values: months.map(month => valid(month[period][key]) ? month[period][key] / 10000 : null),
  });
  const trend = plot([
    series('含税收入（万）', 'taxRevenue', '#6366f1'), series('毛利额（万）', 'grossProfit', '#8b5cf6'),
    series('销售利润（万）', 'profit', '#10b981'), series('同期销售利润（万）', 'profit', '#94a3b8', 'previous'),
  ], { labels });
  const structure = plot([
    series('总成本（万）', 'cost', '#ef4444'), series('总费用（万）', 'expenses', '#f59e0b'),
    series('税金及附加（万）', 'taxes', '#64748b'), series('销售利润（万）', 'profit', '#10b981'),
  ], { labels, type: 'bar', stacked: true });
  return '<h3>月度利润趋势（本期 vs 去年同期）</h3>' + trend
    + '<h3>利润构成拆解（未税收入 → 销售利润）</h3>' + structure;
}

export function renderFinance(data, range) {
  const summary = financeSummary(data, range);
  if (!summary.hasData) return card('💰 利润数据（财务细表）', '<div class="empty-state">当前范围暂无财务数据。导入未税收入、总成本、期间费用及税金及附加后可核算利润。</div>');
  const { current, previous } = summary;
  const year = summary.months.at(-1).month.slice(0, 4);
  const { months } = financeSummary(data, { start: year + '-01-01', end: year + '-12-31' });
  const tiles = financeTiles([
    { label: '毛利额', value: money(current.grossProfit), detail: deltaMoney(difference(current.grossProfit, previous.grossProfit)), color: '#8b5cf6' },
    { label: '毛利率', value: fmt(current.grossMargin, 'pct'), detail: points(difference(current.grossMargin, previous.grossMargin)), color: '#7c3aed' },
    { label: '销售利润额', value: money(current.profit), detail: deltaMoney(difference(current.profit, previous.profit)), color: current.profit < 0 ? '#ef4444' : '#10b981' },
    { label: '销售利润率', value: fmt(current.margin, 'pct'), detail: points(difference(current.margin, previous.margin)), color: current.margin < 0 ? '#ef4444' : '#059669' },
    { label: '成本率', value: fmt(current.costRate, 'pct'), detail: points(difference(current.costRate, previous.costRate)), color: '#f59e0b' },
    { label: '费用率', value: fmt(current.expenseRate, 'pct'), detail: points(difference(current.expenseRate, previous.expenseRate)), color: '#ef4444' },
  ]);
  const detail = table(['月份', '来源', '实际截至', '含税收入', '未税收入', '总成本', '毛利额', '毛利率', '期间费用', '税金及附加', '销售利润', '利润率', '同期利润', '利润率同比'],
    months.map(({ month, source, end, current, previous }) => [
      month, source, end, money(current.taxRevenue), money(current.netRevenue), money(current.cost), money(current.grossProfit),
      fmt(current.grossMargin, 'pct'), money(current.expenses), money(current.taxes), money(current.profit), fmt(current.margin, 'pct'),
      money(previous.profit), points(difference(current.margin, previous.margin)),
    ]));
  return card('💰 利润数据（财务细表）', '<div class="finance-store">' + tiles
    + '<p class="hint">' + year + ' 年月度视图，未结月份按当月日表展示。</p>' + financeCharts(months)
    + '<div class="finance-panel"><h3>📈 利润同比分析</h3><p>同期比较 ' + escapeHtml(summary.comparison.start) + ' 至 '
    + escapeHtml(summary.comparison.end) + '。金额用万元，率差用百分点，缺项显示“—”。</p>' + profitDrivers(summary)
    + financialTable(summary) + '<h3>各月利润对比明细</h3>' + detail
    + '<h3>费用归因分析（子项拆解）</h3>' + expenseBreakdown(summary) + '</div></div>', sourceText(summary));
}

function productFinancialRows(rows, demo) {
  if (!demo) return rows.map(row => financialRow(row, false));
  const costs = [1.42, 0.71, 0.84, 1.28, 0.85, 1.25, 0.62, 0.82];
  return [...Map.groupBy(rows, row => row.date).values()].flatMap(items => {
    const dayCost = items.reduce((sum, row) => sum + row.cost, 0);
    const weights = items.map(row => row.netRevenue * (costs[Number(row.id.split('-').at(-1)) - 1] ?? 1));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    return items.map((row, index) => financialRow({
      ...row, cost: totalWeight > 0 ? dayCost * weights[index] / totalWeight : row.cost, profit: null,
    }, false));
  });
}

export function productProfit(data, summary) {
  const rows = filterDates(data.products ?? [], summary.start, summary.end);
  if (!rows.length) return [];
  const priorRows = filterDates(data.products ?? [], summary.comparison.start, summary.comparison.end);
  const productKey = row => row.id || row.name;
  const current = Map.groupBy(productFinancialRows(rows, data === demoData || data.demoProfile === "tmall"), productKey);
  const prior = Map.groupBy(productFinancialRows(priorRows, data === demoData || data.demoProfile === "tmall"), productKey);
  const nameGroups = new Map();
  for (const row of data.ports ?? []) {
    if (!row.product || !['达播', '淘客'].includes(row.group)) continue;
    if (!nameGroups.has(row.product) || row.group === '达播') nameGroups.set(row.product, row.group);
  }
  return [...current].map(([id, items]) => ({
    id, name: items[0].name, group: items[0].businessType ?? nameGroups.get(items[0].name) ?? '货架',
    current: financialTotals(items), prior: financialTotals(prior.get(id) ?? []),
  })).filter(row => valid(row.current.grossMargin));
}

function productProfitPanel(data, summary) {
  const rows = productProfit(data, summary);
  if (!rows.length || !valid(summary.target.grossMargin)) return '';
  const target = summary.target.grossMargin;
  const totalRevenue = rows.reduce((sum, row) => sum + row.current.netRevenue, 0);
  const weighted = ratio(rows.reduce((sum, row) => sum + row.current.grossProfit, 0), totalRevenue);
  const gaps = rows.map(row => ({
    ...row, shortfall: Math.max(0, row.current.netRevenue * target / 100 - row.current.grossProfit),
  })).filter(row => row.shortfall > 0).sort((a, b) => b.shortfall - a.shortfall);
  const leading = rows.filter(row => row.current.grossMargin >= target + 3)
    .sort((a, b) => b.current.grossProfit - a.current.grossProfit).slice(0, 6);
  const comparisonRows = ['达播', '货架', '淘客'].map(group => {
    const selected = rows.filter(row => row.group === group);
    const revenue = selected.reduce((sum, row) => sum + row.current.netRevenue, 0);
    const gross = selected.reduce((sum, row) => sum + row.current.grossProfit, 0);
    return { label: group + '毛利率', value: fmt(ratio(gross, revenue), 'pct'), detail: '未税收入占比 ' + fmt(ratio(revenue, totalRevenue), 'pct') };
  });
  const endMonth = summary.months.at(-1);
  const pending = endMonth ? budgetForRange(data, { start: endMonth.month + '-01', end: monthEnd(endMonth.month) }) : null;
  const remaining = pending ? difference(pending.netRevenue, endMonth.current.netRevenue) : null;
  const required = valid(remaining) && remaining > 0 && valid(pending.grossProfit) && valid(endMonth.current.grossProfit) && endMonth.mode === 'mtd'
    ? ratio(Math.max(0, pending.grossProfit - endMonth.current.grossProfit), remaining) : null;
  const detail = table(['影响排名', '商品 ID / 简称', '业务类型', '未税收入', '实际毛利率', '较去年同期', '目标差', '毛利缺口', '拖累点数'],
    gaps.slice(0, 10).map((row, index) => [
      '#' + (index + 1), row.id + ' / ' + row.name, row.group, money(row.current.netRevenue),
      fmt(row.current.grossMargin, 'pct'), points(difference(row.current.grossMargin, row.prior.grossMargin)),
      points(row.current.grossMargin - target), money(row.shortfall), points(ratio(row.shortfall, totalRevenue)),
    ]));
  const incrementalRevenue = leading.reduce((sum, row) => sum + row.current.netRevenue * 0.3, 0);
  const incrementalProfit = leading.reduce((sum, row) => sum + row.current.grossProfit * 0.3, 0);
  const projected = ratio(rows.reduce((sum, row) => sum + row.current.grossProfit, incrementalProfit), totalRevenue + incrementalRevenue);
  const growth = leading.length ? '<h4>高毛利商品放量机会</h4><div class="finance-opportunities">'
    + leading.map(({ id, name, current }) => `<div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(id)}</small>
      <p>毛利率 ${fmt(current.grossMargin, 'pct')} · 未税收入 ${money(current.netRevenue)}</p></div>`).join('')
    + '</div><p class="hint">按候选商品维持现有毛利率且销售增加 30% 测算，新增未税收入 ' + money(incrementalRevenue)
    + '，新增毛利 ' + money(incrementalProfit) + '，单品加权毛利率 ' + fmt(projected, 'pct') + '。</p>' : '';
  return '<div class="finance-product"><div class="finance-product-head"><div><h3>单品毛利目标差距与影响排行</h3>'
    + '<p class="hint">毛利率按单品未税收入加权。目标取区间财务目标合计。</p></div><span class="chip">目标 '
    + fmt(target, 'pct') + '</span></div>'
    + financeTiles([
      { label: '单品加权毛利率', value: fmt(weighted, 'pct'), detail: '较目标 ' + points(weighted - target) },
      ...comparisonRows,
      { label: '低于目标单品', value: gaps.length + ' 个', detail: '按单品毛利缺口降序' },
      { label: '剩余目标毛利率', value: fmt(required, 'pct'), detail: '按当月剩余未税收入测算' },
    ]) + detail + growth + '</div>';
}

export function renderFinanceKpi(data, range) {
  const summary = financeSummary(data, range);
  if (!summary.hasData) return card('🧠 销售利润深究与自动策略建议', '<div class="empty-state">所选周期暂无可用于深究的财务数据。</div>');
  const { current, previous, target } = summary;
  const shop = aggregate(filterDates(data.store ?? [], summary.start, summary.end));
  const priorShop = aggregate(filterDates(data.store ?? [], summary.comparison.start, summary.comparison.end));
  const paid = attributionSummary(data, { start: summary.start, end: summary.end }, { window: 15 }).totals;
  const spendChange = relativeChange(current.expenses, previous.expenses);
  const marginGap = difference(current.margin, target.margin);
  const costChange = difference(current.costRate, previous.costRate);
  const conversionChange = difference(shop.conversion, priorShop.conversion);
  const bestExpenses = Object.entries(summary.expenses).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const topExpenses = bestExpenses.map(([name, amount]) => name + ' ' + money(amount)).join(' / ');
  const drivers = [
    ['销售进度', '含税收入达成 ' + fmt(ratio(current.taxRevenue, target.taxRevenue), 'pct') + '，收入同比 ' + deltaPercent(relativeChange(current.taxRevenue, previous.taxRevenue))],
    ['经营毛利', '毛利率 ' + fmt(current.grossMargin, 'pct') + '，成本率同比 ' + points(costChange)],
    ['销售利润', '销售利润同比 ' + deltaMoney(difference(current.profit, previous.profit)) + '，利润率同比 ' + points(difference(current.margin, previous.margin))],
    ['访客', '访客同比 ' + deltaPercent(compare(shop.visitors, priorShop.visitors)) + '，支付转化率同比 ' + points(conversionChange)],
    ['客单与退款', '客单价 ' + fmt(shop.asp, 'money') + '，客单同比 ' + deltaPercent(compare(shop.asp, priorShop.asp)) + '，退款率 ' + fmt(shop.refundRate, 'pct')],
    ['经营费用', '期间费用同比 ' + deltaPercent(spendChange) + (topExpenses ? '，主要费用为 ' + topExpenses : '')],
  ];
  const actions = [];
  if (valid(marginGap) && marginGap < 0) actions.push('销售利润率低于目标。优先复核费用率较高的场景及低毛利商品。');
  if (valid(costChange) && costChange >= 0.005) actions.push('成本率同比上升。检查商品结构、进货成本与退款后的实际毛利。');
  if (valid(spendChange) && spendChange > 0 && bestExpenses.length) actions.push('期间费用同比增加。按推广、平台和达人费用追溯增量来源。');
  if (valid(conversionChange) && conversionChange < 0) actions.push('支付转化率低于同期。按来源核对访客变化与支付承接。');
  if (valid(paid.roi) && paid.roi < 3 && !paid.missingDays) actions.push('付费 ROI 低于 3。先按推广场景检查直接成交和花费，再定位低效计划。');
  const list = items => '<ol>' + items.map(item => '<li>' + escapeHtml(item) + '</li>').join('') + '</ol>';
  const reasons = '<ol>' + drivers.map(([label, detail]) =>
    '<li><span class="finance-driver">' + escapeHtml(label) + '</span>' + escapeHtml(detail) + '</li>').join('') + '</ol>';
  return card('🧠 销售利润深究与自动策略建议', financeTiles([
    { label: '经营收入与销售达成', value: money(current.taxRevenue), detail: '目标 ' + money(target.taxRevenue) + ' · 达成 ' + fmt(ratio(current.taxRevenue, target.taxRevenue), 'pct') },
    { label: '经营毛利', value: money(current.grossProfit), detail: '目标 ' + money(target.grossProfit) + ' · 达成 ' + fmt(ratio(current.grossProfit, target.grossProfit), 'pct') + ' · 毛利率 ' + fmt(current.grossMargin, 'pct') },
    { label: '经营销售利润', value: money(current.profit), detail: '目标 ' + money(target.profit) + ' · 达成 ' + fmt(ratio(current.profit, target.profit), 'pct') + ' · 利润率 ' + fmt(current.margin, 'pct') },
    { label: '经营费用 TOP', value: money(current.expenses), detail: '预算使用 ' + fmt(ratio(current.expenses, target.expenses), 'pct') + ' · 费用率 ' + fmt(current.expenseRate, 'pct') + (topExpenses ? ' · ' + topExpenses : '') },
    { label: '付费效率', value: fmt(paid.roi, 'roi'), detail: '归因成交 ' + money(paid.txn) + ' · 花费 ' + money(paid.spend)
      + ' · 站内/逛逛 15 天，自播 1 天'
      + (paid.retainedDays ? ' · 历史留存 ' + paid.retainedDays : '') + (paid.missingDays ? ' · 缺项 ' + paid.missingDays : '') },
  ]) + '<div class="finance-deep-layout"><div class="finance-panel"><h3>原因拆解</h3>' + reasons
    + '</div><div class="finance-panel"><h3>策略建议</h3>'
    + (actions.length ? list(actions) : '<p>所选周期暂无命中已配置的财务预警条件。</p>') + '</div></div>'
    + productProfitPanel(data, summary), sourceText(summary));
}
