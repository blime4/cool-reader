import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePlant} from '../lib/plants-store.mjs';
test('card source labels and secondary references survive validation for Obsidian roundtrip',()=>{
 const card=validatePlant({name:'合欢',sourceUrl:'https://www.inaturalist.org/taxa/47443',sourceLabel:'iNaturalist / 维基百科',sourceUrls:['https://zh.wikipedia.org/wiki/合欢']});
 assert.equal(card.sourceLabel,'iNaturalist / 维基百科');assert.equal(card.sourceUrls.length,1);
 assert.throws(()=>validatePlant({name:'合欢',sourceUrls:['javascript:alert(1)']}));
});
