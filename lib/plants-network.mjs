import { writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IMAGE_HOSTS } from './plants-store.mjs';
import {inferKind} from './taxon-kind.mjs';
export function imageType(buffer){
  if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
  if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(buffer.subarray(0,6).toString().match(/^GIF8[79]a$/))return 'image/gif';
  if(buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP')return 'image/webp';return '';
}
export async function cacheImage(imageUrl,dataDir){
  if(!imageUrl||/^\/plant-images\/[0-9a-f-]{36}\.jpg$/.test(imageUrl)||/^\/plant-assets\/\d{1,15}\.jpg$/.test(imageUrl))return {imageUrl};
  const url=new URL(imageUrl);
  if(url.protocol!=='https:'||url.port||!IMAGE_HOSTS.has(url.hostname))return {imageUrl:'',warning:'图片来源不受支持，已保留植物占位图。'};
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:'error'});
    if(!response.ok||!/^image\/(jpeg|png|webp|gif)(?:;|$)/i.test(response.headers.get('content-type')??''))throw new Error('image');
    if(Number(response.headers.get('content-length'))>8*1024*1024)throw new Error('size');
    const reader=response.body.getReader();let size=0;const chunks=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();throw new Error('size');}chunks.push(value);}
    const bytes=Buffer.concat(chunks);if(!imageType(bytes))throw new Error('signature');
    await mkdir(path.join(dataDir,'images'),{recursive:true});const name=`${randomUUID()}.jpg`;await writeFile(path.join(dataDir,'images',name),bytes);
    return {imageUrl:`/plant-images/${name}`};
  }catch{return {imageUrl,warning:'图片暂时无法缓存，已保留来源图片链接。'};}
}
export const VERIFIED_ALIASES=Object.freeze({'合欢树':['合欢','Albizia julibrissin']});
export async function remoteSearch(query,{signal=AbortSignal.timeout(17000),kind='plant'}={}){
  let taxa=[];let matchedQuery=query;let succeeded=false;let lastError;
  const verified=['plant','all'].includes(kind)?VERIFIED_ALIASES[query]:undefined;
  const broader=['plant','all'].includes(kind)&&!verified&&/^[\p{Script=Han}]{2,}树$/u.test(query)?query.slice(0,-1):'';
  for(const candidate of [query,...(verified??(broader?[broader]:[]))]){
    if(signal.aborted)break;
    const url=new URL('https://api.inaturalist.org/v1/taxa/autocomplete');
    for(const [key,value] of Object.entries({q:candidate,locale:'zh-CN',per_page:'6'}))url.searchParams.set(key,value);
    const scope={plant:'47126',animal:'1',bird:'3'}[kind];if(scope)url.searchParams.set('taxon_id',scope);
    try{
      const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(5500)]),redirect:'error'});if(!response.ok)throw new Error('查询服务暂不可用');
      const payload=await response.json();succeeded=true;
      taxa=(payload.results??[]).filter(taxon=>/^\d{1,15}$/.test(String(taxon.id))&&['species','subspecies','variety','form','genus','subgenus','tribe','subfamily','family','superfamily','order','suborder','infraorder','class','subclass'].includes(taxon.rank)).slice(0,6);
      if(taxa.length){matchedQuery=candidate;break;}
    }catch(error){if(broader&&candidate===query)throw error;lastError=error;}
  }
  if(!succeeded||(!taxa.length&&lastError))throw lastError??new Error('查询服务暂不可用');
  if(taxa.length){
    try{
      const detailUrl=new URL(`https://api.inaturalist.org/v1/taxa/${taxa.map(taxon=>taxon.id).join(',')}`);detailUrl.searchParams.set('locale','zh-CN');
      const response=await fetch(detailUrl,{signal:AbortSignal.any([signal,AbortSignal.timeout(5500)]),redirect:'error'});
      if(response.ok){const details=await response.json();const byId=new Map((details.results??[]).map(taxon=>[String(taxon.id),taxon]));taxa=taxa.map(taxon=>({...taxon,...byId.get(String(taxon.id))}));}
    }catch{/* Autocomplete candidates remain usable when optional detail lookup fails. */}
  }
  return taxa.map(taxon=>{
    const ancestors=taxon.ancestors??[];const photo=taxon.default_photo;
    const photoAllowed=['cc0','cc-by','cc-by-sa','cc-by-nc','cc-by-nc-sa','cc-by-nd','cc-by-nc-nd'].includes(photo?.license_code);
    let imageUrl=photoAllowed?(photo?.medium_url??photo?.square_url??''):'';
    if(imageUrl){try{const u=new URL(imageUrl);if(!IMAGE_HOSTS.has(u.hostname)||u.protocol!=='https:')imageUrl='';}catch{imageUrl='';}}
    const description=String(taxon.wikipedia_summary??'').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,entity=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[entity]).replace(/\s+/g,' ').trim().slice(0,6000);
    const terms=[taxon.preferred_common_name,taxon.name,taxon.matched_term].filter(Boolean).map(term=>String(term).trim().replace(/\s+/g,' ').toLocaleLowerCase());
    const original=query.trim().replace(/\s+/g,' ').toLocaleLowerCase();
    const searched=matchedQuery.trim().replace(/\s+/g,' ').toLocaleLowerCase();
    const matchType=broader&&matchedQuery!==query?'broader-candidate':terms.includes(original)?'exact':verified&&matchedQuery!==query&&terms.includes(searched)?'alias':'candidate';
    let matchNote=matchType==='alias'?`按“${matchedQuery}”别名检索`:matchType==='broader-candidate'?`按名称片段「${matchedQuery}」查找，请核对物种（并非已确认别名）`:matchType==='candidate'?'名称未精确匹配，仅为搜索候选，请核对物种。':'';
    const groupRank={genus:'属',subgenus:'亚属',tribe:'族',subfamily:'亚科',family:'科',superfamily:'总科',order:'目',suborder:'亚目',infraorder:'下目',class:'纲',subclass:'亚纲'}[taxon.rank];
    if(groupRank)matchNote=`这是${groupRank}级类群，并非一种物种；请核对原书所指范围。${matchNote}`;
    return {kind:inferKind(taxon),taxonId:String(taxon.id),taxonRank:taxon.rank,name:taxon.preferred_common_name??taxon.name,scientificName:taxon.name,family:ancestors.find(a=>a.rank==='family')?.name??'',genus:ancestors.find(a=>a.rank==='genus')?.name??(taxon.rank==='genus'?taxon.name:''),description,imageUrl,imageAttribution:photo?.attribution??'',sourceUrl:`https://www.inaturalist.org/taxa/${taxon.id}`,sourceLabel:'iNaturalist',tags:[],matchedTerm:taxon.matched_term??'',matchType,...(matchNote?{matchNote}:{})};
  }).sort((a,b)=>Number(b.name===matchedQuery||b.matchedTerm===matchedQuery||b.scientificName===matchedQuery)-Number(a.name===matchedQuery||a.matchedTerm===matchedQuery||a.scientificName===matchedQuery));
}

