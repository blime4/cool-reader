import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from '../server.mjs';
test('HTTP background task survives UI absence, coalesces repeated encounters, and preserves edits while safely completing the same card',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'folio-background-api-'));await writeFile(path.join(dataDir,'image-worker.token'),'test-background-private-token');const jpeg=Buffer.from([255,216,255,224,1,2,3]);let generated=0,release=()=>{},reached;const generating=new Promise(resolve=>{reached=resolve;});
  const worker=http.createServer((req,res)=>{assert.equal(req.headers['x-folio-token'],'test-background-private-token');if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({app:'folio-qwen-image',ready:true}));}generated++;req.resume();release=()=>{if(res.writableEnded)return;res.writeHead(200,{'Content-Type':'image/jpeg'});res.end(jpeg);};reached();});await new Promise(resolve=>worker.listen(0,'127.0.0.1',resolve));let server;
  try{
    server=await createServer({dataDir,natureCatalogPath:path.join(dataDir,'missing.json'),imageGeneration:{enabled:true,port:worker.address().port}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    const request=(url,method='GET',input,headers={})=>fetch(base+url,{method,headers:{'Content-Type':'application/json',...headers},...(input?{body:JSON.stringify(input)}:{})});const context={bookId:'a'.repeat(40),pageId:'p1',chapterId:'c1',sourceBook:'公开测试书',quote:'第一处原文'};const input={plant:{name:'测试野牛',kind:'other',notes:'原笔记'},context,generate:true};
    assert.equal((await request('/api/collection-tasks','POST',input,{Origin:'https://evil.test'})).status,403);assert.equal((await request('/api/collection-tasks','POST',{...input,context:{...context,bookId:'../bad'}})).status,400);
    const started=await request('/api/collection-tasks','POST',input);assert.equal(started.status,202);const {task:first}=await started.json();assert.ok(first.plantId);await generating;
    const {task:second}=await(await request('/api/collection-tasks','POST',{...input,plantId:first.plantId,context:{...context,pageId:'p2',quote:'第二处原文'}})).json();assert.equal(second.id,first.id);assert.equal(generated,1);
    const before=(await(await request('/api/plants')).json()).plants[0];assert.match(before.notes,/第一处原文/);assert.match(before.notes,/第二处原文/);assert.equal((await request('/api/plants/'+first.plantId,'PUT',{notes:before.notes+'\n用户后来手写'})).status,200);
    // No browser or UI callback participates after the request is accepted.
    release();let done;
    for(let i=0;i<100;i++){done=(await(await request('/api/collection-tasks/'+first.id)).json()).task;if(!['queued','running'].includes(done.status))break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(done.status,'done');const plants=(await(await request('/api/plants')).json()).plants;assert.equal(plants.length,1);assert.equal(plants[0].id,first.plantId);assert.equal(plants[0].imageKind,'generated');assert.match(plants[0].notes,/用户后来手写/);assert.match(plants[0].notes,/第二处原文/);assert.deepEqual(Buffer.from(await(await request(plants[0].imageUrl)).arrayBuffer()),jpeg);assert.equal((await(await request('/api/collection-tasks')).json()).tasks.length,1);
    assert.equal((await request('/api/collection-tasks','POST',{plant:plants[0],plantId:first.plantId,context,generate:true,regenerate:'yes'})).status,400);assert.equal((await request('/api/collection-tasks/00000000-0000-4000-8000-000000000001')).status,404);
  }finally{release();if(server)await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>worker.close(resolve));await rm(dataDir,{recursive:true,force:true});}
});
