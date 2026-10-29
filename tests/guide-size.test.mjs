import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {normalizeGuideSize,guideSizeProfile,createGuideSize} from '../dist/guide-size.mjs';
import {guideRailLayout} from '../dist/guide-density.mjs';
test('guide card size defaults to medium and accepts only the supported persisted values',()=>{assert.equal(normalizeGuideSize(null),'medium');assert.equal(normalizeGuideSize('script'),'medium');for(const size of ['small','medium','large'])assert.equal(normalizeGuideSize(size),size);assert.ok(guideSizeProfile('medium').cardWidth>guideSizeProfile('small').cardWidth);assert.ok(guideSizeProfile('large').photoHeight>guideSizeProfile('medium').photoHeight);});
test('size restores, persists and requests an immediate rail remeasurement without touching book dimensions',()=>{
 const css=new Map(),events={},writes=[];let measured=0;const select={addEventListener:(key,fn)=>events[key]=fn},root={style:{setProperty:(key,value)=>css.set(key,value)}};
 const view=createGuideSize({select,root,storage:{getItem:()=> 'large',setItem:(key,value)=>writes.push([key,value])},onChange:()=>measured++});assert.equal(view.value,'large');assert.equal(css.get('--guide-card-width'),'212px');select.value='medium';events.change();assert.equal(view.value,'medium');assert.equal(writes[0][1],'medium');assert.equal(measured,1);assert.ok([...css.keys()].every(key=>key.startsWith('--guide-')));
 assert.doesNotThrow(()=>createGuideSize({select,root,storage:{getItem(){throw Error();}}}));
});
test('larger cards change only rail capacity and fold safely when the available border is too narrow',()=>{
 const normal={width:600,height:620,book:{left:90,top:90,right:510,bottom:390}};
 assert.equal(guideRailLayout({...normal,size:'small'}).mode,'edge');assert.equal(guideRailLayout({...normal,size:'medium'}).mode,'edge');assert.equal(guideRailLayout({...normal,size:'large'}).mode,'folded');
 assert.equal(guideRailLayout({width:1200,height:150,book:{left:400,top:0,right:800,bottom:150},size:'large'}).mode,'folded');
 for(const size of ['small','medium','large'])for(const rail of guideRailLayout({width:1680,height:850,book:{left:380,top:150,right:1300,bottom:700},size}).rails){assert.ok(rail.x+rail.width<=370||rail.x>=1310||rail.y+rail.height<=140||rail.y>=710);}
});
test('card typography, photo, width and hit areas use size variables in both rails and the mobile browser',async()=>{const css=await readFile(new URL('../dist/styles.css',import.meta.url),'utf8');for(const name of ['--guide-card-width','--guide-photo-height','--guide-title-size','--guide-button-height'])assert.ok(css.includes(`var(${name}`));assert.match(css,/\.guide-density-dialog[^{}]*\.book-guide-card[^{}]*\{[^}]*var\(--guide-card-width/);});
