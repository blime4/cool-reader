import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('reader loads a dedicated editorial magazine stylesheet', async () => {
  const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.match(html,/href="\.\/magazine\.css"/);
});

test('magazine art direction defines a dominant feature plate and restrained inset', async () => {
  const css=await readFile(new URL('../dist/magazine.css',import.meta.url),'utf8');
  assert.match(css,/\.magazine-figure-feature/);
  assert.match(css,/\.magazine-figure-inset/);
  assert.match(css,/\.magazine-figure-kicker/);
  assert.match(css,/object-fit:\s*cover/);
  assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('magazine spreads use a quiet clothbound-book treatment even without figures', async () => {
  const css=await readFile(new URL('../dist/magazine.css',import.meta.url),'utf8');
  assert.match(css,/data-reader-presentation="magazine"[^}]*\.book-spread::after/);
  assert.match(css,/linear-gradient\(90deg,\s*transparent[^;]+rgba\([^;]+transparent\)/s);
  assert.match(css,/data-reader-presentation="magazine"[^}]*\.cover-back/);
  assert.match(css,/data-reader-presentation="magazine"[^}]*\.page-running-title/);
  assert.match(css,/data-reader-presentation="magazine"[^}]*\.floating-fragments/);
});

test('magazine paper avoids ruled-page texture and gives prose a calmer measure', async () => {
  const css=await readFile(new URL('../dist/magazine.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/repeating-linear-gradient/);
  assert.match(css,/data-reader-presentation="magazine"[^}]*\.leaf-copy/);
  assert.match(css,/line-height:\s*calc\(var\(--reader-line-height\)\s*\*\s*1\.06\)/);
});

test('reader supplies a larger feature geometry than inset illustrations', async () => {
  const app=await readFile(new URL('../dist/app.mjs',import.meta.url),'utf8');
  assert.match(app,/featureWidth:/);
  assert.match(app,/featureHeight:/);
});

test('narrow screens limit magazine input to one figure before layout', async () => {
  const app=await readFile(new URL('../dist/app.mjs',import.meta.url),'utf8');
  assert.match(app,/magazineNarrowPreference\.matches\s*\?\s*1/);
  assert.match(app,/rankMagazineFigures\(guides,magazineFigureLimit\)/);
  assert.match(app,/magazineNarrowPreference\.addEventListener\('change',[^;]+renderBook/);
});
