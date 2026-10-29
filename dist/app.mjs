import { CATEGORIES, analyzeBook, makeDemoBook, filterFragments } from './engine.mjs';
import { readBookFile } from './importers.mjs';
import { createBookMotion } from './book-motion.mjs';
import {selectBookGuides} from './book-guides.mjs';
import {createBookGuideView} from './book-guide-view.mjs';
import {captureReadingSelection,readingPageMatches,readingLookupName} from './reader-selection.mjs';
import {createReaderFullscreen} from './reader-fullscreen.mjs';
import {createReaderTypography} from './reader-typography.mjs';
import {createGuideCollector,findCollectedGuide} from './guide-collection.mjs';
import {createSelectionExplorer,selectionExplorerName,sameExplorerSelection} from './selection-explorer.mjs';
import { NATURE_WORDS, natureMatches, collectionLink, readingContext, selectedSpeciesName, contextFromSearch } from './reading-links.mjs';

const $ = id => document.getElementById(id);
const categories = CATEGORIES.filter(item => item.id !== 'all');
const categoryMap = new Map(CATEGORIES.map(item => [item.id, item]));
const number = value => Number(value).toLocaleString('zh-CN');
const state = {
  book: makeDemoBook(), demo: true, pageIndex: 0, selected: null,
  person: 'all', category: 'all', chapter: 'all', query: '', visibleLimit: 80, closed: false,
};
let uploadVersion = 0;
let toastTimer;
let disposeTurn = () => {};
let loading = false;
let lastDialogTrigger;
let libraryBookId = '', restoringReading = false, returnQuote = '', encounterQuote = '', progressTimer;
let natureNames = [...NATURE_WORDS], collectedSpecies = [], natureIndex = [], natureIndexedBook;
let guideSeeds = [], bookGuideView;
let guidePage, guideCollection, guideSeedRef, guideNamesRef, guideMatchRef, currentGuides = [];
const pageReadingMatches = new WeakMap();
const readingMatchFailures = new WeakSet();
const noReadingMatches = [];
let pendingMatchPage, matchController, selectedReading, selectedReadingPage;
let selectionExplorer, selectionExplorerTimer;
const guideCollector = createGuideCollector({
  getCollection:()=>collectedSpecies,
  onCollection:next=>{
    collectedSpecies = next;
    natureNames = [...new Set([...natureNames,...next.map(item=>item.name)])]; natureIndexedBook = null;
    bookGuideView?.updateCollected(guide=>Boolean(findCollectedGuide(next,guide)));
    renderNature(); renderBookInfo();
  },
  request:async(path,options)=>{
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),20000);
    try { return await fetch(path,{...options,signal:controller.signal}); } finally { clearTimeout(timer); }
  },
});
let trailCache;
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const pageMotion = createBookMotion({
  getLimit:()=>state.book.pages.length,
  reduced:()=>motionPreference.matches || typeof $('turning-leaf').animate !== 'function',
  animate:animatePageTurn,
  onCommit:index=>{ state.pageIndex = index; renderBook(); disposeTurn(); bookGuideView?.suspend(false); },
  onTarget:updatePageButtons,
});
motionPreference.addEventListener('change',()=>{ if (motionPreference.matches) pageMotion.settle(); });

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(use);
  return svg;
}

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.add('is-visible');
  toastTimer = setTimeout(() => $('toast').classList.remove('is-visible'), 3500);
}

function openDialog(id, trigger) {
  lastDialogTrigger = trigger;
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
}

function closeDialog(id) {
  $(id).close();
  if (lastDialogTrigger?.isConnected) lastDialogTrigger.focus();
}

function currentPage() {
  return state.book.pages[state.pageIndex];
}

function chapterById(id) {
  return state.book.chapters.find(chapter => chapter.id === id);
}

function clearFilters() {
  state.person = 'all';
  state.category = 'all';
  state.chapter = 'all';
  state.query = '';
  state.visibleLimit = 80;
  $('search-input').value = '';
  renderExplorer();
  renderTimeline();
  renderFloating();
}

function setBook(book, demo = false, bookId = '') {
  clearSelectionExplorer();
  const wasClosed = state.closed;
  pageMotion.reset(0);
  disposeTurn();
  bookGuideView?.reset();
  libraryBookId = bookId;
  returnQuote = '';
  state.book = book;
  state.demo = demo;
  state.pageIndex = 0;
  state.selected = null;
  state.closed = false;
  $('book-stage').classList.remove('is-closed');
  $('toggle-book').querySelector('span').textContent = '收起书本';
  $('toggle-book').setAttribute('aria-expanded', 'true');
  document.querySelector('.book-spread').setAttribute('aria-hidden', 'false');
  document.querySelector('.book-spread').inert = false;
  for (const leaf of document.querySelectorAll('.leaf-copy')) leaf.tabIndex = 0;
  clearFilters();
  renderBookInfo();
  renderBook();
  populateChapterSelect();
  if (wasClosed) {
    const panel = $('reader-panel');
    bookGuideView?.bookTransition({animated:!panel.classList.contains('reader-fullscreen') && !panel.classList.contains('reader-layout-switch')});
  }
}

function renderBookInfo() {
  const book = state.book;
  $('book-title').textContent = book.title;
  $('cover-title').textContent = book.title;
  $('cover-title').parentElement.classList.toggle('is-long-title',Array.from(book.title).length > 8);
  $('demo-badge').hidden = !state.demo;
  $('book-meta').textContent = `${state.demo ? '书间原创短篇' : '我的私人藏书'} · ${number(book.totalChars)} 字 · ${state.demo ? '一封信，三个人，一座海边小城' : '本地解析，安心探索'}`;
  $('stat-chapters').textContent = number(book.chapters.length);
  $('stat-people').textContent = number(libraryBookId ? new Set(natureIndex.flatMap(entry=>entry.matches.map(item=>item.name))).size : book.people.length);
  $('stat-people').nextElementSibling.textContent = libraryBookId ? '种线索' : '位人物';
  $('stat-fragments').textContent = number(book.fragments.length);
  document.title = `${book.title} — 书间 FOLIO`;
}

function setHighlightedText(node, text, selectedText) {
  node.replaceChildren();
  const start = selectedText ? text.indexOf(selectedText) : -1;
  if (start < 0) {
    node.textContent = text;
  } else {
    node.append(document.createTextNode(text.slice(0, start)));
    node.append(element('mark', '', selectedText));
    node.append(document.createTextNode(text.slice(start + selectedText.length)));
  }
  node.scrollTop = 0;
  requestAnimationFrame(() => {
    const mark = node.querySelector('mark');
    if (mark) node.scrollTop = Math.max(0, mark.offsetTop - 40);
  });
}

function pageParts(index) {
  const page = state.book.pages[index];
  const text = page.text;
  let midpoint = Math.ceil(text.length / 2);
  const nearbyBreak = text.indexOf('\n', Math.max(0, midpoint - 50));
  if (nearbyBreak >= 0 && nearbyBreak < midpoint + 70) midpoint = nearbyBreak + 1;
  const selectedText = state.selected?.pageId === page.id ? state.selected.text : (returnQuote && text.includes(returnQuote) ? returnQuote : '');
  const selectedStart = selectedText ? text.indexOf(selectedText) : -1;
  if (selectedStart >= 0 && selectedStart < midpoint && selectedStart + selectedText.length > midpoint) {
    midpoint = selectedStart + selectedText.length;
  }
  for (const guide of guidesForPage(index)) {
    for (const range of guide.ranges ?? [{start:guide.offset,end:guide.offset+guide.length}]) if (range.start < midpoint && range.end > midpoint) midpoint = range.end;
  }
  return {left:text.slice(0,midpoint),right:text.slice(midpoint),selectedText};
}

function guidesForPage(index) {
  const page = state.book.pages[index];
  const matches = pageReadingMatches.get(page) || noReadingMatches;
  if (guidePage !== page || guideCollection !== collectedSpecies || guideSeedRef !== guideSeeds || guideNamesRef !== natureNames || guideMatchRef !== matches) {
    currentGuides = selectBookGuides(page.text,collectedSpecies,[...guideSeeds,...matches.flatMap(item=>item.records)],{limit:2,names:[...natureNames,...matches.map(item=>item.name)]}).map(guide=>{
      const lookupName = readingLookupName(guide.name,matches);
      const value = lookupName === guide.name ? guide : {...guide,lookupName,matchNote:`原文「${guide.name}」可能指「${lookupName}」，需核对`};
      return {...value,collected:Boolean(findCollectedGuide(collectedSpecies,value))};
    });
    guidePage = page; guideCollection = collectedSpecies; guideSeedRef = guideSeeds; guideNamesRef = natureNames;
    guideMatchRef = matches;
  }
  return currentGuides;
}

function renderBook() {
  const page = currentPage();
  if (!page) return;
  if (selectedReadingPage !== page) { clearSelectionExplorer(); selectedReading = null; selectedReadingPage = page; updateSelectionActions(); }
  const chapter = chapterById(page.chapterId);
  const text = page.text;
  const {left,right,selectedText} = pageParts(state.pageIndex);
  setHighlightedText($('page-left'), left, selectedText);
  setHighlightedText($('page-right'), right, selectedText);
  bookGuideView?.render({guides:guidesForPage(state.pageIndex),parts:[{text:left,selectedText,offset:0},{text:right,selectedText,offset:left.length}],key:page,autoLocate:!selectedText && !window.getSelection()?.toString()});
  $('source-title').textContent = chapter?.title ?? '阅读原文';
  $('source-meta').textContent = `${state.book.title} · 重排第 ${number(state.pageIndex + 1)} / ${number(state.book.pages.length)} 页`;
  if ($('source-dialog').open) setHighlightedText($('source-copy'), text, selectedText);
  $('page-running-title').textContent = state.book.title;
  $('page-chapter-title').textContent = chapter?.title ?? '';
  $('reading-chapter').textContent = chapter?.title ?? '正在阅读';
  $('reading-chapter').title = chapter?.title ?? '';
  $('folio-left').textContent = state.pageIndex * 2 + 1;
  $('folio-right').textContent = state.pageIndex * 2 + 2;
  $('page-number').textContent = number(state.pageIndex + 1);
  $('page-total').textContent = number(state.book.pages.length);
  updatePageButtons();
  renderNature();
  requestReadingMatches(page);
  persistReading();
  for (const card of $('fragment-list').querySelectorAll('.fragment-card')) {
    const selected = card.dataset.fragmentId === state.selected?.id;
    card.classList.toggle('is-selected', selected);
    card.setAttribute('aria-pressed', String(selected));
  }
  for (const stop of $('chapter-timeline').children) {
    stop.classList.toggle('is-current', stop.dataset.chapterIds?.split('|').includes(page.chapterId));
  }
}

function goToPage(index, animate = true) {
  clearSelectionExplorer();
  const wasClosed = state.closed;
  if (wasClosed) toggleBook();
  pageMotion.request(index,{animate:animate && !wasClosed});
}

function updatePageButtons() {
  $('prev-page').disabled = pageMotion.target === 0;
  $('next-page').disabled = pageMotion.target >= state.book.pages.length - 1;
}

function animatePageTurn(from,to) {
  bookGuideView?.suspend(true);
  const forward = to > from;
  const sheet = $('turning-leaf'), underlay = $('turn-underlay'), shade = $('turn-shadow');
  const oldSide = forward ? 'right' : 'left', newSide = forward ? 'left' : 'right';
  const original = $(`page-${oldSide}`).parentElement;
  const oldScroll = original.querySelector('.leaf-copy').scrollTop;
  const cloneLeaf = (side,index,current = false) => {
    const source = $(`page-${side}`).parentElement;
    const leaf = source.cloneNode(true);
    for (const child of [leaf,...leaf.querySelectorAll('[id]')]) child.removeAttribute('id');
    for (const child of leaf.querySelectorAll('[tabindex]')) child.removeAttribute('tabindex');
    leaf.classList.add('turn-page');
    if (!current) {
      const parts = pageParts(index);
      const page = state.book.pages[index];
      const heading = side === 'left' ? state.book.title : chapterById(page.chapterId)?.title ?? '';
      leaf.querySelector('.page-running-title').textContent = heading;
      setHighlightedText(leaf.querySelector('.leaf-copy'),parts[side],parts.selectedText);
      leaf.querySelector('.page-folio').textContent = index*2 + (side === 'left' ? 1 : 2);
    }
    return leaf;
  };
  const front = element('div','turn-face turn-front'), back = element('div','turn-face turn-back');
  const snapshot = cloneLeaf(oldSide,from,true);
  front.append(snapshot); back.append(cloneLeaf(newSide,to));
  sheet.replaceChildren(front,back);
  underlay.replaceChildren(cloneLeaf(oldSide,to));
  sheet.className = `turning-leaf ${forward ? 'turn-forward' : 'turn-backward'}`;
  underlay.className = `turn-underlay ${forward ? 'underlay-right' : 'underlay-left'}`;
  sheet.hidden = underlay.hidden = shade.hidden = false;
  snapshot.querySelector('.leaf-copy').scrollTop = oldScroll;
  $('physical-book').classList.add('is-turning');
  const sign = forward ? -1 : 1;
  const animation = sheet.animate([
    {transform:`translateZ(1px) rotateY(${sign*5}deg)`},
    {transform:`translateZ(14px) rotateY(${sign*88}deg)`,offset:.49},
    {transform:`translateZ(1px) rotateY(${sign*175}deg)`},
  ],{duration:430,easing:'cubic-bezier(.3,.08,.24,1)',fill:'both'});
  const shadow = shade.animate([{opacity:0},{opacity:.2,offset:.45},{opacity:0}],{duration:430,easing:'ease-in-out',fill:'both'});
  let disposed = false;
  const cleanup = () => {
    if (disposed) return; disposed = true;
    sheet.hidden = underlay.hidden = shade.hidden = true;
    animation.cancel(); shadow.cancel();
    sheet.replaceChildren(); underlay.replaceChildren();
    $('physical-book').classList.remove('is-turning');
    bookGuideView?.schedule();
  };
  disposeTurn = cleanup;
  return {finished:Promise.all([animation.finished,shadow.finished]),cancel:cleanup};
}

function selectFragment(fragment) {
  selectedReading = null; updateSelectionActions();
  state.selected = fragment;
  const index = state.book.pages.findIndex(page => page.id === fragment.pageId);
  if (index >= 0) goToPage(index);
  if (matchMedia('(max-width: 800px)').matches) $('reader-heading').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}

function toggleBook() {
  if (!state.closed && pageMotion.busy) pageMotion.settle();
  state.closed = !state.closed;
  $('book-stage').classList.toggle('is-closed', state.closed);
  $('toggle-book').querySelector('span').textContent = state.closed ? '展开书本' : '收起书本';
  $('toggle-book').setAttribute('aria-expanded', String(!state.closed));
  document.querySelector('.book-spread').setAttribute('aria-hidden', String(state.closed));
  document.querySelector('.book-spread').inert = state.closed;
  for (const leaf of document.querySelectorAll('.leaf-copy')) leaf.tabIndex = state.closed ? -1 : 0;
  for (const button of $('floating-fragments').querySelectorAll('button')) button.disabled = state.closed;
  const panel = $('reader-panel');
  bookGuideView?.bookTransition({animated:!panel.classList.contains('reader-fullscreen') && !panel.classList.contains('reader-layout-switch')});
}

function renderPeople() {
  const container = $('people-filters');
  container.replaceChildren();
  const natureMode = Boolean(libraryBookId);
  $('people-caption').textContent = natureMode ? '跟随自然线索' : '跟随人物';
  container.setAttribute('aria-label',natureMode ? '按自然词语筛选' : '按人物筛选');
  $('analysis-caption').textContent = natureMode ? '本地词语匹配 · 物种需核对' : '本地规则分析 · 可调整人物';
  $('analysis-help').title = natureMode ? '按本书实际出现的名称查找文字线索，不代表自动确认物种身份。' : '按词语和人物名称匹配提取，可能存在遗漏，可调整人物名称。';
  $('manage-people').hidden = natureMode;
  const counts = new Map();
  if (natureMode) {
    if (natureIndexedBook !== state.book) renderNature();
    for (const entry of natureIndex) for (const match of entry.matches) counts.set(match.name,(counts.get(match.name) || 0) + match.count);
  }
  const people = [{ name: 'all', label: natureMode ? '全部线索' : '全部人物', count: state.book.fragments.length }, ...(natureMode ? [...counts].sort((a,b)=>b[1]-a[1]).slice(0,30).map(([name,count])=>({name,label:name,count})) : state.book.people.map(person => ({ ...person, label: person.name })))];
  for (const person of people) {
    const active = natureMode ? (person.name === 'all' ? !state.query : state.query === person.name) : state.person === person.name;
    const button = element('button', `person-chip${active ? ' is-active' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(active));
    button.append(document.createTextNode(person.label), element('small', '', number(person.count)));
    button.addEventListener('click', () => {
      state.person = natureMode ? 'all' : person.name;
      if (natureMode) { state.query = person.name === 'all' ? '' : person.name; $('search-input').value = state.query; }
      state.visibleLimit = 80;
      renderExplorer();
      renderFloating();
      renderTimeline();
    });
    container.append(button);
  }
}

function renderCategories() {
  const container = $('category-filters');
  container.replaceChildren();
  const entries = [{ id: 'all', label: '全部', color: '#899779' }, ...categories];
  for (const category of entries) {
    const button = element('button', `category-chip${state.category === category.id ? ' is-active' : ''}`);
    button.type = 'button';
    button.style.setProperty('--category-color', category.color ?? '#899779');
    button.setAttribute('aria-pressed', String(state.category === category.id));
    button.append(element('i'), document.createTextNode(category.label));
    button.addEventListener('click', () => {
      state.category = category.id;
      state.visibleLimit = 80;
      renderExplorer();
      renderFloating();
      renderTimeline();
    });
    container.append(button);
  }
  $('selection-label').textContent = state.category === 'all' ? '全部细节' : `${categoryMap.get(state.category)?.label ?? '文字'}细节`;
}

function renderFragments() {
  const results = filterFragments(state.book, state);
  const container = $('fragment-list');
  container.replaceChildren();
  $('result-count').textContent = number(results.length);
  const hasFilters = state.person !== 'all' || state.category !== 'all' || state.chapter !== 'all' || Boolean(state.query.trim());
  $('clear-filters').hidden = !hasFilters;
  $('results-category').hidden = hasFilters;
  $('visible-count').textContent = results.length > state.visibleLimit ? `已显示 ${number(state.visibleLimit)} / ${number(results.length)} 段` : '';
  if (!results.length) {
    const empty = element('div', 'empty-state');
    empty.append(icon('search'), element('strong', '', '故事暂时藏起了这个细节'), element('p', '', '换一个词或人物再找找，也可以清除筛选，重新翻开故事。'));
    const reset = element('button', '', '重新探索全部文字');
    reset.addEventListener('click', clearFilters);
    empty.append(reset);
    container.append(empty);
    return;
  }
  const chapters = new Map(state.book.chapters.map(chapter => [chapter.id, chapter]));
  for (const [index, fragment] of results.slice(0, state.visibleLimit).entries()) {
    const displayCategory = state.category !== 'all' && (fragment.categories ?? [fragment.category]).includes(state.category) ? state.category : fragment.category;
    const category = categoryMap.get(displayCategory) ?? { label: '摘录', color: '#949a83' };
    const card = element('button', `fragment-card${state.selected?.id === fragment.id ? ' is-selected' : ''}`);
    card.type = 'button';
    card.dataset.fragmentId = fragment.id;
    card.style.setProperty('--category-color', category.color ?? '#949a83');
    card.style.animationDelay = `${Math.min(index, 7) * 28}ms`;
    card.setAttribute('aria-pressed', String(state.selected?.id === fragment.id));
    card.title = `${fragment.text}\n点击回到原文`;
    const label = element('span', 'card-category');
    label.append(element('i'), document.createTextNode(category.label));
    const quote = element('blockquote', '', fragment.text);
    const footer = element('span', 'card-footer');
    const fragmentNames = libraryBookId ? natureMatches(fragment.text,natureNames).map(item=>item.name) : fragment.people;
    if (fragmentNames.length) footer.append(element('span', 'card-person', fragmentNames.join(' · ')), document.createTextNode(' / '));
    const chapter = chapters.get(fragment.chapterId);
    const source = element('span', 'card-chapter', chapter?.title ?? '原文');
    footer.append(source, icon('arrow'));
    card.append(label, quote, footer);
    card.addEventListener('click', () => selectFragment(fragment));
    container.append(card);
  }
  if (results.length > state.visibleLimit) {
    const more = element('button', 'load-more', `再展开 80 段 · 共 ${number(results.length)} 段`);
    more.addEventListener('click', () => {
      const scroll = container.scrollTop;
      state.visibleLimit += 80;
      renderFragments();
      container.scrollTop = scroll;
    });
    container.append(more);
  }
}

function renderExplorer() {
  renderPeople();
  renderCategories();
  renderFragments();
}

function renderFloating() {
  const fragments = filterFragments(state.book, state);
  const picks = [];
  for (const category of ['appearance', 'voice', 'setting', 'clothing']) {
    const candidate = fragments.find(fragment => (fragment.categories ?? [fragment.category]).includes(category) && !picks.includes(fragment));
    if (candidate) picks.push(candidate);
  }
  for (const fragment of fragments) {
    if (picks.length >= 4) break;
    if (!picks.includes(fragment)) picks.push(fragment);
  }
  $('floating-fragments').replaceChildren();
  for (const fragment of picks) {
    const button = element('button', 'flying-paper');
    button.type = 'button';
    button.disabled = state.closed;
    const displayCategory = state.category !== 'all' && (fragment.categories ?? [fragment.category]).includes(state.category) ? state.category : fragment.category;
    const category = categoryMap.get(displayCategory)?.label ?? '摘录';
    const subject = libraryBookId ? natureMatches(fragment.text,natureNames)[0]?.name ?? '自然' : fragment.people[0] ?? '故事';
    button.append(element('span', '', `${subject} / ${category}`), document.createTextNode(fragment.text.length > 32 ? `${fragment.text.slice(0, 32)}…` : fragment.text));
    button.title = `回到原文：${fragment.text}`;
    button.addEventListener('click', () => selectFragment(fragment));
    $('floating-fragments').append(button);
  }
}

function populateChapterSelect() {
  const select = $('chapter-select');
  select.replaceChildren(element('option', '', '全部章节'));
  select.firstChild.value = 'all';
  for (const chapter of state.book.chapters) {
    const option = element('option', '', chapter.title);
    option.value = chapter.id;
    select.append(option);
  }
  select.value = state.chapter;
}

function chooseChapter(id) {
  state.chapter = id;
  state.visibleLimit = 80;
  state.selected = null;
  if (id !== 'all') {
    const pageIndex = state.book.pages.findIndex(page => page.chapterId === id);
    if (pageIndex >= 0) goToPage(pageIndex);
  }
  renderExplorer();
  renderFloating();
  renderTimeline();
}

function renderTimeline() {
  const container = $('chapter-timeline');
  container.replaceChildren();
  const counts = new Map(state.book.chapters.map(chapter => [chapter.id, new Map()]));
  const chapterTotals = new Map();
  const fragments = filterFragments(state.book, { person: state.person, category: state.category, query: state.query });
  for (const fragment of fragments) {
    const group = counts.get(fragment.chapterId);
    if (group) {
      chapterTotals.set(fragment.chapterId, (chapterTotals.get(fragment.chapterId) ?? 0) + 1);
      for (const category of fragment.categories ?? [fragment.category]) group.set(category, (group.get(category) ?? 0) + 1);
    }
  }
  const max = Math.max(1, ...Array.from(counts.values()).flatMap(group => Array.from(group.values())));
  const step = Math.max(1, Math.ceil(state.book.chapters.length / 60));
  for (let start = 0; start < state.book.chapters.length; start += step) {
    const group = state.book.chapters.slice(start, start + step);
    const chapter = group[0];
    const label = group.length > 1 ? `${start + 1}–${start + group.length} 章` : chapter.title;
    const button = element('button', 'chapter-stop');
    button.type = 'button';
    button.dataset.chapterIds = group.map(item => item.id).join('|');
    button.classList.toggle('is-current', group.some(item => item.id === currentPage()?.chapterId));
    button.classList.toggle('is-active', group.some(item => item.id === state.chapter));
    button.setAttribute('aria-label', `${label}，点击阅读${group.length > 1 ? '本组第一章；其他章节可使用章节选择器' : ''}`);
    button.setAttribute('aria-pressed', String(group.some(item => item.id === state.chapter)));
    const bars = element('span', 'chapter-bars');
    const total = group.reduce((sum, item) => sum + (chapterTotals.get(item.id) ?? 0), 0);
    for (const category of categories) {
      const count = group.reduce((sum, item) => sum + (counts.get(item.id)?.get(category.id) ?? 0), 0);
      const bar = element('i');
      bar.style.height = `${count ? 5 + Math.min(36, count / (max * group.length) * 36) : 2}px`;
      bar.style.setProperty('--bar-color', category.color ?? '#9aab88');
      bars.append(bar);
    }
    button.title = `${label} · ${number(total)} 段匹配文字${group.length > 1 ? '（点击第一章，使用下拉框选择其他章节）' : ''}`;
    button.append(bars, element('span', 'chapter-line-dot'), element('span', 'chapter-name', label));
    button.addEventListener('click', () => chooseChapter(chapter.id));
    container.append(button);
  }
  $('chapter-select').value = state.chapter;
  $('reset-chapter').hidden = state.chapter === 'all';
  renderNature();
}

function pageContext(quote = '') {
  const page = currentPage();
  return readingContext({bookId:libraryBookId,pageId:page?.id,chapterId:page?.chapterId,sourceBook:state.book.title,chapter:chapterById(page?.chapterId)?.title,page:`重排第 ${state.pageIndex + 1} 页`,quote});
}

function persistReading() {
  clearTimeout(progressTimer);
  if (!libraryBookId || restoringReading) return;
  const payload = pageContext();
  progressTimer = setTimeout(async () => {
    try {
      const response = await fetch('/api/reading-state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId:payload.bookId,pageId:payload.pageId,chapterId:payload.chapterId})});
      if (!response.ok) throw new Error();
    } catch { toast('阅读位置暂未保存，请确认本机服务仍在运行。'); }
  },350);
}

function renderNature() {
  if (!currentPage()) return;
  if (natureIndexedBook !== state.book) {
    natureIndex = state.book.pages.map((page,index)=>({page,index,matches:natureMatches(page.text,natureNames)}));
    natureIndexedBook = state.book;
  }
  const matches = [...new Map([...(natureIndex[state.pageIndex]?.matches ?? []),...(pageReadingMatches.get(currentPage()) || [])].map(item=>[item.name,item])).values()].sort((a,b)=>a.offset-b.offset);
  $('nature-hint').textContent = matches.length ? `${matches.length} 个词语线索，需确认 · 点击携带这一页的原文去查找` : '这一页暂未找到词语线索。可以选取原文，记录一次自己的发现。';
  $('nature-clues').replaceChildren();
  for (const match of matches.slice(0,16)) {
    const lookupName = readingLookupName(match.name,pageReadingMatches.get(currentPage()) || []);
    const button = element('button','',`${match.name}${lookupName !== match.name ? ` → ${lookupName}（需核对）` : ''} · ${match.count}`);
    button.title = '原文中出现的名称线索，尚未确认物种身份';
    button.addEventListener('click',()=>{ location.href = collectionLink(lookupName,pageContext(match.quote)); });
    $('nature-clues').append(button);
  }
  if (trailCache?.index === natureIndex && trailCache?.collection === collectedSpecies && trailCache?.chapter === state.chapter) return;
  trailCache = {index:natureIndex,collection:collectedSpecies,chapter:state.chapter};
  const names = new Set(collectedSpecies.map(item=>item.name));
  const trail = [];
  for (const entry of natureIndex) {
    if (state.chapter !== 'all' && entry.page.chapterId !== state.chapter) continue;
    for (const match of entry.matches) if (names.has(match.name)) trail.push({...match,page:entry.page,index:entry.index});
  }
  $('trail-count').textContent = trail.reduce((sum,item)=>sum+item.count,0);
  $('nature-trail-list').replaceChildren();
  $('nature-trail-list').append(element('p','','已收藏物种名称在本书中的字面匹配 · 词语线索，需确认。'));
  if (!trail.length) $('nature-trail-list').append(element('p','','暂未匹配到已收藏的物种名称。可以先从这一页记录一次自然遇见。'));
  for (const item of trail.slice(0,80)) {
    const button = element('button','',`${item.name} · 重排第 ${item.index+1} 页 · ${item.count} 次`);
    button.addEventListener('click',()=>{ state.selected = null; returnQuote = item.quote; goToPage(item.index); });
    $('nature-trail-list').append(button);
  }
  if (trail.length > 80) $('nature-trail-list').append(element('p','',`共 ${trail.length} 处匹配位置，先显示前 80 处；可在章节时间轴中缩小范围。`));
}

function readCurrentSelection() {
  const selection = window.getSelection();
  const element = value => value?.nodeType === 1 ? value : value?.parentElement;
  const inside = Boolean(element(selection?.anchorNode)?.closest('#source-copy,#page-left,#page-right') && element(selection?.focusNode)?.closest('#source-copy,#page-left,#page-right'));
  const captured=captureReadingSelection(currentPage(),selection?.toString(),inside);
  return captured?{...captured,anchorNode:selection.anchorNode,anchorOffset:selection.anchorOffset,focusNode:selection.focusNode,focusOffset:selection.focusOffset}:null;
}

function updateSelectionActions() {
  const value = selectedReadingPage === currentPage() ? selectedReading : null;
  const name = selectionExplorerName(value?.quote) || value?.name || '';
  const lookupName = name ? readingLookupName(name,pageReadingMatches.get(currentPage()) || noReadingMatches) : '';
  for (const prefix of ['reader','source']) {
    $(`${prefix}-selection-actions`).hidden = !value;
    $(`${prefix}-selection-label`).textContent = value ? name ? `已选原文「${name}」${lookupName !== name ? `；可能指「${lookupName}」，请核对` : ''}` : '已选一段原文，请先确认其中的物种名称。' : '';
    $(`${prefix}-selection-lookup`).textContent = name ? `原地探索「${lookupName}」` : '填写物种名称';
  }
}

function clearSelectionExplorer(){clearTimeout(selectionExplorerTimer);selectionExplorer?.invalidate();}

function refreshReadingGuides() {
  const page = currentPage();
  if (!page || pageMotion.busy || readCurrentSelection()) return;
  const {left,right,selectedText} = pageParts(state.pageIndex);
  bookGuideView?.render({guides:guidesForPage(state.pageIndex),parts:[{text:left,selectedText,offset:0},{text:right,selectedText,offset:left.length}],key:page,autoLocate:false});
}

async function requestReadingMatches(page) {
  if (pageReadingMatches.has(page)) {
    $('reader-match-state').textContent = readingMatchFailures.has(page) ? '本地扩展线索暂不可用，仍可选中文字直接查找。' : `本页名称线索仅在本机匹配 · ${pageReadingMatches.get(page).length} 个词语线索，身份需核对`;
    return;
  }
  if (pendingMatchPage === page) return;
  matchController?.abort();
  const controller = new AbortController(); matchController = controller; pendingMatchPage = page;
  $('reader-match-state').textContent = '正在本地查找本页名称线索…';
  const timer = setTimeout(()=>controller.abort(),5000);
  try {
    const response = await fetch('/api/reading-matches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:page.text.slice(0,10000)}),signal:controller.signal});
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (currentPage() !== page || matchController !== controller) return;
    const matches = readingPageMatches(page.text,data.matches); pageReadingMatches.set(page,matches);
    $('reader-match-state').textContent = `本页名称线索仅在本机匹配 · ${matches.length} 个词语线索，身份需核对`;
    renderNature(); updateSelectionActions(); refreshReadingGuides();
  } catch {
    if (currentPage() === page && matchController === controller) {
      pageReadingMatches.set(page,[]);
      readingMatchFailures.add(page);
      $('reader-match-state').textContent = '本地扩展线索暂不可用，仍可选中文字直接查找。';
    }
  } finally { clearTimeout(timer); if (matchController === controller) pendingMatchPage = null; }
}

function captureEncounter() {
  const direct = readCurrentSelection();
  if (direct) { selectedReading = direct; selectedReadingPage = currentPage(); }
  const selected = selectedReadingPage === currentPage() ? selectedReading : null;
  encounterQuote = (selected?.quote || (state.selected?.pageId === currentPage()?.id ? state.selected.text : currentPage()?.text ?? '')).slice(0,1000);
  if ($('source-dialog').open) closeDialog('source-dialog');
  $('encounter-name').value = selected ? selected.name : selectedSpeciesName(state.selected?.text ?? '');
  $('encounter-quote').textContent = encounterQuote;
  openDialog('encounter-dialog',$('capture-encounter'));
  $('encounter-name').focus();
}

async function initializeLibrary() {
  const uploadAtStart = uploadVersion;
  const requestContext = contextFromSearch(location.search);
  try {
    const [libraryResponse,collectionResponse,seedsResponse] = await Promise.all([fetch('/api/library'),fetch('/api/plants'),fetch('/plants-seed.json')]);
    if (collectionResponse.ok) { const data = await collectionResponse.json(); collectedSpecies = Array.isArray(data.plants) ? data.plants : []; }
    const seeds = seedsResponse.ok ? await seedsResponse.json() : [];
    guideSeeds = Array.isArray(seeds) ? seeds : [];
    natureNames = [...new Set([...NATURE_WORDS,...collectedSpecies.map(item=>item.name),...(Array.isArray(seeds) ? seeds.map(item=>item.name) : [])])];
    natureIndexedBook = null;
    renderNature();
    renderBook();
    if (!libraryResponse.ok) return;
    const library = await libraryResponse.json();
    const books = Array.isArray(library.books) ? library.books : [];
    const book = requestContext.bookId ? books.find(item=>item.id === requestContext.bookId) : books[0];
    if (!book) { if (requestContext.bookId) toast('这本书暂未配置在本机，已打开示例。'); return; }
    if (!/^[a-f0-9]{40}$/i.test(book.id) || book.url !== `/api/library/${book.id}/file`) throw new Error('本机书库地址格式不正确。');
    $('library-notice').hidden = false; $('library-notice').textContent = `正在翻开本机书库《${book.title}》…`;
    const [fileResponse,progressResponse] = await Promise.all([fetch(book.url),fetch(`/api/reading-state?bookId=${encodeURIComponent(book.id)}`)]);
    if (!fileResponse.ok) throw new Error('本机书籍暂时无法读取，请检查书库配置。');
    const bytes = await fileResponse.arrayBuffer();
    const parsed = await readBookFile(new File([bytes],`${book.title}.epub`,{type:'application/epub+zip'}),message=>{ $('library-notice').textContent = message; });
    if (uploadAtStart !== uploadVersion) { $('library-notice').hidden = true; return; }
    const progress = progressResponse.ok ? (await progressResponse.json()).state : null;
    restoringReading = true;
    setBook(analyzeBook(parsed,[]),false,book.id);
    const targetId = requestContext.pageId || progress?.pageId;
    let index = state.book.pages.findIndex(page=>page.id === targetId);
    if (!targetId) index = state.book.pages.findIndex(page=>/^1月1日|^一月一日/.test(chapterById(page.chapterId)?.title || ''));
    returnQuote = requestContext.quote;
    if (index >= 0) goToPage(index,false); else renderBook();
    restoringReading = false; persistReading();
    $('library-notice').textContent = `本机书库 · ${state.book.title} · 自动保存重排阅读位置`;
  } catch (error) {
    restoringReading = false;
    $('library-notice').hidden = false; $('library-notice').textContent = `${error.message || '本机书库暂不可用。'} 可继续使用上传书籍或示例。`;
  }
}

async function importBook(file) {
  if (!file) return;
  const version = ++uploadVersion;
  loading = false;
  $('upload-progress').hidden = true;
  $('drop-zone').classList.remove('is-loading');
  $('upload-error').hidden = true;
  if (file.size > 25 * 1024 * 1024) {
    $('upload-error').textContent = '这本书超过了 25 MB，请选择较小的文件。';
    $('upload-error').hidden = false;
    $('book-file').value = '';
    return;
  }
  if (!/\.(txt|epub|pdf)$/i.test(file.name)) {
    $('upload-error').textContent = '目前支持 TXT、EPUB 和文字版 PDF，请换一本试试。';
    $('upload-error').hidden = false;
    $('book-file').value = '';
    return;
  }
  loading = true;
  $('upload-progress').hidden = false;
  $('upload-progress-label').textContent = `正在翻开《${file.name}》…`;
  $('drop-zone').classList.add('is-loading');
  try {
    const data = await readBookFile(file, progress => {
      if (version !== uploadVersion) return;
      $('upload-progress-label').textContent = typeof progress === 'string' ? progress : '正在整理书中的文字…';
    });
    if (version !== uploadVersion) return;
    $('upload-progress-label').textContent = '正在整理人物与细节…';
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    if (version !== uploadVersion) return;
    const book = analyzeBook(data, []);
    if (version !== uploadVersion) return;
    setBook(book);
    loading = false;
    closeDialog('upload-dialog');
    toast(`《${book.title}》已打开，发现 ${number(book.fragments.length)} 段文字`);
  } catch (error) {
    if (version !== uploadVersion) return;
    $('upload-error').textContent = error instanceof Error ? error.message : '这本书暂时打不开，请换一个文件试试。';
    $('upload-error').hidden = false;
  } finally {
    if (version === uploadVersion) {
      loading = false;
      $('upload-progress').hidden = true;
      $('drop-zone').classList.remove('is-loading');
      $('book-file').value = '';
    }
  }
}

for (const trigger of document.querySelectorAll('.upload-trigger')) trigger.addEventListener('click', () => {
  $('upload-error').hidden = true;
  openDialog('upload-dialog', trigger);
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog(button.dataset.close));
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog.id);
    }
  });
}
$('upload-dialog').addEventListener('close', () => {
  if (loading) {
    uploadVersion++;
    loading = false;
    $('upload-progress').hidden = true;
    $('drop-zone').classList.remove('is-loading');
    $('book-file').value = '';
  }
});
$('book-file').addEventListener('change', event => importBook(event.target.files?.[0]));
for (const name of ['dragenter', 'dragover']) $('drop-zone').addEventListener(name, event => {
  event.preventDefault();
  $('drop-zone').classList.add('drag-over');
});
for (const name of ['dragleave', 'drop']) $('drop-zone').addEventListener(name, event => {
  event.preventDefault();
  $('drop-zone').classList.remove('drag-over');
});
$('drop-zone').addEventListener('drop', event => importBook(event.dataTransfer?.files?.[0]));
document.addEventListener('dragover', event => {
  if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault();
});
document.addEventListener('drop', event => {
  if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
  event.preventDefault();
  if (!$('upload-dialog').open && !$('people-dialog').open) openDialog('upload-dialog', document.querySelector('.upload-trigger'));
  if (event.target.closest('#drop-zone')) return;
  if ($('upload-dialog').open) importBook(event.dataTransfer?.files?.[0]);
});
$('sample-button').addEventListener('click', () => {
  uploadVersion++;
  setBook(makeDemoBook(), true);
  toast('已翻开书间原创短篇《海边来信》');
});
$('prev-page').addEventListener('click', () => { state.selected = null; returnQuote = ''; goToPage(pageMotion.target - 1); });
$('next-page').addEventListener('click', () => { state.selected = null; returnQuote = ''; goToPage(pageMotion.target + 1); });
$('toggle-book').addEventListener('click', toggleBook);
$('capture-encounter').addEventListener('click',captureEncounter);
$('capture-source').addEventListener('click',captureEncounter);
document.addEventListener('selectionchange',()=>{
  const captured = readCurrentSelection();
  if(captured&&selectedReadingPage===currentPage()&&sameExplorerSelection(selectedReading,captured)){updateSelectionActions();return;}
  if (captured) {
    selectedReading = captured; selectedReadingPage = currentPage();clearSelectionExplorer();
    const name=selectionExplorerName(captured.quote),pageKey=currentPage(),context=pageContext(captured.quote);
    if(name&&!pageMotion.busy)selectionExplorerTimer=setTimeout(()=>{
      if(selectedReading!==captured||currentPage()!==pageKey||pageMotion.busy)return;
      if($('source-dialog').open)closeDialog('source-dialog');
      void selectionExplorer?.open({text:name,context,pageKey});
    },350);
  }
  else if (window.getSelection()?.toString().trim()) {selectedReading = null;clearSelectionExplorer();}
  updateSelectionActions();
});
for (const prefix of ['reader','source']) {
  $(`${prefix}-selection-lookup`).addEventListener('click',()=>{
    if (!selectedReading || selectedReadingPage !== currentPage()) return;
    const name=selectionExplorerName(selectedReading.quote)||selectionExplorerName(selectedReading.name);
    if(!name){captureEncounter();return;}
    clearTimeout(selectionExplorerTimer);
    if($('source-dialog').open)closeDialog('source-dialog');
    void selectionExplorer?.open({text:name,context:pageContext(selectedReading.quote),pageKey:currentPage()});
  });
  $(`${prefix}-selection-clear`).addEventListener('click',()=>{ clearSelectionExplorer();selectedReading = null; window.getSelection()?.removeAllRanges(); updateSelectionActions(); refreshReadingGuides(); });
}
$('encounter-form').addEventListener('submit',event=>{event.preventDefault();const name=selectionExplorerName($('encounter-name').value);if(!name){toast('请输入 2 至 40 个字符的短名称，再继续探索。');return;}const context=pageContext(encounterQuote),pageKey=currentPage();closeDialog('encounter-dialog');void selectionExplorer?.open({text:name,context,pageKey});});
$('read-source').addEventListener('click', () => {
  openDialog('source-dialog', $('read-source'));
  setHighlightedText($('source-copy'), currentPage()?.text ?? '', pageParts(state.pageIndex).selectedText);
});
$('clear-filters').addEventListener('click', clearFilters);
$('reset-chapter').addEventListener('click', () => chooseChapter('all'));
$('chapter-select').addEventListener('change', event => chooseChapter(event.target.value));
$('search-input').addEventListener('input', event => {
  state.query = event.target.value;
  state.visibleLimit = 80;
  renderFragments();
  renderFloating();
  renderTimeline();
});
$('manage-people').addEventListener('click', () => {
  $('people-input').value = state.book.people.map(person => person.name).join('，');
  $('people-error').hidden = true;
  openDialog('people-dialog', $('manage-people'));
});
$('people-form').addEventListener('submit', event => {
  event.preventDefault();
  const names = [...new Set($('people-input').value.split(/[,，;；\n]+/u).map(name => name.trim()).filter(Boolean))];
  if (names.length > 30 || names.some(name => name.length > 60)) {
    $('people-error').textContent = '最多填写 30 位人物，每个人物名称不超过 60 个字。';
    $('people-error').hidden = false;
    return;
  }
  try {
    const previousPageId = currentPage()?.id;
    const book = analyzeBook({ title: state.book.title, chapters: state.book.chapters.map(({ title, text }) => ({ title, text })) }, names);
    setBook(book, state.demo, libraryBookId);
    const previousIndex = state.book.pages.findIndex(page=>page.id === previousPageId);
    if (previousIndex >= 0) goToPage(previousIndex,false);
    closeDialog('people-dialog');
    toast(`人物已更新，发现 ${number(book.people.length)} 位人物`);
  } catch (error) {
    $('people-error').textContent = error instanceof Error ? error.message : '分析未完成，请重试。';
    $('people-error').hidden = false;
  }
});
$('analysis-help').addEventListener('click', () => toast(libraryBookId ? '自然线索只按本书字面出现的名称匹配，不代表自动确认物种身份。' : '按词语和人物名在本地匹配，可能存在遗漏；可用“调整人物”补充名称。'));
$('export-button').addEventListener('click', () => {
  const fragments = filterFragments(state.book, state);
  const payload = { title: state.book.title, exportedAt: new Date().toISOString(), analysis: '本地词语与人物名称匹配', filters: { person: state.person, category: state.category, chapter: state.chapter, query: state.query }, fragments: fragments.map(fragment => ({ ...fragment, chapter: chapterById(fragment.chapterId)?.title ?? '' })) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = `${state.book.title.replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '_').slice(0, 100)}-书间摘录.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`已导出当前筛选的 ${number(fragments.length)} 段摘录`);
});
document.addEventListener('keydown', event => {
  if (event.target instanceof Element && event.target.closest('input,textarea,select,button,[contenteditable="true"]')) return;
  if (document.querySelector('dialog[open]')) return;
  if (event.key === '/') { event.preventDefault(); $('search-input').focus(); }
  if (event.key === 'ArrowRight') { event.preventDefault(); state.selected = null; returnQuote = ''; goToPage(pageMotion.target + 1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); state.selected = null; returnQuote = ''; goToPage(pageMotion.target - 1); }
});
for (const [index, leaf] of Array.from(document.querySelectorAll('.leaf-copy')).entries()) {
  leaf.tabIndex = 0;
  leaf.setAttribute('role', 'region');
  leaf.setAttribute('aria-label', `书籍${index === 0 ? '左' : '右'}页正文，可滚动阅读`);
}
$('toggle-book').setAttribute('aria-expanded', 'true');
selectionExplorer=createSelectionExplorer({root:$('selection-explorer'),getPageKey:currentPage,collector:guideCollector,onSaved:result=>toast(result.alreadyExists?'已在收藏中，本次未覆盖原卡。':`已收藏「${result.plant.name}」，继续阅读吧。`)});
bookGuideView = createBookGuideView({stage:$('book-stage'),leaves:[$('page-left'),$('page-right')],svg:$('book-guide-lines'),cards:$('book-guide-cards'),toggle:$('toggle-book-guides'),status:$('book-guide-status'),onLookup:async guide=>{
  try {
    const result = await guideCollector.collect(guide,pageContext(guide.quote));
    toast(result.alreadyExists ? `「${guide.lookupName || guide.name}」已在收藏中` : `已收藏「${result.plant.name}」，继续阅读吧。`);
    return result;
  } catch (error) { toast(error.name === 'AbortError' ? '收藏响应较慢，请稍后重试。' : error.message || '暂时无法收藏，请稍后重试。'); throw error; }
}});
createReaderFullscreen({panel:$('reader-panel'),enterButton:$('enter-reader-fullscreen'),exitButton:$('exit-reader-fullscreen'),orientationButton:$('reader-orientation'),sizeSelect:$('reader-size'),onLayout:({active,orientationChanged})=>{
  const panel = $('reader-panel'); panel.classList.add('reader-layout-switch');
  bookGuideView.settleBookTransition();
  (active ? panel : document.body).append($('toast'));
  requestAnimationFrame(()=>{ bookGuideView.schedule(); requestAnimationFrame(()=>panel.classList.remove('reader-layout-switch')); });
}});
createReaderTypography({
  panel:$('reader-typography-panel'),toggle:$('reader-typography-toggle'),close:$('reader-typography-close'),root:$('reader-panel'),reset:$('reader-typography-reset'),storage:window.localStorage,
  inputs:{fontSize:$('reader-font-size'),lineHeight:$('reader-line-height'),letterSpacing:$('reader-letter-spacing'),pagePadding:$('reader-page-padding'),fontFamily:document.querySelectorAll('[name="reader-font-family"]')},
  outputs:{fontSize:$('reader-font-size-value'),lineHeight:$('reader-line-height-value'),letterSpacing:$('reader-letter-spacing-value'),pagePadding:$('reader-page-padding-value')},
  presetButtons:document.querySelectorAll('[data-reader-preset]'),
});
renderBookInfo();
renderExplorer();
renderBook();
renderFloating();
populateChapterSelect();
renderTimeline();
initializeLibrary();
