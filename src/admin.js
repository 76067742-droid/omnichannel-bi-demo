import { card, escapeHtml, fmt, table, tiles } from './ui.js';

const platforms = { tmall: '天猫', douyin: '抖音' };
const kinds = { daily: '店铺日报', finance: '闭月财务', attribution: '推广归因', settlement: '结算日报' };
const controls = {
  daily: [['gmv', '支付金额'], ['refunds', '退款金额'], ['receipts', '回款'], ['spend', '推广花费']],
  finance: [['netRevenue', '未税收入']],
  attribution: [['directTxn', '直接归因成交'], ['spend', '花费']],
  settlement: [['settled', '结算金额'], ['receipts', '实收金额']],
};
const sampleLinks = {
  daily: [['./samples/天猫店铺日报.csv', '天猫 CSV 样例'], ['./samples/抖音店铺日报.xlsx', '抖音 Excel 样例']],
  finance: [['./finance-template.csv', '闭月财务 CSV 模板']],
  attribution: [['./attribution-template.csv', '推广归因 CSV 模板']],
  settlement: [['./samples/结算日报.csv', '结算 CSV 样例']],
};
const importNotes = {
  daily: '一店一天一行。请使用支付口径的成交金额，平台 GMV 字段需确认口径后再映射。',
  finance: '一店一月一行，日期填该月 01 日。完整月份优先读取闭月实际。',
  attribution: '按日、场景和归因窗口导入。归因金额用于诊断，与支付金额分开汇总。',
  settlement: '按结算日记录平台金额和实收。支付日期与结算日期可能不同，分别核对。',
};
const views = { shops: '店铺配置', imports: '导入与对账', history: '批次记录' };
const reconciliationLabels = { matched: '一致', mismatch: '有差异', missing: '缺少导入金额', unverified: '未提供对照值' };
const controlLabels = { manual: '独立对照', sheet: '表内合计' };
const amountFormatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const maxFileBytes = 8 * 1024 * 1024;

const count = value => fmt(value ?? 0);
const yuan = value => value == null || !Number.isFinite(Number(value)) ? '—' : '¥' + amountFormatter.format(Number(value));
const platformName = value => platforms[value] ?? value;
const kindName = value => kinds[value] ?? value;
const enabled = shops => shops.filter(shop => !shop.archived);
const shopName = shop => platformName(shop.platform) + ' · ' + shop.name;
const shopId = shop => String(shop.id);
const option = (value, label, active = '') =>
  '<option value="' + escapeHtml(value) + '"' + (String(value) === String(active) ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
const dateSpan = (start, end) => !start ? '—' : start === end || !end ? start : start + ' 至 ' + end;
const hasData = shop => Object.values(shop.counts ?? {}).some(value => value > 0);
const skipMapping = '__admin_skip__';

import { demoRequest as api } from './demo-workspace.js';

async function encoded(file) {
  if (file.size > maxFileBytes) throw new Error('文件超过 8 MB，请按日期拆分。');
  if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error('请选择 .xlsx 或 .csv 文件。');
  const data = new Uint8Array(await file.arrayBuffer());
  let bytes = '';
  for (let offset = 0; offset < data.length; offset += 16_384) {
    bytes += String.fromCharCode(...data.subarray(offset, offset + 16_384));
  }
  return btoa(bytes);
}

function shopTable(shops) {
  if (!shops.length) return '<div class="empty-state">还没有店铺。新增天猫或抖音店铺后即可导入。</div>';
  return '<div class="table-wrap"><table><thead><tr><th scope="col">店铺</th><th scope="col">平台</th>'
    + '<th scope="col">店铺编码</th><th scope="col">状态</th><th scope="col">日报覆盖</th>'
    + '<th scope="col">日报 / 财务 / 推广 / 结算</th><th scope="col">操作</th></tr></thead><tbody>'
    + shops.map(shop => {
      const id = escapeHtml(shopId(shop));
      const badge = '<span class="admin-platform" data-platform="' + escapeHtml(shop.platform) + '">' + escapeHtml(platformName(shop.platform)) + '</span>';
      const status = shop.archived ? '已归档' : '启用';
      const totals = Object.keys(kinds).map(key => count(shop.counts?.[key])).join(' / ');
      const href = '#shop?shop=' + encodeURIComponent(shop.id);
      const actions = '<button class="button" type="button" data-edit-shop="' + id + '">编辑</button>'
        + (shop.archived ? '' : '<button class="button" type="button" data-import-shop="' + id + '">导入</button>'
          + '<a class="button" data-open-shop="' + id + '" href="' + href + '">看板</a>')
        + '<button class="button admin-archive" type="button" data-archive-shop="' + id + '">' + (shop.archived ? '恢复' : '归档') + '</button>';
      return '<tr><th scope="row">' + escapeHtml(shop.name) + '</th><td>' + badge + '</td><td>' + escapeHtml(shop.code)
        + '</td><td>' + status + '</td><td>' + escapeHtml(dateSpan(shop.earliestDate, shop.latestDate))
        + '</td><td>' + totals + '</td><td><div class="admin-actions">' + actions + '</div></td></tr>';
    }).join('') + '</tbody></table></div>';
}

function shopEditor(shop) {
  const editing = Boolean(shop);
  return '<form id="admin-shop-form" class="admin-form admin-shop-form">'
    + '<label>平台<select name="platform"' + (editing ? ' disabled' : '') + '>'
    + Object.entries(platforms).map(([value, label]) => option(value, label, shop?.platform)).join('') + '</select></label>'
    + '<label>店铺编码<input required name="code" maxlength="64" autocomplete="off" value="' + escapeHtml(shop?.code)
    + '" placeholder="例：tmall-main"></label>'
    + '<label>店铺名称<input required name="name" maxlength="100" autocomplete="off" value="' + escapeHtml(shop?.name)
    + '" placeholder="例：天猫旗舰店"></label>'
    + '<button class="button primary" type="submit">' + (editing ? '保存店铺' : '新增店铺') + '</button>'
    + (editing ? '<button class="button" type="button" data-admin-action="cancel-edit">取消</button>' : '') + '</form>';
}

function mappingForm(preview, state) {
  const sheets = preview?.sheetNames ?? [];
  const fields = preview?.fields ?? [];
  const columns = preview?.columns ?? [];
  if (!preview) return '';
  return '<details class="admin-mapping"' + (state.mappingOpen ? ' open' : '') + '><summary>工作表与字段映射</summary>'
    + '<div class="admin-form admin-mapping-top">'
    + (sheets.length ? '<label>工作表<select name="sheet">' + sheets.map(name => option(name, name, state.sheet ?? preview.sheet)).join('') + '</select></label>' : '')
    + '<label>表头所在行<input name="headerRow" type="number" min="1" max="100" step="1" value="'
    + escapeHtml(state.headerRow ?? preview.headerRow ?? 1) + '"></label></div>'
    + '<div class="admin-fields">' + fields.map(({ key, label, required }) => {
      const overridden = Object.hasOwn(state.mapping, key);
      const selected = overridden ? (state.mapping[key] ?? skipMapping) : preview.mapping?.[key];
      return '<label>' + escapeHtml(label) + (required ? ' *' : '') + '<select data-map-field="' + escapeHtml(key)
        + '"><option value="">自动识别</option>'
        + (required ? '' : option(skipMapping, '忽略此字段', selected))
        + columns.map(col => {
          const name = typeof col === 'string' ? col : col.name ?? col.label;
          const value = typeof col === 'string' ? col : col.key ?? col.name ?? col.label;
          return option(value, name, selected);
        }).join('') + '</select></label>';
    }).join('') + '</div>'
    + '<p class="hint">更换工作表、表头行或字段后，重新运行预检。</p></details>';
}

function importForm(shops, state, preview, legacyData) {
  const live = enabled(shops);
  if (!live.length) {
    return '<div class="empty-state">请先配置至少一家启用的店铺。<br><button type="button" class="button primary" data-view="shops">配置店铺</button></div>';
  }
  const currentShop = live.find(shop => shopId(shop) === state.shopId) || live[0];
  const controlsHtml = controls[state.kind].map(([key, label]) =>
    '<label>' + escapeHtml(label) + '对照值<input type="number" name="expected-' + key + '" step="0.01" value="'
    + escapeHtml(state.expected[key] ?? '') + '" placeholder="选填，元"></label>').join('');
  const sample = sampleLinks[state.kind].map(([href, label]) =>
    '<a href="' + href.split('/').map(encodeURIComponent).join('/') + '" download>' + escapeHtml(label) + '</a>').join('');
  return '<form id="admin-import-form" class="admin-import-form">'
    + '<div class="admin-form"><label>目标店铺<select required name="shopId">'
    + live.map(shop => option(shopId(shop), shopName(shop), shopId(currentShop))).join('') + '</select></label>'
    + '<label>数据类型<select name="kind">'
    + Object.entries(kinds).map(([key, label]) => option(key, label, state.kind)).join('') + '</select></label>'
    + '<label class="admin-file">来源文件<input name="file" type="file" accept=".xlsx,.csv" aria-describedby="admin-file-label"></label>'
    + '<button class="button primary" type="submit">运行预检</button></div>'
    + '<p class="hint" id="admin-file-label">' + (state.file ? '已选择 ' + escapeHtml(state.file.name) + ' · ' : '') + escapeHtml(importNotes[state.kind])
    + '</p><div class="admin-samples"><button class="button" type="button" data-demo-sample>使用内置样表</button>' + sample + '</div>'
    + mappingForm(preview, state)
    + '<details class="admin-controls"' + (state.controlsOpen ? ' open' : '') + '><summary>填写平台对照金额（可选）</summary>'
    + '<div class="admin-form">' + controlsHtml + '</div>'
    + '<p class="hint">从平台后台或已核准汇总填写与本文件相同范围的金额。未填写时可使用可识别的表内合计。推广文件包含多个归因窗口时按窗口分别核对。</p></details>'
    + '</form>' + migrationPanel(live, legacyData);
}

function migrationPanel(shops, legacy) {
  if (!legacy?.store?.length && !legacy?.financeMonthly?.length && !Object.values(legacy?.attribution ?? {}).some(Array.isArray)) return '';
  const candidates = shops.filter(shop => !hasData(shop));
  return '<details class="admin-migrate"><summary>迁移本浏览器旧版单店数据</summary>'
    + '<p class="hint">选择与旧日报对应的空店铺。新版保存日报、闭月财务与推广归因，迁移后仍保留旧浏览器记录。</p>'
    + (candidates.length
      ? '<form id="admin-migrate-form" class="admin-form"><label>目标空店铺<select name="shopId">'
        + candidates.map(shop => option(shopId(shop), shopName(shop))).join('') + '</select></label>'
        + '<label class="admin-check"><input required type="checkbox">已核对店铺归属</label>'
        + '<button type="submit" class="button">迁移旧版数据</button></form>'
      : '<p class="hint">暂无空店铺，可以先在店铺配置中新增。</p>') + '</details>';
}

function reconciliationTable(rows) {
  if (!rows?.length) return '<p class="hint">当前文件没有可供对账的有效金额。</p>';
  return '<div class="table-wrap"><table><thead><tr>'
    + ['指标', '本次导入', '同键原值', '入库变化', '对照值', '差额', '核对'].map(value => '<th scope="col">' + value + '</th>').join('')
    + '</tr></thead><tbody>' + rows.map(row =>
      '<tr><th scope="row">' + escapeHtml(row.label || row.key) + '</th>'
      + [row.imported, row.existing, row.delta].map(value => '<td>' + yuan(value) + '</td>').join('')
      + '<td>' + yuan(row.expected) + (controlLabels[row.controlSource] ? ' <small>' + controlLabels[row.controlSource] + '</small>' : '') + '</td>'
      + '<td>' + yuan(row.difference) + '</td>'
      + '<td><span class="admin-recon ' + (row.status === 'matched' ? 'success' : row.status === 'mismatch' ? 'danger' : '') + '">'
      + escapeHtml(reconciliationLabels[row.status] ?? row.status) + '</span></td></tr>').join('')
    + '</tbody></table></div>';
}

function previewContent(preview, state) {
  if (!preview) return '<div class="admin-empty">预检将展示识别列、行级问题、入库变更和对照差额。</div>';
  const issues = preview.issues ?? [];
  const changes = preview.changes ?? {};
  const samples = preview.samples ?? [];
  const reconciliation = preview.reconciliation ?? [];
  const blocked = issues.some(issue => issue.level === 'error') || !preview.canCommit;
  const shownFields = [...new Set(samples.flatMap(row => Object.keys(row)))].filter(key =>
    samples.some(row => row[key] == null || typeof row[key] !== 'object')).slice(0, 12);
  const fields = new Map((preview.fields ?? []).map(field => [field.key, field.label]));
  let text = '预检通过，核对后可入库。';
  if (state.stale) text = '导入选项已变更，请重新预检。';
  else if (preview.duplicate) text = '相同导入已处理，数据无需重复写入。';
  else if (blocked) text = '预检未通过。请查看校验问题或金额差异。';
  const notes = issues.length ? '<h3>校验明细</h3>'
    + table(['来源行', '级别', '问题'], issues.map(item => [item.row || '文件', item.level === 'error' ? '错误' : '提示', item.message])) : '';
  const sample = samples.length && shownFields.length ? '<details class="admin-sample"><summary>查看数据预览（' + count(samples.length) + ' 行）</summary>'
    + table(shownFields.map(key => fields.get(key) || key), samples.map(row => shownFields.map(key => row[key]))) + '</details>' : '';
  const ignored = Object.entries({ blank: '空行', total: '合计行', duplicate: '重复行' })
    .filter(([key]) => preview.skipped?.[key] > 0)
    .map(([key, label]) => label + ' ' + count(preview.skipped[key]));
  const meta = '<p class="hint">工作表 ' + escapeHtml(preview.sheet || 'CSV')
    + ' · 表头第 ' + count(preview.headerRow) + ' 行 · ' + escapeHtml(dateSpan(preview.dateFrom, preview.dateTo))
    + (ignored.length ? ' · 已跳过 ' + ignored.join(' / ') : '') + '</p>';
  const ready = !state.stale && !preview.duplicate && !blocked && Boolean(preview.previewId);
  return '<div class="admin-result ' + (blocked && !preview.duplicate ? 'admin-result-alert' : '') + '" role="status">' + text + '</div>'
    + meta + tiles([
      { label: '有效记录', value: count(preview.rowCount) },
      { label: '新增', value: count(changes.added) },
      { label: '更新同键', value: count(changes.updated) },
      { label: '无变化', value: count(changes.unchanged) },
    ]) + '<h3>金额对账（元）</h3>' + reconciliationTable(reconciliation) + notes + sample
    + '<form id="admin-commit-form" class="admin-form admin-commit" data-ready="' + ready + '">'
    + (ready ? '<label class="admin-check"><input required type="checkbox" name="reviewed">已核对店铺、字段和金额</label>' : '')
    + '<button type="submit" class="button primary" disabled>确认入库</button></form>';
}

function historyTable(batches, shops) {
  if (!batches.length) return '<div class="empty-state">暂无入库记录。</div>';
  const byShop = new Map(shops.map(shop => [shopId(shop), shopName(shop)]));
  return '<div class="admin-history-list">' + batches.map(batch => {
    const when = new Date(batch.createdAt);
    const timestamp = Number.isNaN(when.valueOf()) ? batch.createdAt : timeFormatter.format(when);
    const changes = batch.changes ?? {};
    return '<details class="admin-batch"><summary><strong>' + escapeHtml(batch.fileName || '旧版迁移') + '</strong>'
      + '<span>' + escapeHtml(byShop.get(String(batch.shopId)) ?? '店铺 ' + batch.shopId) + '</span>'
      + '<span>' + escapeHtml(kindName(batch.kind)) + '</span><span>' + count(batch.rowCount) + ' 行</span>'
      + '<span>' + escapeHtml(timestamp) + '</span></summary>'
      + '<div class="admin-batch-body"><p class="hint">数据期间 ' + escapeHtml(dateSpan(batch.dateFrom, batch.dateTo))
      + (batch.sheet ? ' · 工作表 ' + escapeHtml(batch.sheet) : '') + '</p>'
      + '<p>新增 ' + count(changes.added) + ' · 更新 ' + count(changes.updated) + ' · 无变化 ' + count(changes.unchanged) + '</p>'
      + reconciliationTable(batch.reconciliation) + '</div></details>';
  }).join('') + '</div>';
}

export function renderAdmin(root, { shops = [], onChanged, legacyData, navigate } = {}) {
  let allShops = [...shops];
  let view = location.hash === '#admin?view=imports' ? 'imports' : 'shops';
  let editing = '';
  let preview = null;
  let busy = false;
  let historyShop = '';
  let currentBatches = null;
  let historyVersion = 0;
  const state = { shopId: '', kind: 'daily', file: null, sheet: null, headerRow: null, mapping: {}, expected: {}, stale: false };

  root.innerHTML = '<div class="admin-console"><header class="admin-hero"><div><span class="admin-kicker">电商 BI · 演示工作台</span>'
    + '<h1>管理后台</h1><p>用样表体验店铺配置、字段映射和金额对账。本页操作只在当前标签页生效，刷新即重置。</p></div>'
    + '<div class="admin-hero-tag">天猫 / 抖音</div></header>'
    + '<nav class="admin-nav" aria-label="后台模块"></nav><div class="admin-feedback" role="status" aria-live="polite"></div>'
    + '<div class="admin-content"></div></div>';
  const console = root.querySelector('.admin-console');
  const nav = console.querySelector('.admin-nav');
  const feedback = console.querySelector('.admin-feedback');
  const body = console.querySelector('.admin-content');

  const notice = (message, problem = false) => {
    feedback.textContent = message;
    feedback.classList.toggle('problem', problem);
  };

  function resetPreview(resetMapping = true) {
    preview = null;
    state.stale = false;
    if (!resetMapping) return;
    Object.assign(state, { sheet: null, headerRow: null, mapping: {}, mappingOpen: false });
  }

  function resetUpload(shop) {
    Object.assign(state, { shopId: shop, file: null, expected: {} });
    resetPreview();
  }

  function draw() {
    const fileInput = body.querySelector('input[name="file"]');
    const keepFileInput = state.file && fileInput?.files[0] === state.file;
    nav.innerHTML = Object.entries(views).map(([key, label]) => '<button type="button" class="button' + (key === view ? ' primary' : '')
      + '" aria-pressed="' + (key === view) + '" data-view="' + key + '">' + label + '</button>').join('');
    if (view === 'shops') {
      const shop = allShops.find(item => shopId(item) === editing);
      const active = enabled(allShops);
      body.innerHTML = card('店铺配置', tiles([
        { label: '启用店铺', value: count(active.length) },
        { label: '天猫店铺', value: count(active.filter(shop => shop.platform === 'tmall').length) },
        { label: '抖音店铺', value: count(active.filter(shop => shop.platform === 'douyin').length) },
      ]) + '<h3>' + (shop ? '编辑店铺' : '新增店铺') + '</h3>' + shopEditor(shop) + shopTable(allShops),
      '店铺编码在同平台内唯一。归档店铺会退出经营汇总，历史批次保留。');
    } else if (view === 'imports') {
      body.innerHTML = card('文件导入', importForm(allShops, state, preview, legacyData),
        '支持 Excel（.xlsx）和 CSV。先检查本批金额、同键原值和可选的外部对照值。')
        + card('预检与对账', '<div id="admin-preview">' + previewContent(preview, state) + '</div>');
      if (keepFileInput) body.querySelector('input[name="file"]')?.replaceWith(fileInput);
    } else {
      body.innerHTML = card('导入批次记录', '<div class="admin-form"><label>店铺范围<select name="historyShop">'
        + option('', '全部店铺', historyShop) + allShops.map(shop => option(shopId(shop), shopName(shop), historyShop)).join('')
        + '</select></label></div><div id="admin-history">'
        + (currentBatches ? historyTable(currentBatches, allShops) : '<div class="admin-empty">读取批次记录中…</div>') + '</div>',
      '显示所选范围最近的 200 条批次。');
    }
    if (busy) markBusy(true);
  }

  function markBusy(value) {
    busy = value;
    if (value) {
      for (const element of console.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')) {
        element.dataset.adminBusy = '';
        element.disabled = true;
      }
    } else {
      for (const element of console.querySelectorAll('[data-admin-busy]')) {
        element.disabled = false;
        delete element.dataset.adminBusy;
      }
    }
    console.setAttribute('aria-busy', String(value));
  }

  function drawPreview() {
    const node = body.querySelector('#admin-preview');
    if (node) node.innerHTML = previewContent(preview, state);
  }

  function markStale() {
    if (preview) {
      state.stale = true;
      drawPreview();
    }
  }

  async function refreshShops(shop) {
    if (shop) {
      const existing = allShops.findIndex(item => shopId(item) === shopId(shop));
      if (existing >= 0) allShops[existing] = shop;
      else allShops.push(shop);
    }
    const result = await onChanged?.();
    if (Array.isArray(result?.shops)) allShops = result.shops;
  }

  async function history() {
    const version = ++historyVersion;
    try {
      const data = await api('/api/imports' + (historyShop ? '?shopId=' + encodeURIComponent(historyShop) : ''));
      if (version !== historyVersion || view !== 'history' || !root.contains(console)) return;
      currentBatches = data.batches ?? [];
      body.querySelector('#admin-history').innerHTML = historyTable(currentBatches, allShops);
    } catch (error) {
      if (version === historyVersion && view === 'history') {
        body.querySelector('#admin-history').innerHTML = '<div class="admin-empty">批次记录暂不可用。</div>';
        notice(error.message, true);
      }
    }
  }

  function openView(next) {
    view = next;
    notice('');
    draw();
    if (next === 'history') history();
  }

  async function task(work) {
    if (busy) return;
    markBusy(true);
    notice('');
    try {
      await work();
    } catch (error) {
      notice(error.message, true);
    } finally {
      markBusy(false);
    }
  }

  console.addEventListener('toggle', event => {
    if (event.target.matches('.admin-mapping')) state.mappingOpen = event.target.open;
    if (event.target.matches('.admin-controls')) state.controlsOpen = event.target.open;
  }, true);

  console.addEventListener('click', event => {
    const target = event.target.closest('button, a');
    if (!target || busy) return;
    if (target.dataset.view) {
      openView(target.dataset.view);
      nav.querySelector('[aria-pressed="true"]')?.focus();
    }
    if (target.hasAttribute('data-demo-sample')) {
      task(async () => {
        const shop = allShops.find(item => item.id === state.shopId) || enabled(allShops)[0];
        const links = sampleLinks[state.kind];
        const [path] = links[state.kind === 'daily' && shop?.platform === 'douyin' ? 1 : 0];
        const response = await fetch(encodeURI(path));
        if (!response.ok) throw new Error('样表加载失败，请重试。');
        const file = new File([await response.blob()], path.split('/').at(-1));
        state.file = file;
        resetPreview();
        draw();
        body.querySelector('#admin-file-label')?.scrollIntoView({ block: 'nearest' });
        notice('样表已选中。点击“运行预检”查看映射和对账。');
      });
      return;
    }
    if (target.dataset.adminAction === 'cancel-edit') {
      editing = '';
      draw();
    }
    if (target.dataset.editShop) {
      editing = target.dataset.editShop;
      draw();
      body.querySelector('input[name="name"]')?.focus();
    }
    if (target.dataset.importShop) {
      if (state.shopId !== target.dataset.importShop) resetUpload(target.dataset.importShop);
      openView('imports');
    }
    if (target.dataset.openShop && navigate) {
      event.preventDefault();
      navigate('shop', undefined, target.dataset.openShop);
    }
    if (target.dataset.archiveShop) task(async () => {
      const id = target.dataset.archiveShop;
      const old = allShops.find(shop => shopId(shop) === id);
      const { shop } = await api('/api/shops/' + encodeURIComponent(id), { method: 'PATCH', body: { archived: !old.archived } });
      await refreshShops(shop);
      if (state.shopId === id && shop.archived) resetUpload('');
      if (editing === id) editing = '';
      draw();
      notice(shop.archived ? '店铺已归档，历史批次已保留。' : '店铺已恢复。');
    });
  });

  console.addEventListener('change', event => {
    if (busy) return;
    const { target } = event;
    if (target.name === 'historyShop') {
      historyShop = target.value;
      currentBatches = null;
      draw();
      history();
      return;
    }
    if (target.form?.id === 'admin-commit-form' && target.name === 'reviewed') {
      target.form.querySelector('button[type="submit"]').disabled = !target.checked || target.form.dataset.ready !== 'true';
      return;
    }
    if (target.form?.id !== 'admin-import-form') return;
    if (target.name === 'kind' || target.name === 'shopId' || target.name === 'file') {
      if (target.name === 'kind') {
        state.kind = target.value;
        state.expected = {};
      }
      if (target.name === 'shopId') {
        state.shopId = target.value;
        state.expected = {};
      }
      if (target.name === 'file') {
        if (state.file) state.expected = {};
        state.file = target.files[0] || null;
      }
      resetPreview();
      draw();
      if (target.name !== 'file') body.querySelector('[name="' + target.name + '"]')?.focus();
      return;
    }
    if (target.name === 'sheet' || target.name === 'headerRow') {
      state[target.name] = target.name === 'headerRow' ? Number(target.value) || null : target.value;
      if (target.name === 'sheet') state.headerRow = null;
      state.mapping = {};
      markStale();
    }
    if (target.dataset.mapField) {
      const key = target.dataset.mapField;
      if (target.value) state.mapping[key] = target.value === skipMapping ? null : target.value;
      else delete state.mapping[key];
      markStale();
    }
  });

  console.addEventListener('input', event => {
    const { name, value } = event.target;
    if (busy || !name?.startsWith('expected-')) return;
    const key = name.slice(9);
    if (value) state.expected[key] = value;
    else delete state.expected[key];
    markStale();
  });

  console.addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    const form = event.target;
    const fields = Object.fromEntries(new FormData(form));
    if (form.id === 'admin-shop-form') task(async () => {
      const payload = { code: fields.code.trim(), name: fields.name.trim() };
      if (!editing) payload.platform = fields.platform;
      const path = editing ? '/api/shops/' + encodeURIComponent(editing) : '/api/shops';
      const { shop } = await api(path, { method: editing ? 'PATCH' : 'POST', body: payload });
      await refreshShops(shop);
      editing = '';
      draw();
      notice('店铺配置已保存。');
    });
    if (form.id === 'admin-import-form') task(async () => {
      if (!state.file) throw new Error('请先选择要预检的 Excel 或 CSV 文件。');
      if (!fields.shopId) throw new Error('请先配置目标店铺。');
      state.shopId = fields.shopId;
      const contentBase64 = await encoded(state.file);
      const expected = Object.fromEntries(Object.entries(state.expected).map(([key, value]) => [key, Number(value)]));
      const body = { shopId: state.shopId, kind: state.kind, fileName: state.file.name, contentBase64, expected };
      if (state.sheet) body.sheet = state.sheet;
      if (state.headerRow) body.headerRow = state.headerRow;
      if (Object.keys(state.mapping).length) body.mapping = state.mapping;
      if (preview) {
        state.stale = true;
        drawPreview();
      }
      preview = await api('/api/imports/preview', { method: 'POST', body });
      state.stale = false;
      state.sheet = preview.sheet || null;
      state.headerRow = preview.headerRow || null;
      if (!preview.canCommit && !preview.duplicate && preview.issues?.some(issue => issue.row === preview.headerRow)) state.mappingOpen = true;
      draw();
    });
    if (form.id === 'admin-commit-form') task(async () => {
      if (!preview?.canCommit || preview.duplicate || state.stale || !fields.reviewed) return;
      const { batch, shop } = await api('/api/imports/' + encodeURIComponent(preview.previewId) + '/commit', { method: 'POST' });
      await refreshShops(shop);
      const filename = batch.fileName;
      const written = batch.rowCount;
      resetUpload(state.shopId);
      currentBatches = null;
      draw();
      notice('已入库 ' + count(written) + ' 行 · ' + filename + '。可在批次记录中查看对账。');
    });
    if (form.id === 'admin-migrate-form') task(async () => {
      const { shop } = await api('/api/migrate', { method: 'POST', body: { shopId: fields.shopId, legacy: legacyData } });
      await refreshShops(shop);
      legacyData = null;
      currentBatches = null;
      draw();
      notice('旧版数据已迁移到 ' + shop.name + '。');
    });
  });
  draw();
}
