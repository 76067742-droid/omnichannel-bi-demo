import { attributionScenes } from './attribution.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 48 * 1024 * 1024;
const MAX_ROWS = 50000;
const MAX_COLUMNS = 256;
const MAX_ISSUES = 300;

const field = (key, label, type, aliases = [], required = false) => ({ key, label, type, aliases, required });
const date = field('date', '统计日期', 'date', ['日期', '时间', '数据日期', '统计时间', '支付日期', '经营日期', '业务日期'], true);
const month = field('date', '结账月份', 'month', ['日期', '统计日期', '年月', '月份', '结算月份', '账期', '期间'], true);
const receipts = field('receipts', '回款', 'money', ['回款金额', '实际回款', '实收金额', '实收货款', '净回款']);
const orders = field('orders', '支付订单数', 'count', ['支付订单', '订单数', '成交订单数', '订单', '成交订单量', '支付订单量', '成交笔数']);
const spend = field('spend', '推广花费', 'money', ['广告花费', '广告消耗', '花费', '广告支出', '消耗', '投放消耗', '消耗金额', '千川消耗']);
const clicks = field('clicks', '点击量', 'count', ['点击数', '广告点击量', '点击次数']);
const impressions = field('impressions', '展现量', 'count', ['曝光量', '曝光数', '广告展示次数', '展示量', '曝光次数']);
const expenseNames = [
  '代运营费用', '促销费用', '品牌宣传费', '商品流转费', '平台费用', '广告宣传费用', '折旧资金占用报废',
  '推广服务费', '管理费用', '调研服务费', '软件服务费', '达人与站外种草费用', '达人服务费', '运营服务费',
];
const financial = [
  field('taxRevenue', '含税收入', 'money', ['销售收入（含税）', '销售收入含税', '含税销售收入']),
  field('netRevenue', '未税收入', 'money', ['不含税收入', '销售收入（不含税）', '净收入', '未税销售收入']),
  field('cost', '总成本', 'money', ['销售成本', '成本', '商品成本', '营业成本']),
  field('expenses', '期间费用', 'money', ['总费用', '经营费用']),
  field('taxes', '税金及附加', 'money', ['税金', '税费']),
  field('grossProfit', '毛利额', 'money', ['毛利', '销售毛利']),
  field('profit', '销售利润', 'money', ['利润', '营业利润']),
];
const expenses = expenseNames.map(name => field('expense.' + name, name, 'money'));
const schemas = {
  daily: [
    date,
    field('gmv', '支付金额', 'money', ['支付成交金额', '实付金额', '订单实付金额', '用户实付金额', '支付GMV', '成交金额', '成交总额'], true),
    receipts,
    field('refunds', '退款金额', 'money', ['退款', '成功退款金额', '退款成功金额', '售后退款金额', '实际退款金额']),
    field('visitors', '访客数', 'count', ['访客', 'UV', '店铺访客数', '访客人数', '访问人数', '访问用户数']),
    field('buyers', '支付买家数', 'count', ['支付人数', '成交人数', '支付买家', '成交买家数', '成交用户数', '支付用户数']),
    orders, spend,
    field('units', '支付件数', 'count', ['成交件数', '成交商品件数']),
    field('cartAdds', '加购人数', 'count', ['加购用户数']),
    field('collect', '收藏人数', 'count', ['收藏用户数']),
    field('oldGmv', '老客成交金额', 'money', ['老客支付金额', '老客成交额']),
    field('attributedSales', '直接成交金额', 'money', ['推广直接成交金额', '直接支付金额']),
    impressions, clicks, ...financial, ...expenses,
  ],
  finance: [
    month, field('source', '来源', 'text', ['数据来源', '来源说明']), ...financial, ...expenses,
  ],
  attribution: [
    date,
    field('scene', '场景', 'text', ['端口', '推广场景', '推广类型', '投放场景', '广告场景'], true),
    field('window', '口径', 'window', ['归因窗口', '归因天数', '归因口径', '转化周期', '归因周期'], true),
    field('directTxn', '直接成交金额', 'money', ['推广直接成交金额', '直接支付金额', '广告直接成交金额', '直接成交'], true),
    { ...spend, required: true },
    field('snapshotAt', '快照时间', 'timestamp', ['导出时间', '生成时间', '更新时间']),
    field('trafficTxn', '三级来源支付金额', 'money', ['三级流量支付金额']),
    clicks, impressions, orders,
  ],
  settlement: [
    field('date', '结算日期', 'date', ['日期', '统计日期', '结算时间', '出账日期', '入账日期', '到账日期', '打款日期'], true),
    field('settled', '结算金额', 'money', ['实际结算金额', '结算净额', '结算净收入', '应结金额', '实结金额', '到账金额', '打款金额', '可提现金额'], true),
    receipts,
    field('fees', '平台费用', 'money', ['平台扣费', '费用合计', '平台服务费', '技术服务费', '佣金合计', '结算费用']),
  ],
};

const moneyUnits = new Map([['分', 0.01], ['元', 1], ['人民币', 1], ['万元', 10000], ['万', 10000], ['亿元', 100000000], ['亿', 100000000]]);
const unitSuffix = /\((人民币|万元|亿元|元|分|万|亿|人|个|件|笔|次)\)$/;
const absent = /^(?:\s*|[-—–]{1,3}|暂无(?:数据)?|不适用|N\/?A)$/i;
const summaryLabel = /^(总合计|合计|总计|汇总|小计|总计金额|total|grand\s*total|subtotal)[:：]?$/i;
const grandTotal = /^(总合计|合计|总计|汇总|总计金额|total|grand\s*total)[:：]?$/i;
const nonnegative = new Set(['gmv', 'refunds', 'spend', 'directTxn', 'trafficTxn', 'attributedSales', 'oldGmv']);
const windowNames = new Map([
  ['1', 'oneDay'], ['1天', 'oneDay'], ['1日', 'oneDay'], ['1d', 'oneDay'], ['oneday', 'oneDay'],
  ['7', 'sevenDay'], ['7天', 'sevenDay'], ['7日', 'sevenDay'], ['7d', 'sevenDay'], ['sevenday', 'sevenDay'],
  ['15', 'fifteenDay'], ['15天', 'fifteenDay'], ['15日', 'fifteenDay'], ['15d', 'fifteenDay'], ['fifteenday', 'fifteenDay'],
  ['留存', 'history'], ['历史留存', 'history'], ['history', 'history'],
]);

function inputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function text(value) {
  return value == null ? '' : String(value).normalize('NFKC').trim();
}

function headerKey(value) {
  return text(value).replace(/\s+/g, '').toLowerCase();
}

function dateKey(value) {
  return value.toISOString().slice(0, 10);
}

function excelDate(value) {
  if (!Number.isFinite(value) || value < 1 || value >= 2958466 || Math.floor(value) === 60) return null;
  return new Date(Date.UTC(1899, 11, 30) + (value + (value < 60 ? 1 : 0)) * 86400000);
}

function normalizeDate(value, monthly) {
  if (value instanceof Date && Number.isFinite(value.valueOf())) return validateDate(dateKey(value), monthly);
  const raw = text(value).replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/-$/, '');
  const separated = raw.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/);
  const compact = raw.match(monthly ? /^(\d{4})(\d{2})(\d{2})?$/ : /^(\d{4})(\d{2})(\d{2})$/);
  const parts = separated || compact;
  if (parts) {
    const [, year, month, day] = parts;
    if (!day && !monthly) throw inputError('必须填写具体日期，如 2026-11-05');
    return validateDate(year + '-' + month.padStart(2, '0') + '-' + (day || '1').padStart(2, '0'), monthly);
  }
  const serial = typeof value === 'number' ? value : /^\d{5}(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
  const excel = excelDate(serial);
  if (excel) return validateDate(dateKey(excel), monthly);
  throw inputError(monthly ? '月份无效，请填写 YYYY-MM 或当月 01 日' : '日期无效，请填写 YYYY-MM-DD 或 Excel 日期');
}

function validateDate(key, monthly) {
  const stamp = new Date(key + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key.startsWith('0000') || !Number.isFinite(stamp.valueOf()) || dateKey(stamp) !== key) {
    throw inputError('日期不存在，请检查年份、月份和日期');
  }
  if (monthly && !key.endsWith('-01')) throw inputError('闭月财务须用月份或该月 01 日');
  return key;
}

function normalizeTimestamp(value) {
  const raw = value instanceof Date && Number.isFinite(value.valueOf())
    ? value.toISOString().slice(0, 19) : text(value).replace(' ', 'T');
  const parts = raw.match(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/i);
  if (!parts) throw inputError('快照时间无效，如 2026-11-06 09:00:00 或 2026-11-06T09:00:00+08:00');
  const [, day, hour, minute, second = '00', milliseconds, zone = '+08:00'] = parts;
  const timestamp = normalizeDate(day, false) + 'T' + hour + ':' + minute + ':' + second
    + (milliseconds ? '.' + milliseconds : '') + zone.toUpperCase();
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || !Number.isFinite(Date.parse(timestamp))) {
    throw inputError('快照时间或时区无效');
  }
  return new Date(timestamp).toISOString();
}

function parseNumber(value, def, header) {
  let raw = text(value).replace(/[−–]/g, '-').replace(/(?<=\d) (?=\d{3}(?:[ ,.\s]|$))/g, ',');
  if (/^\(.+\)$/.test(raw)) raw = '-' + raw.slice(1, -1).trim();
  if (def.type === 'money') raw = raw.replace(/^([+-]?)(?:¥|CNY|RMB)\s*/i, '$1');
  const match = raw.match(/^([+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?)(?:\s*(人民币|万元|亿元|元|分|万|亿|人|个|件|笔|次))?$/);
  if (typeof value !== 'number' && !match) throw inputError('数值无效，请使用数字');
  const unit = match?.[2];
  if (unit && (def.type === 'money' ? !moneyUnits.has(unit) : moneyUnits.has(unit))) {
    throw inputError('单元格的单位与字段不匹配');
  }
  const number = typeof value === 'number' ? value : Number(match[1].replaceAll(',', ''));
  if (def.type === 'count') {
    if (!Number.isSafeInteger(number) || number < 0) throw inputError('须为非负整数');
    return number;
  }
  const headerUnit = headerKey(header).match(unitSuffix)?.[1];
  const multiplier = moneyUnits.get(unit) ?? moneyUnits.get(headerUnit) ?? 1;
  const yuan = number * multiplier;
  const cents = Math.round(yuan * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(yuan) > 1000000000000 || Math.abs(yuan * 100 - cents) > 0.0005) {
    throw inputError('金额须在 ±1 万亿元内，换算为元后最多保留两位小数');
  }
  if (nonnegative.has(def.key) && cents < 0) throw inputError('须填非负金额，退款按正数列示');
  return cents === 0 ? 0 : cents / 100;
}

function parseCell(value, def, column, platform) {
  if (def.type === 'date' || def.type === 'month') return normalizeDate(value, def.type === 'month');
  if (def.type === 'timestamp') return normalizeTimestamp(value);
  if (def.type === 'money' || def.type === 'count') return parseNumber(value, def, column);
  if (def.type === 'window') {
    const window = windowNames.get(headerKey(value));
    if (!window || (window === 'sevenDay' && platform !== 'douyin')) {
      throw inputError(platform === 'douyin' ? '归因口径须为 1天、7天、15天或留存' : '归因口径须为 1天、15天或留存');
    }
    return window;
  }
  const normalized = text(value);
  if (normalized.length > 150 || /[\u0000-\u001f]/.test(normalized)) throw inputError('文本应为 150 字内的一行内容');
  if (def.key === 'scene' && platform !== 'douyin' && !Object.hasOwn(attributionScenes, normalized)) {
    throw inputError('天猫场景应使用推广模板中的标准名称');
  }
  return normalized;
}

function decodeText(buffer) {
  try {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(buffer);
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(buffer);
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try { return new TextDecoder('gb18030', { fatal: true }).decode(buffer); }
    catch { throw inputError('文本编码无法识别，请另存为 CSV UTF-8'); }
  }
}

function delimiter(text, extension) {
  if (extension === '.tsv') return '\t';
  const counts = { ',': [], '\t': [], ';': [] };
  let quoted = false;
  let line = 0;
  for (let i = 0; i < text.length && i < 8192 && line < 6; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    if (quoted) continue;
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      line++;
    } else if (Object.hasOwn(counts, c)) counts[c][line] = (counts[c][line] || 0) + 1;
  }
  const first = separator => counts[separator].find(count => count > 0);
  const stability = separator => counts[separator].filter(count => count === first(separator)).length;
  return Object.keys(counts).sort((a, b) => stability(b) - stability(a) || (first(b) || 0) - (first(a) || 0))[0];
}

function readDelimited(source, separator) {
  const rows = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let startLine = 1;
  function finishCell() {
    cells.push(cell.trim());
    if (cells.length > MAX_COLUMNS) throw inputError('表格列数超过 ' + MAX_COLUMNS + ' 列');
    cell = '';
    afterQuote = false;
  }
  function finishRow() {
    finishCell();
    rows.push({ cells, line: startLine });
    if (rows.length > MAX_ROWS + 50) throw inputError('每个工作表最多支持 ' + MAX_ROWS + ' 行明细');
    cells = [];
    startLine = line + 1;
  }
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const newline = c === '\n' || c === '\r';
    if (c === '\u0000') throw inputError('该文件不是有效的 CSV 文本');
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { cell += c; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; }
      else if (newline) cell += '\n';
      else cell += c;
    } else if (c === separator) finishCell();
    else if (newline) finishRow();
    else if (c === '"') {
      if (afterQuote || cell.trim()) throw inputError('CSV 第 ' + line + ' 行引号位置不正确');
      quoted = true;
      cell = '';
    } else if (!afterQuote || !c.trim()) cell += c;
    else throw inputError('CSV 第 ' + line + ' 行引号后有多余字符');
    if (newline) {
      if (c === '\r' && source[i + 1] === '\n') i++;
      line++;
    }
  }
  if (quoted) throw inputError('CSV 第 ' + startLine + ' 行引号未闭合');
  if (cells.length || cell || afterQuote) finishRow();
  return rows;
}

function checkZipBounds(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const uint32 = offset => view.getUint32(offset, true);
  const uint16 = offset => view.getUint16(offset, true);
  const lowest = Math.max(0, buffer.length - 65557);
  let end = buffer.length - 22;
  while (end >= lowest) {
    if (uint32(end) === 0x06054b50 && end + 22 + uint16(end + 20) === buffer.length) break;
    end--;
  }
  if (end < lowest) throw inputError('Excel 文件损坏或格式不正确');
  const entries = uint16(end + 10);
  let offset = uint32(end + 16);
  if (entries > 1024 || offset > end) throw inputError('Excel 文件包含过多组件或不支持的压缩格式');
  let expanded = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || uint32(offset) !== 0x02014b50) throw inputError('Excel 文件的目录结构不完整');
    expanded += uint32(offset + 24);
    if (expanded > MAX_EXPANDED_BYTES) throw inputError('Excel 文件解压后超过 48 MB，请拆分工作簿');
    offset += 46 + uint16(offset + 28) + uint16(offset + 30) + uint16(offset + 32);
  }
}

async function readTables(buffer, fileName) {
  const extension = fileName.match(/\.[^.]+$/)?.[0].toLowerCase();
  if (extension === '.xls') throw inputError('旧版 .xls 请另存为 .xlsx 或 CSV 后导入');
  if (!['.csv', '.tsv', '.xlsx'].includes(extension)) throw inputError('仅支持 .xlsx、.csv 或 .tsv');
  if (extension !== '.xlsx') {
    const decoded = decodeText(buffer);
    return [{ name: 'CSV', rows: readDelimited(decoded, delimiter(decoded, extension)) }];
  }
  checkZipBounds(buffer);
  try {
    const workbook = await globalThis.readXlsxFile(new Blob([buffer]));
    if (workbook.length > 40) throw inputError('工作簿超过 40 张工作表，请保留需要导入的工作表');
    return workbook.map(({ sheet, data }) => {
      if (data.length > MAX_ROWS + 50 || data.some(row => row.length > MAX_COLUMNS)) {
        throw inputError('工作表超过 ' + MAX_ROWS + ' 行或 ' + MAX_COLUMNS + ' 列，请拆分工作簿');
      }
      return { name: sheet, rows: data.map((cells, index) => ({ cells, line: index + 1 })) };
    });
  } catch (error) {
    if (error.statusCode === 400) throw error;
    throw inputError('Excel 工作簿无法读取。请确认是未加密的 .xlsx 文件并重新保存');
  }
}

function namesFor(def) {
  return [def.key, def.label, ...def.aliases].map(headerKey);
}

function autoColumn(def, header) {
  for (const alias of namesFor(def)) {
    const indexes = header.flatMap((name, i) => headerKey(name).replace(unitSuffix, '') === alias ? [i] : []);
    if (indexes.length) return indexes.length === 1 ? indexes[0] : -1;
  }
  return -1;
}

function bestHeader(rows, fields, wanted) {
  if (wanted != null && wanted !== '') {
    const line = Number(wanted);
    if (!Number.isInteger(line) || line < 1 || !rows.some(row => row.line === line)) {
      throw inputError('表头行号应为当前工作表中存在的行');
    }
    return rows.findIndex(row => row.line === line);
  }
  let best = rows.findIndex(row => row.cells.some(cell => text(cell)));
  let score = 0;
  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const matches = fields.filter(def => autoColumn(def, rows[i].cells) >= 0);
    const value = matches.length + matches.filter(def => def.required).length * 5;
    if (value > score) { score = value; best = i; }
  }
  return best;
}

function uniqueColumns(header, width) {
  const names = new Set();
  return Array.from({ length: width }, (_, index) => {
    const source = text(header[index]).slice(0, 150) || '第 ' + (index + 1) + ' 列';
    let name = source;
    let number = 2;
    while (names.has(name)) name = source + ' (' + number++ + ')';
    names.add(name);
    return name;
  });
}

function selectedColumns(fields, header, columns, overrides, report, line) {
  const mapping = {};
  const indexes = new Map();
  const used = new Set();
  for (const def of fields) {
    const explicit = Object.hasOwn(overrides, def.key);
    const choice = overrides[def.key];
    const index = explicit ? columns.indexOf(choice) : autoColumn(def, header);
    if (index < 0) {
      if (explicit && choice) report(line, 'error', '映射的源列不存在：' + def.label, def.key);
      else if (def.required) report(line, 'error', '请为必填字段选择源列：' + def.label, def.key);
      continue;
    }
    if (used.has(index)) {
      report(line, 'error', '一个源列只能对应一个指标：' + columns[index], def.key);
      continue;
    }
    indexes.set(def.key, index);
    mapping[def.key] = columns[index];
    used.add(index);
    if (def.key === 'gmv' && ['gmv', '成交金额', '成交总额'].includes(headerKey(header[index]).replace(unitSuffix, ''))) {
      report(line, 'warning', '请确认“' + columns[index] + '”是支付成交金额，避免把下单金额作为实付', def.key);
    }
  }
  return { mapping, indexes };
}

export function importRecordKey(kind, row) {
  return kind === 'attribution' ? JSON.stringify([row.date, row.scene, row.window]) : row.date;
}

function checkRow(kind, record, platform) {
  if (kind === 'finance' && !financial.some(def => Number.isFinite(record[def.key]))) {
    throw inputError('至少需要一项收入、成本、费用、税金或利润金额');
  }
  if (kind === 'attribution' && platform !== 'douyin'
    && attributionScenes[record.scene] === '自播付费' && record.window !== 'oneDay') {
    throw inputError('天猫自播付费只使用 1 天口径');
  }
}

function checkArithmetic(record, line, report) {
  const warnDifference = (actual, expected, message) => {
    if (Number.isFinite(actual) && Number.isFinite(expected) && Math.round(Math.abs(actual - expected) * 100) > 1) {
      report(line, 'warning', message);
    }
  };
  if (Number.isFinite(record.netRevenue) && Number.isFinite(record.cost)) {
    warnDifference(record.grossProfit, record.netRevenue - record.cost, '毛利额与未税收入减成本存在差额，请核对平台口径');
  }
  if (Number.isFinite(record.grossProfit) && Number.isFinite(record.expenses) && Number.isFinite(record.taxes)) {
    warnDifference(record.profit, record.grossProfit - record.expenses - record.taxes, '销售利润与毛利减费用、税费存在差额，请核对财务口径');
  }
}

function setRecordValue(record, key, value) {
  if (key.startsWith('expense.')) {
    record.expenseBreakdown ??= {};
    record.expenseBreakdown[key.slice(8)] = value;
  } else record[key] = value;
}

function sourceControl(cells, fields, indexes, header, platform, line, report) {
  const result = {};
  for (const def of fields.filter(def => def.type === 'money' || def.type === 'count')) {
    const index = indexes.get(def.key);
    const value = cells[index];
    if (absent.test(text(value))) continue;
    try { result[def.key] = parseCell(value, def, header[index], platform); }
    catch { report(line, 'warning', '合计行“' + def.label + '”无法读取，未用于对账', def.key); }
  }
  return result;
}

/**
 * Inspect an uploaded file without persistence. A caller may show valid rows in
 * a preview, but must never commit when an error is present.
 */
export async function parseImport({ kind, fileName, buffer, platform = 'tmall', sheet, mapping = {}, headerRow }) {
  if (!Object.hasOwn(schemas, kind)) throw inputError('未知的导入类型');
  if (!(buffer instanceof Uint8Array) || !buffer.length || buffer.length > MAX_BYTES) throw inputError('请选择 8 MB 以内的非空文件');
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw inputError('列映射格式无效');
  const fields = schemas[kind];
  const tables = await readTables(buffer, fileName);
  const sheetNames = tables.map(table => table.name);
  const table = sheet ? tables.find(item => item.name === sheet) : tables.find(item => item.rows.length) || tables[0];
  if (!table) throw inputError('找不到选择的工作表');
  const rowIndex = bestHeader(table.rows, fields, headerRow);
  const source = table.rows[rowIndex];
  if (!source) throw inputError('当前工作表没有表头和明细');
  const { cells: header, line } = source;
  const width = table.rows.slice(rowIndex).reduce((max, row) => Math.max(max, row.cells.length), header.length);
  const columns = uniqueColumns(header, width);
  const issues = [];
  const issueCounts = { warning: 0, error: 0 };
  const report = (row, level, message, field) => {
    if (++issueCounts[level] <= MAX_ISSUES) issues.push({ row, level, message, ...(field ? { field } : {}) });
  };
  const selected = selectedColumns(fields, header, columns, mapping, report, line);
  const skipped = { blank: 0, total: 0, duplicate: 0 };
  const records = new Map();
  let sourceTotals = {};
  let grandCount = 0;
  const missingColumn = fields.some(def => def.required && !selected.indexes.has(def.key));

  if (!missingColumn) for (const { cells, line: rowLine } of table.rows.slice(rowIndex + 1)) {
    if (!cells.some(value => text(value))) { skipped.blank++; continue; }
    const dateValue = text(cells[selected.indexes.get('date')]);
    const label = dateValue || text(cells.find(value => text(value)));
    if (summaryLabel.test(label)) {
      skipped.total++;
      if (grandTotal.test(label)) {
        grandCount++;
        sourceTotals = sourceControl(cells, fields, selected.indexes, header, platform, rowLine, report);
      }
      continue;
    }
    const record = {};
    let invalid = false;
    for (const def of fields) {
      const index = selected.indexes.get(def.key);
      if (index === undefined) continue;
      const value = cells[index];
      if (absent.test(text(value))) {
        if (def.required) {
          invalid = true;
          report(rowLine, 'error', def.label + '不能为空', def.key);
        }
        continue;
      }
      try { setRecordValue(record, def.key, parseCell(value, def, header[index], platform)); }
      catch (error) { invalid = true; report(rowLine, 'error', def.label + '：' + error.message, def.key); }
    }
    if (invalid) continue;
    try { checkRow(kind, record, platform); }
    catch (error) { report(rowLine, 'error', error.message); continue; }
    checkArithmetic(record, rowLine, report);

    const key = importRecordKey(kind, record);
    const existing = records.get(key);
    if (!existing) records.set(key, { row: record, line: rowLine });
    else if (kind === 'attribution' && (
      JSON.stringify(existing.row) === JSON.stringify(record)
      || (existing.row.snapshotAt && record.snapshotAt && existing.row.snapshotAt !== record.snapshotAt)
    )) {
      skipped.duplicate++;
      if (record.snapshotAt > existing.row.snapshotAt) records.set(key, { row: record, line: rowLine });
    } else report(rowLine, 'error', '与第 ' + existing.line + ' 行的业务键重复，请先核对粒度或快照时间');
  }
  if (grandCount > 1) {
    sourceTotals = {};
    report(line, 'warning', '工作表有多条合计行，已跳过，未将其中任一行视为全表对账值');
  }
  if (skipped.duplicate) report(line, 'warning', '推广重复快照 ' + skipped.duplicate + ' 行，已按同口径保留最新版本');
  const rows = [...records.values()].map(item => item.row).sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length && !issueCounts.error) report(line, 'error', '没有可导入的业务明细');
  for (const level of ['warning', 'error']) {
    if (issueCounts[level] > MAX_ISSUES) issues.push({ row: line, level, message: '另有 ' + (issueCounts[level] - MAX_ISSUES) + ' 条' + (level === 'error' ? '错误' : '提示') });
  }
  return {
    sheetNames, sheet: table.name, headerRow: line, columns, mapping: selected.mapping,
    fields: fields.map(({ key, label, required, type }) => ({ key, label, required, type })),
    rows, issues, skipped, sourceTotals, dateFrom: rows[0]?.date ?? null, dateTo: rows.at(-1)?.date ?? null,
  };
}
