import {matchesKind} from './taxon-kind.mjs';
const RANK_LABELS={species:'种',subspecies:'亚种',variety:'变种',form:'变型',genus:'属',subgenus:'亚属',tribe:'族',subfamily:'亚科',family:'科',superfamily:'总科',order:'目',suborder:'亚目',infraorder:'下目',class:'纲',subclass:'亚纲'};
const normalized=value=>String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase();
export async function searchGBIF(query,{signal=AbortSignal.timeout(6500),kind='plant'}={}){
  const url=new URL('https://api.gbif.org/v1/species/search');url.searchParams.set('q',query);url.searchParams.set('limit','30');
  const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(6500)]),redirect:'error',headers:{'User-Agent':'FOLIO-Local-Nature/1.0 (http://127.0.0.1:4173; local personal biodiversity reader)'}});
  if(!response.ok)throw new Error(response.status===429?'GBIF 查询频率受限，请稍后再试':'GBIF 数据集暂不可用');
  const payload=await response.json();const candidates=[];const seen=new Set();const needle=normalized(query);
  for(const record of payload.results??[]){
    const rank=String(record.rank??'').toLowerCase();const scientificName=record.canonicalName??record.scientificName;
    if(!RANK_LABELS[rank]||!/^\d{1,15}$/.test(String(record.key))||typeof scientificName!=='string'||!scientificName||scientificName.length>180)continue;
    const bird=record.class==='Aves'||(rank==='class'&&scientificName==='Aves');
    if(bird&&record.kingdom&&!['Animalia','Metazoa'].includes(record.kingdom))continue;
    const resolved=bird?'bird':record.kingdom==='Plantae'?'plant':['Animalia','Metazoa'].includes(record.kingdom)?'animal':['Fungi','Chromista','Protozoa','Bacteria','Archaea'].includes(record.kingdom)?'other':'';
    if(!resolved||!matchesKind(resolved,kind))continue;
    const identity=resolved+':'+normalized(scientificName);if(seen.has(identity))continue;seen.add(identity);
    const vernaculars=(Array.isArray(record.vernacularNames)?record.vernacularNames:[]).filter(item=>typeof item.vernacularName==='string'&&item.vernacularName.length<=120);
    const exactName=vernaculars.find(item=>normalized(item.vernacularName)===needle);
    const chinese=vernaculars.find(item=>['zho','chi','zh','zh-cn','cmn'].includes(String(item.language??'').toLowerCase()));
    const name=exactName?.vernacularName??chinese?.vernacularName??scientificName;
    const exact=Boolean(exactName)||normalized(scientificName)===needle;
    const group=!['species','subspecies','variety','form'].includes(rank);
    const matchNote=group?`这是${RANK_LABELS[rank]}级类群，并非一种物种；请核对原书所指范围。`:exact?'GBIF 名称匹配，原书物种身份仍待核对。':'GBIF 相关候选，名称未精确匹配，请核对物种。';
    candidates.push({name,scientificName,taxonId:'',gbifKey:String(record.key),kind:resolved,taxonRank:rank,family:typeof record.family==='string'?record.family:'',genus:typeof record.genus==='string'?record.genus:'',description:'',imageUrl:'',imageAttribution:'',sourceUrl:`https://www.gbif.org/species/${record.key}`,sourceLabel:'GBIF 生物多样性数据集',tags:[],matchType:exact?'exact':'candidate',matchNote});
  }
  return candidates.sort((a,b)=>Number(b.matchType==='exact')-Number(a.matchType==='exact')).slice(0,6);
}
