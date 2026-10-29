import test from 'node:test';
import assert from 'node:assert/strict';
import {createReaderFullscreen} from '../dist/reader-fullscreen.mjs';
function fixture(request,storage) {
 const listeners=new Map();
 const doc={body:{style:{overflow:'scroll'}},querySelector:()=>null,fullscreenElement:null,addEventListener:(name,fn)=>listeners.set(name,fn)};
 function element(){const classes=new Set();return {hidden:false,attrs:{},dataset:{},parentElement:doc.body,classList:{toggle(name,value){if(value)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},setAttribute(name,value){this.attrs[name]=value;},addEventListener(){},focus(){doc.activeElement=this;},querySelectorAll:()=>[]};}
 const original=element(),panel=element(),enterButton=element(),exitButton=element(),orientationButton=element(),sizeSelect=element();doc.body.children=[panel];doc.activeElement=original;
 if(request) panel.requestFullscreen=()=>request({doc,panel,listeners});
 doc.exitFullscreen=async()=>{doc.fullscreenElement=null;listeners.get('fullscreenchange')?.();};
 const layouts=[];const view=createReaderFullscreen({panel,enterButton,exitButton,orientationButton,sizeSelect,storage,document:doc,onLayout:value=>layouts.push(value)});
 return {view,doc,panel,enterButton,exitButton,orientationButton,sizeSelect,original,listeners,layouts};
}

test('first fullscreen entry defaults to straight with matching button text and aria without writing a preference',async()=>{
 const writes=[];const f=fixture(undefined,{getItem:()=>null,setItem:(...args)=>writes.push(args)});await f.view.enter();assert.equal(f.panel.classList.contains('reader-front-view'),true);assert.equal(f.orientationButton.attrs['aria-pressed'],'true');assert.equal(f.orientationButton.textContent,'正放 · 切换斜放');assert.deepEqual(writes,[]);
});
test('explicit orientation persists across fresh sessions and saved tilted choice wins over the new default',async()=>{
 const values=new Map();const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};const first=fixture(undefined,storage);await first.view.enter();first.view.orientation();assert.equal(values.get('folio-reader-orientation'),'tilted');assert.equal(first.orientationButton.textContent,'斜放 · 切换正放');await first.view.exit();const next=fixture(undefined,storage);await next.view.enter();assert.equal(next.panel.classList.contains('reader-front-view'),false);assert.equal(next.orientationButton.attrs['aria-pressed'],'false');next.view.orientation();assert.equal(values.get('folio-reader-orientation'),'straight');
});
test('unavailable or malformed preference storage still defaults to straight',async()=>{
 for(const storage of [undefined,{getItem:()=> 'invalid'},{getItem(){throw Error('unavailable');},setItem(){throw Error('quota');}}]){const f=fixture(undefined,storage);await f.view.enter();assert.equal(f.panel.classList.contains('reader-front-view'),true);assert.doesNotThrow(()=>f.view.orientation());}
});
test('denied native fullscreen falls back, Escape restores scroll and focus',async()=>{
 const f=fixture(async()=>{throw new Error('Denied');});await f.view.enter();assert.equal(f.view.active,true);assert.equal(f.panel.classList.contains('reader-fullscreen'),true);assert.equal(f.doc.body.style.overflow,'hidden');assert.equal(f.enterButton.attrs['aria-pressed'],'true');
 f.listeners.get('keydown')({key:'Escape',preventDefault(){}});await Promise.resolve();assert.equal(f.view.active,false);assert.equal(f.doc.body.style.overflow,'scroll');assert.equal(f.doc.activeElement,f.original);assert.equal(f.exitButton.hidden,true);
});
test('native browser exit synchronizes UI and presentation-only orientation',async()=>{
 const f=fixture(async({doc,panel,listeners})=>{doc.fullscreenElement=panel;listeners.get('fullscreenchange')();},{getItem:()=> 'tilted'});await f.view.enter();f.view.orientation();assert.equal(f.panel.classList.contains('reader-front-view'),true);assert.equal(f.orientationButton.attrs['aria-pressed'],'true');assert.equal(f.layouts.at(-1).orientationChanged,true);
 await f.doc.exitFullscreen();assert.equal(f.view.active,false);assert.equal(f.panel.classList.contains('reader-front-view'),false);assert.equal(f.enterButton.attrs['aria-pressed'],'false');
});
test('an outstanding request cannot reopen after the user exits',async()=>{
 let finish;const f=fixture(async({doc,panel,listeners})=>{await new Promise(resolve=>{finish=resolve;});doc.fullscreenElement=panel;listeners.get('fullscreenchange')();});const opening=f.view.enter();await f.view.exit();finish();await opening;assert.equal(f.view.active,false);assert.equal(f.doc.fullscreenElement,null);
});
test('fullscreen unavailable still supports orientation and preserves selected orientation on reentry',async()=>{
 const f=fixture(undefined,{getItem:()=> 'tilted'});await f.view.enter();f.view.orientation();await f.view.exit();await f.view.enter();assert.equal(f.panel.classList.contains('reader-front-view'),true);assert.equal(f.layouts.at(-1).front,true);assert.equal(f.layouts.filter(item=>item.orientationChanged).length,1);
});

test('a stale request cannot exit a newer active fullscreen session',async()=>{
 let finish,calls=0;const f=fixture(async({doc,panel,listeners})=>{if(++calls===1)await new Promise(resolve=>{finish=resolve;});doc.fullscreenElement=panel;listeners.get('fullscreenchange')();});const first=f.view.enter();await f.view.exit();await f.view.enter();finish();await first;assert.equal(f.view.active,true);assert.equal(f.doc.fullscreenElement,f.panel);
});

test('exit restores CSS, overflow and focus even when native exit rejects',async()=>{
 const f=fixture(async({doc,panel,listeners})=>{doc.fullscreenElement=panel;listeners.get('fullscreenchange')();});await f.view.enter();f.doc.exitFullscreen=async()=>{throw new Error('Embedded browser denied exit');};await f.view.exit();assert.equal(f.view.active,false);assert.equal(f.panel.classList.contains('reader-fullscreen'),false);assert.equal(f.doc.body.style.overflow,'scroll');assert.equal(f.doc.activeElement,f.original);assert.equal(f.enterButton.attrs['aria-pressed'],'false');assert.equal(f.sizeSelect.hidden,true);
});
test('CSS exits immediately while native exit is still pending',async()=>{
 const f=fixture(async({doc,panel,listeners})=>{doc.fullscreenElement=panel;listeners.get('fullscreenchange')();});await f.view.enter();let finish;f.doc.exitFullscreen=()=>new Promise(resolve=>{finish=resolve;});const exit=f.view.exit();assert.equal(f.view.active,false);assert.equal(f.doc.body.style.overflow,'scroll');assert.equal(f.doc.activeElement,f.original);finish();await exit;
});
test('native completion of an old exit cannot dismiss a newer requested session',async()=>{
 const f=fixture(async({doc,panel,listeners})=>{doc.fullscreenElement=panel;listeners.get('fullscreenchange')();});await f.view.enter();let finish;f.doc.exitFullscreen=()=>new Promise(resolve=>{finish=()=>{f.doc.fullscreenElement=null;f.listeners.get('fullscreenchange')();resolve();};});const exit=f.view.exit();await f.view.enter();finish();await exit;assert.equal(f.view.active,true);assert.equal(f.panel.classList.contains('reader-fullscreen'),true);
});
test('size defaults to large, remains independent of orientation and persists across reentry',async()=>{
 const f=fixture(undefined,{getItem:()=> 'tilted'});assert.equal(f.sizeSelect.value,'large');await f.view.enter();assert.equal(f.panel.dataset.readerSize,'large');f.sizeSelect.value='extra';f.view.resize();assert.equal(f.panel.dataset.readerSize,'extra');f.view.orientation();assert.equal(f.panel.dataset.readerSize,'extra');assert.equal(f.panel.classList.contains('reader-front-view'),true);await f.view.exit();await f.view.enter();assert.equal(f.panel.dataset.readerSize,'extra');assert.equal(f.panel.classList.contains('reader-front-view'),true);f.sizeSelect.value='invalid';f.view.resize();assert.equal(f.panel.dataset.readerSize,'extra');
});
