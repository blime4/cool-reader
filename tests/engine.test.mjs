import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBook, filterFragments, makeDemoBook, CATEGORIES } from '../dist/engine.mjs';

const repeated = '林舟说：“潮声还在。”陈晚问：“信从哪里来？”林舟穿着灰色外套，眼睛映着灯光。陈晚低声说：“我会等到天亮。”';

test('rejects empty, unreadable, very short, oversized, and excessive chapter input', () => {
  for (const text of ['', '   ', 'a', '1234567890!'.repeat(20), '\u0000'.repeat(50)]) {
    assert.throws(() => analyzeBook({ title: '无字书', text }), /文字|内容|短|读取/);
  }
  assert.throws(() => analyzeBook({ text: '字'.repeat(2_000_001) }), /200|字|大/);
  assert.throws(() => analyzeBook({ chapters: Array.from({ length: 1001 }, () => ({ title: '章', text: repeated })) }), /章节|1000/);
});

test('splits Chinese and English headings and keeps the entire last content', () => {
  const ending = '这是最后一页最后一句，不能遗失。';
  const book = analyzeBook({ title: '灯塔', text: `第一章 来信\r\n${repeated.repeat(24)}\r\n第二章 回声\r\n${repeated.repeat(22)}${ending}` });
  assert.equal(book.title, '灯塔');
  assert.equal(book.chapters.length, 2);
  assert.equal(book.chapters[0].title, '第一章 来信');
  assert.ok(book.pages.length > 5);
  assert.ok(book.pages.at(-1).text.endsWith(ending));
  assert.equal(book.chapters.map(ch => ch.text).join(''), book.pages.map(page => page.text).join(''));
  assert.equal(book.totalChars, book.chapters.reduce((sum, ch) => sum + ch.text.length, 0));
  assert.ok(book.pages.every(page => !page.text.includes('\r')));
  const english = analyzeBook({ text: `Chapter 1: Home\nAlice said hello. Alice wore a blue coat.\nChapter II: Return\nAlice whispered softly in the empty room.` });
  assert.equal(english.chapters.length, 2);
});

test('preserves prefaces, provided chapters, and long unpunctuated content', () => {
  const preface = '这是一段不能遗失的序言。潮声落在纸上，灯光照着窗台。';
  const book = analyzeBook({ text: `${preface}\n第一章 起点\n${repeated}` });
  assert.ok(book.chapters[0].text.includes(preface));
  const supplied = analyzeBook({ title: '分卷', chapters: [{ title: '独立章', text: repeated }, { title: '尾章', text: '这是一段没有标点的很长的叙述'.repeat(140) }] });
  assert.equal(supplied.chapters.length, 2);
  assert.equal(supplied.pages.map(page => page.text).join(''), supplied.chapters.map(ch => ch.text).join(''));
  assert.ok(supplied.fragments.length > 0);
});

test('splits heading-free prose into fallback chapters with no lost text or source offsets', () => {
  const text = '潮声从很远的海面传来，岸边的灯光一直没有熄灭。'.repeat(610) + '这是最后的回信。';
  const book = analyzeBook({ text });
  assert.ok(book.chapters.length >= 2);
  assert.equal(book.chapters.map(chapter => chapter.text).join(''), text);
  assert.equal(book.pages.map(page => page.text).join(''), text);
  assert.ok(book.pages.every(page => page.text.length < 700));
  for (const fragment of book.fragments) {
    const chapter = book.chapters.find(item => item.id === fragment.chapterId);
    assert.equal(chapter.text.slice(fragment.offset, fragment.offset + fragment.text.length), fragment.text);
    assert.ok(book.pages.find(page => page.id === fragment.pageId).text.includes(fragment.text));
  }
});

test('discovers repeated people and associates custom names without inventing descriptions', () => {
  const book = analyzeBook({ text: repeated.repeat(4) });
  assert.ok(book.people.some(person => person.name === '林舟' && person.count >= 4));
  assert.ok(book.people.some(person => person.name === '陈晚'));
  assert.ok(!book.people.some(person => ['潮声', '灰色', '灯光'].includes(person.name)));
  const custom = analyzeBook({ text: '阿芒把门轻轻推开。她穿着蓝色棉裙。阿芒说风从海上来，岸边灯光闪烁。林舟说天亮了。林舟说可以出发了。' }, ['阿芒']);
  assert.deepEqual(custom.people.map(person => person.name), ['阿芒']);
  assert.ok(custom.fragments.some(fragment => fragment.people.includes('阿芒')));
  for (const fragment of book.fragments) {
    const chapter = book.chapters.find(ch => ch.id === fragment.chapterId);
    const page = book.pages.find(page => page.id === fragment.pageId);
    assert.ok(chapter.text.includes(fragment.text));
    assert.ok(page.text.includes(fragment.text));
    assert.equal(chapter.text.slice(fragment.offset, fragment.offset + fragment.text.length), fragment.text);
    assert.equal(page.chapterId, fragment.chapterId);
  }
  const english = analyzeBook({ text: 'The shore was quiet. Alice said hello. Alice wore a blue coat. The rain fell. Alice answered softly. The window was open.' });
  assert.ok(english.people.some(person => person.name === 'Alice'));
  assert.ok(!english.people.some(person => person.name === 'The'));
});

test('keeps cross filters consistent and uses excerpts when there are no rule keywords', () => {
  const book = analyzeBook({ title: '例子', chapters: [{ title: '一', text: repeated.repeat(2) }, { title: '二', text: repeated.repeat(2) }] });
  const first = book.fragments.find(fragment => fragment.people.includes('林舟'));
  const found = filterFragments(book, { person: '林舟', category: first.category, chapter: first.chapterId, query: first.text.slice(0, 4) });
  assert.ok(found.length);
  assert.ok(found.every(fragment => fragment.people.includes('林舟') && fragment.category === first.category && fragment.chapterId === first.chapterId));
  assert.equal(filterFragments(book, { query: '不存在的句子' }).length, 0);
  assert.deepEqual(filterFragments(book), book.fragments);
  const plain = analyzeBook({ text: '一加一等于二。三加三等于六。四乘四等于十六。五减三等于二。' });
  assert.ok(plain.fragments.length > 0);
  assert.ok(plain.fragments.every(fragment => fragment.category === 'excerpt'));
  assert.ok(CATEGORIES.some(category => category.id === 'excerpt' && category.label === '摘录'));
});

test('a mixed description appears under every matching category without duplicating the source fragment', () => {
  const sentence = '林舟穿着蓝色外套，眼睛明亮。';
  const book = analyzeBook({ text: `${sentence}陈晚低声说，海边的灯光还亮着。` }, ['林舟', '陈晚']);
  const mixed = book.fragments.find(fragment => fragment.text === sentence);
  assert.equal(book.fragments.filter(fragment => fragment.text === sentence).length, 1);
  assert.equal(mixed.category, 'appearance');
  assert.deepEqual(mixed.categories, ['appearance', 'clothing']);
  for (const category of mixed.categories) {
    assert.ok(filterFragments(book, { category, person: '林舟' }).includes(mixed));
  }
  const excerpt = analyzeBook({ text: '一加一等于二。三加三等于六。四乘四等于十六。五减三等于二。' }).fragments[0];
  assert.deepEqual(excerpt.categories, ['excerpt']);
});

test('demo is a rich original book with all visual categories and navigable source references', () => {
  const book = makeDemoBook();
  assert.equal(book.title, '海边来信');
  assert.ok(book.chapters.length >= 6 && book.chapters.length <= 8);
  assert.ok(book.fragments.length >= 50);
  assert.deepEqual(new Set(book.people.map(person => person.name)), new Set(['林舟', '陈晚', '许远']));
  for (const category of CATEGORIES.filter(item => !['all', 'excerpt'].includes(item.id))) {
    assert.ok(book.fragments.some(fragment => fragment.category === category.id), category.id);
  }
  for (const fragment of book.fragments) {
    assert.ok(book.pages.find(page => page.id === fragment.pageId).text.includes(fragment.text));
  }
});
