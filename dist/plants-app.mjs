import {contextFromSearch,readingContext,readerLink,applyReadingToCard} from './reading-links.mjs';
import {unverifiedNameCard,taxonomyPresentation,lookupWarning,findExistingNameCard} from './collection-lookup-ui.mjs';
import {createNatureImage} from './nature-image-view.mjs';
const $ = id => document.getElementById(id);
let incomingReading = contextFromSearch(location.search);
const statuses = ['全部收藏', '想了解', '已认识', '待观察'];
const kindLabels = { all: '万物', plant: '植物', animal: '动物（含鸟类）', bird: '鸟类', other: '其他' };
let kindFilter = 'all', lookupKind = 'all';
const savedKind = item => ['plant', 'animal', 'bird', 'other'].includes(item.kind) ? item.kind : 'plant';
const matchesKind = (item, kind) => kind === 'all' || savedKind(item) === kind || (kind === 'animal' && savedKind(item) === 'bird');
let plants = [], filter = '全部收藏', query = '', candidate = null, editing = null, lookupVersion = 0, searchName = '', busy = false, toastTimer;
const dialogFocus = new Map();
const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
function icon(name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', `#${name}`); svg.setAttribute('aria-hidden', 'true'); svg.append(use); return svg; }
function safeUrl(value) { try { const url = new URL(value || '', location.origin); return value && ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function photograph(plant, cls = 'card-image') { const wrap = node('div', cls); wrap.append(createNatureImage(plant)); return wrap; }
function notify(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('visible'); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4200); }
function show(id, trigger = document.activeElement) { dialogFocus.set(id, trigger); if (!$(id).open) $(id).showModal(); }
function close(id) { if (busy && id === 'edit-dialog') return; $(id).close(); const trigger = dialogFocus.get(id); if (trigger?.isConnected && !trigger.closest('dialog:not([open])')) trigger.focus(); else $('plant-query').focus(); }
function error(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
async function api(path, options = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 25000);
  try { const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: controller.signal }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || `请求未完成（${response.status}），请稍后重试。`); return data; }
  catch (err) { if (err.name === 'AbortError') throw new Error('连接超时，请检查网络后再试。'); if (err instanceof TypeError) throw new Error('无法连接本地服务，请确认服务正在运行后重试。'); throw err; }
  finally { clearTimeout(timer); }
}
async function showStorageLocation() {
  try {
    const data = await api('/api/storage');
    if (typeof data.folderPath !== 'string' || !data.folderPath) return;
    $('storage-location').textContent = `${data.type === 'obsidian' ? 'Obsidian 收藏资料夹' : '本机收藏资料夹'} · ${data.folderPath}`;
    $('storage-location').hidden = false;
  } catch { $('storage-location').hidden = true; }
}
async function load() { $('initial-loading').hidden = false; $('connection-error').hidden = true; $('empty-collection').hidden = true; $('no-results').hidden = true; try { const data = await api('/api/plants'); if (!Array.isArray(data.plants)) throw new Error('收藏数据格式不正确，请重新连接。'); plants = data.plants; render(); showStorageLocation(); } catch (err) { $('connection-message').textContent = err.message; $('connection-error').hidden = false; } finally { $('initial-loading').hidden = true; } }
function render() {
  $('total-count').textContent = plants.length;
  $('kind-filters').replaceChildren();
  for (const [kind, label] of Object.entries(kindLabels)) {
    const button = node('button', `kind-tab${kindFilter === kind ? ' active' : ''}`); button.type = 'button';
    button.setAttribute('aria-pressed', String(kindFilter === kind));
    button.append(document.createTextNode(label), node('small', '', plants.filter(item => matchesKind(item, kind)).length));
    button.addEventListener('click', () => { kindFilter = kind; render(); }); $('kind-filters').append(button);
  }
  const scopedPlants = plants.filter(item => matchesKind(item, kindFilter));
  $('status-tabs').replaceChildren();
  for (const status of statuses) { const count = status === statuses[0] ? scopedPlants.length : scopedPlants.filter(plant => plant.status === status).length; const button = node('button', `status-tab${filter === status ? ' active' : ''}`); button.type = 'button'; button.setAttribute('aria-pressed', String(filter === status)); button.append(document.createTextNode(status), node('small', '', count)); button.addEventListener('click', () => { filter = status; render(); }); $('status-tabs').append(button); }
  const needle = query.trim().toLocaleLowerCase();
  const results = scopedPlants.filter(plant => (filter === statuses[0] || plant.status === filter) && (!needle || [plant.name, plant.scientificName, plant.sourceBook, plant.chapter, plant.page, plant.notes, ...(plant.tags || [])].join(' ').toLocaleLowerCase().includes(needle)));
  $('plant-grid').replaceChildren();
  $('empty-collection').hidden = plants.length > 0;
  $('no-results').hidden = plants.length === 0 || results.length > 0;
  for (const [index, plant] of results.entries()) {
    const card = node('button', 'plant-card'); card.type = 'button'; card.setAttribute('aria-label', `查看${plant.name}的收藏详情`);
    const image = photograph(plant); image.append(node('span', 'card-status', plant.status || '想了解'), node('span', 'card-number', `No. ${String(index + 1).padStart(3, '0')}`));
    const body = node('div', 'card-body'); const title = node('div', 'card-title-line'); title.append(node('h3', '', plant.name), node('span', '', '↗')); body.append(title, node('p', 'scientific-name', plant.scientificName || '学名待补充'), node('p', 'card-taxonomy', `${plant.family || '科名待补充'} / ${plant.genus || '属名待补充'}`));
    body.append(node('p','card-rank',taxonomyPresentation(plant).rankLabel));
    const tags = node('div', 'card-tags'); tags.append(node('span', 'card-tag', savedKind(plant) === 'animal' ? '动物' : kindLabels[savedKind(plant)])); for (const tag of (plant.tags || []).slice(0, 6)) tags.append(node('span', 'card-tag', tag)); body.append(tags);
    const source = node('div', 'card-source'); source.append(icon('book'), node('span', '', [plant.sourceBook ? `《${plant.sourceBook.replace(/^《|》$/g, '')}》` : '来源书籍待记录', plant.chapter, plant.page].filter(Boolean).join(' · '))); body.append(source); card.append(image, body);
    if (plant.imageAttribution) card.append(node('div', 'image-credit', plant.imageAttribution));
    card.addEventListener('click', () => editPlant(plant, card)); $('plant-grid').append(card);
  }
  $('collection-summary').textContent = plants.length ? `已留下 ${plants.length} 条收藏${results.length !== plants.length ? ` · 当前显示 ${results.length} 条` : ' · 每一条，都有相遇的故事。'}` : '每一次收藏，都是认识自然的开始。';
}
function keepUnverifiedName(name = searchName) {
  const draft = unverifiedNameCard(name,lookupKind);
  const existing = findExistingNameCard(plants,draft.name,lookupKind);
  close('search-dialog');
  editPlant(existing || draft,$('plant-query'),!existing,true);
  if (existing) notify('这个名称已在收藏中，已打开原卡片；保存前可以核对并补充笔记。');
}
function keepNameEntry(name) {
  const entry = node('button','keep-name-card'); entry.type = 'button';
  entry.append(node('strong','',`先收纳「${name}」`),node('span','','暂不确认具体物种 · 不用知道拉丁名，之后再补资料'),node('small','','按原名称记录，学名、图片和分类均标为待核对 ↗'));
  entry.addEventListener('click',()=>keepUnverifiedName(name));
  return entry;
}
async function lookup(name) {
  name = name.trim(); if (!name) { $('plant-query').focus(); return; }
  lookupKind = $('lookup-kind').value;
  const version = ++lookupVersion; searchName = name; $('plant-query').value = name; $('search-subtitle').textContent = `寻找「${name}」的资料。可以核对物种或类群，也可以先把名字留下。`; $('candidate-list').replaceChildren(keepNameEntry(name)); $('search-loading').hidden = false; error('search-error'); $('search-warning').hidden = true; show('search-dialog', $('plant-query'));
  try { const data = await api(`/api/search?q=${encodeURIComponent(name)}&kind=${encodeURIComponent(lookupKind)}`); if (version !== lookupVersion || !$('search-dialog').open) return; const results = Array.isArray(data.results) ? data.results : [];
    $('candidate-list').replaceChildren();
    const warning = lookupWarning(data,results);
    if (warning) { $('search-warning').textContent = warning; $('search-warning').title = typeof data.warning === 'string' ? data.warning : ''; $('search-warning').hidden = false; }
    if (!results.length) { $('candidate-list').append(keepNameEntry(name)); const empty = node('div', 'candidate-empty'); empty.append(node('p', '', '暂未找到可靠资料也能收藏。之后可以补充别名、学名或照片；现在无需更换名称重试。')); $('candidate-list').append(empty); }
    for (const item of results.slice(0, 20)) {
      const card = node('button', 'candidate-card'); card.type = 'button';
      const info = node('div', 'candidate-body');
      const taxonomy = taxonomyPresentation(item);
      info.append(node('strong', '', item.name || name), node('em', '', item.scientificName || '分类待核对'), node('p', '', `${item.family || '科名待补充'} / ${item.genus || '属名待补充'}`));
      info.append(node('p', '', `物种类群：${savedKind(item) === 'animal' ? '动物' : kindLabels[savedKind(item)]}`));
      info.append(node('p','candidate-rank',taxonomy.rankLabel));
      const sourceLabel = item.providerLabel || item.sourceLabel;
      if (typeof sourceLabel === 'string' && sourceLabel.trim()) info.append(node('p', 'candidate-source',`${taxonomy.sourceType}：${sourceLabel}`));
      const matchNote = typeof item.matchNote === 'string' && item.matchNote.trim() ? item.matchNote : ({ exact: '名称精确匹配', alias: '通过别名匹配，请核对物种资料' })[item.matchType];
      if (matchNote) info.append(node('p', '', matchNote));
      info.append(node('small', '', taxonomy.higher ? '收藏这个类群 ↗' : '核对并收藏 ↗'));
      card.append(photograph(item, 'candidate-image'), info);
      if (item.imageAttribution) {
        const attribution = String(item.imageAttribution);
        const license = attribution.match(/\b(?:CC(?:0| BY(?:-[A-Z]{2})*)(?:[ -]\d(?:\.\d)?)?|Public domain)\b/i)?.[0];
        const compact = attribution.replace(/\s*,?\s*uploaded by[\s\S]*$/i,'').replace(/some rights reserved[\s,]*/i,'').trim();
        const label = compact.length > 110 ? `${compact.slice(0,107)}…` : compact;
        const credit = node('p','candidate-photo-credit',`${label}${license && !label.includes(license) ? ` · ${license}` : ''}`);
        credit.title = attribution; card.append(credit);
      }
      card.addEventListener('click', () => {
        close('search-dialog');
        const kingdom = value => ['animal','bird'].includes(savedKind(value)) ? 'animal' : savedKind(value);
        const existing = plants.find(value=>(item.taxonId && value.taxonId && String(value.taxonId) === String(item.taxonId)) || (item.scientificName && value.scientificName && item.scientificName.toLocaleLowerCase() === value.scientificName.toLocaleLowerCase() && kingdom(item) === kingdom(value)));
        editPlant(existing || item,$('plant-query'),!existing,true);
      });
      $('candidate-list').append(card);
    }
  } catch (err) { if (version === lookupVersion && $('search-dialog').open) { if (!$('candidate-list').querySelector('.keep-name-card')) $('candidate-list').prepend(keepNameEntry(name)); $('search-warning').textContent = '在线资料暂不可用，仍可以先按名称收纳，稍后再补充资料。'; $('search-warning').title = err.message; $('search-warning').hidden = false; } }
  finally { if (version === lookupVersion) $('search-loading').hidden = true; }
}
function editPlant(plant, trigger, isNew = false, applyReading = false) {
  const provenance = applyReading && incomingReading.name && (incomingReading.bookId || incomingReading.sourceBook || incomingReading.quote) ? readingContext(incomingReading) : null;
  plant = provenance ? applyReadingToCard(plant,provenance,{isNew}) : plant;
  candidate = { ...plant }; editing = isNew ? null : plant.id; error('edit-error');
  $('edit-title').textContent = editing ? '这个物种，与你的故事' : '留住这一次相遇'; $('edit-eyebrow').textContent = editing ? 'YOUR NATURE READING MEMORY' : 'A NEW LEAF IN YOUR COLLECTION';
  $('save-plant').replaceChildren(document.createTextNode(editing ? '保存这页记忆' : '加入我的万物收藏'), node('span', '', editing ? '✓' : '＋')); $('delete-plant').hidden = !editing;
  const values = { name: plant.name || '', kind: savedKind(plant), scientific: plant.scientificName || '', family: plant.family || '', genus: plant.genus || '', book: plant.sourceBook ?? '看不见的森林', chapter: plant.chapter || '', page: plant.page || '', notes: plant.notes || '', tags: (plant.tags || []).join('，'), status: plant.status || '想了解' };
  for (const [key, value] of Object.entries(values)) $(`edit-${key}`).value = value;
  $('edit-specimen').replaceChildren(); const photo = photograph(plant, 'image-wrap'); const details = node('div', 'specimen-details'); details.append(node('p', '', plant.description || '这个物种的资料还待补充。先留下名字和阅读笔记，慢慢认识它。'));
  details.append(node('p','candidate-rank',taxonomyPresentation(plant).rankLabel));
  if (plant.imageAttribution) details.append(node('div', 'credit', `图片：${plant.imageAttribution}`));
  const sourceLabel = plant.providerLabel || plant.sourceLabel;
  if (typeof sourceLabel === 'string' && sourceLabel.trim()) details.append(node('p', '', `资料来源：${sourceLabel}`));
  const url = safeUrl(plant.sourceUrl); if (url) { const link = node('a', '', '查看物种资料来源 ↗'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; details.append(link); }
  const seenSourceUrls = new Set(url ? [url] : []);
  for (const [index, value] of (Array.isArray(plant.sourceUrls) ? plant.sourceUrls.slice(0, 8) : []).entries()) {
    const extraUrl = safeUrl(value);
    if (!extraUrl || seenSourceUrls.has(extraUrl)) continue;
    seenSourceUrls.add(extraUrl);
    const link = node('a', '', `其他物种资料来源 ${index + 1} ↗`);
    link.href = extraUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; details.append(link);
  }
  const returnUrl = readerLink(plant);
  if (returnUrl) { const link = node('a','reading-return','回到书中 · 重排阅读页 ↗'); link.href = returnUrl; details.append(link); }
  $('edit-specimen').append(photo, details); show('edit-dialog', trigger);
}
function tagsFromInput() { return [...new Set($('edit-tags').value.split(/[,，;；\n]+/u).map(tag => tag.trim()).filter(Boolean))]; }
async function save(event) {
  event.preventDefault(); if (busy) return;
  const name = $('edit-name').value.trim(); if (!name) { error('edit-error', '请先填写物种名称。'); $('edit-name').focus(); return; }
  const tags = tagsFromInput(); if (tags.length > 30 || tags.some(tag => tag.length > 40)) { error('edit-error', '请最多填写 30 个标签，每个标签不超过 40 个字。'); return; }
  const payload = { ...candidate, name, kind: $('edit-kind').value, scientificName: $('edit-scientific').value.trim(), family: $('edit-family').value.trim(), genus: $('edit-genus').value.trim(), sourceBook: $('edit-book').value.trim(), chapter: $('edit-chapter').value.trim(), page: $('edit-page').value.trim(), notes: $('edit-notes').value, tags, status: $('edit-status').value };
  const editId = editing;
  busy = true; $('save-plant').disabled = true; $('delete-plant').disabled = true; error('edit-error');
  try { const data = await api(editId ? `/api/plants/${encodeURIComponent(editId)}` : '/api/plants', { method: editId ? 'PUT' : 'POST', body: JSON.stringify(payload) }); if (!data.plant) throw new Error('保存结果不完整，请重新连接查看收藏。'); if (editId) plants = plants.map(item => item.id === editId ? data.plant : item); else plants.unshift(data.plant); busy = false; render(); close('edit-dialog'); notify(`「${name}」${editId ? '的阅读记忆已保存' : '已加入你的万物收藏'}`); }
  catch (err) { error('edit-error', err.message); }
  finally { busy = false; $('save-plant').disabled = false; $('delete-plant').disabled = false; }
}
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => close(button.dataset.close));
for (const dialog of document.querySelectorAll('dialog')) { dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); }); dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(dialog.id); } }); }
$('search-dialog').addEventListener('close', () => { lookupVersion++; $('search-loading').hidden = true; });
$('lookup-form').addEventListener('submit', event => { event.preventDefault(); lookup($('plant-query').value); });
$('add-top').addEventListener('click', () => { $('plant-query').focus(); $('plant-query').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }); });
for (const button of document.querySelectorAll('[data-suggest]')) button.addEventListener('click', () => lookup(button.dataset.suggest));
$('manual-create').addEventListener('click', () => keepUnverifiedName());
$('plant-form').addEventListener('submit', save);
$('collection-query').addEventListener('input', event => { query = event.target.value; render(); });
$('clear-search').addEventListener('click', () => { query = ''; filter = statuses[0]; kindFilter = 'all'; $('collection-query').value = ''; render(); });
$('retry-load').addEventListener('click', load);
$('delete-plant').addEventListener('click', () => { $('delete-description').textContent = `确认将「${$('edit-name').value || candidate.name}」移出你的万物收藏？`; error('delete-error'); show('delete-dialog', $('delete-plant')); });
$('confirm-delete').addEventListener('click', async () => { if (busy || !editing) return; const id = editing; busy = true; $('confirm-delete').disabled = true; error('delete-error'); try { await api(`/api/plants/${encodeURIComponent(id)}`, { method: 'DELETE' }); plants = plants.filter(plant => plant.id !== id); busy = false; render(); close('delete-dialog'); close('edit-dialog'); notify('这个物种已移出收藏'); } catch (err) { error('delete-error', err.message); } finally { busy = false; $('confirm-delete').disabled = false; } });
$('import-backup').addEventListener('click', () => $('backup-file').click());
$('backup-file').addEventListener('change', async event => { const file = event.target.files?.[0]; if (!file) return; $('import-backup').disabled = true; try { if (file.size > 20 * 1024 * 1024) throw new Error('备份超过 20 MB，请选择较小的 JSON 文件。'); let data; try { data = JSON.parse(await file.text()); } catch { throw new Error('这个文件不是有效的 JSON 备份。'); } const result = await api('/api/restore', { method: 'POST', body: JSON.stringify(data) }); await load(); notify(`已导入 ${result.imported ?? 0} 个物种，跳过 ${result.skipped ?? 0} 个重复收藏`); } catch (err) { notify(err.message); } finally { $('backup-file').value = ''; $('import-backup').disabled = false; } });
async function starterCards() {
  let starters;
  try { const response = await fetch('/plants-seed.json'); if (!response.ok) throw new Error(); starters = (await response.json()).filter(item => ['银杏','水杉','红豆杉'].includes(item.name)); }
  catch { starters = ['银杏','水杉','红豆杉'].map(name => ({ name, scientificName: '从一个名字，开始认识自然', description: '查找物种资料，留住书页里的相遇。' })); }
  for (const starter of starters) { const card = node('button', 'starter-card'); card.type = 'button'; const picture = photograph(starter); picture.append(node('span', 'starter-caption', 'AN INVITATION TO EXPLORE')); const body = node('div', 'card-body'); const title = node('div', 'card-title-line'); title.append(node('h3', '', starter.name), node('span', '', '↗')); body.append(title, node('p', 'scientific-name', starter.scientificName), node('p', 'starter-description', starter.description)); card.append(picture, body); if (starter.imageAttribution) { const credit = node('div', 'image-credit', starter.imageAttribution); credit.title = starter.imageAttribution; card.append(credit); } card.addEventListener('click', () => lookup(starter.name)); $('starter-grid').append(card); }
}
async function initializeCollectionReading() {
  const continueReading = async () => {
    try {
      const library = await api('/api/library'); const book = library.books?.[0];
      if (!book) { $('reading-bridge-label').textContent = '本机书库尚未配置。'; const link = node('a','','打开阅读工作台 ↗'); link.href = '/index.html'; $('reading-bridge').append(link); return; }
      const progress = await api(`/api/reading-state?bookId=${encodeURIComponent(book.id)}`);
      $('reading-bridge-label').textContent = progress.state ? '接着上一次的自然之旅' : '从书页里，认识万物';
      const link = node('a','',`继续阅读《${book.title}》 ↗`); link.href = readerLink({bookId:book.id,pageId:progress.state?.pageId,chapterId:progress.state?.chapterId}); $('reading-bridge').append(link);
    } catch { $('reading-bridge-label').textContent = '暂时无法读取本机书库，稍后可打开阅读工作台。'; }
  };
  await Promise.all([load(),continueReading()]);
  if (incomingReading.name) {
    if (incomingReading.sourceBook || incomingReading.quote) {
      $('reading-origin').hidden = false;
      $('reading-origin').append(node('strong','',`来自《${incomingReading.sourceBook || '阅读中的书'}》 · ${incomingReading.page || '重排阅读页'}，保存时带入阅读位置`));
      if (incomingReading.quote) $('reading-origin').append(node('blockquote','',incomingReading.quote));
      const clear = node('button','','不携带这段阅读来源'); clear.addEventListener('click',()=>{ incomingReading = {...readingContext(),name:''}; $('reading-origin').hidden = true; history.replaceState(null,'',location.pathname); }); $('reading-origin').append(clear);
    }
    lookup(incomingReading.name);
  }
}
starterCards();
render(); initializeCollectionReading();
