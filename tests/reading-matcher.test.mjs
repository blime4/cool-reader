import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNameMatcher} from '../lib/reading-matcher.mjs';
import {searchPlantSources} from '../lib/plant-search.mjs';
const record={name:'槭叶荚蒾',scientificName:'Viburnum acerifolium',kind:'plant',aliases:['Mapleleaf viburnum'],readingTerms:['槭叶荚迷'],readingNote:'原文用字“迷”可能对应“蒾”，仅为待核对线索，并非标准别名。',imageUrl:'/plant-assets/999000003.jpg',sourceUrl:'https://www.inaturalist.org/taxa/62997',offline:true};
test('recorded source spelling is matched literally without rewriting it or claiming an official alias',()=>{
  const match=buildNameMatcher([record]);const text='这里有槭叶荚迷，还有槭叶荚迷。';const [result]=match(text);assert.equal(result.literalName,'槭叶荚迷');assert.equal(result.offset,3);assert.equal(result.count,2);assert.equal(text.slice(result.offset,result.offset+result.length),'槭叶荚迷');assert.equal(result.candidates[0].name,'槭叶荚蒾');assert.equal(result.candidates[0].matchType,'candidate');assert.match(result.candidates[0].matchNote,/并非标准别名/);assert.equal(result.candidates[0].imageUrl,record.imageUrl);
});
test('canonical names, real aliases, homonyms and English word boundaries stay distinct',()=>{
  const matcher=buildNameMatcher([record,{name:'杜鹃',scientificName:'Cuculus canorus',kind:'bird'},{name:'杜鹃',scientificName:'Rhododendron simsii',kind:'plant'}]);assert.equal(matcher('槭叶荚蒾。')[0].candidates[0].matchType,'exact');assert.equal(matcher('Mapleleaf viburnum。')[0].candidates[0].matchType,'alias');assert.equal(matcher('xMapleleaf viburnums。').length,0);assert.equal(matcher('杜鹃出现。')[0].candidates.length,2);
});
test('recognition keeps longest literal words, ignores malicious terms and bounds page input',()=>{
  const matcher=buildNameMatcher([record,{name:'荚迷',scientificName:'Unconfirmed',kind:'other'},{name:'<img onerror=x>',kind:'other'}]);assert.equal(matcher('槭叶荚迷。')[0].literalName,'槭叶荚迷');assert.equal(matcher('<img onerror=x>').length,0);assert.throws(()=>matcher('字'.repeat(10001)),/页|长/);
});
test('search for observed reading spelling yields the reliable candidate and explicitly flags the spelling issue',async()=>{
  const result=await searchPlantSources('槭叶荚迷',{kind:'all',localSeeds:[record],providers:{},cache:false});assert.equal(result.results[0].scientificName,'Viburnum acerifolium');assert.equal(result.results[0].matchType,'candidate');assert.match(result.results[0].matchNote,/并非标准别名/);
});
test('sourced full English viburnum names suppress the shorter maple hit',()=>{
  const matcher=buildNameMatcher([{...record,aliases:['maple-leaf viburnum','mapleleaf viburnum','maple leaf viburnum']},{name:'枫树',scientificName:'Acer',kind:'plant',aliases:['maple']}]);
  for(const name of ['maple-leaf viburnum','mapleleaf viburnum','maple leaf viburnum']){const result=matcher(`观察（${name}）的叶片。`);assert.equal(result.length,1);assert.equal(result[0].literalName,name);assert.equal(result[0].candidates[0].scientificName,'Viburnum acerifolium');assert.ok(!result.some(match=>match.literalName==='maple'));}
});
test('explicit broad-group representative is preserved without dropping other moss candidates',()=>{
  const reference={literalName:'苔藓',name:'灰藓',scientificName:'Hypnum cupressiforme',note:'类群参考，不代表全部苔藓。'};
  const matcher=buildNameMatcher([{name:'地钱门',scientificName:'Marchantiophyta',kind:'plant',taxonRank:'phylum',readingTerms:['苔藓'],imageUrl:'/plant-assets/999000004.jpg'},{name:'真藓门',scientificName:'Bryophyta',kind:'plant',taxonRank:'phylum',readingTerms:['苔藓'],imageUrl:'/plant-assets/999000005.jpg',readingRepresentative:reference}]);
  const [result]=matcher('苔藓在这里。');assert.equal(result.candidates.length,2);assert.equal(result.candidates[0].scientificName,'Bryophyta');assert.deepEqual(result.candidates[0].readingRepresentative,reference);assert.equal(result.candidates[0].matchType,'candidate');
});
test('representative flags never cross kingdom boundaries of homonymous names',()=>{
  const matcher=buildNameMatcher([{name:'杜鹃',scientificName:'Rhododendron',kind:'plant',taxonRank:'genus',imageUrl:'/plant-assets/999000006.jpg',readingRepresentative:{literalName:'杜鹃',name:'杜鹃花',scientificName:'Rhododendron simsii',note:'代表图'}},{name:'杜鹃',scientificName:'Cuculus',kind:'bird',taxonRank:'genus'}]);
  const [result]=matcher('杜鹃在这里。');assert.equal(result.candidates.length,2);assert.ok(result.candidates.every(candidate=>!candidate.readingRepresentative));
});
