import test from 'node:test';
import assert from 'node:assert/strict';
import {searchPlantSources,searchWikipedia} from '../lib/plant-search.mjs';
const plant={name:'合欢',scientificName:'Albizia julibrissin',sourceUrl:'https://www.inaturalist.org/taxa/47443',taxonId:'47443',tags:[]};
test('provider failures retain other results and do not cache temporary failures',async()=>{
  let count=0;const providers={inat:async()=>{count++;throw new Error('offline');},wiki:async()=>[{...plant,sourceUrl:'https://zh.wikipedia.org/wiki/合欢'}]};
  const first=await searchPlantSources('temporary-failure',{providers});assert.equal(first.results.length,1);assert.ok(first.warning.includes('iNaturalist'));assert.equal(first.sources.find(source=>source.name==='iNaturalist').status,'error');
  await searchPlantSources('temporary-failure',{providers});assert.equal(count,2);
});
test('dedupes botanical scientific names while preserving distinct candidates and provider URLs',async()=>{
  const providers={inat:async()=>[plant],wiki:async()=>[{...plant,name:'合欢树',scientificName:'albizia   julibrissin',sourceUrl:'https://zh.wikipedia.org/wiki/合欢'},{...plant,name:'山合欢',scientificName:'Albizia kalkora',sourceUrl:'https://zh.wikipedia.org/wiki/山合欢'}]};
  const result=await searchPlantSources('dedupe',{providers,cache:false});assert.equal(result.results.length,2);assert.equal(result.results[0].sourceUrls.length,2);assert.equal(result.results[0].sourceUrl,plant.sourceUrl);
});
test('successful nonempty searches cache but empty searches retry; exact curated seed is immediate',async()=>{
  let calls=0;const providers={inat:async()=>{calls++;return [plant];},wiki:async()=>[]};await searchPlantSources('cache-success',{providers});await searchPlantSources('cache-success',{providers});assert.equal(calls,1);
  const empty={inat:async()=>{calls++;return [];},wiki:async()=>[]};await searchPlantSources('cache-empty',{providers:empty});await searchPlantSources('cache-empty',{providers:empty});assert.equal(calls,3);
  const result=await searchPlantSources('合欢',{providers:{inat:()=>{throw new Error('must not call');},wiki:()=>{throw new Error('must not call');}},localSeeds:[plant]});assert.equal(result.results[0].name,'合欢');
});
test('Wikipedia needs a botanical Wikidata taxon and rejects disambiguations and animal identities',async t=>{
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.hostname==='zh.wikipedia.org')return Response.json({query:{pages:[{pageid:1,title:'合欢',extract:'合欢是豆科乔木。',pageprops:{wikibase_item:'Q1'}},{pageid:2,title:'合欢 (消歧义)',pageprops:{wikibase_item:'Q2',disambiguation:''}},{pageid:3,title:'动物',pageprops:{wikibase_item:'Q3'}}]}});
    assert.equal(url.hostname,'www.wikidata.org');return Response.json({entities:{Q1:{claims:{P225:[{mainsnak:{datavalue:{value:'Albizia julibrissin'}}}]},descriptions:{en:{value:'species of flowering plant'}}},Q3:{claims:{P225:[{mainsnak:{datavalue:{value:'Panthera leo'}}}]},descriptions:{en:{value:'species of mammal'}}}}});
  });
  const results=await searchWikipedia('合欢');assert.equal(results.length,1);assert.equal(results[0].scientificName,'Albizia julibrissin');assert.equal(results[0].imageUrl,'');assert.ok(results[0].sourceUrl.includes('wikipedia.org'));
});
