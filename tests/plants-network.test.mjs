import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {cacheImage,remoteSearch,imageType} from '../lib/plants-network.mjs';
test('image caching is allowlisted, validates bytes, and preserves attribution URL on failure',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'folio-images-'));let calls=0;
  const bytes=Buffer.from([255,216,255,224,0,0,0,0]);
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(bytes,{headers:{'Content-Type':'image/jpeg'}});});
  try{
    const blocked=await cacheImage('https://127.0.0.1/private',dir);assert.equal(calls,0);assert.equal(blocked.imageUrl,'');
    const cached=await cacheImage('https://static.inaturalist.org/photos/1/medium.jpg',dir);
    assert.match(cached.imageUrl,/^\/plant-images\/[0-9a-f-]{36}\.jpg$/);
    assert.deepEqual(await readFile(path.join(dir,'images',path.basename(cached.imageUrl))),bytes);
    assert.equal(imageType(bytes),'image/jpeg');
    globalThis.fetch.mock.mockImplementation(async()=>new Response('<script>bad</script>',{headers:{'Content-Type':'image/jpeg'}}));
    const rejected=await cacheImage('https://static.inaturalist.org/photos/2/medium.jpg',dir);assert.ok(rejected.warning);assert.ok(rejected.imageUrl.startsWith('https:'));
    globalThis.fetch.mock.mockImplementation(async()=>new Response(bytes,{headers:{'Content-Type':'image/jpeg','Content-Length':'9000000'}}));
    assert.ok((await cacheImage('https://static.inaturalist.org/photos/3/medium.jpg',dir)).warning);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('remote results preserve real taxa, exclude broad ranks, and rank exact name matches',async t=>{
  t.mock.method(globalThis,'fetch',async url=>{if(url.pathname!=='/v1/taxa/autocomplete')throw new Error('optional details unavailable');return Response.json({results:[
    {id:1,name:'Plantae',rank:'kingdom'},
    {id:2,name:'Other species',rank:'species',preferred_common_name:'其他'},
    {id:64350,name:'Ginkgo biloba',rank:'species',preferred_common_name:'银杏',matched_term:'银杏',ancestors:[{rank:'family',name:'Ginkgoaceae'},{rank:'genus',name:'Ginkgo'}],default_photo:{medium_url:'https://static.inaturalist.org/photos/1/medium.jpg',attribution:'Author / CC BY',license_code:'cc-by'}},
  ]});});
  const results=await remoteSearch('银杏');assert.equal(results.length,2);assert.equal(results[0].taxonId,'64350');assert.equal(results[0].family,'Ginkgoaceae');assert.equal(results[0].genus,'Ginkgo');assert.equal(results[0].imageAttribution,'Author / CC BY');
});
test('restricted or unrecognized photo licenses produce placeholders while recognized licenses retain attribution',async t=>{
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.pathname!=='/v1/taxa/autocomplete')throw new Error('no optional details');
    return Response.json({results:[null,'all-rights-reserved','unknown','cc0','cc-by-sa'].map((license,index)=>({id:100+index,name:`Species ${index}`,rank:'species',default_photo:{license_code:license,medium_url:`https://static.inaturalist.org/photos/${index}/medium.jpg`,attribution:`Photographer ${index}`}}))});
  });
  const plants=await remoteSearch('Species');
  for(const plant of plants.slice(0,3))assert.equal(plant.imageUrl,'');
  for(const plant of plants.slice(3)){assert.ok(plant.imageUrl.startsWith('https://static.inaturalist.org/'));assert.ok(plant.imageAttribution.startsWith('Photographer'));}
});
test('batched taxon details fill ancestry and convert sourced summaries into bounded plain text',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async url=>{
    calls.push(url.pathname);
    if(url.pathname==='/v1/taxa/autocomplete')return Response.json({results:[{id:64350,name:'Ginkgo biloba',rank:'species',preferred_common_name:'银杏'}]});
    assert.equal(url.pathname,'/v1/taxa/64350');assert.equal(url.searchParams.get('locale'),'zh-CN');
    return Response.json({results:[{id:64350,ancestors:[{rank:'family',name:'Ginkgoaceae'},{rank:'genus',name:'Ginkgo'}],wikipedia_summary:'<p>银杏是 <b>落叶乔木</b> &amp; 裸子植物。</p><script>bad()</script>'+'描述'.repeat(4000)}]});
  });
  const [plant]=await remoteSearch('银杏');assert.equal(calls.length,2);assert.equal(plant.family,'Ginkgoaceae');assert.equal(plant.genus,'Ginkgo');
  assert.ok(plant.description.includes('落叶乔木 & 裸子植物'));assert.ok(!plant.description.includes('<'));assert.ok(!plant.description.includes('bad()'));assert.ok(plant.description.length<=6000);
});
test('verified 合欢树 alias retries 合欢 and scientific name only after exact query misses',async t=>{
  const queries=[];
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.pathname!=='/v1/taxa/autocomplete')throw new Error('details unavailable');
    const query=url.searchParams.get('q');queries.push(query);
    return Response.json({results:query==='Albizia julibrissin'?[{id:47443,name:'Albizia julibrissin',rank:'species',preferred_common_name:'合欢'}]:[]});
  });
  const result=await remoteSearch('合欢树');assert.deepEqual(queries,['合欢树','合欢','Albizia julibrissin']);assert.equal(result[0].scientificName,'Albizia julibrissin');assert.equal(result[0].matchType,'alias');
});
test('a valid exact query is never replaced by suffix stripping or alias identity',async t=>{
  const queries=[];t.mock.method(globalThis,'fetch',async url=>{if(url.pathname!=='/v1/taxa/autocomplete')throw new Error('no details');queries.push(url.searchParams.get('q'));return Response.json({results:[]});});
  assert.deepEqual(await remoteSearch('铁树'),[]);assert.deepEqual(queries,['铁树']);
});
test('long Chinese tree names retry a broad name fragment with an explicit species-confirmation caution',async t=>{
  const queries=[];
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.pathname!=='/v1/taxa/autocomplete')throw new Error('details unavailable');
    const query=url.searchParams.get('q');queries.push(query);
    return Response.json({results:query==='冬青'?[{id:123,name:'Ilex chinensis',rank:'species',preferred_common_name:'冬青'}]:[]});
  });
  const [plant]=await remoteSearch('冬青树');assert.deepEqual(queries,['冬青树','冬青']);assert.equal(plant.name,'冬青');assert.equal(plant.matchType,'broader-candidate');assert.match(plant.matchNote,/名称片段「冬青」/);assert.match(plant.matchNote,/并非已确认别名/);
});
test('exact Chinese tree-name results suppress broader name-fragment lookup',async t=>{
  const queries=[];
  t.mock.method(globalThis,'fetch',async url=>{if(url.pathname!=='/v1/taxa/autocomplete')throw new Error('no details');queries.push(url.searchParams.get('q'));return Response.json({results:[{id:123,name:'Ilex chinensis',rank:'species',preferred_common_name:'冬青树'}]});});
  const [plant]=await remoteSearch('冬青树');assert.deepEqual(queries,['冬青树']);assert.equal(plant.matchType,'exact');assert.equal(plant.matchNote,undefined);
});
test('autocomplete distractions never inherit an exact or alias claim from the query',async t=>{
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.pathname!=='/v1/taxa/autocomplete')throw new Error('no details');
    const q=url.searchParams.get('q');return Response.json({results:q==='合欢树'?[]:q==='合欢'?[{id:47443,name:'Albizia julibrissin',rank:'species',preferred_common_name:'合欢'},{id:99,name:'Acacia',rank:'genus',preferred_common_name:'相思树属',matched_term:'相思树属'}]:[{id:99,name:'Other species',rank:'species',preferred_common_name:'无关植物'}]});
  });
  const [fuzzy]=await remoteSearch('某种俗名');assert.equal(fuzzy.matchType,'candidate');assert.match(fuzzy.matchNote,/核对/);
  const alias=await remoteSearch('合欢树');assert.equal(alias.find(plant=>plant.scientificName==='Albizia julibrissin').matchType,'alias');assert.equal(alias.find(plant=>plant.scientificName==='Acacia').matchType,'candidate');
});
test('broader name fragments are not attempted when the exact provider request fails',async t=>{
  const queries=[];t.mock.method(globalThis,'fetch',async url=>{queries.push(url.searchParams.get('q'));throw new Error('offline');});
  await assert.rejects(remoteSearch('冬青树'),/offline/);assert.deepEqual(queries,['冬青树']);
});
