// Refresh only these sourced public reference records; never reads a vault or book.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=path.join(project,'dist','plant-assets');
const manifestFile=path.join(assets,'nature-photo-credits.json');
const groupsFile=path.join(project,'dist','nature-groups.json');
const catalog=JSON.parse(await readFile(path.join(project,'dist','nature-catalog.json'),'utf8'));
const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
const groups=JSON.parse(await readFile(groupsFile,'utf8'));
const allowedLicense=value=>/^(?:cc0|pd|cc-by(?:-nc)?(?:-sa)?)(?:[- ]\d+(?:\.\d+)?)?$/.test(String(value??'').trim().toLowerCase());
const allowedHosts=new Set(['static.inaturalist.org','inaturalist-open-data.s3.amazonaws.com','static.avicommons.org','birdnet.cornell.edu']);
async function get(url,binary=false){
  const target=new URL(url);if(target.protocol!=='https:'||target.username||target.password||target.port||!allowedHosts.has(target.hostname)&&target.hostname!=='api.inaturalist.org')throw new Error('Unsupported reference URL');
  let last;for(let attempt=0;attempt<3;attempt++){
    try{const response=await fetch(target,{signal:AbortSignal.timeout(12000),redirect:'error'});if(!response.ok)throw new Error(`Reference HTTP ${response.status}`);
      if(!binary)return await response.json();
      if(Number(response.headers.get('content-length'))>8*1024*1024)throw new Error('Reference image too large');
      const reader=response.body.getReader();const chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();throw new Error('Reference image too large');}chunks.push(value);}
      const bytes=Buffer.concat(chunks);if(!bytes.subarray(0,3).equals(Buffer.from([255,216,255])))throw new Error('Reference image is not bounded JPEG');return bytes;
    }catch(error){last=error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,400));}
  }throw last;
}
const plantTargets=[{id:163992,name:'Hypnum cupressiforme'},{id:56406,name:'Marchantia polymorpha'},{id:158429,name:'Anthoceros agrestis'}];
const taxonIds=[311249,64615,56327,...plantTargets.map(item=>item.id)];
const taxa=(await get(`https://api.inaturalist.org/v1/taxa/${taxonIds.join(',')}?locale=zh-CN`)).results;
const birds=['Corvus cornix','Corvus corone','Corvus frugilegus','Corvus macrorhynchos','Corvus sinaloae','Regulus satrapa'];
async function resolvePhoto(scientificName,plant){
  const existing=manifest.find(item=>item.scientificName===scientificName);
  if(existing){if(!/^\d{1,15}\.jpg$/.test(existing.file)||createHash('sha256').update(await readFile(path.join(assets,existing.file))).digest('hex')!==existing.sha256.toLowerCase())throw new Error('Existing reference photo hash mismatch');return {entry:existing};}
  let sourceUrl,author,license,imageSource,metadataUrl;
  if(plant){const taxon=taxa.find(item=>item.id===plant.id&&item.name===scientificName);if(!taxon)throw new Error('Exact plant identity unavailable');const photo=taxon.default_photo;sourceUrl=photo?.medium_url;author=photo?.attribution_name;license=photo?.license_code;imageSource='iNaturalist';metadataUrl=`https://api.inaturalist.org/v1/taxa/${plant.id}`;}
  else{
    metadataUrl=`https://birdnet.cornell.edu/taxonomy/api/species/${encodeURIComponent(scientificName)}`;const record=await get(metadataUrl);if(record.scientific_name!==scientificName)throw new Error('Exact bird identity unavailable');
    const photo=allowedLicense(record.image?.license)&&record.image?.author?record.image:record.avicommons_image;
    sourceUrl=photo?.src;author=photo?.author;license=photo?.license;imageSource=photo===record.image?photo.source:'Avicommons';
    if(sourceUrl&&new URL(sourceUrl).hostname==='inaturalist-open-data.s3.amazonaws.com')sourceUrl=sourceUrl.replace(/\/large\.(jpg|jpeg)$/i,'/medium.$1');
  }
  if(!sourceUrl||!author||!allowedLicense(license))throw new Error(`No licensed reference image for ${scientificName}`);
  const bytes=await get(sourceUrl,true);
  return {bytes,entry:{scientificName,sourceUrl,metadataUrl,author,license,imageSource,sha256:createHash('sha256').update(bytes).digest('hex')}};
}
// Finish every network request before writing any new files or manifests.
const resolved=await Promise.all([...birds.map(name=>resolvePhoto(name)),...plantTargets.map(item=>resolvePhoto(item.name,item))]);
let nextNumber=910000001;
for(const result of resolved){if(!result.bytes)continue;while(true){const file=`${nextNumber++}.jpg`;try{await stat(path.join(assets,file));}catch(error){if(error.code!=='ENOENT')throw error;result.entry.file=file;await writeFile(path.join(assets,file),result.bytes,{flag:'wx'});break;}}manifest.push(result.entry);}
function credit(entry){return `${entry.author} · ${entry.license} · ${entry.imageSource} · ${entry.sourceUrl}`;}
for(const target of plantTargets){
  const taxon=taxa.find(item=>item.id===target.id&&item.name===target.name);const entry=manifest.find(item=>item.scientificName===target.name);
  const record={name:taxon.preferred_common_name??taxon.name,scientificName:taxon.name,taxonRank:'species',kind:'plant',taxonId:String(taxon.id),aliases:[],tags:['苔藓','苔藓代表种'],family:taxon.ancestors.find(item=>item.rank==='family')?.name??'',genus:taxon.ancestors.find(item=>item.rank==='genus')?.name??'',sourceLabel:'iNaturalist 离线植物参考',sourceUrl:`https://www.inaturalist.org/taxa/${taxon.id}`,sourceUrls:[entry.metadataUrl],imageUrl:`/plant-assets/${entry.file}`,imageLicense:entry.license,imageSource:entry.imageSource,imageAttribution:credit(entry),description:'这是苔藓相关类群中的具体代表种，不能据书中“苔藓”一词确定该种。',matchNote:'具体代表种供比较；不是“苔藓”的同义词或原书身份鉴定。',offline:true};
  const index=groups.findIndex(item=>item.scientificName===record.scientificName);if(index>=0)groups[index]=record;else groups.push(record);
}
for(const [id,scientificName,representative] of [[311249,'Bryophyta','Hypnum cupressiforme'],[64615,'Marchantiophyta','Marchantia polymorpha'],[56327,'Anthocerotophyta','Anthoceros agrestis']]){
  const taxon=taxa.find(item=>item.id===id&&item.name===scientificName&&item.rank==='phylum');if(!taxon)throw new Error('Plant phylum identity mismatch');
  const entry=manifest.find(item=>item.scientificName===representative);const member=groups.find(item=>item.scientificName===representative);
  if(!taxa.find(item=>item.name===representative).ancestor_ids.includes(id))throw new Error('Representative plant ancestry mismatch');
  const caution=`“苔藓”为广义俗称，相关植物涉及真藓门、地钱门、角苔门等，本项仅收纳${taxon.preferred_common_name??scientificName}，门级类群，并非一种物种。类群代表图：${member.name} (${representative})，不代表全部成员。`;
  const record={name:taxon.preferred_common_name??scientificName,scientificName,taxonRank:'phylum',kind:'plant',taxonId:String(id),aliases:[],tags:['苔藓','苔藓类群'],sourceLabel:'iNaturalist 离线类群参考',sourceUrl:`https://www.inaturalist.org/taxa/${id}`,sourceUrls:[`https://api.inaturalist.org/v1/taxa/${id}`],imageUrl:`/plant-assets/${entry.file}`,imageLicense:entry.license,imageSource:entry.imageSource,imageAttribution:`类群代表图：${member.name} (${representative}) · ${credit(entry)}`,description:caution,matchNote:caution,offline:true};
  const index=groups.findIndex(item=>item.scientificName===scientificName);if(index>=0)groups[index]=record;else groups.push(record);
}
const crow=groups.find(item=>item.scientificName==='Corvus');const crowPhoto=manifest.find(item=>item.scientificName==='Corvus corone');
if(crow){const caution='类群代表图：小嘴乌鸦 (Corvus corone)，不代表全部成员；“乌鸦”不能据此确定为某一种。';Object.assign(crow,{imageUrl:`/plant-assets/${crowPhoto.file}`,imageLicense:crowPhoto.license,imageSource:crowPhoto.imageSource,imageAttribution:`${caution} · ${credit(crowPhoto)}`,description:crow.description.includes(caution)?crow.description:`${crow.description} ${caution}`,matchNote:crow.matchNote.includes(caution)?crow.matchNote:`${crow.matchNote} ${caution}`});}
const mossNames=new Set(['Bryophyta','Marchantiophyta','Anthocerotophyta',...plantTargets.map(item=>item.name)]);
const orderedGroups=[...groups.filter(item=>!mossNames.has(item.scientificName)),...groups.filter(item=>mossNames.has(item.scientificName)&&item.taxonRank==='phylum'),...groups.filter(item=>mossNames.has(item.scientificName)&&item.taxonRank==='species')];
await writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
await writeFile(groupsFile,JSON.stringify(orderedGroups,null,2)+'\n');
console.log(JSON.stringify({manifestPhotos:manifest.length,plantReferences:plantTargets.length,crowSpecies:birds.length,groups:groups.length}));
