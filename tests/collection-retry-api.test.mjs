import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from '../server.mjs';
test('guarded retry API recovers the fixed worker without replaying a card or its saved encounter',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'folio-retry-api-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));await writeFile(path.join(dataDir,'image-worker.token'),'private-token');let ready=false;
  const worker=http.createServer((req,res)=>{req.resume();if(req.url==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'folio-qwen-image',ready}));}else{res.setHeader('Content-Type','image/jpeg');res.end(Buffer.from([255,216,255,224,0,1]));}});await new Promise(resolve=>worker.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>worker.close(resolve)));
  const server=await createServer({dataDir,natureCatalogPath:path.join(dataDir,'missing.json'),imageGeneration:{enabled:true,port:worker.address().port}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,input={},extra={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(input)});const get=async route=>(await fetch(base+route)).json();
  async function done(id){for(let i=0;i<100;i++){const {task}=await get('/api/collection-tasks/'+id);if(!['running','queued'].includes(task.status))return task;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('timeout');}
  const initial=(await(await post('/api/collection-tasks',{plant:{name:'断线恢复测试',kind:'other',notes:'原有笔记'},context:{sourceBook:'测试书籍',quote:'本次唯一摘录'}})).json()).task;const failed=await done(initial.id);assert.equal(failed.status,'failed');assert.equal(failed.retryable,true);const notes=(await get('/api/plants')).plants[0].notes;
  const route='/api/collection-tasks/'+failed.id+'/retry';assert.equal((await post(route,{}, {Origin:'https://evil.test'})).status,403);assert.equal((await post(route,{plant:{name:'不得重写'}})).status,400);
  ready=true;const response=await post(route);assert.equal(response.status,202);const retry=(await response.json()).task;assert.equal((await done(retry.id)).status,'done');const cards=(await get('/api/plants')).plants;assert.equal(cards.length,1);assert.equal(cards[0].id,failed.plantId);assert.equal(cards[0].notes,notes);assert.match(cards[0].imageUrl,/^\/generated-images\//);
});
