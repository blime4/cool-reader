import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
 const body=cards.children[0].children[1],button=body.children[2].children[1],link=body.children.at(-1);
 assert.equal(button.textContent,'快速收藏');assert.equal(link.hidden,true);
 const click=button.events.get('click');const saving=click();await click();assert.equal(calls,1);assert.equal(button.disabled,true);assert.equal(button.textContent,'收藏中…');assert.equal(button.attrs.get('aria-busy'),'true');
 resolve({plant:{id:'saved'}});await saving;assert.equal(button.textContent,'已收藏 ✓');assert.equal(button.disabled,true);assert.equal(button.attrs.get('aria-busy'),'false');assert.equal(link.hidden,false);assert.equal(link.href,'/plants.html#collection-title');
});

test('only missing guide photos offer generation and a current result replaces the card in place',t=>{
 class Element {
  attrs=new Map();children=[];dataset={};events=new Map();classList={toggle(){},contains(){return false;}};style={};isConnected=true;
  setAttribute(k,v){this.attrs.set(k,String(v));} toggleAttribute(k,v){if(v)this.attrs.set(k,'');else this.attrs.delete(k);} append(...values){this.children.push(...values);} replaceChildren(...values){this.children=values;} addEventListener(k,fn){this.events.set(k,fn);}
 }
 const previous=new Map();const replacements={document:{createElement:()=>new Element(),createElementNS:()=>new Element(),createTextNode:text=>text},window:{addEventListener(){}},ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,matchMedia:()=>({matches:true,addEventListener(){}}),setTimeout:()=>1,clearTimeout(){}};
 for(const [key,value]of Object.entries(replacements)){previous.set(key,globalThis[key]);globalThis[key]=value;}t.after(()=>{for(const [key,value]of previous)if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 const generated={imageUrl:'/generated-images/00000000-0000-4000-8000-000000000001.jpg',imageKind:'generated',imageAttribution:'AI 生成示意图 · 非实拍'};
 const guides=[{name:'野猪',kind:'animal'},{name:'花鼠',kind:'animal',imageUrl:'/plant-assets/1.jpg'}];let action;
 const cards=new Element();const view=createBookGuideView({stage:new Element(),svg:new Element(),cards,leaves:[],toggle:new Element(),status:new Element(),onLookup(){},createGeneration(options){action=options;return new Element();}});
 view.render({guides,parts:[],key:'page-53'});
 assert.ok(action);assert.equal(action.getItem(),guides[0]);assert.equal(action.isCurrent(),true);
 action.onGenerated(generated);
 assert.equal(guides[0].imageUrl,generated.imageUrl);assert.equal(guides[0].imageKind,'generated');assert.equal(guides[0].imageAttribution,generated.imageAttribution);
 assert.equal(action.isCurrent(),false);assert.equal(cards.children.length,2);
 const verified={name:'野猪',kind:'animal',imageUrl:'/plant-assets/99.jpg',imageAttribution:'可靠实拍'};
 view.render({guides:[verified],parts:[],key:{id:'page-53',text:'不应进入缓存键的全文'}});
 assert.equal(verified.imageUrl,'/plant-assets/99.jpg');assert.equal(verified.imageAttribution,'可靠实拍');
});

test('the guide view renders four page matches without truncating the third and fourth',t=>{
 class Element {attrs=new Map();children=[];dataset={};events=new Map();classList={toggle(){},contains(){return false;}};style={};setAttribute(k,v){this.attrs.set(k,String(v));}toggleAttribute(k,v){if(v)this.attrs.set(k,'');else this.attrs.delete(k);}append(...values){this.children.push(...values);}replaceChildren(...values){this.children=values;}addEventListener(k,fn){this.events.set(k,fn);}}
 const previous=new Map();const replacements={document:{createElement:()=>new Element(),createElementNS:()=>new Element(),createTextNode:text=>text},window:{addEventListener(){}},ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,matchMedia:()=>({matches:true,addEventListener(){}})};
 for(const [key,value]of Object.entries(replacements)){previous.set(key,globalThis[key]);globalThis[key]=value;}t.after(()=>{for(const [key,value]of previous)if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 const cards=new Element(),status=new Element();const view=createBookGuideView({stage:new Element(),svg:new Element(),cards,leaves:[],toggle:new Element(),status,onLookup(){}});
 const guides=['林地野牛','野猪','乳齿象','驯鹿'].map((name,index)=>({name,kind:'animal',imageUrl:`/plant-assets/${index+1}.jpg`}));view.render({guides,parts:[],key:'page-forest'});
 assert.equal(cards.children.length,4);assert.equal(status.textContent,'本页 4 个名称');
});

test('the guide view exposes a configurable density capped at sixteen',t=>{
 class Element {attrs=new Map();children=[];dataset={};events=new Map();classList={toggle(){},contains(){return false;}};style={};setAttribute(k,v){this.attrs.set(k,String(v));}toggleAttribute(k,v){if(v)this.attrs.set(k,'');else this.attrs.delete(k);}append(...values){this.children.push(...values);}replaceChildren(...values){this.children=values;}addEventListener(k,fn){this.events.set(k,fn);}}
 const previous=new Map();const replacements={document:{createElement:()=>new Element(),createElementNS:()=>new Element(),createTextNode:text=>text},window:{addEventListener(){}},ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,matchMedia:()=>({matches:true,addEventListener(){}})};for(const [key,value]of Object.entries(replacements)){previous.set(key,globalThis[key]);globalThis[key]=value;}t.after(()=>{for(const [key,value]of previous)if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 const cards=new Element(),status=new Element(),guides=Array.from({length:20},(_,index)=>({name:`名称${index}`,kind:'other',imageUrl:`/plant-assets/${index+1}.jpg`}));const view=createBookGuideView({stage:new Element(),svg:new Element(),cards,leaves:[],toggle:new Element(),status,onLookup(){},limit:12});view.render({guides,parts:[],key:'dense-page'});assert.equal(cards.children.length,12);assert.equal(status.textContent,'本页 12 个名称');
 const cappedCards=new Element();const capped=createBookGuideView({stage:new Element(),svg:new Element(),cards:cappedCards,leaves:[],toggle:new Element(),status:new Element(),onLookup(){},limit:99});capped.render({guides,parts:[],key:'capped-page'});assert.equal(cappedCards.children.length,16);
});

test('guide density changes at runtime without losing the full page candidates',t=>{
 class Element {attrs=new Map();children=[];dataset={};events=new Map();classList={toggle(){},contains(){return false;}};style={};setAttribute(k,v){this.attrs.set(k,String(v));}toggleAttribute(k,v){if(v)this.attrs.set(k,'');else this.attrs.delete(k);}append(...values){this.children.push(...values);}replaceChildren(...values){this.children=values;}addEventListener(k,fn){this.events.set(k,fn);}}
 const previous=new Map();const replacements={document:{createElement:()=>new Element(),createElementNS:()=>new Element(),createTextNode:text=>text},window:{addEventListener(){}},ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,matchMedia:()=>({matches:true,addEventListener(){}})};for(const [key,value]of Object.entries(replacements)){previous.set(key,globalThis[key]);globalThis[key]=value;}t.after(()=>{for(const [key,value]of previous)if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 const cards=new Element(),status=new Element(),guides=Array.from({length:16},(_,index)=>({name:`名称${index}`,kind:'other',imageUrl:`/plant-assets/${index+1}.jpg`}));const view=createBookGuideView({stage:new Element(),svg:new Element(),cards,leaves:[],toggle:new Element(),status,onLookup(){}});view.render({guides,parts:[],key:'runtime-density'});assert.equal(cards.children.length,4);
 assert.equal(view.setLimit(8),8);assert.equal(cards.children.length,8);assert.equal(status.textContent,'本页 8 个名称');assert.equal(view.setLimit(12),12);assert.equal(cards.children.length,12);assert.equal(view.setLimit(99),16);assert.equal(cards.children.length,16);assert.equal(view.setLimit(4),4);assert.equal(cards.children.length,4);assert.equal(view.setLimit(Number.NaN),4);assert.equal(cards.children.length,4);
});

test('guide lines hide while their card is clipped by the perimeter rail',t=>{
 class Element {attrs=new Map();children=[];dataset={};events=new Map();style={};rect={left:0,right:400,top:0,bottom:300,width:400,height:300};classList={toggle(){},contains(){return false;}};setAttribute(k,v){this.attrs.set(k,String(v));}toggleAttribute(k,v){if(v)this.attrs.set(k,'');else this.attrs.delete(k);}append(...values){this.children.push(...values);}replaceChildren(...values){this.children=values;}addEventListener(k,fn){this.events.set(k,fn);}getBoundingClientRect(){return this.rect;}querySelectorAll(){return this.words||[];}closest(){return this.ownerLeaf||null;}}
 let frame;const previous=new Map();const replacements={document:{createElement:()=>new Element(),createElementNS:()=>new Element(),createTextNode:text=>text},window:{addEventListener(){}},ResizeObserver:class{observe(){}},requestAnimationFrame:callback=>(frame=callback,1),matchMedia:()=>({matches:true,addEventListener(){}}),setTimeout:()=>1,clearTimeout(){}};for(const [key,value]of Object.entries(replacements)){previous.set(key,globalThis[key]);globalThis[key]=value;}t.after(()=>{for(const [key,value]of previous)if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 const stage=new Element(),svg=new Element(),cards=new Element(),rail=new Element(),leaf=new Element();rail.classList.contains=name=>name==='guide-perimeter-rail';rail.rect={left:0,right:200,top:0,bottom:300,width:200,height:300};leaf.scrollTop=0;leaf.clientHeight=100;const view=createBookGuideView({stage,svg,cards,leaves:[leaf],toggle:new Element(),status:new Element(),onLookup(){}});view.render({guides:[{name:'野猪',ranges:[{start:0,end:2}],imageUrl:'/plant-assets/1.jpg'}],parts:[{text:'野猪',offset:0}],key:'rail-page'});const word=leaf.children[0],card=cards.children[0];card.closest=selector=>selector==='.guide-perimeter-rail'?rail:null;word.ownerLeaf=leaf;word.offsetTop=10;word.offsetHeight=10;word.rect={left:100,right:120,top:10,bottom:20,width:20,height:10};leaf.words=[word];card.rect={left:220,right:380,top:80,bottom:240,width:160,height:160};frame();assert.equal(svg.children[0].style.display,'none');assert.equal(svg.children[1].style.display,'none');
 card.rect={left:20,right:180,top:80,bottom:240,width:160,height:160};view.schedule();frame();assert.equal(svg.children[0].style.display,'');assert.equal(svg.children[1].style.display,'');
});

test('extra fullscreen card slots override later generic insets and clear the opposite edge',async()=>{
 const css=await readFile(new URL('../dist/styles.css',import.meta.url),'utf8');const generic=css.lastIndexOf('.reader-fullscreen[data-reader-size="extra"] .book-guide-card{');const slots=css.lastIndexOf('/* Final extra-fullscreen guide slots */');
 assert.ok(slots>generic,'the four-slot override must follow every generic extra-size card rule');const final=css.slice(slots);
 assert.match(final,/nth-child\(1\)\{left:[^;]+;right:auto;top:auto;bottom:[^}]+\}/);assert.match(final,/nth-child\(2\)\{left:auto;right:[^;]+;top:auto;bottom:[^}]+\}/);assert.match(final,/nth-child\(3\)\{left:[^;]+;right:auto;top:[^;]+;bottom:auto\}/);assert.match(final,/nth-child\(4\)\{left:auto;right:[^;]+;top:[^;]+;bottom:auto\}/);
});
test('AI guide cards expose direct background regeneration while reference photos do not',async t=>{
 class Element {attrs=new Map();children=[];dataset={};events=new Map();classList={toggle(){},contains(){return false;}};style={};isConnected=true;setAttribute(k,v){this.attrs.set(k,String(v));}toggleAttribute(k,v){if(v)this.attrs.set(k,'');else this.attrs.delete(k);}append(...values){this.children.push(...values);}replaceChildren(...values){this.children=values;}addEventListener(k,fn){this.events.set(k,fn);}}
 const previous=new Map();const replacements={document:{createElement:()=>new Element(),createElementNS:()=>new Element()},window:{addEventListener(){}},ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,matchMedia:()=>({matches:true,addEventListener(){}}),setTimeout:()=>1,clearTimeout(){}};for(const[key,value]of Object.entries(replacements)){previous.set(key,globalThis[key]);globalThis[key]=value;}t.after(()=>{for(const[key,value]of previous)if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 let calls=0,finish;const submitted=new Promise(resolve=>{finish=resolve;});const cards=new Element();const ai={name:'林地野牛',kind:'other',collected:true,imageUrl:'/generated-images/00000000-0000-4000-8000-000000000001.jpg'},photo={name:'野猪',kind:'animal',imageUrl:'/plant-assets/1.jpg'};const view=createBookGuideView({stage:new Element(),svg:new Element(),cards,leaves:[],toggle:new Element(),status:new Element(),onLookup(){},onRegenerate:guide=>{calls++;assert.equal(guide,ai);return submitted;}});view.render({guides:[ai,photo],parts:[],key:'page-a'});const walk=root=>root.children.flatMap(child=>[child,...walk(child)]);const buttons=walk(cards).filter(child=>child.className==='book-guide-regenerate');assert.equal(buttons.length,1);const click=buttons[0].events.get('click');const pending=click();await click();assert.equal(calls,1);assert.equal(buttons[0].disabled,true);view.render({guides:[photo],parts:[],key:'page-b'});finish({status:'queued'});await pending;assert.equal(walk(cards).filter(child=>child.className==='book-guide-regenerate').length,0);assert.equal(photo.imageUrl,'/plant-assets/1.jpg');
});
