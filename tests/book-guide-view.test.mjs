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
  // Fullscreen disables the physical-book CSS transition: no transitionend will arrive.
  stage.closed = true; view.bookTransition({animated:false});
  assert.equal(cards.hidden,true);
  stage.closed = false; view.bookTransition({animated:false});
  assert.equal(cards.hidden,false);
  assert.equal(svg.hasAttribute('hidden'),false);
  // Entering fullscreen cancels an ordinary transform transition without ending a page turn.
  view.bookTransition();
  assert.equal(cards.hidden,true);
  view.settleBookTransition();
  assert.equal(cards.hidden,false);
  view.suspend(true); view.bookTransition(); view.settleBookTransition();
  assert.equal(cards.hidden,true);
  assert.equal(svg.hasAttribute('hidden'),true);
  view.suspend(false);
  assert.equal(cards.hidden,false);
});

test('guide collection button stays in place, blocks repeated clicks and reports completion',async t=>{
 class Element {
  attrs=new Map();children=[];dataset={};events=new Map();classList={toggle(){},contains(){return false;}};
  setAttribute(k,v){this.attrs.set(k,String(v));} toggleAttribute(k,v){if(v)this.attrs.set(k,'');else this.attrs.delete(k);} append(...values){this.children.push(...values);} replaceChildren(...values){this.children=values;} addEventListener(k,fn){this.events.set(k,fn);}
 }
 const previous=new Map();const replacements={document:{createElement:()=>new Element(),createElementNS:()=>new Element()},window:{addEventListener(){}},ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,matchMedia:()=>({matches:true,addEventListener(){}})};
 for(const [key,value]of Object.entries(replacements)){previous.set(key,globalThis[key]);globalThis[key]=value;}t.after(()=>{for(const [key,value]of previous)if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 let calls=0,resolve;const saved=new Promise(done=>{resolve=done;});const cards=new Element();const view=createBookGuideView({stage:new Element(),svg:new Element(),cards,leaves:[],toggle:new Element(),status:new Element(),onLookup:()=>{calls++;return saved;}});
 view.render({guides:[{name:'苔藓',kind:'plant'}],parts:[]});
 const body=cards.children[0].children[1],button=body.children[2].children[1],link=body.children[3];
 assert.equal(button.textContent,'快速收藏');assert.equal(link.hidden,true);
 const click=button.events.get('click');const saving=click();await click();assert.equal(calls,1);assert.equal(button.disabled,true);assert.equal(button.textContent,'收藏中…');assert.equal(button.attrs.get('aria-busy'),'true');
 resolve({plant:{id:'saved'}});await saving;assert.equal(button.textContent,'已收藏 ✓');assert.equal(button.disabled,true);assert.equal(button.attrs.get('aria-busy'),'false');assert.equal(link.hidden,false);assert.equal(link.href,'/plants.html#collection-title');
});
