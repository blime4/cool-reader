import test from 'node:test';
import assert from 'node:assert/strict';
import {queuePresentation,createGenerationQueueView} from '../dist/generation-queue-view.mjs';

test('queue reports real stages, keeps connection uncertainty, and never invents percentages',()=>{
 const result=queuePresentation([{id:'a',status:'queued',plant:{name:'林地野牛'}},{id:'b',status:'running',phase:'writing',plant:{name:'苔藓'}},{id:'c',status:'running',phase:'generating',connectionWarning:'暂时断开'}]);
 assert.equal(result.active,3);assert.equal(result.label,'正在生成 3');assert.deepEqual(result.rows.map(row=>row.stage),['排队中','正在写入收藏','连接暂不可用 · 任务可能仍在运行']);assert.ok(!JSON.stringify(result).includes('%'));
});
test('terminal states remain honest and active jobs appear before completed history',()=>{
 const result=queuePresentation([{id:'a',status:'done',reason:'image-present',plant:{name:'已有图'}},{id:'b',status:'failed',error:'模型未就绪',plant:{name:'无图'}},{id:'c',status:'running',plant:{name:'新任务'}}]);
 assert.equal(result.rows[0].name,'新任务');assert.equal(result.rows.find(row=>row.id==='a').stage,'已同步 · 保留已有图片');assert.equal(result.failed,1);assert.equal(result.rows.find(row=>row.id==='b').detail,'模型未就绪');
});
function setup(t){
 class Element {children=[];attrs={};events={};hidden=false;className='';id='queue';classList={toggle(){}};append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(k,v){this.attrs[k]=String(v);}addEventListener(k,fn){this.events[k]=fn;}contains(value){return value===this||this.children.some(item=>item.contains?.(value));}focus(){doc.activeElement=this;}}
 const doc={createElement:()=>new Element(),activeElement:null};const timers=new Map();let sequence=0;
 const previous=new Map();for(const [key,value]of Object.entries({document:doc,setTimeout:fn=>{timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id)})){previous.set(key,globalThis[key]);globalThis[key]=value;}t.after(()=>{for(const [key,value]of previous)if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 return {root:new Element(),timers,doc};
}
test('failed task offers explicit retry, prevents duplicate clicks and reports a failed retry without hiding the card',async t=>{const {root}=setup(t);let finish,calls=0;const view=createGenerationQueueView({root,onRetry:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});view.update([{id:'failed-one',status:'failed',retryable:true,plant:{name:'仍在收藏的名称'},error:'本地图像服务连接中断'}]);const row=root.children[1].children[1].children[0];const button=row.children.find(item=>item.tagName==='button'||item.textContent==='恢复服务后重试');assert.ok(button);const first=button.events.click();await button.events.click();assert.equal(calls,1);assert.equal(button.disabled,true);finish();await first;assert.equal(view.presentation.rows[0].name,'仍在收藏的名称');});
test('view expands accessibly, clears only terminal rows, and accepts further live updates',t=>{
 const {root}=setup(t);const view=createGenerationQueueView({root});view.update([{id:'a',status:'running',plant:{name:'<script>字面名称</script>'}},{id:'b',status:'done'}]);
 const [toggle,panel]=root.children;assert.equal(toggle.attrs['aria-expanded'],'false');toggle.events.click();assert.equal(panel.hidden,false);assert.equal(toggle.attrs['aria-expanded'],'true');
 const clear=panel.children[0].children[1];clear.events.click();assert.equal(view.presentation.rows.length,1);assert.equal(view.presentation.rows[0].name,'<script>字面名称</script>');
 view.update([{id:'a',status:'done',reason:'image-added'},{id:'b',status:'done'}]);assert.equal(view.presentation.rows.length,1);assert.equal(view.presentation.rows[0].stage,'配图已同步到收藏');
});
test('completion collapses after a short delay without dropping live jobs or stealing focus',t=>{
 const {root,timers,doc}=setup(t);const view=createGenerationQueueView({root});view.update([{id:'a',status:'running'}]);const [toggle,panel]=root.children;toggle.events.click();view.update([{id:'a',status:'done'}]);assert.equal(timers.size,1);doc.activeElement=panel.children[0].children[1];[...timers.values()][0]();assert.equal(panel.hidden,true);assert.equal(doc.activeElement,toggle);view.update([{id:'new',status:'queued'}]);assert.equal(view.presentation.active,1);
});
