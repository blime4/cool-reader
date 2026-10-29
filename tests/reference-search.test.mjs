import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from '../server.mjs';
test('moss, crow and golden-crowned kinglet queries return relevant sourced local JPEG references offline',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'folio-references-'));let server;const originalFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).startsWith('http://127.0.0.1:'))return originalFetch(url,options);throw new Error('Live providers must not be required for these offline cases');});
  try{
    server=await createServer({dataDir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    for(const query of ['苔藓','乌鸦','金冠戴菊鸟']){
      const response=await fetch(`${base}/api/search?q=${encodeURIComponent(query)}&kind=all`);assert.equal(response.status,200);const data=await response.json();assert.ok(data.results.length>0&&data.results.length<=6);
      if(query==='苔藓'){assert.equal(data.results.length,6);assert.ok(data.results.every(item=>item.kind==='plant'));assert.equal(data.results[0].taxonRank,'phylum');assert.match(data.results[0].matchNote,/门级类群.*并非一种/);}
      if(query==='乌鸦'){assert.equal(data.results[0].scientificName,'Corvus');assert.match(data.results[0].imageAttribution,/代表图.*Corvus corone/);}
      if(query==='金冠戴菊鸟'){assert.equal(data.results[0].scientificName,'Regulus satrapa');assert.equal(data.results[0].matchType,'candidate');assert.match(data.results[0].matchNote,/并非已确认别名/);}
      for(const item of data.results){assert.match(item.imageUrl,/^\/plant-assets\/\d{1,15}\.jpg$/);assert.ok(item.imageAttribution&&item.sourceUrl);const picture=await fetch(base+item.imageUrl);assert.equal(picture.status,200);assert.match(picture.headers.get('content-type'),/^image\/jpeg/);const bytes=Buffer.from(await picture.arrayBuffer());assert.deepEqual(bytes.subarray(0,3),Buffer.from([255,216,255]));}
    }
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});}
});
