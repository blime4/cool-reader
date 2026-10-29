import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from '../server.mjs';

test('detailed edits use a content version that detects external Obsidian notes even without a timestamp change',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'folio-detail-'));const vault=path.join(dir,'vault');await mkdir(path.join(vault,'.obsidian'),{recursive:true});
  const app=await createServer({dataDir:path.join(dir,'data'),obsidianVault:vault});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
  const request=(route,method='GET',input,headers={})=>fetch(base+route,{method,headers:{'Content-Type':'application/json',...headers},...(input?{body:JSON.stringify(input)}:{})});
  try{
    const created=await(await request('/api/plants','POST',{name:'测试物种',notes:'原始笔记',aliases:['测试别名'],kind:'other'})).json();
    assert.match(created.plant.editVersion??'',/^[a-f0-9]{64}$/);
    assert.deepEqual(created.plant.aliases,['测试别名']);
    const original=(await(await request('/api/plants')).json()).plants[0];const cards=path.join(vault,'FOLIO植物志','卡片');const file=path.join(cards,(await readdir(cards)).find(name=>name.endsWith('.md')));
    await writeFile(file,(await readFile(file,'utf8')).replace('原始笔记','外部编辑，时间戳未改'));
    const stale=await request('/api/plants/'+original.id,'PUT',{notes:'旧表单笔记',aliases:['新别名']},{'If-Match':`"${original.editVersion}"`});assert.equal(stale.status,409);
    assert.match((await stale.json()).error,/修改|版本/);
    const latest=(await(await request('/api/plants')).json()).plants[0];assert.equal(latest.notes,'外部编辑，时间戳未改');assert.notEqual(latest.editVersion,original.editVersion);
    const saved=await request('/api/plants/'+original.id,'PUT',{notes:latest.notes+'\n补充',aliases:['新别名']},{'If-Match':`"${latest.editVersion}"`});assert.equal(saved.status,200);assert.deepEqual((await saved.json()).plant.aliases,['新别名']);
    assert.match(await readFile(file,'utf8'),/外部编辑，时间戳未改/);assert.doesNotMatch(await readFile(file,'utf8'),/editVersion:/);
    assert.equal((await request('/api/plants/'+original.id,'PUT',{notes:'坏版本'},{'If-Match':'invalid'})).status,400);
    assert.equal((await request('/api/plants','POST',{name:'坏别名',aliases:['x'.repeat(121)]})).status,400);
  }finally{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});}
});
