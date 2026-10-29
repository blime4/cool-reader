import {randomUUID} from 'node:crypto';
import {ApiError,validatePlant,duplicate} from './plants-store.mjs';
import {applyReadingToCard,readingContext} from '../dist/reading-links.mjs';
const normalized=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase();
const terminal=task=>!['queued','running'].includes(task.status);
const aiImage=card=>/^\/generated-images\/[a-f0-9-]{36}\.jpg$/.test(card?.imageUrl||'');
const replaceable=(task,card)=>task.regenerate&&aiImage(card)&&card.imageUrl===task.previousImageUrl;
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

export function createCollectionTasks({store,generator}){
  const tasks=new Map(),pending=new Map();let queue=Promise.resolve();
  async function mutate(operation){
    for(let attempt=0;attempt<3;attempt++)try{return await store.mutate(operation);}catch(error){if(error.status!==409||attempt===2)throw error;}
  }
  async function get(id){
    const task=tasks.get(id);if(!task)throw new ApiError(404,'后台收藏任务不存在');
    const plant=(await store.list()).find(card=>card.id===task.plantId)||null;
    return structuredClone({...task,plant});
  }
  async function run(task){
    try{
      let plant=(await store.list()).find(card=>card.id===task.plantId);
      if(!plant){task.status='cancelled';task.reason='card-deleted';return;}
      if(plant.imageUrl&&!replaceable(task,plant)){task.status='done';task.reason='image-present';return;}
      task.status='running';const deadline=Date.now()+30*60*1000;let job;
      while(!job){
        try{job=await generator.start({name:plant.name,scientificName:plant.scientificName,kind:plant.kind});}
        catch(error){if(error.status!==429||Date.now()>=deadline)throw error;await sleep(1000);}
      }
      task.jobId=job.id;task.phase='generating';const identity=JSON.stringify([plant.name,plant.scientificName,plant.kind]);
      const result=await generator.wait(job.id);
      if(result.status!=='done')throw new Error(result.error||'生成未完成，卡片和阅读笔记已保留。');
      if(!/^\/generated-images\/[a-f0-9-]{36}\.jpg$/.test(result.image?.imageUrl||''))throw new Error('生成图片地址无效，未修改收藏。');
      task.phase='writing';
      await mutate(next=>{
        const index=next.findIndex(card=>card.id===task.plantId);
        if(index<0){task.status='cancelled';task.reason='card-deleted';return;}
        const latest=next[index];
        if(latest.imageUrl&&!replaceable(task,latest)){task.reason='image-present';return;}
        if(JSON.stringify([latest.name,latest.scientificName,latest.kind])!==identity){task.status='cancelled';task.reason='identity-changed';return;}
        // Never replay an old full-card snapshot: notes and any external edits stay authoritative.
        next[index]={...latest,...validatePlant({...latest,imageUrl:result.image.imageUrl,imageKind:'generated',imageAttribution:result.image.imageAttribution||''}),updatedAt:new Date().toISOString()};
        task.reason=task.regenerate?'image-replaced':'image-added';
      });
      if(task.status!=='cancelled')task.status='done';
    }catch(error){task.status='failed';task.error=String(error.message||'后台生成未完成').slice(0,400);}
    finally{task.phase=task.status;task.updatedAt=new Date().toISOString();pending.delete(task.plantId);}
  }
  return {get,async list(){const cards=new Map((await store.list()).map(card=>[card.id,card]));return [...tasks.values()].map(task=>structuredClone({...task,plant:cards.get(task.plantId)||null}));},async start(input){
    if(!input||typeof input!=='object'||Array.isArray(input)||typeof(input.generate??true)!=='boolean'||typeof(input.regenerate??false)!=='boolean'||(input.regenerate&&input.generate===false))throw new ApiError(400,'后台收藏任务格式无效');
    const incoming=validatePlant(input.plant);
    if(input.plantId!==undefined&&(typeof input.plantId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(input.plantId)))throw new ApiError(400,'收藏编号无效');
    if(input.context!==undefined&&(!input.context||typeof input.context!=='object'||Array.isArray(input.context)))throw new ApiError(400,'阅读出处无效');
    const source=Object.fromEntries(['bookId','pageId','chapterId','sourceBook','chapter','page','quote'].filter(key=>input.context?.[key]!==undefined).map(key=>[key,input.context[key]]));
    const context=readingContext(validatePlant({name:incoming.name,...source}));
    const plant=await mutate(next=>{
      let existing=input.plantId?next.find(card=>card.id===input.plantId):next.find(card=>duplicate([card],incoming));
      if(input.plantId&&!existing)throw new ApiError(404,'目标收藏已不存在，未重新创建');
      if(!existing&&!incoming.scientificName&&!incoming.taxonId){
        const sameName=next.filter(card=>normalized(card.name)===normalized(incoming.name));
        if(sameName.length>1)throw new ApiError(409,'存在多个同名收藏，请先选择具体卡片');
        existing=sameName[0];
      }
      if(existing&&normalized(existing.name)!==normalized(incoming.name)&&!(existing.taxonId&&existing.taxonId===incoming.taxonId)&&!(existing.scientificName&&normalized(existing.scientificName)===normalized(incoming.scientificName)))throw new ApiError(400,'目标收藏与所选名称不一致');
      if(input.regenerate&&(!existing||!aiImage(existing)))throw new ApiError(400,'仅已有 AI 示意图可重新生成，实拍和资料图不会替换');
      const now=new Date().toISOString();
      const card=existing?{...applyReadingToCard(existing,context),updatedAt:now}:{...applyReadingToCard(incoming,context,{isNew:true}),id:randomUUID(),createdAt:now,updatedAt:now};
      if(existing)next[next.findIndex(item=>item.id===existing.id)]=card;
      else{if(next.length>=5000)throw new ApiError(400,'最多收藏 5000 条记录');next.push(card);}
      return card;
    });
    const ongoing=pending.get(plant.id);if(ongoing&&!terminal(ongoing))return get(ongoing.id);
    while(tasks.size>=100){const oldest=[...tasks.values()].find(terminal);if(!oldest)break;tasks.delete(oldest.id);}
    const now=new Date().toISOString();const task={id:randomUUID(),plantId:plant.id,name:plant.name,status:'queued',phase:'queued',regenerate:input.regenerate===true,previousImageUrl:input.regenerate?plant.imageUrl:'',createdAt:now,updatedAt:now};tasks.set(task.id,task);
    if((plant.imageUrl&&!task.regenerate)||input.generate===false){task.status='done';task.phase='done';task.reason=plant.imageUrl?'image-present':'encounter-recorded';return get(task.id);}
    if(pending.size>=10){task.status='failed';task.phase='failed';task.error='后台队列已满，卡片与阅读出处已收藏，可稍后重试补图。';return get(task.id);}
    pending.set(plant.id,task);queue=queue.then(()=>run(task),()=>run(task));return get(task.id);
  }};
}
