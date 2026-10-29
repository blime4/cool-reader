import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {kingdomGroup} from './taxon-kind.mjs';
export class ApiError extends Error { constructor(status,message){super(message);this.status=status;} }
export const MAX_COLLECTION_BYTES=20*1024*1024;
const limits={name:120,scientificName:180,family:120,genus:120,description:6000,imageAttribution:1000,sourceBook:300,chapter:200,page:40,notes:12000};
export function safeUrl(value){
  if(!value)return '';
  if(typeof value!=='string'||value.length>2048)throw new ApiError(400,'网址格式无效');
  let url;try{url=new URL(value);}catch{throw new ApiError(400,'网址格式无效');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new ApiError(400,'网址仅支持 HTTP 或 HTTPS');
  return url.href;
}
export const IMAGE_HOSTS=new Set(['static.inaturalist.org','inaturalist-open-data.s3.amazonaws.com','upload.wikimedia.org','birdnet.cornell.edu','static.avicommons.org']);
export function validatePlant(input,{restore=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'植物资料格式无效');
  const result={};
  for(const [key,max] of Object.entries(limits)){
    const value=input[key]??'';
    if((key==='page'&&typeof value==='number'))result[key]=String(value);
    else if(typeof value!=='string'||value.length>max)throw new ApiError(400,`${key} 内容过长或格式无效`);
    else result[key]=key==='notes'?value:value.trim();
  }
  if(!result.name)throw new ApiError(400,'请输入植物名称');
  for(const key of ['bookId','chapterId','pageId']){
    if(input[key]===undefined)continue;
    const value=input[key];const pattern=key==='bookId'?/^[a-f0-9]{40}$/:/^[A-Za-z0-9_-]{1,80}$/;
    if(typeof value!=='string'||(value!==''&&!pattern.test(value)))throw new ApiError(400,'阅读来源编号格式无效');
    result[key]=value;
  }
  if(input.quote!==undefined){if(typeof input.quote!=='string'||input.quote.length>1000)throw new ApiError(400,'原书摘录最多 1000 字');result.quote=input.quote;}
  result.kind=input.kind??'plant';
  if(!['plant','animal','bird','other'].includes(result.kind))throw new ApiError(400,'物种类群无效');
  if(input.taxonRank!==undefined){
    if(typeof input.taxonRank!=='string'||input.taxonRank.length>40||!['','species','subspecies','variety','form','genus','subgenus','tribe','subfamily','family','superfamily','order','suborder','infraorder','class','subclass'].includes(input.taxonRank))throw new ApiError(400,'分类阶元格式无效');
    result.taxonRank=input.taxonRank;
  }
  const id=input.taxonId;
  if(id!==undefined&&id!==null&&id!==''&&!/^\d{1,15}$/.test(String(id)))throw new ApiError(400,'分类编号无效');
  result.taxonId=id===undefined||id===null||id===''?'':String(id);
  result.sourceUrl=safeUrl(input.sourceUrl);
  if(input.sourceLabel!==undefined){
    if(typeof input.sourceLabel!=='string'||input.sourceLabel.length>160)throw new ApiError(400,'资料来源标签格式无效');
    result.sourceLabel=input.sourceLabel.trim();
  }
  if(input.sourceUrls!==undefined){
    if(!Array.isArray(input.sourceUrls)||input.sourceUrls.length>8)throw new ApiError(400,'资料来源链接格式无效');
    result.sourceUrls=[...new Set(input.sourceUrls.map(safeUrl).filter(Boolean))];
  }
  const image=input.imageUrl??'';
  if(typeof image!=='string')throw new ApiError(400,'图片网址无效');
  if(/^\/plant-images\/[0-9a-f-]{36}\.jpg$/.test(image)||/^\/plant-assets\/\d{1,15}\.jpg$/.test(image))result.imageUrl=image;
  else {result.imageUrl=safeUrl(image);if(result.imageUrl){const url=new URL(result.imageUrl);if(url.protocol!=='https:'||url.port||!IMAGE_HOSTS.has(url.hostname))throw new ApiError(400,'图片来源不受支持');}}
  result.status=input.status??'想了解';
  if(!['想了解','已认识','待观察'].includes(result.status))throw new ApiError(400,'认识状态无效');
  const tags=input.tags??[];
  if(!Array.isArray(tags)||tags.length>30||tags.some(tag=>typeof tag!=='string'||!tag.trim()||tag.length>40))throw new ApiError(400,'标签格式无效，最多 30 个');
  result.tags=[...new Set(tags.map(tag=>tag.trim()))];
  if(restore){
    if(typeof input.id!=='string'||!(/^[A-Za-z0-9_-]{1,80}$/).test(input.id))throw new ApiError(400,'记录编号无效');
    result.id=input.id;
    for(const key of ['createdAt','updatedAt'])if(input[key]!==undefined){if(typeof input[key]!=='string'||!Number.isFinite(Date.parse(input[key])))throw new ApiError(400,'日期格式无效');result[key]=input[key];}
  }
  return result;
}
export function duplicate(plants,plant){return plants.some(other=>{
  if(other.id&&plant.id&&other.id===plant.id)return true;
  if(other.taxonId&&plant.taxonId)return other.taxonId===plant.taxonId;
  if(kingdomGroup(other.kind)!==kingdomGroup(plant.kind))return false;
  if(other.scientificName&&plant.scientificName)return other.scientificName.toLocaleLowerCase()===plant.scientificName.toLocaleLowerCase();
  return other.name.toLocaleLowerCase()===plant.name.toLocaleLowerCase();
});}
export async function openStore(dataDir){
  await mkdir(dataDir,{recursive:true});
  const file=path.join(dataDir,'plants.json');let plants=[];
  try{
    const parsed=JSON.parse(await readFile(file,'utf8'));
    if(parsed.version!==1||!Array.isArray(parsed.plants)||parsed.plants.length>5000)throw new Error('schema');
    plants=parsed.plants.map(plant=>validatePlant(plant,{restore:true}));
    const seen=[];for(const plant of plants){if(duplicate(seen,plant))throw new Error('duplicate');seen.push(plant);}
  }catch(error){if(error.code!=='ENOENT')throw new Error(`植物数据库损坏，请保留并修复 ${file}，原文件未被改写。`,{cause:error});}
  let queue=Promise.resolve();
  return {list:()=>plants,mutate(operation,{snapshot=false}={}){
    const job=queue.then(async()=>{
      const next=structuredClone(plants);const result=await operation(next);
      const serialized=JSON.stringify({version:1,plants:next},null,2);
      if(Buffer.byteLength(serialized,'utf8')>MAX_COLLECTION_BYTES)throw new ApiError(413,'植物收藏总容量不能超过 20 MB，请精简笔记或删除部分记录后重试。');
      if(snapshot){try{await copyFile(file,path.join(dataDir,`plants-before-restore-${Date.now()}-${randomUUID()}.json`));}catch(error){if(error.code!=='ENOENT')throw error;}}
      const temp=path.join(dataDir,`plants-${randomUUID()}.tmp`);
      await writeFile(temp,serialized,'utf8');await rename(temp,file);plants=next;return result;
    });queue=job.catch(()=>{});return job;
  }};
}
