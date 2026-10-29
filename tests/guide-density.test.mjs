import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {normalizeGuideDensity,guideRailLayout,createGuideDensity,createGuidePerimeter} from '../dist/guide-density.mjs';
test('only the four supported persisted densities are accepted',()=>{for(const value of [4,8,12,16,'12'])assert.equal(normalizeGuideDensity(value),Number(value));for(const value of [null,'',0,5,99,'bad'])assert.equal(normalizeGuideDensity(value),4);});
test('all perimeter rails stay outside the projected physical-book safety rectangle',()=>{
 const cases=[{width:600,height:620,book:{left:90,top:90,right:510,bottom:390}},{width:1680,height:850,book:{left:380,top:150,right:1300,bottom:700}},{width:1680,height:850,book:{left:45,top:8,right:1635,bottom:842}},{width:340,height:610,book:{left:5,top:80,right:335,bottom:380}}];
 for(const sample of cases){const result=guideRailLayout(sample);for(const rail of result.rails){assert.ok(rail.x>=0&&rail.y>=0&&rail.x+rail.width<=sample.width&&rail.y+rail.height<=sample.height);assert.ok(rail.x+rail.width<=sample.book.left-10||rail.x>=sample.book.right+10||rail.y+rail.height<=sample.book.top-10||rail.y>=sample.book.bottom+10);}}
 assert.equal(guideRailLayout(cases[2]).mode,'folded');assert.equal(guideRailLayout(cases[3]).mode,'edge');
});

function perimeterFixture(t) {
 class Node {
  children=[];dataset={};style={};events={};className='';scrollTop=0;scrollLeft=0;replacements=0;appends=0;hidden=false;
  classList={contains:name=>this.className.split(' ').includes(name)};
  append(...items){this.appends++;for(const item of items){if(item.parentElement)item.parentElement.children=item.parentElement.children.filter(child=>child!==item);item.parentElement=this;this.children.push(item);}}
  replaceChildren(...items){this.replacements++;for(const child of this.children)child.parentElement=null;this.children=[];this.append(...items);}
  querySelectorAll(){return this.children.flatMap(child=>[...(child.classList.contains('book-guide-card')?[child]:[]),...child.querySelectorAll()]);}
  setAttribute(){}addEventListener(key,fn){this.events[key]=fn;}focus(){}
 }
 const frames=new Map(),resizeCallbacks=[];let frame=0,measurements=0;const previous=new Map();
 const globals={requestAnimationFrame:fn=>{frames.set(++frame,fn);return frame;},ResizeObserver:class{constructor(fn){resizeCallbacks.push(fn);}observe(){}},MutationObserver:class{observe(){}},window:{addEventListener(){}}};
 for(const [key,value]of Object.entries(globals)){previous.set(key,globalThis[key]);globalThis[key]=value;}t.after(()=>{for(const [key,value]of previous)if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 const stage=new Node(),book=new Node(),cards=new Node(),browse=new Node(),dialog=new Node(),close=new Node();const projection={left:380,top:150,right:1300,bottom:700};stage.parentElement=new Node();stage.getBoundingClientRect=()=>({left:0,top:0,width:1680,height:850});book.getBoundingClientRect=()=>projection;
 const makeCard=()=>{const card=new Node();card.className='book-guide-card';return card;};const items=Array.from({length:6},makeCard);cards.append(...items);stage.append(cards);
 const view=createGuidePerimeter({stage,book,cards,browse,dialog,close,onLayout:()=>measurements++,document:{createElement:()=>new Node()}});
 const flush=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());};flush();
 return {view,items,cards,projection,makeCard,flush,resize:()=>resizeCallbacks.forEach(fn=>fn()),get measurements(){return measurements;}};
}
test('identical observer callbacks preserve rail parents, scroll offsets, order and replacement count',t=>{
 const f=perimeterFixture(t),rails=[...f.cards.children],parents=f.items.map(item=>item.parentElement),replacements=f.cards.replacements;
 const operations=rails.map(rail=>[rail.appends,rail.replacements]);
 rails.forEach((rail,index)=>{rail.scrollTop=20+index;rail.scrollLeft=40+index;});
 for(let index=0;index<3;index++){f.resize();f.flush();assert.deepEqual(f.cards.children,rails);assert.equal(f.cards.replacements,replacements);f.items.forEach((item,n)=>assert.equal(item.parentElement,parents[n]));rails.forEach((rail,n)=>{assert.equal(f.cards.children[n],rail);assert.deepEqual([rail.appends,rail.replacements],operations[n]);assert.equal(rail.scrollTop,20+n);assert.equal(rail.scrollLeft,40+n);});}
 assert.equal(f.measurements,4);
});
test('geometry updates reuse rail nodes, while a new card collection is installed exactly once',t=>{
 const f=perimeterFixture(t),rails=[...f.cards.children],parents=f.items.map(item=>item.parentElement),replacements=f.cards.replacements;rails[0].scrollTop=33;
 f.projection.bottom=680;f.view.schedule();f.flush();assert.deepEqual(f.cards.children,rails);assert.equal(f.cards.replacements,replacements);assert.equal(rails.at(-1).style.height,'120px');assert.equal(rails[0].scrollTop,33);f.items.forEach((item,n)=>assert.equal(item.parentElement,parents[n]));
 const next=[f.makeCard(),f.makeCard()];f.cards.replaceChildren(...next);f.view.schedule();f.flush();assert.deepEqual(f.cards.children,rails);assert.ok(next.every(item=>rails.includes(item.parentElement)));assert.equal(f.cards.querySelectorAll().length,2);const count=f.cards.replacements;f.view.schedule();f.flush();assert.equal(f.cards.replacements,count);
 f.cards.replaceChildren(next[1],next[0]);f.view.schedule();f.flush();assert.equal(next[1].parentElement,rails[0]);assert.equal(next[0].parentElement,rails[1]);
});
test('density persists, tolerates unavailable storage, and does not mutate the book size',()=>{
 const handlers={},dataset={},writes=[];const select={value:'',addEventListener:(key,fn)=>handlers[key]=fn};const stage={dataset};const view=createGuideDensity({select,stage,storage:{getItem:()=> '8',setItem:(key,value)=>writes.push([key,value])},onChange:value=>writes.push(['changed',value])});assert.equal(view.value,8);select.value='16';handlers.change();assert.equal(view.value,16);assert.equal(dataset.guideDensity,'16');assert.equal(writes[0][1],'16');assert.equal(writes[1][1],16);
 assert.doesNotThrow(()=>createGuideDensity({select,stage,storage:{getItem(){throw Error();},setItem(){throw Error();}}}));
});
test('rail presentation keeps card actions and metadata reachable without resizing the stage',async()=>{
 const css=await readFile(new URL('../dist/styles.css',import.meta.url),'utf8');assert.ok(css.includes('.guide-perimeter-rail'));assert.ok(css.includes('overscroll-behavior:contain'));assert.ok(css.includes('.guide-density-dialog'));
 for(const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))if(/guide-density|guide-rail-mode/.test(rule[1])&&/\.book-stage[^ ]*\s*$/.test(rule[1]))assert.ok(!/(?:^|;)\s*(?:height|width|transform):/.test(rule[2]));
});
