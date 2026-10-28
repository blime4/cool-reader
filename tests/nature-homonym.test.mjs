import test from 'node:test';import assert from 'node:assert/strict';import {searchPlantSources} from '../lib/plant-search.mjs';import {duplicate} from '../lib/plants-store.mjs';
test('cross-kingdom homonyms remain separate candidates and can both be collected',async()=>{
 const plant={id:'p',name:'同名',scientificName:'Prunella',kind:'plant',taxonId:'10',sourceUrl:'https://www.inaturalist.org/taxa/10'};
 const bird={id:'b',name:'同名',scientificName:'Prunella',kind:'bird',taxonId:'20',sourceUrl:'https://www.inaturalist.org/taxa/20'};
 const r=await searchPlantSources('homonym-regression',{kind:'all',cache:false,providers:{inat:async()=>[plant,bird]}});
 assert.equal(r.results.length,2);assert.equal(duplicate([plant],bird),false);assert.equal(duplicate([plant],{...plant,id:'new'}),true);
 assert.equal(duplicate([plant],{...plant,id:'new',taxonId:''}),true);
});
