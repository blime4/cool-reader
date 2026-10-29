import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {normalizeGuideDensity,guideRailLayout,createGuideDensity} from '../dist/guide-density.mjs';
test('only the four supported persisted densities are accepted',()=>{for(const value of [4,8,12,16,'12'])assert.equal(normalizeGuideDensity(value),Number(value));for(const value of [null,'',0,5,99,'bad'])assert.equal(normalizeGuideDensity(value),4);});
test('all perimeter rails stay outside the projected physical-book safety rectangle',()=>{
 const cases=[{width:600,height:620,book:{left:90,top:90,right:510,bottom:390}},{width:1680,height:850,book:{left:380,top:150,right:1300,bottom:700}},{width:1680,height:850,book:{left:45,top:8,right:1635,bottom:842}},{width:340,height:610,book:{left:5,top:80,right:335,bottom:380}}];
 for(const sample of cases){const result=guideRailLayout(sample);for(const rail of result.rails){assert.ok(rail.x>=0&&rail.y>=0&&rail.x+rail.width<=sample.width&&rail.y+rail.height<=sample.height);assert.ok(rail.x+rail.width<=sample.book.left-10||rail.x>=sample.book.right+10||rail.y+rail.height<=sample.book.top-10||rail.y>=sample.book.bottom+10);}}
 assert.equal(guideRailLayout(cases[2]).mode,'folded');assert.equal(guideRailLayout(cases[3]).mode,'edge');
});
test('density persists, tolerates unavailable storage, and does not mutate the book size',()=>{
 const handlers={},dataset={},writes=[];const select={value:'',addEventListener:(key,fn)=>handlers[key]=fn};const stage={dataset};const view=createGuideDensity({select,stage,storage:{getItem:()=> '8',setItem:(key,value)=>writes.push([key,value])},onChange:value=>writes.push(['changed',value])});assert.equal(view.value,8);select.value='16';handlers.change();assert.equal(view.value,16);assert.equal(dataset.guideDensity,'16');assert.equal(writes[0][1],'16');assert.equal(writes[1][1],16);
 assert.doesNotThrow(()=>createGuideDensity({select,stage,storage:{getItem(){throw Error();},setItem(){throw Error();}}}));
});
test('rail presentation keeps card actions and metadata reachable without resizing the stage',async()=>{
 const css=await readFile(new URL('../dist/styles.css',import.meta.url),'utf8');assert.ok(css.includes('.guide-perimeter-rail'));assert.ok(css.includes('overscroll-behavior:contain'));assert.ok(css.includes('.guide-density-dialog'));
 for(const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))if(/guide-density|guide-rail-mode/.test(rule[1])&&/\.book-stage[^ ]*\s*$/.test(rule[1]))assert.ok(!/(?:^|;)\s*(?:height|width|transform):/.test(rule[2]));
});
