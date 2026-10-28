import test from 'node:test';import assert from 'node:assert/strict';
import {inferKind,matchesKind} from '../lib/taxon-kind.mjs';
import {remoteSearch} from '../lib/plants-network.mjs';
import {validatePlant} from '../lib/plants-store.mjs';
test('taxonomy evidence separates plants, animals and birds without guessing by name',()=>{
 assert.equal(inferKind({iconic_taxon_name:'Aves'}),'bird');
 assert.equal(inferKind({ancestors:[{name:'Animalia',rank:'kingdom'},{name:'Mammalia',rank:'class'}]}),'animal');
 assert.equal(inferKind({iconic_taxon_name:'Plantae'}),'plant');
 assert.equal(inferKind({iconic_taxon_name:'Fungi'}),'other');
 assert.equal(inferKind({name:'鸟巢蕨'}),'other');
 assert.equal(matchesKind('bird','animal'),true);assert.equal(matchesKind('plant','animal'),false);
});
test('new categories persist while legacy cards remain plants',()=>{
 assert.equal(validatePlant({name:'喜鹊',kind:'bird'}).kind,'bird');
 assert.equal(validatePlant({name:'松鼠',kind:'animal'}).kind,'animal');
 assert.equal(validatePlant({name:'银杏'}).kind,'plant');
 assert.throws(()=>validatePlant({name:'?',kind:'invalid'}));
});
test('animal and bird searches use correct API taxon scopes and classify actual candidates',async t=>{
 const scopes=[];
 t.mock.method(globalThis,'fetch',async url=>{
 if(url.pathname!=='/v1/taxa/autocomplete')throw new Error('no details');
 scopes.push(url.searchParams.get('taxon_id'));
 return Response.json({results:[{id:99,name:'Pica pica',rank:'species',preferred_common_name:'喜鹊',iconic_taxon_name:'Aves'}]});
 });
 const birds=await remoteSearch('喜鹊',{kind:'bird'});assert.equal(birds[0].kind,'bird');
 await remoteSearch('喜鹊',{kind:'animal'});await remoteSearch('喜鹊',{kind:'all'});
 assert.deepEqual(scopes,['3','1',null]);
});
