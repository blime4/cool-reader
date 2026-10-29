import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from '../server.mjs';
test('moss, crow and golden-crowned kinglet queries return relevant sourced local JPEG references offline',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'folio-references-'));let server;const originalFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).startsWith('http://127.0.0.1:'))return originalFetch(url,options);throw new Error('Live providers must not be required for these offline cases');});
  try{
    server=await createServer({dataDir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    for(const query of ['苔藓','乌鸦','金冠戴菊鸟','槭叶荚迷','槭叶荚蒾']){
      const response=await fetch(`${base}/api/search?q=${encodeURIComponent(query)}&kind=all`);assert.equal(response.status,200);const data=await response.json();assert.ok(data.results.length>0&&data.results.length<=6);
      if(query==='苔藓'){assert.equal(data.results.length,6);assert.ok(data.results.every(item=>item.kind==='plant'));assert.equal(data.results[0].taxonRank,'phylum');assert.match(data.results[0].matchNote,/门级类群.*并非一种/);}
      if(query==='乌鸦'){assert.equal(data.results[0].scientificName,'Corvus');assert.match(data.results[0].imageAttribution,/代表图.*Corvus corone/);}
      if(query==='金冠戴菊鸟'){assert.equal(data.results[0].scientificName,'Regulus satrapa');assert.equal(data.results[0].matchType,'candidate');assert.match(data.results[0].matchNote,/并非已确认别名/);}
      if(query==='槭叶荚迷'){assert.equal(data.results[0].name,'槭叶荚蒾');assert.equal(data.results[0].scientificName,'Viburnum acerifolium');assert.equal(data.results[0].matchType,'candidate');assert.match(data.results[0].matchNote,/并非标准别名/);assert.ok(!data.results[0].aliases.includes('槭叶荚迷'));}
      for(const item of data.results){assert.match(item.imageUrl,/^\/plant-assets\/\d{1,15}\.jpg$/);assert.ok(item.imageAttribution&&item.sourceUrl);const picture=await fetch(base+item.imageUrl);assert.equal(picture.status,200);assert.match(picture.headers.get('content-type'),/^image\/jpeg/);const bytes=Buffer.from(await picture.arrayBuffer());assert.deepEqual(bytes.subarray(0,3),Buffer.from([255,216,255]));}
    }
    const page='这里有槭叶荚迷。';const reading=await fetch(base+'/api/reading-matches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:page})});assert.equal(reading.status,200);const {matches}=await reading.json();assert.equal(matches[0].literalName,'槭叶荚迷');assert.equal(page.slice(matches[0].offset,matches[0].offset+matches[0].length),'槭叶荚迷');assert.equal(matches[0].candidates[0].scientificName,'Viburnum acerifolium');assert.match(matches[0].candidates[0].readingNote,/并非标准别名/);
    const english=await fetch(base+'/api/reading-matches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'观察（maple-leaf viburnum）的叶片。'})});const englishMatches=(await english.json()).matches;assert.equal(englishMatches.length,1);assert.equal(englishMatches[0].literalName,'maple-leaf viburnum');assert.equal(englishMatches[0].candidates[0].scientificName,'Viburnum acerifolium');
    const moss=await fetch(base+'/api/reading-matches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'苔藓在这里。'})});const mossMatch=(await moss.json()).matches[0];assert.equal(mossMatch.candidates.length,3);assert.equal(mossMatch.candidates[0].readingRepresentative.literalName,'苔藓');assert.match(mossMatch.candidates[0].readingRepresentative.note,/不代表全部/);assert.equal(mossMatch.candidates.filter(item=>item.readingRepresentative).length,1);
    assert.equal((await fetch(base+'/api/reading-matches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'字'.repeat(10001)})})).status,400);
    assert.equal((await fetch(base+'/api/reading-matches',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body:JSON.stringify({text:page})})).status,403);
    assert.deepEqual(await readdir(dataDir),[]);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});}
});
