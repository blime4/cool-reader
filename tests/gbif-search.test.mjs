import test from 'node:test';
import assert from 'node:assert/strict';
import {searchGBIF} from '../lib/gbif-search.mjs';
import {remoteSearch} from '../lib/plants-network.mjs';
import {searchPlantSources} from '../lib/plant-search.mjs';
import {validatePlant,openStore} from '../lib/plants-store.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('GBIF retains genuine Chinese names, bird evidence, higher ranks and distinct provider identifiers',async t=>{
  t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url.hostname,'api.gbif.org');assert.equal(url.pathname,'/v1/species/search');assert.ok(options.headers['User-Agent']);return Response.json({results:[
    {key:101,canonicalName:'Troglodytes troglodytes',rank:'SPECIES',kingdom:'Animalia',class:'Aves',vernacularNames:[{vernacularName:'鹪鹩',language:'zho'}]},
    {key:102,canonicalName:'Picidae',rank:'FAMILY',kingdom:'Animalia',class:'Aves',vernacularNames:[{vernacularName:'啄木鸟科',language:'zho'}]},
    {key:103,canonicalName:'Ginkgo biloba',rank:'SPECIES',kingdom:'Plantae',vernacularNames:[{vernacularName:'银杏',language:'zho'}]},
    {key:104,canonicalName:'Unverified',rank:'SPECIES'},
  ]});});
  const result=await searchGBIF('鹪鹩',{kind:'bird'});assert.equal(result.length,2);assert.equal(result[0].name,'鹪鹩');assert.equal(result[0].gbifKey,'101');assert.equal(result[0].taxonId,'');assert.equal(result[0].kind,'bird');assert.equal(result[0].imageUrl,'');assert.equal(result[1].taxonRank,'family');assert.match(result[1].matchNote,/科.*并非/);assert.ok(result[1].sourceUrl.endsWith('/102'));
});
test('GBIF broad results keep their actual name and never masquerade as the submitted Chinese query',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({results:[{key:101,canonicalName:'Hylorchilus',rank:'GENUS',kingdom:'Animalia',class:'Aves',vernacularNames:[{vernacularName:'细嘴鹪鹩属',language:'zho'}]}]}));
  const [result]=await searchGBIF('鹪鹩',{kind:'bird'});assert.equal(result.name,'细嘴鹪鹩属');assert.equal(result.matchType,'candidate');assert.match(result.matchNote,/核对/);
});
test('iNaturalist bird family results are retained and clearly marked as a group',async t=>{
  t.mock.method(globalThis,'fetch',async url=>{if(url.pathname!=='/v1/taxa/autocomplete')throw new Error('details offline');return Response.json({results:[{id:18952,name:'Picidae',rank:'family',preferred_common_name:'啄木鸟科',iconic_taxon_name:'Aves'}]});});
  const [result]=await remoteSearch('啄木鸟',{kind:'bird'});assert.equal(result.scientificName,'Picidae');assert.equal(result.taxonRank,'family');assert.match(result.matchNote,/科.*并非/);
});
test('verified offline aliases respect bird scope and bypass failed online sources',async()=>{
  const offline={name:'鹪鹩',scientificName:'Troglodytes troglodytes',kind:'bird',aliases:['欧洲鹪鹩'],sourceLabel:'离线自然名录',sourceUrl:'https://www.gbif.org/species/1',taxonRank:'species'};
  const providers={inat:()=>{throw new Error('must bypass');},gbif:()=>{throw new Error('must bypass');}};
  const result=await searchPlantSources('欧洲鹪鹩',{kind:'bird',localSeeds:[offline],providers,cache:false});assert.equal(result.results[0].scientificName,offline.scientificName);assert.equal(result.results[0].matchType,'alias');assert.equal(result.results[0].sourceLabel,offline.sourceLabel);
  const wrong=await searchPlantSources('欧洲鹪鹩',{kind:'plant',localSeeds:[offline],providers:{},cache:false});assert.equal(wrong.results.length,0);
});
test('GBIF timeouts retain successful sources and failures are not cached',async()=>{
  let count=0;const providers={inat:async()=>{count++;throw new DOMException('timeout','TimeoutError');},gbif:async()=>[{name:'鹪鹩',scientificName:'Troglodytes troglodytes',kind:'bird',sourceUrl:'https://www.gbif.org/species/1'}]};
  const result=await searchPlantSources('timeout-test-bird',{kind:'bird',providers});assert.equal(result.results.length,1);assert.ok(result.warning.includes('iNaturalist'));await searchPlantSources('timeout-test-bird',{kind:'bird',providers});assert.equal(count,2);
});
test('offline exact names beyond the first six partial matches win and offline broad names return immediately',async()=>{
  const partial=Array.from({length:8},(_,i)=>({name:`测试候选 ${i}`,scientificName:`Testus species${i}`,kind:'bird',aliases:[`鹪鹩候选 ${i}`],offline:true}));const exact={name:'鹪鹩',scientificName:'Troglodytes troglodytes',kind:'bird',offline:true,sourceLabel:'测试离线名录'};
  const providers={inat:()=>{throw new Error('offline should bypass');}};
  const result=await searchPlantSources('鹪鹩',{kind:'bird',localSeeds:[...partial,exact],providers,cache:false});assert.equal(result.results[0].name,'鹪鹩');
  const broad=await searchPlantSources('鹪鹩候选',{kind:'bird',localSeeds:partial,providers,cache:false});assert.equal(broad.results.length,6);assert.ok(!broad.sources.some(source=>source.name==='iNaturalist'));assert.match(broad.results[0].matchNote,/核对|确认/);
});
test('taxon rank survives card validation while invalid and oversized ranks reject',()=>{
  assert.equal(validatePlant({name:'啄木鸟科',kind:'bird',taxonRank:'family'}).taxonRank,'family');assert.equal(validatePlant({name:'鹪鹩'}).taxonRank,undefined);assert.throws(()=>validatePlant({name:'鹪鹩',taxonRank:'invented'}));assert.throws(()=>validatePlant({name:'鹪鹩',taxonRank:'x'.repeat(41)}));
});
test('saved family classification remains a family after reopening persistent storage',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'folio-rank-'));
  try{let store=await openStore(dir);await store.mutate(next=>next.push({...validatePlant({name:'啄木鸟科',scientificName:'Picidae',kind:'bird',taxonRank:'family'}),id:'test-family-card'}));store=await openStore(dir);assert.equal(store.list()[0].taxonRank,'family');assert.equal(store.list()[0].kind,'bird');}finally{await rm(dir,{recursive:true,force:true});}
});
test('merging other source evidence retains GBIF family rank and group caution',async()=>{
  const providers={wiki:async()=>[{name:'啄木鸟科',scientificName:'Picidae',kind:'bird',sourceUrl:'https://zh.wikipedia.org/wiki/啄木鸟科'}],gbif:async()=>[{name:'Picidae',scientificName:'Picidae',kind:'bird',taxonRank:'family',matchNote:'科级类群，并非一种物种。',sourceUrl:'https://www.gbif.org/species/9333'}]};
  const result=await searchPlantSources('merge-family-rank',{providers,kind:'bird',cache:false});assert.equal(result.results.length,1);assert.equal(result.results[0].taxonRank,'family');assert.match(result.results[0].matchNote,/科级类群.*并非/);
});
