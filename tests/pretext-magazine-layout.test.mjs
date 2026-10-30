import test from 'node:test';
import assert from 'node:assert/strict';

import {createMagazineLayouter,rankMagazineFigures} from '../dist/pretext-magazine-layout.mjs';

function fakePretext() {
  return {
    prepareWithSegments(text) { return {segments:[text],text}; },
    layoutNextLineRange(prepared,width,start={segmentIndex:0,graphemeIndex:0}) {
      const from = start.graphemeIndex;
      if (from >= prepared.text.length) return null;
      const hard = prepared.text.indexOf('\n',from);
      const capacity = Math.max(1,Math.floor(width/10));
      let to = Math.min(prepared.text.length,from+capacity);
      if (hard >= from && hard < to) to = hard+1;
      return {start:{segmentIndex:0,graphemeIndex:from},end:{segmentIndex:0,graphemeIndex:to},width:(to-from)*10};
    },
    materializeLineRange(prepared,range) { return {text:prepared.text.slice(range.start.graphemeIndex,range.end.graphemeIndex),...range}; },
  };
}

test('text narrows beside a figure and returns to the full leaf width below it', () => {
  const layouter = createMagazineLayouter({pretext:fakePretext()});
  const text = '白蜡树旁边有很多文字，需要自然地绕过图片，然后继续铺满整张书页。'.repeat(4);
  const result = layouter.layout({text,width:240,lineHeight:20,font:'16px "Microsoft YaHei"',side:'left',figures:[{name:'白蜡树',imageUrl:'/plant-assets/ash.jpg'}],figureWidth:100,figureHeight:60,gap:20});
  assert.equal(result.supported,true);
  assert.equal(result.figures.length,1);
  assert.ok(result.lines.some(line=>line.y < 60 && line.availableWidth===120));
  assert.ok(result.lines.some(line=>line.y >= 60 && line.availableWidth===240));
  assert.equal(result.lines.map(line=>line.text).join(''),text);
  assert.equal(result.lines.at(-1).sourceEnd,text.length);
});

test('hard breaks and source offsets remain stable while right-page text starts beside the opposite edge', () => {
  const layouter = createMagazineLayouter({pretext:fakePretext()});
  const text = '第一段白蜡树。\n第二段继续阅读。';
  const result = layouter.layout({text,width:200,lineHeight:24,font:'16px serif',side:'right',figures:[{name:'白蜡树',imageUrl:'/x.jpg'}],figureWidth:80,figureHeight:48,gap:16});
  assert.equal(result.lines.map(line=>line.text).join(''),text);
  assert.deepEqual(result.lines.map(line=>line.sourceStart),result.lines.map((_,index,array)=>index===0?0:array[index-1].sourceEnd));
  assert.ok(result.lines.filter(line=>line.y<48).every(line=>line.x===0));
  assert.equal(result.figures[0].x,120);
});

test('figure ranking is bounded and prefers real then referenced then generated images', () => {
  const guides = [
    {name:'AI',imageUrl:'/generated-images/a.jpg',imageKind:'generated'},
    {name:'参考',imageUrl:'/plant-assets/ref.jpg',imageKind:'reference'},
    {name:'实拍',imageUrl:'/plant-assets/real.jpg',imageKind:'photo'},
    {name:'无图'},
  ];
  assert.deepEqual(rankMagazineFigures(guides,2).map(item=>item.name),['实拍','参考']);
  assert.equal(rankMagazineFigures(guides,99).length,3);
  assert.equal(rankMagazineFigures(guides,0).length,0);
});

test('figure ranking keeps one canonical entry for shared photos and taxon identities', () => {
  const guides = [
    {name:'wood thrush',scientificName:'Hylocichla mustelina',imageUrl:'/plant-assets/thrush.jpg',imageKind:'reference'},
    {name:'棕林鸫',scientificName:'Hylocichla mustelina',imageUrl:'/plant-assets/thrush.jpg',imageKind:'photo'},
    {name:'棕林鸫别名',scientificName:'Hylocichla mustelina',imageUrl:'/plant-assets/thrush-alt.jpg',imageKind:'reference'},
    {name:'红眼莺雀',scientificName:'Vireo olivaceus',imageUrl:'/plant-assets/vireo.jpg',imageKind:'reference'},
  ];
  const ranked = rankMagazineFigures(guides,3);
  assert.deepEqual(ranked.map(item=>item.name),['棕林鸫','红眼莺雀']);
  assert.equal(new Set(ranked.map(item=>item.imageUrl)).size,ranked.length);
});

test('figure identities preserve case-sensitive paths and normalize scientific-name spacing', () => {
  const guides = [
    {name:'大写路径',imageUrl:'/Bird/A.jpg',imageKind:'photo'},
    {name:'小写路径',imageUrl:'/Bird/a.jpg',imageKind:'photo'},
    {name:'棕林鸫',scientificName:'Hylocichla  mustelina',imageUrl:'/birds/thrush-a.jpg',imageKind:'photo'},
    {name:'wood thrush',scientificName:' Hylocichla mustelina ',imageUrl:'/birds/thrush-b.jpg',imageKind:'reference'},
  ];
  assert.deepEqual(rankMagazineFigures(guides,3).map(item=>item.name),['大写路径','小写路径','棕林鸫']);
});

test('a taxon id on one alias still dedupes another alias carrying only the same scientific name', () => {
  const guides = [
    {name:'棕林鸫',taxonId:'15980',scientificName:'Hylocichla mustelina',imageUrl:'/birds/thrush-collected.jpg',imageKind:'photo'},
    {name:'wood thrush',scientificName:'Hylocichla mustelina',imageUrl:'/birds/thrush-seed.jpg',imageKind:'reference'},
  ];
  assert.deepEqual(rankMagazineFigures(guides,3).map(item=>item.name),['棕林鸫']);
});

test('unsupported Pretext runtime returns a plain-text fallback instead of partial layout', () => {
  const result = createMagazineLayouter({pretext:{}}).layout({text:'安全回退',width:200,lineHeight:24,font:'16px serif',figures:[]});
  assert.equal(result.supported,false);
  assert.equal(result.fallbackText,'安全回退');
  assert.deepEqual(result.lines,[]);
});
