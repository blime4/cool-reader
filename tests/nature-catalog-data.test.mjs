import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validatePlant} from '../lib/plants-store.mjs';
test('pinned offline taxonomy contains real species and groups with validated identifiers and licensed photos',async()=>{
  const catalog=JSON.parse(await readFile(new URL('../dist/nature-catalog.json',import.meta.url),'utf8'));
  assert.equal(catalog.metadata.version,'v0.4-Oct2026');assert.equal(catalog.metadata.sourceSha256,'DAECB2505FF16DDDBAFE76CFA8D15A044C506B6A2998B2349A94BCD355475AC4');assert.equal(catalog.metadata.sourceCsvUrl,'https://birdnet.cornell.edu/taxonomy/api/download/csv');assert.equal(catalog.metadata.speciesCount,16528);assert.ok(catalog.metadata.snapshotDate);assert.equal(catalog.records.length,catalog.metadata.recordCount);
  for(const record of catalog.records){assert.ok(typeof record.name==='string'&&record.name.length>0);assert.ok(record.scientificName&&record.taxonRank);assert.ok(Array.isArray(record.aliases));assert.ok(record.aliases.every(alias=>typeof alias==='string'&&alias.length>0));assert.ok(record.offline);const validated=validatePlant(record);assert.equal(validated.kind,record.kind);if(record.imageUrl){assert.ok(record.imageAttribution);assert.match(record.imageLicense,/^(?:cc0|pd|cc-by(?:-nc)?(?:-sa)?)(?:[- ]\d+(?:\.\d+)?)?$/);}}
  const wren=catalog.records.find(record=>record.scientificName==='Nannus troglodytes');assert.equal(wren.name,'鹪鹩');assert.ok(wren.aliases.includes('Troglodytes troglodytes'));assert.equal(wren.imageUrl,'/plant-assets/900000001.jpg');assert.equal(wren.kind,'bird');
  const woodpecker=catalog.records.find(record=>record.scientificName==='Dendrocopos major');assert.equal(woodpecker.imageUrl,'/plant-assets/900000002.jpg');assert.ok(catalog.records.some(record=>record.scientificName==='Picidae'&&record.taxonRank==='family'));assert.ok(!catalog.records.some(record=>['Rain','Engine'].includes(record.scientificName)));
});
test('licensed Avicommons substitutes for restricted primary photos without manufacturing missing pictures',async()=>{
  const catalog=JSON.parse(await readFile(new URL('../dist/nature-catalog.json',import.meta.url),'utf8'));const downy=catalog.records.find(record=>record.scientificName==='Dryobates pubescens');
  assert.ok(downy.imageUrl.startsWith('https://static.avicommons.org/')||/^\/plant-assets\/\d+\.jpg$/.test(downy.imageUrl));assert.match(downy.imageAttribution,/Jon Cefus/);assert.match(downy.imageLicense,/^cc-by-nc-sa-3\.0$/);assert.ok(downy.sourceUrl.startsWith('https://birdnet.cornell.edu/taxonomy/species/'));
  assert.ok(catalog.metadata.fallbackPhotoCount>0);assert.ok(catalog.metadata.missingPhotoCount>0);assert.match(catalog.metadata.photoManifestSha256,/^[A-Fa-f0-9]{64}$/);
  const restricted=catalog.records.find(record=>record.scientificName==='Acrocephalus brevipennis');assert.equal(restricted.imageUrl,'');assert.equal(restricted.imageAttribution,'');
});
