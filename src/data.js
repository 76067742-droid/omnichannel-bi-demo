import { attributionScenes, makeDemoAttribution } from './attribution.js';

const sumFields = [
  'gmv', 'receipts', 'visitors', 'buyers', 'orders', 'spend', 'profit', 'refunds',
  'attributedSales', 'taxRevenue', 'netRevenue', 'cost', 'expenses', 'taxes',
  'units', 'cartAdds', 'collect', 'searchVisitors', 'searchBuyers', 'members', 'newMembers', 'payingMembers', 'newPayingMembers',
  'newMemberGmv', 'oldGmv', 'impressions', 'clicks', 'sales', 'volume',
];

function divide(value, base, scale = 1) {
  return Number.isFinite(value) && Number.isFinite(base) && base > 0 ? value / base * scale : null;
}

export function aggregate(rows) {
  const totals = Object.fromEntries(sumFields.map(field => [field, null]));
  for (const row of rows) {
    for (const field of sumFields) {
      if (Number.isFinite(row[field])) totals[field] = (totals[field] ?? 0) + row[field];
    }
  }
  const { gmv, receipts, visitors, buyers, refunds, profit, spend, attributedSales } = totals;
  return {
    ...totals,
    conversion: divide(buyers, visitors, 100),
    refundRate: divide(refunds, gmv, 100),
    roi: divide(attributedSales, spend),
    receiptsRoi: divide(receipts, spend),
    asp: divide(gmv, buyers),
    uvValue: divide(gmv, visitors),
    oldRatio: divide(totals.oldGmv, gmv, 100),
    margin: divide(profit, totals.netRevenue, 100),
    ctr: divide(totals.clicks, totals.impressions, 100),
    cpc: divide(spend, totals.clicks),
  };
}

export function compare(current, previous) {
  return Number.isFinite(current) && Number.isFinite(previous) && previous !== 0
    ? (current - previous) / previous * 100
    : null;
}

export function filterDates(rows, start, end) {
  return rows.filter(({ date }) => (!start || date >= start) && (!end || date <= end));
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function datesBetween(start, end) {
  const dates = [];
  const date = new Date(`${start}T00:00:00Z`);
  while (dayKey(date) <= end) {
    dates.push(dayKey(date));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return dates;
}

const activities = [
  { name: '新年囤货季', start: '2025-01-05', end: '2025-01-15' },
  { name: '春日焕新', start: '2025-03-01', end: '2025-03-08' },
  { name: '520好礼季', start: '2025-05-13', end: '2025-05-20' },
  { name: '618年中大促', start: '2025-06-01', end: '2025-06-20' },
  { name: '双十一', start: '2025-10-28', end: '2025-11-11' },
  { name: '双十二', start: '2025-12-08', end: '2025-12-12' },
  { name: '新年囤货季', start: '2026-01-05', end: '2026-01-15' },
  { name: '春日焕新', start: '2026-03-01', end: '2026-03-08' },
  { name: '520好礼季', start: '2026-05-13', end: '2026-05-20' },
  { name: '618年中大促', start: '2026-06-01', end: '2026-06-20' },
  { name: '秋季上新', start: '2026-09-07', end: '2026-09-14' },
  { name: '双十一', start: '2026-10-28', end: '2026-11-11' },
];

function makeStoreRow(date, index) {
  const month = Number(date.slice(5, 7));
  const event = activities.some(({ start, end }) => date >= start && date <= end);
  const growth = date.startsWith('2026') ? 1.19 : 1;
  const season = month === 6 || month === 11 ? 1.19 : 1;
  const pulse = 1 + 0.16 * Math.sin(index * 0.76) + 0.09 * Math.cos(index * 0.31);
  const visitors = Math.round(28000 * growth * season * pulse * (event ? 1.4 : 1));
  const buyers = Math.round(visitors * (0.049 + Math.sin(index * 0.29) * 0.008 + (event ? 0.008 : 0)));
  const orders = Math.round(buyers * 1.08);
  const gmv = Math.round(buyers * (138 + 12 * Math.cos(index * 0.37) - (event ? 9 : 0)));
  const refunds = Math.round(gmv * (0.107 + 0.019 * Math.sin(index * 0.43)));
  const receipts = gmv - refunds;
  const spend = Math.round(gmv * (0.14 + 0.024 * Math.cos(index * 0.5)));
  const taxRevenue = Math.round(receipts * 0.98);
  const netRevenue = Math.round(taxRevenue / 1.13);
  const cost = Math.round(netRevenue * 0.38);
  const expenses = spend + Math.round(netRevenue * 0.17);
  const taxes = Math.round(netRevenue * 0.012);
  const profit = netRevenue - cost - expenses - taxes;
  return {
    date, gmv, receipts, visitors, buyers, orders, spend, profit, refunds,
    attributedSales: Math.round(gmv * (0.38 + 0.035 * Math.sin(index * 0.36))),
    taxRevenue, netRevenue, cost, expenses, taxes,
    units: Math.round(orders * 1.35),
    cartAdds: Math.round(visitors * 0.126),
    collect: Math.round(visitors * 0.052),
    searchVisitors: Math.round(visitors * 0.29),
    searchBuyers: Math.round(buyers * 0.31),
    oldGmv: Math.round(gmv * (0.56 + 0.029 * Math.sin(index * 0.23))),
    impressions: Math.round(visitors * 7.1),
    clicks: Math.round(visitors * 0.74),
  };
}

const products = [
  ['DEMO-001', '玻尿酸补水喷雾', '引流品', 0.25],
  ['DEMO-002', '保湿修护面霜', '利润品', 0.17],
  ['DEMO-003', '舒缓水乳套装', '成交品', 0.14],
  ['DEMO-004', '精华焕亮组合', '利润品', 0.13],
  ['DEMO-005', '舒缓修护面膜', '成交品', 0.11],
  ['DEMO-006', '防晒保湿乳', '引流品', 0.08],
  ['DEMO-007', '清润洁面乳', '基础品', 0.065],
  ['DEMO-008', '日常旅行套装', '基础品', 0.055],
];

const trafficSources = [
  ['手淘搜索', '免费流量', 0.29],
  ['手淘推荐', '免费流量', 0.19],
  ['我的淘宝', '免费流量', 0.11],
  ['货品全站推广', '付费流量', 0.17],
  ['关键词推广', '付费流量', 0.09],
  ['人群推广', '付费流量', 0.08],
  ['其他来源', '其他流量', 0.07],
];

const portSources = [
  ['达人合作 A', '达播', 0.085, { creator: '达人 A', product: products[0][1] }],
  ['达人合作 B', '达播', 0.065, { creator: '达人 B', product: products[1][1] }],
  ['货品全站推广', '站内付费', 0.29, { campaign: '核心单品放量', product: products[0][1] }],
  ['关键词推广', '站内付费', 0.145, { campaign: '高意向搜索', product: products[2][1] }],
  ['人群推广', '站内付费', 0.11, { campaign: '访客再营销', product: products[3][1] }],
  ['达人合作内容', '种草', 0.05, { creator: '达人 C', contentType: '达人合作内容' }],
  ['品牌自制内容', '种草', 0.015, { contentType: '自制内容' }],
  ['超级短视频', '种草', 0.015, {}],
  ['其他用户内容', '种草', 0.01, { contentType: '其他用户内容' }],
  ['店铺自播', '自播', 0.12, { creator: '主播 A', product: products[1][1] }],
  ['短直联动', '自播', 0.055, { creator: '主播 B', product: products[4][1] }],
  ['内容联盟', '淘客', 0.025, { product: products[0][1] }],
  ['商品联盟', '淘客', 0.015, { product: products[5][1] }],
];

function distribute(row, shares) {
  const fields = sumFields.filter(field => Number.isFinite(row[field]));
  const remaining = Object.fromEntries(fields.map(field => [field, row[field]]));
  return shares.map((share, index) => {
    const values = { date: row.date };
    for (const field of fields) {
      values[field] = index === shares.length - 1 ? remaining[field] : Math.round(row[field] * share);
      remaining[field] -= values[field];
    }
    return values;
  });
}

function varyingShares(items, index) {
  const raw = items.map((share, item) => share * (1 + 0.2 * Math.sin(index * (0.23 + item * 0.018) + item)));
  const total = raw.reduce((sum, share) => sum + share, 0);
  return raw.map(share => share / total);
}

function makeAudience(row, index) {
  const memberShare = 0.52 + 0.06 * Math.sin(index * 0.19);
  const oldShare = row.oldGmv / row.gmv;
  const [member, nonmember] = distribute(row, [memberShare, 1 - memberShare]);
  const [newCustomer, oldCustomer] = distribute(row, [1 - oldShare, oldShare]);
  const newMembers = Math.round(row.visitors * (0.019 + 0.004 * Math.cos(index * 0.41)));
  const newPayingMembers = Math.round(member.buyers * 0.27);
  return [
    {
      ...member, group: '会员', name: '会员', members: Math.round(member.visitors * 0.37),
      newMembers, payingMembers: member.buyers, newPayingMembers,
      newMemberGmv: Math.round(member.gmv * 0.25),
    },
    { ...nonmember, group: '会员', name: '非会员' },
    { ...newCustomer, group: '新老客', name: '新客' },
    { ...oldCustomer, group: '新老客', name: '老客' },
  ];
}

const categories = [
  ['美容护肤', '面部护理', '喷雾', '保湿喷雾', '玻尿酸喷雾'],
  ['美容护肤', '面部护理', '乳液面霜', '修护面霜', '舒缓修护'],
  ['美容护肤', '面部护理', '护肤套装', '水乳套装', '保湿水乳'],
  ['美容护肤', '面部护理', '面部精华', '焕亮精华', '复合精华'],
  ['美容护肤', '面部护理', '面膜', '贴片面膜', '补水面膜'],
  ['美容护肤', '防晒护理', '面部防晒', '防晒乳', '水润防晒'],
];

const brands = ['清润实验室', '晴森', '沐岚', '青野', '微光配方'];
const channelNames = ['天猫', '抖音', '京东', '拼多多', '其他'];

function makeDemoData() {
  const store = datesBetween('2025-01-01', '2026-11-05').map(makeStoreRow);
  const demo = {
    store, products: [], traffic: [], audience: [], ports: [], market: [],
    channels: [], targets: [], portTargets: [], activities, selfSessions: [],
  };
  const portTargetShares = [0.15, 0.545, 0.09, 0.175, 0.04];
  const portGroups = [...new Set(portSources.map(item => item[1]))];
  const byMonth = new Map();
  store.forEach((row, index) => {
    const month = row.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(row);
    demo.products.push(...distribute(row, varyingShares(products.map(item => item[3]), index))
      .map((data, item) => ({ ...data, id: products[item][0], name: products[item][1], group: products[item][2] })));
    demo.traffic.push(...distribute(row, varyingShares(trafficSources.map(item => item[2]), index))
      .map((data, item) => ({ ...data, name: trafficSources[item][0], group: trafficSources[item][1] })));
    demo.audience.push(...makeAudience(row, index));
    const paid = {
      date: row.date, gmv: row.attributedSales, attributedSales: row.attributedSales,
      receipts: Math.round(row.attributedSales * row.receipts / row.gmv),
      buyers: Math.round(row.buyers * 0.4), orders: Math.round(row.orders * 0.4),
      visitors: Math.round(row.visitors * 0.43), profit: Math.round(row.profit * 0.4),
      impressions: row.impressions, clicks: row.clicks, cartAdds: Math.round(row.cartAdds * 0.43),
    };
    paid.refunds = paid.gmv - paid.receipts;
    const portShares = portSources.map(item => item[2]);
    const expenseShares = varyingShares(portShares.map((share, item) => share * (0.73 + (item % 4) * 0.18)), index);
    const paidExpenses = distribute({ date: row.date, spend: row.spend }, expenseShares);
    demo.ports.push(...distribute(paid, varyingShares(portShares, index))
      .map((data, item) => {
        const [name, group, , dimensions] = portSources[item];
        return { ...data, ...paidExpenses[item], ...dimensions, name, group };
      }));
  });

  for (let year = 2023; year <= 2026; year++) {
    for (let month = 1; month <= 12; month++) {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      const date = `${key}-01`;
      const index = (year - 2023) * 12 + month;
      const season = month === 6 || month === 11 ? 1.41 : 1 + 0.12 * Math.sin(month * 0.65);
      const baseline = Math.round(4300000 * (1 + (year - 2023) * 0.17) * season);
      if (year >= 2025) {
        demo.targets.push({
          date, gmv: Math.round(baseline * 1.13), receipts: Math.round(baseline),
          profit: Math.round(baseline * 0.17), spend: Math.round(baseline * 0.15),
          taxRevenue: Math.round(baseline * 0.98),
        });
        distribute({
          date, gmv: Math.round(baseline * 0.45), receipts: Math.round(baseline * 0.4),
          spend: Math.round(baseline * 0.15),
        }, portTargetShares).forEach((target, item) => demo.portTargets.push({ ...target, group: portGroups[item] }));
      }
      if (year === 2026 && month > 11) continue;
      const rows = byMonth.get(key);
      const tmall = rows ? aggregate(rows) : {
        gmv: baseline, receipts: Math.round(baseline * 0.9), profit: Math.round(baseline * 0.16),
        spend: Math.round(baseline * 0.14), refunds: Math.round(baseline * 0.1),
        attributedSales: Math.round(baseline * 0.4),
      };
      channelNames.forEach((name, channel) => {
        const share = [1, 0.63, 0.32, 0.19, 0.12][channel];
        const scale = channel === 0 ? share : share * (1 + 0.14 * Math.sin(index * 0.43 + channel));
        const channelRow = Object.fromEntries(sumFields.filter(field => Number.isFinite(tmall[field]))
          .map(field => [field, Math.round(tmall[field] * scale)]));
        const flagship = Math.round(channelRow.gmv * 0.82);
        const composition = channel === 0 ? { flagship, supermarket: channelRow.gmv - flagship } : {};
        demo.channels.push({ date, name, group: '渠道', ...channelRow, ...composition });
      });
      categories.forEach((categoryPath, category) => {
        const sales = Math.round(6.5e7 * season * (1 + index * 0.021) * (1 + 0.16 * Math.cos(index * 0.53 + category)) / (1 + category * 0.26));
        const volume = Math.round(sales / (102 + category * 18));
        demo.market.push({ date, name: categoryPath.at(-1), group: '类目', categoryPath, gmv: sales, sales, orders: volume, volume });
        const brandShares = varyingShares([0.27, 0.23, 0.21, 0.17, 0.12], index + category);
        distribute({ date, gmv: sales, sales, orders: volume, volume }, brandShares)
          .forEach((row, brand) => demo.market.push({
            ...row, name: brands[brand], brand: brands[brand], group: '品牌', categoryPath,
          }));
      });
    }
  }
  demo.selfSessions = demo.ports.filter(row => row.group === '自播').flatMap((row, index) => {
    const anchor = row.creator;
    const dayPart = index % 2 === 0 ? '下午' : '晚间';
    const times = [dayPart === '下午' ? '14:00' : '20:00', '23:30'];
    return distribute(row, [0.83, 0.17]).map((part, item) => ({
      ...part, name: row.name, product: row.product, creator: item ? 'AI 数字人' : anchor,
      sessionType: item ? 'AI 数字人' : '真人', time: times[item], dayPart: item ? '深夜' : dayPart,
      views: Math.round(part.visitors * (1.22 + (index % 5) * 0.04)),
      averageSeconds: (item ? 39 : 64) + index % 17,
    }));
  });
  demo.attribution = makeDemoAttribution(demo.ports, demo.products);
  return demo;
}

export const demoData = makeDemoData();
export const latestDate = demoData.store.at(-1).date;

const csvColumns = new Map([
  ['date', ['日期', '统计日期']],
  ['gmv', ['支付金额', '支付成交金额', '成交金额']],
  ['receipts', ['回款', '回款金额', '实际回款']],
  ['visitors', ['UV', '访客数', '访客']],
  ['buyers', ['支付买家数', '支付人数', '支付买家']],
  ['orders', ['支付订单数', '支付订单', '订单', '订单数']],
  ['spend', ['推广花费', '广告花费', '花费']],
  ['profit', ['销售利润', '利润']],
  ['grossProfit', ['毛利额', '毛利']],
  ['refunds', ['退款金额', '退款']],
  ['attributedSales', ['直接成交金额', '推广直接成交金额']],
  ['taxRevenue', ['含税收入']],
  ['netRevenue', ['未税收入', '不含税收入']],
  ['cost', ['总成本', '成本']],
  ['expenses', ['期间费用', '总费用']],
  ['taxes', ['税金及附加']],
  ['units', ['支付件数']],
  ['cartAdds', ['加购人数']],
  ['collect', ['收藏人数']],
  ['oldGmv', ['老客成交金额', '老客支付金额']],
  ['impressions', ['展现量', '曝光量']],
  ['clicks', ['点击量']],
].flatMap(([field, aliases]) => [field, ...aliases].map(alias => [alias.toLowerCase(), field])));

function splitCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character !== '"') value += character;
      else if (text[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = false;
        closedQuote = true;
      }
      continue;
    }
    if (character === ',' || character === '\r' || character === '\n') {
      row.push(value.trim());
      value = '';
      closedQuote = false;
      if (character === ',') continue;
      rows.push(row);
      row = [];
      if (character === '\r' && text[index + 1] === '\n') index++;
      continue;
    }
    if (character === '"') {
      if (closedQuote || value.trim()) throw new Error(`CSV 第 ${rows.length + 1} 条记录的引号位置有误`);
      quoted = true;
      value = '';
    } else {
      if (closedQuote && character.trim()) throw new Error(`CSV 第 ${rows.length + 1} 条记录的引号后有多余字符`);
      value += character;
    }
  }
  if (quoted) throw new Error(`CSV 第 ${rows.length + 1} 条记录的引号未闭合`);
  row.push(value.trim());
  rows.push(row);
  return rows;
}

function normalizeDate(text, recordNumber) {
  const parts = text.match(/^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/);
  if (parts) {
    const [, year, , month, day] = parts;
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (year !== '0000' && !Number.isNaN(parsed.valueOf()) && dayKey(parsed) === date) return date;
  }
  throw new Error(`CSV 第 ${recordNumber} 条记录日期无效，请使用 YYYY-MM-DD`);
}

const integerFields = new Set(['visitors', 'buyers', 'orders', 'units', 'cartAdds', 'collect', 'impressions', 'clicks']);

function readCsv(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('CSV 为空，请选择带表头和数据的文件');
  const rows = splitCsv(text.replace(/^\uFEFF/, '')).filter(row => row.some(Boolean));
  const header = rows.shift() ?? [];
  if (!rows.length) throw new Error('CSV 没有明细数据');
  rows.forEach((row, index) => {
    if (row.length !== header.length) throw new Error(`CSV 第 ${index + 2} 条记录的列数与表头不一致`);
  });
  return { header, rows };
}

function parseCsvNumber(value, field, column, row) {
  const valid = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value);
  const number = Number(value.replaceAll(',', ''));
  if (!valid || !Number.isFinite(number) || (integerFields.has(field) && (!Number.isSafeInteger(number) || number < 0))) {
    throw new Error(`CSV 第 ${row} 条记录的“${column}”数值无效`);
  }
  return number;
}

const expenseLabels = new Set([
  '代运营费用', '促销费用', '品牌宣传费', '商品流转费', '平台费用', '广告宣传费用', '折旧资金占用报废',
  '推广服务费', '管理费用', '调研服务费', '软件服务费', '达人与站外种草费用', '达人服务费', '运营服务费',
]);
const financeAmounts = new Set(['taxRevenue', 'netRevenue', 'cost', 'expenses', 'taxes', 'grossProfit', 'profit']);

function normalizeDatedCsv(text, finance = false) {
  const { header, rows } = readCsv(text);
  const fields = header.map(column => {
    if (expenseLabels.has(column)) return column;
    if (finance && (column === '来源' || column.toLowerCase() === 'source')) return 'source';
    const key = csvColumns.get(column.toLowerCase());
    return !finance || key === 'date' || financeAmounts.has(key) ? key : undefined;
  });
  if (!fields.includes('date') || (!finance && !fields.includes('gmv'))) {
    throw new Error(finance ? '财务 CSV 必须包含日期（date）列' : 'CSV 必须包含日期（date）和支付金额（gmv）两列');
  }
  const namedFields = fields.filter(Boolean);
  if (new Set(namedFields).size !== namedFields.length) throw new Error('CSV 含有重复指标列，请保留每个指标的一列');

  const seen = new Set();
  return rows.map((row, index) => {
    const recordNumber = index + 2;
    const date = normalizeDate(row[fields.indexOf('date')], recordNumber);
    if (finance && date.slice(-2) !== '01') throw new Error(`CSV 第 ${recordNumber} 条闭月日期应为每月 01 日`);
    if (seen.has(date)) throw new Error(`CSV 中的日期 ${date} 重复，请先合并该日期的数据`);
    seen.add(date);
    const record = { date };
    fields.forEach((field, column) => {
      if (!field || field === 'date') return;
      const value = row[column];
      if (!value && field !== 'gmv') return;
      if (field === 'source') {
        record.source = value;
        return;
      }
      const number = parseCsvNumber(value, field, header[column], recordNumber);
      if (expenseLabels.has(field)) {
        record.expenseBreakdown ??= {};
        record.expenseBreakdown[field] = number;
      } else record[field] = number;
    });
    if (finance && ![...financeAmounts].some(field => Number.isFinite(record[field]))) {
      throw new Error(`CSV 第 ${recordNumber} 条没有可用财务金额`);
    }
    return record;
  }).sort((left, right) => left.date.localeCompare(right.date));
}

export function normalizeStoreCsv(text) {
  return normalizeDatedCsv(text);
}

export function normalizeFinanceCsv(text) {
  return normalizeDatedCsv(text, true);
}

const attributionColumns = new Map([
  ['date', '统计日期'], ['scene', '场景'], ['window', '口径'], ['directTxn', '直接成交金额'],
  ['spend', '花费'], ['snapshotAt', '快照时间'], ['trafficTxn', '三级来源支付金额'],
  ['clicks', '点击量'], ['impressions', '展现量'], ['orders', '订单数'],
].flatMap(([key, title]) => [[key.toLowerCase(), key], [title, key]]));
const attributionWindows = new Map([['1', 'oneDay'], ['1天', 'oneDay'], ['15', 'fifteenDay'], ['15天', 'fifteenDay'],
  ['留存', 'history'], ['history', 'history']]);

export function normalizeAttributionCsv(text) {
  const { header, rows } = readCsv(text);
  const columns = header.map(column => attributionColumns.get(column.toLowerCase()));
  const mandatory = ['date', 'scene', 'window', 'directTxn', 'spend'];
  if (mandatory.some(column => !columns.includes(column))) throw new Error('推广 CSV 需要统计日期、场景、口径、直接成交金额、花费');
  const known = columns.filter(Boolean);
  if (new Set(known).size !== known.length) throw new Error('推广 CSV 含重复指标列');
  const source = { oneDay: [], fifteenDay: [], history: [] };
  rows.forEach((values, index) => {
    const input = Object.fromEntries(columns.flatMap((key, position) => key ? [[key, values[position]]] : []));
    const line = index + 2;
    const window = attributionWindows.get(input.window);
    if (!window) throw new Error(`第 ${line} 条推广口径须为 1天、15天或留存`);
    if (!Object.hasOwn(attributionScenes, input.scene)) throw new Error(`第 ${line} 条推广场景不在模板范围内`);
    if (attributionScenes[input.scene] === '自播付费' && window !== 'oneDay') throw new Error(`第 ${line} 条自播付费须为 1天口径`);
    const record = { date: normalizeDate(input.date, line), scene: input.scene };
    for (const field of ['directTxn', 'spend', 'trafficTxn', 'clicks', 'impressions', 'orders']) {
      if (input[field] || mandatory.includes(field)) record[field] = parseCsvNumber(input[field], field, field, line);
    }
    if (input.snapshotAt) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(input.snapshotAt) || !Number.isFinite(Date.parse(input.snapshotAt))) {
        throw new Error(`第 ${line} 条快照时间须包含时区，如 2026-11-06T09:00:00+08:00`);
      }
      record.snapshotAt = input.snapshotAt;
    }
    source[window].push(record);
  });
  const dates = source.fifteenDay.map(row => row.date).sort();
  if (dates.length) {
    source.sourceStart = dates[0];
    source.sourceEnd = dates.at(-1);
  }
  return source;
}
