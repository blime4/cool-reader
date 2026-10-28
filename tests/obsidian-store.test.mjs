import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,unlink,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openObsidianStore} from '../lib/obsidian-store.mjs';
import {createServer} from '../server.mjs';
async function fixture(){const base=await mkdtemp(path.join(os.tmpdir(),'folio-obsidian-'));const vault=path.join(base,'vault');const dataDir=path.join(base,'data');await mkdir(path.join(vault,'.obsidian'),{recursive:true});await mkdir(dataDir);return {base,vault,dataDir,options:{vault,folder:'FOLIO植物志',dataDir,staticDir:path.join(base,'dist')}};}
const plant=()=>({id:randomUUID(),name:'白蜡树',scientificName:'Fraxinus chinensis',notes:'第一条阅读笔记',tags:['阅读'],status:'想了解'});
test('migrates without modifying JSON, reloads Obsidian edits, and deletes recoverably',async()=>{
  const f=await fixture();const item=plant();const original=JSON.stringify({version:1,plants:[item]});await writeFile(path.join(f.dataDir,'plants.json'),original);
  try{
    let store=await openObsidianStore(f.options);assert.equal((await store.list()).length,1);
    const file=path.join(f.vault,'FOLIO植物志','卡片',item.id+'.md');let text=await readFile(file,'utf8');assert.ok(text.includes('## 阅读笔记'));
    text=text.replace('第一条阅读笔记','直接在 Obsidian 修改的笔记').replace('name: "白蜡树"','name: 白蜡树新名字');await writeFile(file,text);
    assert.equal((await store.list())[0].notes,'直接在 Obsidian 修改的笔记');assert.equal((await store.list())[0].name,'白蜡树新名字');
    store=await openObsidianStore(f.options);assert.equal((await store.list()).length,1);assert.equal(await readFile(path.join(f.dataDir,'plants.json'),'utf8'),original);
    await store.mutate(next=>{next[0].status='已认识';});assert.equal((await store.list())[0].notes,'直接在 Obsidian 修改的笔记');
    await store.mutate(next=>next.splice(0,1));assert.equal((await store.list()).length,0);assert.equal((await readdir(path.join(f.vault,'FOLIO植物志','已删除'))).length,1);
    store=await openObsidianStore(f.options);assert.equal((await store.list()).length,0);
  }finally{await rm(f.base,{recursive:true,force:true});}
});
test('copies local photos and preserves corrupt managed cards without silently erasing',async()=>{
  const f=await fixture();const item={...plant(),imageUrl:'/plant-assets/123.jpg'};await mkdir(path.join(f.options.staticDir,'plant-assets'),{recursive:true});await writeFile(path.join(f.options.staticDir,'plant-assets','123.jpg'),Buffer.from([255,216,255,224]));
  try{
    const store=await openObsidianStore(f.options);await store.mutate(next=>next.push(item));
    const file=path.join(f.vault,'FOLIO植物志','卡片',item.id+'.md');assert.ok((await readFile(file,'utf8')).includes('../附件/'));
    assert.equal((await readdir(path.join(f.vault,'FOLIO植物志','附件'))).length,1);
    await writeFile(file,'---\nfolioPlant: 1\nname: [broken\n---\n');await assert.rejects(store.list(),/损坏|格式/);assert.equal(await readFile(file,'utf8'),'---\nfolioPlant: 1\nname: [broken\n---\n');
  }finally{await rm(f.base,{recursive:true,force:true});}
});
test('rejects folder traversal and folders outside an Obsidian vault',async()=>{
  const f=await fixture();try{await assert.rejects(openObsidianStore({...f.options,folder:'../outside'}));await assert.rejects(openObsidianStore({...f.options,vault:f.dataDir}));}finally{await rm(f.base,{recursive:true,force:true});}
});
test('one-time migration never resurrects a card deleted directly in Obsidian',async()=>{
  const f=await fixture();const item=plant();await writeFile(path.join(f.dataDir,'plants.json'),JSON.stringify({version:1,plants:[item]}));
  try{await openObsidianStore(f.options);await unlink(path.join(f.vault,'FOLIO植物志','卡片',item.id+'.md'));const store=await openObsidianStore(f.options);assert.equal((await store.list()).length,0);}finally{await rm(f.base,{recursive:true,force:true});}
});
test('preserves indented Markdown notes across external edits and updates',async()=>{
  const f=await fixture();const item=plant();try{const store=await openObsidianStore(f.options);await store.mutate(next=>next.push(item));const file=path.join(f.vault,'FOLIO植物志','卡片',item.id+'.md');await writeFile(file,(await readFile(file,'utf8')).replace('第一条阅读笔记','    indented code\n\n## 子标题\n内容'));assert.equal((await store.list())[0].notes,'    indented code\n\n## 子标题\n内容');await store.mutate(next=>{next[0].status='已认识';});assert.equal((await store.list())[0].notes,'    indented code\n\n## 子标题\n内容');}finally{await rm(f.base,{recursive:true,force:true});}
});
test('refuses a managed directory replaced by a junction',async()=>{
  const f=await fixture();try{await mkdir(path.join(f.vault,'FOLIO植物志'));await symlink(f.dataDir,path.join(f.vault,'FOLIO植物志','卡片'),'junction');await assert.rejects(openObsidianStore(f.options),/符号链接/);}finally{await rm(f.base,{recursive:true,force:true});}
});
test('HTTP API exposes storage and reloads Markdown edits without restarting',async()=>{
  const f=await fixture();let server;
  try{
    server=await createServer({dataDir:f.dataDir,obsidianVault:f.vault,obsidianFolder:f.options.folder});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await(await fetch(base+'/api/health')).json()).app,'folio-plants');assert.equal((await(await fetch(base+'/api/storage')).json()).type,'obsidian');
    const response=await fetch(base+'/api/plants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'新卡片',notes:'网页笔记'})});assert.equal(response.status,201);const {plant}=await response.json();
    const file=path.join(f.vault,'FOLIO植物志','卡片',plant.id+'.md');await writeFile(file,(await readFile(file,'utf8')).replace('网页笔记','Obsidian 最新笔记'));
    assert.equal((await(await fetch(base+'/api/plants')).json()).plants[0].notes,'Obsidian 最新笔记');
    const notes='    indented code\n\n## 手写小节\n内容';
    const update=await fetch(base+'/api/plants/'+plant.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({notes})});assert.equal(update.status,200);assert.equal((await update.json()).plant.notes,notes);
    const status=await fetch(base+'/api/plants/'+plant.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'已认识'})});assert.equal(status.status,200);assert.equal((await status.json()).plant.notes,notes);
    assert.equal((await(await fetch(base+'/api/plants')).json()).plants[0].notes,notes);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await rm(f.base,{recursive:true,force:true});}
});
