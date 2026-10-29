import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from '../server.mjs';
import {validatePlant} from '../lib/plants-store.mjs';
import {selectBookGuides} from '../dist/book-guides.mjs';
test('wrapped offline catalog serves group then genuine related species and scientific aliases without the network',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'folio-catalog-'));const file=path.join(dir,'catalog.json');let server;
  const records=[{name:'啄木鸟科',scientificName:'Picidae',kind:'bird',aliases:['啄木鸟'],taxonRank:'family',sourceLabel:'测试离线鸟类名录',matchNote:'科级类群，并非一种物种。'},{name:'大斑啄木鸟',scientificName:'Dendrocopos major',kind:'bird',taxonRank:'species'},{name:'鹪鹩',scientificName:'Nannus troglodytes',aliases:['Troglodytes troglodytes'],kind:'bird',taxonRank:'species'}];
  await writeFile(file,JSON.stringify({metadata:{source:'test fixture'},records}));const originalFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).startsWith('http://127.0.0.1:'))return originalFetch(url,options);throw new Error('test offline');});
  try{
    server=await createServer({dataDir:path.join(dir,'data'),natureCatalogPath:file});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
    let response=await fetch(base+'/api/search?q='+encodeURIComponent('啄木鸟')+'&kind=bird');let data=await response.json();assert.equal(data.results[0].scientificName,'Picidae');assert.equal(data.results[0].matchType,'alias');assert.match(data.results[0].matchNote,/科级类群/);assert.equal(data.results[1].scientificName,'Dendrocopos major');assert.equal(data.results[1].matchType,'candidate');
    response=await fetch(base+'/api/search?q=Troglodytes%20troglodytes&kind=bird');data=await response.json();assert.equal(data.results[0].scientificName,'Nannus troglodytes');assert.equal(data.results[0].matchType,'alias');
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test('Cornell HTTPS image host is accepted consistently without admitting subdomains, credentials, or custom ports',()=>{
  const imageUrl='https://birdnet.cornell.edu/example-licensed.jpg';
  assert.equal(validatePlant({name:'鹪鹩',kind:'bird',imageUrl}).imageUrl,imageUrl);
  assert.equal(selectBookGuides('鹪鹩出现了。',[{name:'鹪鹩',imageUrl,imageAttribution:'Fixture · CC BY'}],[])[0].imageUrl,imageUrl);
  for(const bad of ['https://birdnet.cornell.edu.evil.test/a.jpg','https://user:pass@birdnet.cornell.edu/a.jpg','https://birdnet.cornell.edu:444/a.jpg'])assert.throws(()=>validatePlant({name:'鹪鹩',imageUrl:bad}));
});
