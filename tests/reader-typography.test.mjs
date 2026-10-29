import test from 'node:test';import assert from 'node:assert/strict';
import {DEFAULT_TYPOGRAPHY,normalizeTypography,typographyPreset,createReaderTypography} from '../dist/reader-typography.mjs';
test('invalid persisted typography is bounded and falls back safely',()=>{
 const value=normalizeTypography({fontSize:100,lineHeight:'bad',letterSpacing:-2,pagePadding:0,fontFamily:'script'});
 assert.deepEqual(value,{fontSize:24,lineHeight:1.9,letterSpacing:0,pagePadding:12,fontFamily:'serif'});
 assert.equal(typographyPreset(DEFAULT_TYPOGRAPHY),'paper');assert.equal(typographyPreset({...DEFAULT_TYPOGRAPHY,fontSize:17}),'');
});
function fixture(saved=''){
 const listeners=new Map(),css=new Map(),stored=[];
 const node=(value='')=>({value,hidden:false,checked:false,dataset:{},attrs:{},listeners:new Map(),style:{setProperty:(key,val)=>css.set(key,val)},addEventListener(name,fn){this.listeners.set(name,fn);},setAttribute(name,val){this.attrs[name]=val;},focus(){},contains(){return false;}});
 const inputs={fontSize:node('16'),lineHeight:node('1.9'),letterSpacing:node('.2'),pagePadding:node('28'),fontFamily:[node('serif'),node('kai'),node('sans')]};inputs.fontFamily.forEach((item,index)=>item.value=['serif','kai','sans'][index]);
 const outputs={fontSize:node(),lineHeight:node(),letterSpacing:node(),pagePadding:node()};
 const presetButtons=['paper','immersive','compact'].map(name=>{const item=node();item.dataset.readerPreset=name;return item;});
 const panel=node();panel.hidden=true;const toggle=node(),close=node(),reset=node(),root=node();
 const storage={getItem:()=>saved,setItem:(key,value)=>stored.push([key,value])};const doc={addEventListener:(name,fn)=>listeners.set(name,fn)};
 const view=createReaderTypography({panel,toggle,close,root,inputs,outputs,presetButtons,reset,storage,document:doc});
 return {view,inputs,outputs,presetButtons,panel,toggle,reset,css,stored,listeners};
}
test('saved settings apply to page variables without changing unrelated book UI',()=>{
 const f=fixture(JSON.stringify({fontSize:20,lineHeight:2.1,letterSpacing:.6,pagePadding:36,fontFamily:'kai'}));
 assert.equal(f.css.get('--reader-full-font-size'),'20px');assert.equal(f.css.get('--reader-page-font-size'),'10.25px');assert.equal(f.css.get('--reader-full-page-padding-x'),'36px');assert.match(f.css.get('--reader-page-font'),/KaiTi/);assert.equal(f.outputs.lineHeight.value,'2.10');assert.equal(f.stored.length,0);
});
test('live tuning, presets and reset persist while panel supports keyboard dismissal',()=>{
 const f=fixture();f.inputs.fontSize.value='22';f.inputs.fontSize.listeners.get('input')({target:f.inputs.fontSize});assert.equal(f.view.settings.fontSize,22);assert.equal(f.css.get('--reader-full-font-size'),'22px');assert.equal(f.stored.length,1);
 f.presetButtons[1].listeners.get('click')();assert.equal(f.view.settings.fontFamily,'kai');assert.equal(f.presetButtons[1].attrs['aria-pressed'],'true');
 f.toggle.listeners.get('click')();assert.equal(f.panel.hidden,false);f.listeners.get('keydown')({key:'Escape',preventDefault(){}});assert.equal(f.panel.hidden,true);
 f.reset.listeners.get('click')();assert.deepEqual(f.view.settings,DEFAULT_TYPOGRAPHY);
});
