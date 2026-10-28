import {remoteSearch} from './plants-network.mjs';
import {matchesKind,kingdomGroup} from './taxon-kind.mjs';
const cacheEntries=new Map();
const normalized=value=>String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase();
async function request(url,signal){const response=await fetch(url,{signal,redirect:'error'});if(!response.ok)throw new Error('来源服务不可用');const data=await response.json();if(data.error)throw new Error('来源查询失败');return data;}
export async function searchWikipedia(query,{signal=AbortSignal.timeout(6500),kind='plant'}={}){
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(6500)]);
  const url=new URL('https://zh.wikipedia.org/w/api.php');
  for(const [key,value] of Object.entries({action:'query',format:'json',formatversion:'2',generator:'search',gsrsearch:query,gsrnamespace:'0',gsrlimit:'6',prop:'extracts|pageprops',exintro:'1',explaintext:'1',exchars:'6000',redirects:'1'}))url.searchParams.set(key,value);
  const data=await request(url,bounded);
  const pages=Object.values(data.query?.pages??{}).filter(page=>page.pageprops?.wikibase_item&&!Object.hasOwn(page.pageprops,'disambiguation'));
  if(!pages.length)return [];
  const ids=[...new Set(pages.map(page=>page.pageprops.wikibase_item).filter(id=>/^Q\d+$/.test(id)))];if(!ids.length)return [];
  const entityUrl=new URL('https://www.wikidata.org/w/api.php');
  for(const [key,value] of Object.entries({action:'wbgetentities',format:'json',ids:ids.join('|'),props:'claims|descriptions',languages:'zh|zh-cn|en'}))entityUrl.searchParams.set(key,value);
  const entities=(await request(entityUrl,bounded)).entities??{};
  return pages.flatMap(page=>{
    const entity=entities[page.pageprops.wikibase_item];const scientificName=entity?.claims?.P225?.find(claim=>typeof claim.mainsnak?.datavalue?.value==='string')?.mainsnak.datavalue.value;
    if(!scientificName||scientificName.length>180)return [];
    const description=Object.values(entity.descriptions??{}).map(item=>item.value??'').join(' ');
    const plantEvidence=/植物|乔木|灌木|草本|蕨类|苔藓|\b(?:species|genus|family|variety|subspecies|taxon) of (?:[a-z-]+ ){0,3}(?:plants?|trees?|shrubs?|ferns?|conifers?|mosses?)\b|\b(?:plant|tree|shrub|fern|conifer|moss) (?:species|genus|family)\b/i.test(description);
    const animalEvidence=/动物|哺乳|鸟类|昆虫|\b(?:animals?|mammals?|birds?|insects?|frogs?|fishes?|fish|reptiles?)\b/i.test(description);
    const birdEvidence=/鸟类|鸟科|鸟属|\b(?:birds?|avian|aves)\b/i.test(description);
    const otherEvidence=/真菌|蘑菇|\b(?:fungi|fungus|mushroom|lichen)\b/i.test(description);
    const resolved=plantEvidence&&!animalEvidence?'plant':birdEvidence?'bird':animalEvidence?'animal':otherEvidence?'other':'';
    if(!resolved||!matchesKind(resolved,kind))return [];
    const text=String(page.extract??'').replace(/<[^>]*>/g,' ').trim().slice(0,6000);
    return [{kind:resolved,taxonId:'',name:String(page.title).slice(0,120),scientificName,family:'',genus:'',description:text,imageUrl:'',imageAttribution:'',sourceUrl:`https://zh.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g,'_'))}`,sourceLabel:'维基百科 / Wikidata',sourceUrls:[`https://www.wikidata.org/wiki/${page.pageprops.wikibase_item}`],tags:[],matchType:'candidate',matchNote:'已核对 Wikidata 物种学名，请对照原书确认'}];
  });
}
export async function searchPlantSources(query,{localSeeds=[],kind='plant',providers={inat:remoteSearch,wiki:searchWikipedia},cache=true}={}){
  query=String(query).trim();if(!query||query.length>120)throw new Error('请输入 1 至 120 字的物种名称');
  const key=kind+':'+normalized(query); const needle=normalized(query);
  const local=localSeeds.filter(plant=>matchesKind(plant.kind??'plant',kind)).filter(plant=>[plant.name,plant.scientificName,...(plant.tags??[])].some(value=>normalized(value).includes(needle))).slice(0,6).map(plant=>({...plant,kind:plant.kind??'plant',sourceLabel:plant.sourceLabel??'本地精选'}));
  const exact=local.filter(plant=>[plant.name,plant.scientificName].some(value=>normalized(value)===needle));
  if(exact.length)return {results:exact,sources:[{name:'本地精选',status:'ok',count:exact.length}]};
  if(cache){const cached=cacheEntries.get(key);if(cached&&cached.expires>Date.now())return structuredClone(cached.value);cacheEntries.delete(key);}
  const signal=AbortSignal.timeout(17500);
  const names={inat:'iNaturalist',wiki:'维基百科 / Wikidata'};
  const settled=await Promise.allSettled(Object.entries(providers).map(async([id,provider])=>({id,plants:await provider(query,{signal,kind})})));
  const sources=local.length?[{name:'本地精选',status:'ok',count:local.length}]:[];const candidates=[...local];const warnings=[];
  let index=0;
  for(const [id] of Object.entries(providers)){
    const result=settled[index++];const name=names[id]??id;
    if(result.status==='rejected'){sources.push({name,status:'error',count:0,warning:'连接超时或来源暂不可用'});warnings.push(`${name} 暂时无法连接`);continue;}
    const plants=result.value.plants??[];sources.push({name,status:plants.length?'ok':'empty',count:plants.length});
    candidates.push(...plants.map(plant=>({...plant,kind:plant.kind??'plant',sourceLabel:plant.sourceLabel??name})));
  }
  const merged=new Map();
  for(const plant of candidates){
    const scientific=normalized(plant.scientificName);if(!scientific)continue;
    let identity=kingdomGroup(plant.kind)+':'+scientific;
    const known=merged.get(identity);
    if(known?.taxonId&&plant.taxonId&&known.taxonId!==plant.taxonId)identity+=':'+plant.taxonId;
    const urls=[...new Set([plant.sourceUrl,...(plant.sourceUrls??[])].filter(Boolean))];
    if(!merged.has(identity)){merged.set(identity,{...plant,sourceUrls:urls.slice(0,8)});continue;}
    const previous=merged.get(identity);previous.sourceUrls=[...new Set([...previous.sourceUrls,...urls])].slice(0,8);
    previous.sourceLabel=[...new Set([previous.sourceLabel,plant.sourceLabel])].join(' · ');
    // A richer description keeps both provider references with its attribution.
    if(!previous.description&&plant.description)previous.description=plant.description;
    if(!previous.family&&plant.family)previous.family=plant.family;
    if(!previous.genus&&plant.genus)previous.genus=plant.genus;
    if(!previous.imageUrl&&plant.imageUrl){previous.imageUrl=plant.imageUrl;previous.imageAttribution=plant.imageAttribution??'';}
  }
  const results=[...merged.values()].slice(0,12);
  if(!results.length)warnings.push('暂未找到有物种学名依据的候选。中文俗名可能未被来源收录，可尝试别名或拉丁学名。');
  const response={results,sources,...(warnings.length?{warning:warnings.join('；')+'。'}:{})};
  if(cache&&results.length&&!sources.some(source=>source.status==='error')){cacheEntries.set(key,{expires:Date.now()+10*60*1000,value:structuredClone(response)});while(cacheEntries.size>100)cacheEntries.delete(cacheEntries.keys().next().value);}
  return response;
}

