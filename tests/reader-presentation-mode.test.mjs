import test from 'node:test';
import assert from 'node:assert/strict';

import {createReaderPresentationMode} from '../dist/reader-presentation-mode.mjs';

class Button {
  constructor(value) { this.dataset = {readerPresentation: value}; this.attrs = new Map(); this.events = new Map(); }
  addEventListener(type, listener) { this.events.set(type, listener); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  click() { this.events.get('click')?.(); }
}

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {getItem:key=>values.get(key) ?? null, setItem:(key,value)=>values.set(key,String(value)), value:key=>values.get(key)};
}

test('presentation mode defaults to guides and persists only whitelisted choices', () => {
  const buttons = ['plain','guides','magazine'].map(value=>new Button(value));
  const saved = storage({'folio-reader-presentation':'unsafe'});
  const changes = [];
  const mode = createReaderPresentationMode({buttons,storage:saved,onChange:value=>changes.push(value)});
  assert.equal(mode.value,'guides');
  assert.deepEqual(buttons.map(button=>button.attrs.get('aria-pressed')),['false','true','false']);
  buttons[2].click();
  assert.equal(mode.value,'magazine');
  assert.equal(saved.value('folio-reader-presentation'),'magazine');
  assert.deepEqual(changes,['magazine']);
});

test('stored plain and magazine modes restore without emitting a synthetic change', () => {
  for (const expected of ['plain','magazine']) {
    const buttons = ['plain','guides','magazine'].map(value=>new Button(value));
    const changes = [];
    const mode = createReaderPresentationMode({buttons,storage:storage({'folio-reader-presentation':expected}),onChange:value=>changes.push(value)});
    assert.equal(mode.value,expected);
    assert.equal(buttons.find(button=>button.dataset.readerPresentation===expected).attrs.get('aria-pressed'),'true');
    assert.deepEqual(changes,[]);
  }
});

test('reader markup and app wiring expose the three modes without removing existing guide support', async () => {
  const {readFile} = await import('node:fs/promises');
  const html = await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  const app = await readFile(new URL('../dist/app.mjs',import.meta.url),'utf8');
  for (const value of ['plain','guides','magazine']) assert.match(html,new RegExp(`data-reader-presentation="${value}"`));
  assert.match(app,/createReaderPresentationMode/);
  assert.match(app,/readerPresentation\.value/);
  assert.match(html,/id="toggle-book-guides"/);
});
