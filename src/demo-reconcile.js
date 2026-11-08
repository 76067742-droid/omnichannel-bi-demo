import { importRecordKey } from './demo-ingestion.js';

const windowLabels = { oneDay: '1 天', fifteenDay: '15 天', sevenDay: '7 天', history: '留存' };
const reconciliationFields = {
  daily: { gmv: '支付金额', refunds: '退款金额', receipts: '回款', spend: '推广花费' },
  finance: { netRevenue: '未税收入' },
  attribution: { directTxn: '直接归因成交', spend: '推广花费' },
  settlement: { settled: '结算金额', receipts: '回款' },
};
export class WorkspaceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function hasValue(value) {
  return value !== null && value !== undefined;
}

function validAmount(value) {
  return Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum || /[\x00-\x1f\x7f]/.test(value)) {
    throw new WorkspaceError(label + '应填写 1 至 ' + maximum + ' 个字符。');
  }
  return value.trim();
}

function cleanCode(value) {
  const code = cleanText(value, '店铺编码', 64);
  if (!/^[\p{L}\p{N}._-]+$/u.test(code)) {
    throw new WorkspaceError('店铺编码可使用字母、数字、汉字、点、下划线和短横线。');
  }
  return code;
}

function stableRecord(value) {
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableRecord(value[key])]));
}

function encodeRecord(row) {
  return JSON.stringify(stableRecord(row));
}

function classifyChanges(kind, rows, existing) {
  const changes = { added: 0, updated: 0, unchanged: 0 };
  const updates = [];
  let older = 0;
  for (const row of rows) {
    const key = importRecordKey(kind, row);
    const previous = existing.get(key);
    if (!previous) {
      changes.added++;
      updates.push({ key, row });
    } else if (kind === 'attribution' && previous.snapshotAt &&
        (!row.snapshotAt || Date.parse(row.snapshotAt) < Date.parse(previous.snapshotAt))) {
      changes.unchanged++;
      older++;
    } else if (encodeRecord(previous) === encodeRecord(row)) {
      changes.unchanged++;
    } else {
      changes.updated++;
      updates.push({ key, row });
    }
  }
  return { changes, updates, older };
}

function sumCents(rows, field) {
  let value = 0;
  let count = 0;
  for (const row of rows) {
    if (!validAmount(row?.[field])) continue;
    value += Math.round(row[field] * 100);
    count++;
    if (!Number.isSafeInteger(value)) throw new WorkspaceError('金额合计超过可核算范围。');
  }
  return count ? value / 100 : null;
}

function centDifference(left, right) {
  if (!validAmount(left) || !validAmount(right)) return null;
  const cents = Math.round(left * 100) - Math.round(right * 100);
  if (!Number.isSafeInteger(cents)) throw new WorkspaceError('金额差额超过可核算范围。');
  return cents / 100;
}

function reconcile(kind, rows, existing, expected = {}, sourceTotals = {}) {
  if (!isObject(expected)) throw new WorkspaceError('对账金额应以字段与金额提交。');
  for (const [key, value] of Object.entries(expected)) {
    if (!hasValue(value)) continue;
    if (!Object.hasOwn(reconciliationFields[kind], key) || !validAmount(value)
        || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) {
      throw new WorkspaceError('对账金额字段或数值无效。');
    }
  }
  const partitions = kind === 'attribution' ? Map.groupBy(rows, row => row.window) : new Map();
  const separateWindows = partitions.size > 1;
  if (separateWindows && Object.values(expected).some(hasValue)) {
    throw new WorkspaceError('推广文件包含多个归因窗口。请按单一窗口拆分后再填写独立对账金额。');
  }
  const groups = separateWindows ? [...partitions] : [[null, rows]];
  return groups.flatMap(([window, group]) => Object.entries(reconciliationFields[kind]).flatMap(([key, label]) => {
    const imported = sumCents(group, key);
    const previous = sumCents(group.map(row => existing.get(importRecordKey(kind, row))), key);
    const manualControl = expected[key] ?? null;
    const sheetControl = separateWindows ? null : sourceTotals[key] ?? null;
    if (imported === null && previous === null && manualControl === null && sheetControl === null) return [];
    const complete = group.length && group.every(row => validAmount(row[key]));
    const baseKey = window ? key + ':' + window : key;
    const baseLabel = window ? label + '（' + windowLabels[window] + '）' : label;
    const delta = centDifference(imported, previous);
    const entry = (key, label, control, controlSource) => {
      const difference = complete ? centDifference(imported, control) : null;
      const status = control === null ? 'unverified' : difference === null ? 'missing' : difference === 0 ? 'matched' : 'mismatch';
      return { key, label, imported, existing: previous, delta, expected: control, difference, status, controlSource };
    };
    if (manualControl === null) return [entry(baseKey, baseLabel, sheetControl, sheetControl === null ? null : 'sheet')];
    const entries = [entry(baseKey, baseLabel, manualControl, 'manual')];
    if (sheetControl !== null && centDifference(manualControl, sheetControl) !== 0) {
      entries.push(entry(baseKey + ':sheet', baseLabel + '（表内合计）', sheetControl, 'sheet'));
    }
    return entries;
  }));
}


export { classifyChanges, cleanCode, cleanText, encodeRecord, reconcile };
