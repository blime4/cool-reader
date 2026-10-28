import { writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IMAGE_HOSTS } from './plants-store.mjs';
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
export async function remoteSearch(query){
  const url=new URL('https://api.inaturalist.org/v1/taxa/autocomplete');
  for(const [key,value] of Object.entries({q:query,taxon_id:'47126',locale:'zh-CN',per_page:'6'}))url.searchParams.set(key,value);
  const signal=AbortSignal.timeout(8000);
  const response=await fetch(url,{signal,redirect:'error'});if(!response.ok)throw new Error('查询服务暂不可用');
  const payload=await response.json();
  let taxa=(payload.results??[]).filter(taxon=>/^\d{1,15}$/.test(String(taxon.id))&&['species','subspecies','variety','genus'].includes(taxon.rank)).slice(0,6);
  if(taxa.length){
    try{
      const detailUrl=new URL(`https://api.inaturalist.org/v1/taxa/${taxa.map(taxon=>taxon.id).join(',')}`);detailUrl.searchParams.set('locale','zh-CN');
      const response=await fetch(detailUrl,{signal,redirect:'error'});
      if(response.ok){const details=await response.json();const byId=new Map((details.results??[]).map(taxon=>[String(taxon.id),taxon]));taxa=taxa.map(taxon=>({...taxon,...byId.get(String(taxon.id))}));}
    }catch{/* Autocomplete candidates remain usable when optional detail lookup fails. */}
  }
  return taxa.map(taxon=>{
    const ancestors=taxon.ancestors??[];const photo=taxon.default_photo;
    const photoAllowed=['cc0','cc-by','cc-by-sa','cc-by-nc','cc-by-nc-sa','cc-by-nd','cc-by-nc-nd'].includes(photo?.license_code);
    let imageUrl=photoAllowed?(photo?.medium_url??photo?.square_url??''):'';
    if(imageUrl){try{const u=new URL(imageUrl);if(!IMAGE_HOSTS.has(u.hostname)||u.protocol!=='https:')imageUrl='';}catch{imageUrl='';}}
    const description=String(taxon.wikipedia_summary??'').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,entity=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[entity]).replace(/\s+/g,' ').trim().slice(0,6000);
    return {taxonId:String(taxon.id),name:taxon.preferred_common_name??taxon.name,scientificName:taxon.name,family:ancestors.find(a=>a.rank==='family')?.name??'',genus:ancestors.find(a=>a.rank==='genus')?.name??(taxon.rank==='genus'?taxon.name:''),description,imageUrl,imageAttribution:photo?.attribution??'',sourceUrl:`https://www.inaturalist.org/taxa/${taxon.id}`,tags:[],matchedTerm:taxon.matched_term??''};
  }).sort((a,b)=>Number(b.name===query||b.matchedTerm===query)-Number(a.name===query||a.matchedTerm===query));
}
