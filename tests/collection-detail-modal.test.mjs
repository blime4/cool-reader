import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionDetailModal} from '../dist/collection-detail-modal.mjs';
class Element{
  children=[];handlers={};dataset={};attrs={};value='';open=false;isConnected=true;
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  addEventListener(name,handler){this.handlers[name]=handler;}
  setAttribute(name,value){this.attrs[name]=String(value);}
  showModal(){this.open=true;}
  close(){this.open=false;this.handlers.close?.();}
  focus(){this.focused=true;}
}
function all(root){return [root,...root.children.flatMap(all)];}
function setup(t,{cards=[],save,load}={}){
  const previous=globalThis.document;globalThis.document={createElement:()=>new Element(),activeElement:new Element()};t.after(()=>{globalThis.document=previous;});
  const mount=new Element();let collection=cards;const calls=[],saved=[];const request=async(url,options={})=>{calls.push({url,options});if(!options.method||options.method==='GET')return load?load():Response.json({plants:collection});return save?save(url,options):Response.json({plant:{...JSON.parse(options.body),id:'saved',editVersion:'b'.repeat(64)}});};
  const modal=createCollectionDetailModal({mount,request,getCollection:()=>collection,onCollection:next=>{collection=next;},onSaved:value=>saved.push(value),createImage:()=>new Element()});
  return {mount,modal,calls,saved,collection:()=>collection,setCollection:next=>{collection=next;},field:name=>all(mount).find(node=>node.dataset.field===name),button:name=>all(mount).find(node=>node.dataset.action===name),dialog:()=>mount.children[0]};
}
const context={sourceBook:'示例自然笔记',chapter:'章节一',page:'重排第 2 页',bookId:'a'.repeat(40),chapterId:'ch1',pageId:'p2',quote:'示例原文片段。'};
const event={preventDefault(){}};
test('new detail modal prefills a safe candidate and frozen encounter, editable aliases/tags/notes save in place',async t=>{
  const f=setup(t);const source={...context};await f.modal.open({plant:{name:'陌生名称',kind:'bird',scientificName:'Example bird',imageUrl:'/plant-assets/1.jpg',aliases:['原别名']},context:source});source.quote='之后的选区';
  assert.equal(f.dialog().open,true);assert.equal(f.field('name').value,'陌生名称');assert.equal(f.field('kind').value,'bird');assert.equal(f.field('scientificName').value,'Example bird');assert.equal(f.field('aliases').value,'原别名');
  f.field('aliases').value='别名一，别名二\n别名一';f.field('tags').value='笔记,鸟类';f.field('notes').value='    保留缩进的笔记';
  await f.button('save-detail').handlers.click(event);const write=f.calls.find(call=>call.options.method==='POST');const payload=JSON.parse(write.options.body);
  assert.deepEqual(payload.aliases,['别名一','别名二']);assert.deepEqual(payload.tags,['笔记','鸟类']);assert.equal(payload.quote,context.quote);assert.equal(payload.imageUrl,'/plant-assets/1.jpg');assert.match(payload.notes,/^    保留缩进的笔记/);assert.ok(payload.notes.includes(context.quote));assert.equal(f.collection().length,1);assert.equal(f.dialog().open,false);
});
test('existing card loads fresh then conditional edit appends encounter while preserving photo and source metadata',async t=>{
  const card={id:'existing',name:'原收藏',kind:'plant',scientificName:'Example plant',notes:'原笔记',imageUrl:'/plant-assets/2.jpg',editVersion:'a'.repeat(64),family:'原科',sourceBook:'另外一本书',quote:'旧摘录'};const f=setup(t,{cards:[card]});
  await f.modal.open({plant:{...card,notes:'不应使用的旧缓存'},context});assert.equal(f.field('notes').value,'原笔记');f.field('name').value='修改名称';f.field('notes').value+='\n个人补记';await f.button('save-detail').handlers.click(event);
  const write=f.calls.find(call=>call.options.method==='PUT');assert.equal(write.url,'/api/plants/existing');assert.equal(write.options.headers['If-Match'],'"'+'a'.repeat(64)+'"');const payload=JSON.parse(write.options.body);assert.equal(payload.imageUrl,undefined);assert.equal(payload.family,undefined);assert.match(payload.notes,/原笔记\n个人补记/);assert.ok(payload.notes.includes(context.quote));assert.equal(payload.quote,undefined);
});
test('version conflict retains typed draft and requires explicit reload before retrying',async t=>{
  const card={id:'existing',name:'原收藏',kind:'other',notes:'原笔记',editVersion:'a'.repeat(64)};let attempts=0;const f=setup(t,{cards:[card],save:()=>{attempts++;return Response.json({error:'卡片已修改，请重新加载'},{status:409});}});await f.modal.open({plant:card,context});f.field('notes').value='本地未保存输入';await f.button('save-detail').handlers.click(event);
  assert.equal(f.dialog().open,true);assert.equal(f.field('notes').value,'本地未保存输入');assert.equal(f.button('save-detail').disabled,true);assert.match(all(f.mount).map(node=>node.textContent||'').join(' '),/修改.*重新加载/);assert.equal(attempts,1);
  f.setCollection([{...card,notes:'外部笔记',editVersion:'c'.repeat(64)}]);await f.button('reload-detail').handlers.click();assert.equal(f.field('notes').value,'外部笔记');assert.equal(f.button('save-detail').disabled,false);
});
test('closing without save writes nothing, and late load from a closed or replaced modal cannot overwrite fields',async t=>{
  const f=setup(t);await f.modal.open({plant:{name:'第一名称',kind:'other'},context});f.field('notes').value='不保存';f.modal.close();assert.equal(f.dialog().open,false);assert.equal(f.calls.filter(call=>call.options.method).length,0);
  await f.modal.open({plant:{name:'第二名称',kind:'plant'},context});assert.equal(f.field('name').value,'第二名称');assert.equal(f.field('notes').value.includes('不保存'),false);
});
test('loading failure and missing existing card disable saving rather than silently creating a duplicate',async t=>{
  const f=setup(t);await f.modal.open({plant:{id:'deleted',name:'已移除'},context});assert.equal(f.button('save-detail').disabled,true);assert.match(all(f.mount).map(node=>node.textContent||'').join(' '),/删除|不存在|移除/);assert.equal(f.calls.filter(call=>call.options.method).length,0);
});
test('late GET from an earlier modal session cannot replace the new form and a read failure remains retryable',async t=>{
  let resolveFirst,count=0;const f=setup(t,{load:()=>++count===1?new Promise(resolve=>{resolveFirst=resolve;}):Response.json({plants:[]})});
  const old=f.modal.open({plant:{name:'旧名称'},context});await f.modal.open({plant:{name:'新名称',kind:'other'},context});resolveFirst(Response.json({plants:[{name:'旧名称',id:'old',editVersion:'a'.repeat(64)}]}));await old;assert.equal(f.field('name').value,'新名称');
  const failure=setup(t,{load:()=>{throw Error('网络暂不可用');}});await failure.modal.open({plant:{name:'未读名称'},context});assert.equal(failure.button('save-detail').disabled,true);assert.equal(failure.button('reload-detail').hidden,false);assert.match(all(failure.mount).map(item=>item.textContent||'').join(' '),/网络暂不可用/);
});
test('repeated save and Enter submission send one write, while closing a pending load sends none',async t=>{
  let finish;const f=setup(t,{save:(url,options)=>new Promise(resolve=>{finish=()=>resolve(Response.json({plant:{...JSON.parse(options.body),id:'one'}}));})});await f.modal.open({plant:{name:'单次收藏',kind:'other'},context});const save=f.button('save-detail');const first=save.handlers.click(event);await f.dialog().children[0].handlers.submit(event);assert.equal(f.calls.filter(call=>call.options.method==='POST').length,1);finish();await first;assert.equal(f.saved.length,1);
  let finishLoad;const closing=setup(t,{load:()=>new Promise(resolve=>{finishLoad=resolve;})});const opening=closing.modal.open({plant:{name:'关闭名称'},context});closing.modal.close();finishLoad(Response.json({plants:[]}));await opening;assert.equal(closing.dialog().open,false);assert.equal(closing.calls.filter(call=>call.options.method).length,0);
});
test('markup-like notes and names stay text, and invalid alias counts never reach the server',async t=>{
  const f=setup(t);await f.modal.open({plant:{name:'<img src=x>',kind:'other'},context});assert.equal(f.field('name').value,'<img src=x>');f.field('aliases').value=Array.from({length:31},(_,index)=>'别名'+index).join(',');await f.button('save-detail').handlers.click(event);assert.equal(f.calls.filter(call=>call.options.method).length,0);assert.equal(f.dialog().open,true);
});
