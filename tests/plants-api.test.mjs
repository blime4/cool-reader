import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { openStore } from '../lib/plants-store.mjs';
async function open(dir) {
  const server = await createServer({ dataDir: dir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {server, base, request: (route, method='GET', data, headers={}) => fetch(base+route,{method, headers:{...(data === undefined ? {} : {'Content-Type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)})};
}
const specimen={name:'银杏',scientificName:'Ginkgo biloba',family:'银杏科',genus:'银杏属',tags:['庭院'],sourceBook:'示例书',status:'想了解'};
test('CRUD persists across restarts, prevents duplicates, and merges backups',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'folio-plants-'));let app=await open(dir);
  try{
    let response=await app.request('/api/plants','POST',specimen); assert.equal(response.status,201);
    const {plant}=await response.json();assert.ok(plant.id);
    assert.equal((await app.request('/api/plants','POST',{...specimen,name:'别名'})).status,409);
    response=await app.request(`/api/plants/${plant.id}`,'PUT',{notes:'书里看见的树',status:'已认识'});assert.equal(response.status,200);
    const backupResponse=await app.request('/api/backup');
    assert.match(backupResponse.headers.get('content-disposition')??'',/attachment;.*filename="folio-plants-backup\.json";.*filename\*=UTF-8''/);
    const backup=await backupResponse.json();assert.equal(backup.plants[0].notes,'书里看见的树');
    await new Promise(resolve=>app.server.close(resolve));app=await open(dir);
    assert.equal((await(await app.request('/api/plants')).json()).plants.length,1);
    response=await app.request('/api/restore','POST',backup);assert.deepEqual(await response.json(),{imported:0,skipped:1});
    assert.equal((await app.request(`/api/plants/${plant.id}`,'DELETE')).status,200);
    response=await app.request('/api/restore','POST',backup);assert.deepEqual(await response.json(),{imported:1,skipped:0});
    assert.ok((await readFile(path.join(dir,'plants.json'),'utf8')).includes('银杏'));
  }finally{await new Promise(resolve=>app.server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test('rejects invalid inputs, unsafe hosts/origins, content types, and restore schemas',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'folio-plants-'));const app=await open(dir);
  try{
    assert.equal((await app.request('/api/plants','POST',{name:''})).status,400);
    assert.equal((await app.request('/api/plants','POST',{...specimen,sourceUrl:'javascript:alert(1)'})).status,400);
    assert.equal((await app.request('/api/plants','POST',specimen,{Origin:'https://evil.test'})).status,403);
    assert.equal((await app.request('/api/plants','POST',specimen,{'Content-Type':'text/plain'})).status,415);
    const hostStatus=await new Promise((resolve,reject)=>{const req=http.get(app.base+'/api/plants',{headers:{Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
    assert.equal(hostStatus,403);
    assert.equal((await app.request('/api/restore','POST',{version:2,plants:[]})).status,400);
    assert.equal((await app.request('/api/plants','POST',{...specimen,notes:'x'.repeat(2_100_000)})).status,413);
    assert.equal((await fetch(app.base+'/api/plants',{method:'POST',headers:{'Content-Type':'application/json'},body:'{oops'})).status,400);
    assert.equal((await app.request('/data/plants.json')).status,404);
  }finally{await new Promise(resolve=>app.server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test('corrupted database fails clearly and preserves the original',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'folio-plants-'));const file=path.join(dir,'plants.json');
  try{await writeFile(file,'{broken');await assert.rejects(createServer({dataDir:dir}),/损坏|corrupt/);assert.equal(await readFile(file,'utf8'),'{broken');}
  finally{await rm(dir,{recursive:true,force:true});}
});
test('concurrent writes retain every record and a rejected restore is atomic',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'folio-plants-'));const app=await open(dir);
  try{
    const responses=await Promise.all(Array.from({length:12},(_,index)=>app.request('/api/plants','POST',{name:`待核对植物 ${index}`})));
    assert.ok(responses.every(response=>response.status===201));
    const backup=await(await app.request('/api/backup')).json();assert.equal(backup.plants.length,12);
    assert.equal((await app.request('/api/restore','POST',{version:1,plants:[{...backup.plants[0],id:'new-id',name:'不应落盘'},{}]})).status,400);
    assert.equal((await(await app.request('/api/plants')).json()).plants.length,12);
    assert.equal((await app.request('/api/restore','POST',backup)).status,200);
    assert.ok((await readdir(dir)).some(name=>name.startsWith('plants-before-restore-')));
    assert.equal((await app.request('/api/plants','POST',{name:'坏照片',imageUrl:'https://127.0.0.1/private'})).status,400);
    assert.equal((await app.request('/api/plants','POST',{name:'坏标签',tags:'tree'})).status,400);
  }finally{await new Promise(resolve=>app.server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test('trusted bundled seed photos can be saved without network downloads',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'folio-plants-'));const app=await open(dir);
  try{
    const response=await app.request('/api/plants','POST',{...specimen,imageUrl:'/plant-assets/64350.jpg'});
    assert.equal(response.status,201);assert.equal((await response.json()).plant.imageUrl,'/plant-assets/64350.jpg');
    assert.equal((await app.request('/api/plants','POST',{name:'bad',imageUrl:'/plant-assets/../private.jpg'})).status,400);
  }finally{await new Promise(resolve=>app.server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test('valid backups above 2 MB restore, while above 20 MB leaves the store intact',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'folio-plants-'));const app=await open(dir);
  try{
    const plants=Array.from({length:190},(_,index)=>({name:`植物 ${index}`,id:`large-${index}`,notes:'a'.repeat(12000)}));
    const backup={version:1,plants};assert.ok(Buffer.byteLength(JSON.stringify(backup))>2*1024*1024);
    const response=await app.request('/api/restore','POST',backup);assert.equal(response.status,200);assert.equal((await response.json()).imported,190);
    assert.equal((await app.request('/api/restore','POST',{version:1,plants:Array.from({length:1900},(_,index)=>({...plants[0],name:`过大 ${index}`,id:`oversize-${index}`}))})).status,413);
    assert.equal((await(await app.request('/api/plants')).json()).plants.length,190);
  }finally{await new Promise(resolve=>app.server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test('every persistent mutation enforces the 20 MB serialized collection limit atomically',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'folio-plants-'));
  try{
    const store=await openStore(dir);await store.mutate(next=>next.push({id:'original',name:'原记录'}));
    const before=await readFile(path.join(dir,'plants.json'),'utf8');
    await assert.rejects(store.mutate(next=>{for(let index=0;index<1900;index++)next.push({id:`big-${index}`,name:`大记录 ${index}`,notes:'a'.repeat(12000)});}),/20 MB/);
    assert.equal(store.list().length,1);assert.equal(await readFile(path.join(dir,'plants.json'),'utf8'),before);
  }finally{await rm(dir,{recursive:true,force:true});}
});
