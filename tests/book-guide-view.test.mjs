import test from 'node:test';
import assert from 'node:assert/strict';
import {createBookGuideView} from '../dist/book-guide-view.mjs';

test('guide SVG hidden attribute follows visible, turning and closed states',t=>{
  // SVG has no reflecting HTMLElement.hidden setter: model attributes separately.
  class Element {
    attrs = new Map(); children = []; closed = false; dataset = {};
    classList = {toggle:()=>{},contains:name=>name === 'is-closed' && this.closed};
    setAttribute(key,value) { this.attrs.set(key,String(value)); }
    toggleAttribute(key,force) { if (force) this.attrs.set(key,''); else this.attrs.delete(key); }
    hasAttribute(key) { return this.attrs.has(key); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener() {}
  }
  const replacements = {document:{createElement:()=>new Element(),createElementNS:()=>new Element()},window:{addEventListener(){}},ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,matchMedia:()=>({matches:false,addEventListener(){}})};
  const previous = new Map(Object.keys(replacements).map(key=>[key,globalThis[key]]));
  Object.assign(globalThis,replacements);
  t.after(()=>{for(const [key,value] of previous) if(value === undefined) delete globalThis[key]; else globalThis[key] = value;});
  const stage = new Element(), svg = new Element(), cards = new Element();
  const view = createBookGuideView({stage,svg,cards,leaves:[],toggle:new Element(),status:new Element(),onLookup(){}});
  view.render({guides:[{name:'白蜡树'}],parts:[]});
  assert.equal(svg.hasAttribute('hidden'),false);
  view.suspend(true);
  assert.equal(svg.hasAttribute('hidden'),true);
  view.suspend(false);
  assert.equal(svg.hasAttribute('hidden'),false);
  stage.closed = true; view.suspend(false);
  assert.equal(svg.hasAttribute('hidden'),true);
  stage.closed = false; view.reset();
  assert.equal(svg.hasAttribute('hidden'),false);
});
