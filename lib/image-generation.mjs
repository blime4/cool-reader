import {mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ApiError} from './plants-store.mjs';
const MODEL='Qwen/Qwen-Image-2.1';
const ID=/^[a-f0-9-]{36}$/;
const MAX_IMAGE=8*1024*1024;
export async function openImageGeneration({dataDir,config={},fetchImpl=fetch}={}){
  const enabled=config.enabled===true;const port=config.port??4174;
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('图像生成端口无效');
  const base=`http://127.0.0.1:${port}`;const folder=path.join(dataDir,'generated-images');
  const jobs=new Map(),completions=new Map();let active=false;let lastStarted=0;
  async function headers(){const file=path.join(dataDir,'image-worker.token');const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>256)throw Error('图像服务令牌无效');return {'Content-Type':'application/json','X-Folio-Token':(await readFile(file,'utf8')).trim()};}
  async function health(){
    if(!enabled)return {enabled:false,ready:false,model:MODEL,reason:'本地图像生成未启用，请按 README 配置 Diffusers 服务。'};
    try{const response=await fetchImpl(base+'/health',{headers:await headers(),signal:AbortSignal.timeout(2500),redirect:'error'});const value=await response.json();if(!response.ok||value.app!=='folio-qwen-image')throw Error('identity');return {enabled:true,ready:value.ready===true,model:MODEL,reason:String(value.reason??'').slice(0,400),busy:active};}
    catch{return {enabled:true,ready:false,model:MODEL,reason:'本地 Diffusers 服务未就绪，请运行 scripts/start-image-worker.ps1。',busy:active};}
  }
  function get(id){const job=jobs.get(id);if(!job)throw new ApiError(404,'生成任务不存在');return structuredClone(job);}
  async function generate(job,input){
    try{
      const response=await fetchImpl(base+'/generate',{method:'POST',headers:await headers(),body:JSON.stringify(input),signal:AbortSignal.timeout(30*60*1000),redirect:'error'});
      if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(typeof error.error==='string'?error.error:'本地模型生成失败');}
      if(!/^image\/jpeg(?:;|$)/i.test(response.headers.get('content-type')??'')||Number(response.headers.get('content-length'))>MAX_IMAGE)throw Error('生成图片格式或大小无效');
      const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>MAX_IMAGE){await response.body.cancel().catch(()=>{});throw Error('生成图片超过 8 MB');}chunks.push(chunk);}
      const bytes=Buffer.concat(chunks);if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw Error('生成图片不是 JPEG');
      await mkdir(folder,{recursive:true});const info=await lstat(folder);if(!info.isDirectory()||info.isSymbolicLink())throw Error('生成图片目录无效');
      const image={imageUrl:`/generated-images/${job.id}.jpg`,imageKind:'generated',imageAttribution:`AI 生成示意图 · ${MODEL} · 非实拍，不能用于物种鉴定`};
      await writeFile(path.join(folder,job.id+'.jpg'),bytes,{flag:'wx'});
      await writeFile(path.join(folder,job.id+'.json'),JSON.stringify({model:MODEL,...input,createdAt:new Date().toISOString(),...image}),{flag:'wx'});
      Object.assign(job,{status:'done',image});
    }catch(error){Object.assign(job,{status:'failed',error:String(error.message??'生成失败').slice(0,400)});}
    finally{active=false;}
  }
  return {health,get,async wait(id){get(id);await completions.get(id);return get(id);},async start(input){
    if(!enabled)throw new ApiError(503,'本地图像生成未启用');
    if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>120||/[\x00-\x1f]/.test(input.name)||typeof(input.scientificName??'')!=='string'||(input.scientificName??'').length>180||!['plant','animal','bird','other'].includes(input.kind??'other'))throw new ApiError(400,'生成名称或类群无效');
    if(active)throw new ApiError(429,'已有图片正在生成，请等待完成');
    if(Date.now()-lastStarted<5000)throw new ApiError(429,'请稍候再生成下一张图片');
    // Reserve before probing so simultaneous requests cannot enter the queue twice.
    active=true;
    const status=await health();if(!status.ready){active=false;throw new ApiError(503,status.reason||'本地模型尚未准备好');}
    lastStarted=Date.now();while(jobs.size>=100){const oldest=jobs.keys().next().value;jobs.delete(oldest);completions.delete(oldest);}
    const job={id:randomUUID(),status:'running',model:MODEL,createdAt:new Date().toISOString()};jobs.set(job.id,job);
    completions.set(job.id,generate(job,{name:input.name.trim(),scientificName:(input.scientificName??'').trim(),kind:input.kind??'other'}));return get(job.id);
  },async file(id){if(!ID.test(id))throw new ApiError(404,'图片不存在');const dir=await lstat(folder);if(!dir.isDirectory()||dir.isSymbolicLink())throw new ApiError(404,'图片不存在');const file=path.join(folder,id+'.jpg');const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_IMAGE)throw new ApiError(404,'图片不存在');return readFile(file);}};
}
