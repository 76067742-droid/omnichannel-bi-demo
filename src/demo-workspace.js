import { demoDays, demoMonthly } from './finance.js';
import { demoShops, demoShopData } from './workspace.js';
import { importRecordKey, parseImport } from './demo-ingestion.js';
import { classifyChanges, cleanCode, cleanText, encodeRecord, reconcile } from './demo-reconcile.js';

const kindFields = { daily: 'store', finance: 'financeMonthly', attribution: 'attributionRows', settlement: 'settlements' };
const previews = new Map();
const shops = new Map();
const batches = [];
let seeded = false;

function loadSamples() {
  if (seeded) return;
  for (const sample of demoShops) {
    const id = sample.id.replace('demo-', 'sample-');
    const seed = demoShopData(sample.id);
    const data = sample.platform === 'tmall'
      ? { ...seed, store: demoDays, financeMonthly: demoMonthly, demoProfile: 'tmall' }
      : seed;
    shops.set(id, {
      meta: { id, name: sample.name, code: sample.code, platform: sample.platform, archived: false },
      data: structuredClone(data),
      revision: 0,
    });
  }
  seeded = true;
}

function requireShop(id, active = false) {
  const shop = shops.get(id);
  if (!shop || (active && shop.meta.archived)) throw new Error('目标店铺不存在或已归档。');
  return shop;
}

function describe({ meta, data }) {
  return {
    ...meta,
    earliestDate: data.store[0]?.date ?? null,
    latestDate: data.store.at(-1)?.date ?? null,
    settlementLatestDate: data.settlements.at(-1)?.date ?? null,
    counts: Object.fromEntries(Object.entries(kindFields).map(([kind, key]) => [kind, data[key].length])),
  };
}

function saveShop(id, payload) {
  const existing = id ? requireShop(id) : null;
  const previous = existing?.meta;
  const platform = previous?.platform ?? payload.platform;
  if (!['tmall', 'douyin'].includes(platform)) throw new Error('请选择天猫或抖音平台。');
  const name = cleanText(payload.name ?? previous?.name, '店铺名称', 80);
  const code = cleanCode(payload.code ?? previous?.code);
  if ([...shops.values()].some(({ meta }) => meta.id !== id && meta.platform === platform && meta.code.toLowerCase() === code.toLowerCase())) {
    throw new Error('同平台已存在此店铺编码。');
  }
  const meta = { id: id ?? crypto.randomUUID(), platform, name, code, archived: payload.archived ?? previous?.archived ?? false };
  const shop = existing ?? { data: { store: [], financeMonthly: [], attributionRows: [], settlements: [], attribution: {} }, revision: 0 };
  shop.meta = meta;
  shop.revision++;
  shops.set(meta.id, shop);
  return { shop: describe(shop) };
}

function rowsByKey(shop, kind) {
  return new Map(shop.data[kindFields[kind]].map(row => [importRecordKey(kind, row), row]));
}

async function previewImport(payload) {
  const { kind, shopId, contentBase64, ...options } = payload;
  const target = requireShop(shopId, true);
  const fileName = cleanText(options.fileName, '文件名', 240);
  const buffer = Uint8Array.from(atob(contentBase64), value => value.charCodeAt(0));
  const { rows, issues, sourceTotals, ...parsed } = await parseImport({
    kind, fileName, buffer, platform: target.meta.platform, sheet: options.sheet,
    headerRow: options.headerRow, mapping: options.mapping,
  });
  const shop = requireShop(shopId, true);
  const existing = rowsByKey(shop, kind);
  const dataKey = JSON.stringify(rows.map(encodeRecord).sort());
  const seen = rows.length > 0 && batches.some(batch => batch.shopId === shopId && batch.kind === kind && batch.dataKey === dataKey);
  const { changes, updates, older } = classifyChanges(kind, rows, existing);
  if (changes.updated && !seen) issues.push({ level: 'warning', message: '有 ' + changes.updated + ' 条同键记录将覆盖原记录，未提供的可选字段会清空。' });
  if (older) issues.push({ level: 'warning', message: '有 ' + older + ' 条较早或未标时间的推广快照，保留已存较新记录。' });
  const reconciliation = reconcile(kind, rows, existing, options.expected, sourceTotals);
  for (const item of reconciliation) {
    if (item.status === 'mismatch' || item.status === 'missing') issues.push({ level: 'error', message: item.label + '未通过金额核对。' });
  }
  const duplicate = seen || Boolean(rows.length && !updates.length);
  const canCommit = Boolean(updates.length && !duplicate && !issues.some(issue => issue.level === 'error'));
  const previewId = canCommit ? crypto.randomUUID() : null;
  if (previewId) {
    if (previews.size >= 8) previews.delete(previews.keys().next().value);
    previews.set(previewId, {
      revision: shop.revision, updates, dataKey,
      batch: { shopId, kind, fileName, sheet: parsed.sheet, dateFrom: parsed.dateFrom, dateTo: parsed.dateTo,
        rowCount: rows.length, changes, reconciliation },
    });
  }
  return { ...parsed, previewId, duplicate, canCommit, rowCount: rows.length, issues, samples: rows.slice(0, 8), reconciliation, changes };
}

function commitImport(id) {
  const pending = previews.get(id);
  if (!pending) throw new Error('请重新运行预检。');
  const shop = requireShop(pending.batch.shopId, true);
  if (pending.result) return pending.result;
  if (shop.revision !== pending.revision) throw new Error('店铺数据已有变化，请重新预检。');
  const { kind } = pending.batch;
  const next = rowsByKey(shop, kind);
  for (const { key, row } of pending.updates) next.set(key, row);
  const rows = [...next.values()].sort((a, b) => a.date.localeCompare(b.date));
  shop.data[kindFields[kind]] = rows;
  if (kind === 'attribution') {
    const grouped = Map.groupBy(rows, row => row.window);
    const windows = Object.fromEntries([...grouped].map(([key, list]) =>
      [key, list.map(({ window, ...row }) => row)]));
    const fifteen = windows.fifteenDay || [];
    shop.data.attribution = { ...shop.data.attribution, ...windows,
      sourceStart: fifteen[0]?.date, sourceEnd: fifteen.at(-1)?.date };
  }
  shop.revision++;
  const batch = { ...pending.batch, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  batches.unshift({ ...batch, dataKey: pending.dataKey });
  if (batches.length > 200) batches.pop();
  pending.result = { batch, shop: describe(shop) };
  return pending.result;
}

export async function demoRequest(path, { method = 'GET', body } = {}) {
  loadSamples();
  const { pathname, searchParams } = new URL(path, 'https://demo.invalid');
  if (method === 'GET') {
    if (pathname === '/api/workspace') return { shops: [...shops.values()].map(describe) };
    if (pathname === '/api/overview') {
      const platform = searchParams.get('platform');
      const id = searchParams.get('shopId');
      return { shops: [...shops.values()].filter(({ meta }) => !meta.archived && (!platform || meta.platform === platform) && (!id || meta.id === id))
        .map(shop => ({ shop: describe(shop), store: shop.data.store, settlements: shop.data.settlements })) };
    }
    if (pathname === '/api/imports') {
      const id = searchParams.get('shopId');
      return { batches: batches.filter(batch => !id || batch.shopId === id).map(({ dataKey, ...batch }) => batch) };
    }
    const dataMatch = pathname.match(/^\/api\/shops\/([^/]+)\/data$/);
    if (dataMatch) {
      const shop = requireShop(decodeURIComponent(dataMatch[1]));
      return { shop: describe(shop), data: shop.data };
    }
  }
  if (method === 'POST') {
    if (pathname === '/api/shops') return saveShop(null, body);
    if (pathname === '/api/imports/preview') return previewImport(body);
    const commitMatch = pathname.match(/^\/api\/imports\/([^/]+)\/commit$/);
    if (commitMatch) return commitImport(decodeURIComponent(commitMatch[1]));
  }
  if (method === 'PATCH') {
    const editMatch = pathname.match(/^\/api\/shops\/([^/]+)$/);
    if (editMatch) return saveShop(decodeURIComponent(editMatch[1]), body);
  }
  throw new Error('当前演示不支持这项操作。');
}

export const readDemo = path => demoRequest(path);
