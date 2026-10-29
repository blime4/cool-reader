import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const css = await readFile(new URL('../dist/styles.css',import.meta.url),'utf8');
const html = await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const geometry = /^(?:width|height|min-width|min-height|max-width|max-height|top|bottom|left|right|inset|transform|scale|translate|flex|flex-basis)$/;

test('guide arrival/removal cannot change stage geometry in any viewport or fullscreen size',()=>{
  // Inspect every media-query rule, including normal/mobile and standard/large/extra fullscreen.
  // These states can change after commit and after async reading-matches; none may size the book.
  const offending = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\.(?:has-book-guides|book-guides-visible)\b/.test(rule[1])) continue;
    for (const declaration of rule[2].split(';')) {
      const property = declaration.split(':')[0].trim();
      if (geometry.test(property)) offending.push(`${rule[1].trim()}: ${property}`);
    }
  }
  assert.deepEqual(offending,[], 'page-dependent guide state must not control the stage or physical-book size/position');
});

test('stable guide space exists before asynchronous page recognition and is never tied to current-page cards',()=>{
  assert.match(html, /class="[^"]*\breader-stage-layout\b[^"]*"[^>]*id="book-stage"/);
  assert.match(css,/\.book-stage\.reader-stage-layout\s*\{height:620px\}/);
  assert.match(css,/\.reader-fullscreen \.book-stage\.reader-stage-layout \.physical-book\s*\{width:var\(--full-guide-width/);
});
