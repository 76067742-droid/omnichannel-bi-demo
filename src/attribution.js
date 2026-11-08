import { escapeHtml, fmt, plot, table, tiles } from './ui.js';

export const attributionScenes = Object.freeze({
  货品全站推广: '站内付费',
  关键词推广: '站内付费',
  人群推广: '站内付费',
  超级直播: '自播付费',
  短直联动: '自播付费',
  超级短视频: '逛逛付费',
});

const trafficScenes = new Set(['关键词推广', '人群推广']);
const fifteenScenes = Object.keys(attributionScenes).filter(scene => attributionScenes[scene] !== '自播付费');
const allScenes = Object.keys(attributionScenes);
const fields = ['txn', 'spend', 'clicks', 'impressions', 'orders'];
const moneyFields = new Set(['txn', 'spend']);

const basisLabels = {
  direct_15d: '15天直接归因',
  direct_1d: '1天独立分析',
  self_1d: '1天自播付费',
  retained: '历史明确留存',
  mixed: '混合口径',
  missing: '无可用数据',
};

function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function combinedPromotionRange(range) {
  const { start, end } = range;
  if (!validDay(start) || !validDay(end) || start > end || start.slice(0, 4) !== end.slice(0, 4)) return range;
  const year = start.slice(0, 4);
  const from = Number(start.slice(5, 7));
  const to = Number(end.slice(5, 7));
  if (from >= 5 && to <= 6) return { start: year + '-05-01', end: year + '-06-30' };
  if (from >= 10 && to <= 11) return { start: year + '-10-01', end: year + '-11-30' };
  return range;
}

function inRange(date, start, end) {
  return (!start || date >= start) && (!end || date <= end);
}

function number(value) {
  return Number.isFinite(value) ? value : null;
}

function ratio(numerator, denominator, scale = 1) {
  return Number.isFinite(numerator) && denominator > 0 ? numerator / denominator * scale : null;
}

function identity(date, scene) {
  return date + '|' + scene;
}

function compareSnapshot(left, right) {
  const leftTime = typeof left.snapshotAt === 'string' ? Date.parse(left.snapshotAt) : NaN;
  const rightTime = typeof right.snapshotAt === 'string' ? Date.parse(right.snapshotAt) : NaN;
  return (Number.isFinite(leftTime) ? leftTime : -Infinity) >= (Number.isFinite(rightTime) ? rightTime : -Infinity);
}

function indexRows(rows, start, end) {
  const result = new Map();
  for (const row of rows || []) {
    if (!row || !validDay(row.date) || !inRange(row.date, start, end) || !Object.hasOwn(attributionScenes, row.scene)) continue;
    const key = identity(row.date, row.scene);
    const previous = result.get(key);
    if (!previous || compareSnapshot(row, previous)) result.set(key, row);
  }
  return result;
}

function standardRow(row, basis, allowTraffic = basis === 'direct_1d') {
  const { scene, date } = row;
  const useTraffic = allowTraffic && trafficScenes.has(scene) && Number.isFinite(row.trafficTxn);
  const txn = number(useTraffic ? row.trafficTxn : row.directTxn);
  const spend = number(row.spend);
  if (txn === null || spend === null) return null;
  const clicks = number(row.clicks);
  const impressions = number(row.impressions);
  return {
    date, scene, group: attributionScenes[scene], basis, txn, spend, clicks, impressions,
    orders: number(row.orders), roi: ratio(txn, spend), ctr: ratio(clicks, impressions, 100), cpc: ratio(spend, clicks),
  };
}

function rollup(rows, missing, retained) {
  const sums = Object.fromEntries(fields.map(field => [field, null]));
  const bases = new Set();
  for (const row of rows) {
    bases.add(row.basis);
    for (const field of fields) if (row[field] !== null) sums[field] = (sums[field] ?? 0) + row[field];
  }
  return {
    ...sums,
    roi: ratio(sums.txn, sums.spend), ctr: ratio(sums.clicks, sums.impressions, 100), cpc: ratio(sums.spend, sums.clicks),
    basis: bases.size > 1 ? 'mixed' : [...bases][0] || 'missing',
    days: new Set(rows.map(row => row.date)).size,
    retainedDays: retained.length, missingDays: missing.length,
  };
}

function datesBetween(start, end) {
  const dates = [];
  if (start > end) return dates;
  const cursor = new Date(start + 'T00:00:00Z');
  const last = Date.parse(end + 'T00:00:00Z');
  while (cursor.valueOf() <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function nonEmptyRows(rows) {
  return rows.filter(Boolean);
}

/**
 * Amounts are yuan. Each export row is a single statistic day × scene snapshot.
 * 15d direct amounts already include the source attribution window.
 */
export function attributionSummary(data, { start, end } = {}, { window = 15 } = {}) {
  const source = data.attribution || {};
  const oneDay = indexRows(source.oneDay, start, end);
  const fifteenDay = indexRows(source.fifteenDay, start, end);
  const history = indexRows(source.history, start, end);
  const bounded = validDay(source.sourceStart) && validDay(source.sourceEnd) && source.sourceStart <= source.sourceEnd;
  const sourceStart = bounded ? source.sourceStart : null;
  const sourceEnd = bounded ? source.sourceEnd : null;
  const daily = [];
  const missing = [];
  const retained = [];

  if (window === 1) {
    daily.push(...nonEmptyRows([...oneDay.values()].map(row => standardRow(row, 'direct_1d'))));
  } else {
    const directKeys = new Set();
    for (const row of oneDay.values()) {
      if (attributionScenes[row.scene] === '自播付费') {
        const selected = standardRow(row, 'self_1d');
        if (selected) daily.push(selected);
      }
    }
    for (const [key, row] of fifteenDay) {
      if (!fifteenScenes.includes(row.scene) || (bounded && !inRange(row.date, sourceStart, sourceEnd))) continue;
      const selected = standardRow(row, 'direct_15d');
      if (selected) {
        daily.push(selected);
        directKeys.add(key);
      }
    }

    const retentionCandidates = new Map(bounded ? [...oneDay, ...history] : history);
    for (const [key, row] of retentionCandidates) {
      if (!fifteenScenes.includes(row.scene) || (bounded && inRange(row.date, sourceStart, sourceEnd)) || directKeys.has(key)) continue;
      const selected = standardRow(row, 'retained', !history.has(key));
      if (selected) {
        daily.push(selected);
        retained.push({ date: row.date, scene: row.scene, group: selected.group });
      }
    }

    if (bounded) {
      const first = start && start > sourceStart ? start : sourceStart;
      const last = end && end < sourceEnd ? end : sourceEnd;
      for (const date of datesBetween(first, last)) {
        for (const scene of fifteenScenes) {
          if (!directKeys.has(identity(date, scene))) missing.push({ date, scene, group: attributionScenes[scene] });
        }
      }
    }
  }
  const sceneOrder = new Map(allScenes.map((scene, index) => [scene, index]));
  daily.sort((left, right) => left.date.localeCompare(right.date) || sceneOrder.get(left.scene) - sceneOrder.get(right.scene));
  const by = (field, value) => rollup(
    daily.filter(row => row[field] === value),
    missing.filter(row => row[field] === value),
    retained.filter(row => row[field] === value),
  );
  const scenes = allScenes.map(scene => ({ scene, group: attributionScenes[scene], ...by('scene', scene) }));
  const channels = [...new Set(Object.values(attributionScenes))].map(group => ({ group, ...by('group', group) }));
  return { window, sourceStart, sourceEnd, totals: rollup(daily, missing, retained), scenes, channels, daily, missing, retained };
}

const demoSceneAliases = { 店铺自播: '超级直播' };

export function makeDemoAttribution(ports, products = []) {
  const nativeSelfLiveDays = new Set(ports.filter(port => port.name === '超级直播').map(port => port.date));
  const oneDay = ports.flatMap(port => {
    if (port.name === '店铺自播' && nativeSelfLiveDays.has(port.date)) return [];
    const scene = demoSceneAliases[port.name] || port.name;
    if (!Object.hasOwn(attributionScenes, scene)) return [];
    return [{
      date: port.date, scene, directTxn: port.attributedSales,
      trafficTxn: trafficScenes.has(scene) ? Math.round(port.attributedSales * 1.07) : undefined,
      spend: port.spend, clicks: port.clicks, impressions: port.impressions, orders: port.orders,
      productName: port.product, cart: port.cartAdds,
    }];
  });
  const sourceEnd = oneDay.reduce((latest, row) => row.date > latest ? row.date : latest, '');
  if (!sourceEnd) return { oneDay, fifteenDay: [] };
  const firstOfMonth = new Date(sourceEnd.slice(0, 7) + '-01T00:00:00Z');
  firstOfMonth.setUTCMonth(firstOfMonth.getUTCMonth() - 1);
  const sourceStart = firstOfMonth.toISOString().slice(0, 10);
  const fifteenDay = oneDay.filter(row => row.date >= sourceStart && fifteenScenes.includes(row.scene)).map(row => ({
    date: row.date, scene: row.scene,
    directTxn: Math.round(row.directTxn * (1.11 + 0.07 * Math.sin(Number(row.date.slice(-2)) * 0.4))),
    spend: row.spend, clicks: row.clicks, impressions: row.impressions, orders: row.orders,
  }));
  return { oneDay, fifteenDay, sourceStart, sourceEnd, detail: makeDemoPaidDetail(oneDay, products) };
}

function change(current, previous, points = false) {
  if (current == null || previous == null || (!points && !previous)) return '—';
  const value = points ? current - previous : (current - previous) / previous * 100;
  return (value > 0 ? '+' : '') + fmt(value, points ? 'roi' : 'pct');
}

function previousYear(date) {
  if (!validDay(date)) return undefined;
  const dateObject = new Date(date + 'T00:00:00Z');
  const month = dateObject.getUTCMonth();
  dateObject.setUTCFullYear(dateObject.getUTCFullYear() - 1);
  if (dateObject.getUTCMonth() !== month) dateObject.setUTCDate(0);
  return dateObject.toISOString().slice(0, 10);
}

function labelFor(row, window) {
  if (row.missingDays) return '源期缺行 · ' + basisLabels[row.basis];
  if (row.retainedDays && row.basis === 'mixed') return '含历史留存';
  if (window === 1 && trafficScenes.has(row.scene) && row.days) return '三级来源支付口径';
  return basisLabels[row.basis];
}

function formatField(row, field) {
  const kind = moneyFields.has(field) ? 'money' : field === 'roi' || field === 'cpc' ? 'roi' : field === 'ctr' ? 'pct' : 'number';
  return fmt(row[field], kind);
}

export function paidProgressStatus({ rate, spendRate, roi, targetRoi, timeProgress }) {
  if (rate == null || timeProgress == null) return '暂无可判断数据';
  const roiLow = roi != null && targetRoi > 0 && roi < targetRoi;
  const spendAhead = spendRate != null && spendRate > rate + 20;
  if (rate >= 100 && !roiLow) return '达成优秀';
  if (rate < timeProgress - 20 && roiLow && roi < targetRoi * 0.85) return '重点预警';
  if (rate < timeProgress) return '进度预警';
  if (roiLow && spendAhead) return '进度领先·控费';
  if (roiLow) return '进度领先·提效';
  if (spendAhead) return '控费观察';
  return '正常跟进';
}

function sceneQuality(row, overall) {
  if (row.roi == null) return '—';
  const aboveAverageRoi = overall.roi != null && row.roi >= overall.roi;
  const goodCpc = row.cpc > 0 && (overall.cpc == null || row.cpc <= overall.cpc);
  const goodCtr = row.ctr != null && overall.ctr != null && row.ctr >= overall.ctr;
  const score = Number(aboveAverageRoi) + Number(goodCpc) + Number(goodCtr);
  if (score === 3) return '优秀';
  if (score === 2) return '可放量';
  if (row.spend > 0 && row.roi < 1.5) return '需优化';
  return '观察';
}

function paidPanel(title, body, note = '') {
  return '<section class="card paid-panel"><h2>' + escapeHtml(title) + '</h2>' + body
    + (note ? '<p class="paid-note">' + escapeHtml(note) + '</p>' : '') + '</section>';
}

function sceneInsights(scenes, overall) {
  const rows = scenes.filter(row => row.spend > 0);
  if (!rows.length) return '';
  const largest = rows.reduce((best, row) => row.spend > best.spend ? row : best);
  const highest = rows.reduce((best, row) => row.roi > best.roi ? row : best);
  const risks = rows.filter(row => row.roi < Math.max(1.5, overall.roi * 0.75))
    .sort((left, right) => right.spend - left.spend).slice(0, 2);
  return '<div class="paid-insights">' + tiles([
    { label: '端口结构', value: largest.scene, detail: '花费最高 · ' + fmt(largest.spend, 'money') + ' · 成交 ' + fmt(largest.txn, 'money') },
    { label: '效率机会', value: highest.scene, detail: 'ROI 最高 · ' + fmt(highest.roi, 'roi') },
    { label: '风险与动作', value: risks.length ? risks.length + ' 项' : '暂无', detail: risks.map(row => row.scene + ' ROI ' + fmt(row.roi, 'roi')).join('、') || '暂无高花费低 ROI 场景' },
  ]) + '</div>';
}

export function attributionDiagnostics(summary) {
  if (summary.window !== 15) return '';
  const notes = [];
  if (summary.sourceStart) notes.push('15天数据覆盖 ' + summary.sourceStart + ' ～ ' + summary.sourceEnd + '。');
  else notes.push('未登记 15 天数据覆盖期。');
  if (summary.retained.length) notes.push(summary.retained.length + ' 个日期×场景为历史明确留存。');
  if (summary.missing.length) notes.push(summary.missing.length + ' 个源期日期×场景缺少直接成交或花费，成交和 ROI 仅反映已有行。');
  const details = summary.missing.length
    ? '<details><summary>查看 15 天归因缺项</summary>' + table(['日期', '板块', '场景'], summary.missing.map(row => [row.date, row.group, row.scene])) + '</details>'
    : '';
  return '<div class="analysis-box"><strong>归因覆盖</strong> ' + escapeHtml(notes.join(' ')) + details + '</div>';
}

function renderTrends(summary) {
  const byDate = Map.groupBy(summary.daily, row => row.date);
  const dates = [...byDate.keys()];
  const labels = dates.map(date => date.slice(5));
  const dataByDate = dates.map(date => rollup(byDate.get(date), [], []));
  const sceneTotals = summary.scenes.filter(row => row.days).map(({ scene }) => ({
    label: scene,
    values: dates.map(date => {
      const row = byDate.get(date).find(item => item.scene === scene);
      return row ? row.txn / 10000 : null;
    }),
  }));
  return '<div class="two-col"><div><h3>整体分日趋势（花费柱状 + ROI 折线）</h3>'
    + plot([
      { label: '花费（万元）', values: dataByDate.map(row => row.spend / 10000), type: 'bar', color: '#f59e0b' },
      { label: '实际 ROI', values: dataByDate.map(row => row.roi), axis: 'right', kind: 'roi', color: '#10b981' },
    ], { labels, height: 270 }) + '</div><div><h3>分端口成交结构趋势（万元）</h3>'
    + plot(sceneTotals, { labels, type: 'bar', stacked: true, height: 270 }) + '</div></div>';
}

export function renderAttribution(data, range, { window = 15, showTrend = window === 1 } = {}) {
  const summary = attributionSummary(data, range, { window });
  const prior = attributionSummary(data, { start: previousYear(range.start), end: previousYear(range.end) }, { window });
  const priorScenes = new Map(prior.scenes.map(row => [row.scene, row]));
  const { totals, scenes } = summary;
  const tilesHtml = tiles([
    { label: '成交金额', value: formatField(totals, 'txn'), detail: basisLabels[totals.basis] },
    { label: '实际花费', value: formatField(totals, 'spend') },
    { label: '实际 ROI', value: formatField(totals, 'roi'), detail: '成交 ÷ 实际花费' },
    { label: '点击率', value: formatField(totals, 'ctr'), detail: '点击 ÷ 展现' },
  ]);
  const headers = ['归属板块', '场景', '花费', '同比花费', '成交金额', '同比成交', 'ROI', '同比 ROI 差', '点击量', '点击率', 'CPC', '表现判断', '取数口径'];
  const values = [{ ...totals, group: '整体', scene: '整体合计' }, ...scenes].map(row => {
    const last = priorScenes.get(row.scene) || prior.totals;
    const usableComparison = window === 1 || (row.basis === last.basis && !row.missingDays && !last.missingDays);
    return [row.group, row.scene, formatField(row, 'spend'), usableComparison ? change(row.spend, last.spend) : '—',
      formatField(row, 'txn'), usableComparison ? change(row.txn, last.txn) : '—', formatField(row, 'roi'),
      usableComparison ? change(row.roi, last.roi, true) : '—', formatField(row, 'clicks'), formatField(row, 'ctr'),
      formatField(row, 'cpc'), row.group === '整体' ? '—' : sceneQuality(row, totals), labelFor(row, window)];
  });
  const note = window === 15
    ? '站内与逛逛采用 15 天直接成交，排除间接和预售。自播付费沿用 1 天口径。'
    : '场景独立分析使用 1 天源。关键词和人群采用店铺流量来源三级支付金额，其余采用直接成交。';
  const title = window === 15 ? '📡 KPI 与报告推广归因' : '🧭 端口分析';
  const panelTop = window === 15 ? tilesHtml + attributionDiagnostics(summary) : '<h3>分场景端口数据</h3>';
  return paidPanel(title, panelTop + table(headers, values) + (window === 1 ? sceneInsights(scenes, totals) : ''), note)
    + (showTrend && summary.daily.length ? paidPanel('📈 趋势分析', renderTrends(summary)) : '');
}

const detailFields = ['spend', 'directTxn', 'totalTxn', 'clicks', 'impressions', 'orders', 'cart', 'newCustomerTxn'];

function allocation(total, weights) {
  if (!Number.isFinite(total)) return weights.map(() => null);
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  let remainder = total;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return remainder;
    const value = Math.min(remainder, Math.round(total * weight / sum));
    remainder -= value;
    return value;
  });
}

function makeDemoPaidDetail(oneDay, products) {
  const catalog = [...new Map(products.filter(item => item.id && item.name)
    .map(item => [item.name, { id: item.id, name: item.name, businessType: item.group }])).values()];
  const fallbackProducts = [...new Set(oneDay.map(item => item.productName).filter(Boolean))]
    .map((name, index) => ({ id: 'PAID-' + String(index + 1).padStart(3, '0'), name, businessType: '演示推广商品' }));
  const product = catalog.length ? catalog : fallbackProducts;
  const audience = ['近 30 日店铺访客', '护肤意向人群', '高价值老客', '高频加购人群', '相似人群拓新', '内容互动人群']
    .map((name, index) => ({ id: 'AUD-' + (index + 1), name }));
  const content = ['使用体验短片', '质地展示', '达人同款解读', '护肤步骤演示', '产品成分介绍', '品牌直播切片', '效果展示短片', '大促清单推荐']
    .map((name, index) => ({ id: 'CNT-' + (index + 1), name, productName: product.length ? product[index % product.length].name : '' }));
  const detail = { product: [], audience: [], content: [] };
  for (const row of oneDay) {
    const group = attributionScenes[row.scene];
    const day = Number(row.date.slice(-2));
    const selections = {
      product: group === '站内付费' ? product : [],
      audience: row.scene === '人群推广' || row.scene === '货品全站推广' ? audience : [],
      content: row.scene === '超级短视频' || row.scene === '短直联动' ? content : [],
    };
    for (const [type, entries] of Object.entries(selections)) {
      if (!entries.length) continue;
      const seed = type.length + day;
      const weights = entries.map((item, index) => 2 + Math.sin(seed * 0.17 + index * 0.53) + (item.name === row.productName ? 2.4 : 0));
      const efficiencyWeights = weights.map((value, index) => value * (0.45 + (index % 4) * 0.38 + Math.abs(Math.cos(seed + index)) * 0.24));
      const amounts = {
        ...row, totalTxn: Math.round(row.directTxn * 1.19),
        newCustomerTxn: Math.round(row.directTxn * (0.29 + day % 5 * 0.024)),
      };
      const split = Object.fromEntries(detailFields.map(field =>
        [field, allocation(amounts[field], field.endsWith('Txn') || field === 'orders' ? efficiencyWeights : weights)]));
      entries.forEach((item, index) => {
        detail[type].push({ ...item, date: row.date, scene: row.scene, ...Object.fromEntries(detailFields.map(field => [field, split[field][index]])) });
      });
    }
  }
  return detail;
}

function summarizeDetail(rows) {
  const result = Object.fromEntries(detailFields.map(field => [field, null]));
  for (const row of rows) {
    for (const field of detailFields) {
      if (Number.isFinite(row[field])) result[field] = (result[field] ?? 0) + row[field];
    }
  }
  return {
    ...result,
    roi: ratio(result.directTxn, result.spend), ctr: ratio(result.clicks, result.impressions, 100),
    cpc: ratio(result.spend, result.clicks), conversion: ratio(result.orders, result.clicks, 100),
    cartRate: ratio(result.cart, result.clicks, 100), newCustomerShare: ratio(result.newCustomerTxn, result.totalTxn, 100),
  };
}

function detailQuality(row, average, type) {
  if (!(row.spend > 0)) return '无消耗';
  if (row.roi == null) return '待补成交';
  const minCtr = type === 'product' ? 3.5 : Math.max(average.ctr ?? 0, 3);
  if (row.roi >= Math.max(average.roi ?? 0, 3) && row.ctr >= minCtr) return '优先放量';
  if (average.roi != null && row.roi >= average.roi && (average.cpc == null || (row.cpc != null && row.cpc <= average.cpc))) {
    return type === 'product' ? '可放量' : '保留观察';
  }
  if (row.roi < 1.5 && row.spend >= (type === 'product' ? 30000 : 1000)) return type === 'product' ? '重点优化' : '降价/暂停';
  if (type === 'product' && row.roi < 1.5) return '控费观察';
  if (type !== 'product' && row.ctr != null && average.ctr != null && row.ctr < average.ctr * 0.7 && row.spend >= 500) return '点击弱';
  return '观察';
}

const paidDetailPanels = {
  product: {
    title: '📦 单品分析', subtitle: '单品推广效率 TOP20（按花费排序）',
    labels: ['商品 ID', '商品简称', '业务类型', '花费', '总成交', '直接成交', '直接成交 ROI', '点击量', '点击率', 'CPC', '成交笔数', '表现判断'],
  },
  audience: {
    title: '👥 人群分析', subtitle: '人群包推广效率 TOP20（按花费排序）',
    labels: ['人群包', '花费', '总成交', '直接成交', '直接成交 ROI', '点击量', '点击率', '点击转化率', 'CPC', '加购率', '新客成交占比', '表现判断'],
  },
  content: {
    title: '🎬 内容分析', subtitle: '内容素材推广效率 TOP20（按花费排序）',
    labels: ['素材/内容', '商品简称', '花费', '总成交', '直接成交', '直接成交 ROI', '点击量', '点击率', '点击转化率', 'CPC', '加购率', '新客成交占比', '表现判断'],
  },
};

function paidDetailValues(type, row) {
  const amounts = [fmt(row.spend, 'money'), fmt(row.totalTxn, 'money'), fmt(row.directTxn, 'money'), fmt(row.roi, 'roi'), fmt(row.clicks), fmt(row.ctr, 'pct')];
  if (type === 'product') return [row.id, row.name, row.businessType, ...amounts, fmt(row.cpc, 'roi'), fmt(row.orders), row.quality];
  const identity = type === 'content' ? [row.name, row.productName] : [row.name];
  return [...identity, ...amounts, fmt(row.conversion, 'pct'), fmt(row.cpc, 'roi'), fmt(row.cartRate, 'pct'), fmt(row.newCustomerShare, 'pct'), row.quality];
}

function paidDetailInsights(rows, average) {
  if (!rows.length) return '';
  const leading = rows[0];
  const scale = rows.filter(row => ['优先放量', '可放量', '保留观察'].includes(row.quality)).slice(0, 3);
  const risk = rows.filter(row => ['重点优化', '控费观察', '降价/暂停', '点击弱'].includes(row.quality)).slice(0, 3);
  const display = entries => entries.map(row => row.name + '（ROI ' + fmt(row.roi, 'roi') + '）').join('、');
  return '<div class="paid-insights">' + tiles([
    { label: '投放概览', value: 'ROI ' + fmt(average.roi, 'roi'), detail: '花费最高 ' + leading.name + ' · ' + fmt(leading.spend, 'money') },
    { label: '保留 / 加码', value: scale.length ? scale.length + ' 项' : '暂无', detail: display(scale) },
    { label: '风险 / 控费', value: risk.length ? risk.length + ' 项' : '暂无', detail: display(risk) },
  ]) + '</div>';
}

function paidContentTrend(rows) {
  if (!rows.length) return '';
  const byDate = [...Map.groupBy(rows, row => row.date)].sort(([left], [right]) => left.localeCompare(right));
  const daily = byDate.map(([, values]) => summarizeDetail(values));
  const label = ([date]) => date.slice(5);
  return '<h3>内容素材分日趋势</h3>' + plot([
    { label: '花费（万元）', color: '#6366f1', values: daily.map(row => row.spend == null ? null : row.spend / 10000) },
    { label: '直接成交（万元）', color: '#10b981', values: daily.map(row => row.directTxn == null ? null : row.directTxn / 10000) },
    { label: '直接成交 ROI', color: '#f59e0b', values: daily.map(row => row.roi), kind: 'roi', axis: 'right' },
  ], { labels: byDate.map(label), height: 280 });
}

export function renderPaidDrilldowns(data, { start, end } = {}) {
  const detail = data.attribution?.detail || {};
  return Object.entries(paidDetailPanels).map(([type, config]) => {
    const records = (detail[type] || []).filter(row => validDay(row.date) && inRange(row.date, start, end) && row.name);
    const ranked = [...Map.groupBy(records, row => row.id || row.name).values()].map(rows => ({
      ...rows.at(-1), ...summarizeDetail(rows),
    })).sort((left, right) => (right.spend ?? -Infinity) - (left.spend ?? -Infinity)).slice(0, 20);
    const average = summarizeDetail(ranked);
    const rows = ranked.map(row => ({ ...row, quality: detailQuality(row, average, type) }));
    const content = '<h3>' + config.subtitle + '</h3>' + table(config.labels, rows.map(row => paidDetailValues(type, row)))
      + (type === 'content' ? paidContentTrend(records) : '') + paidDetailInsights(rows, average);
    const note = rows.length
      ? '独立 1 天明细 · 直接成交 ROI = 直接成交 ÷ 花费 · 总成交仅用于辅助判断。'
      : '暂无对应维度的独立 1 天推广明细。';
    return paidPanel(config.title, content, note);
  }).join('');
}
