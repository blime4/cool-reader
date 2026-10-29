import {natureImageModel} from './nature-image-view.mjs';
const pendingTask=task=>['queued','running'].includes(task?.status);
export function createBackgroundCollectionClient({request=fetch,getCollection=()=>[],onCollection=()=>{},onTask=()=>{},interval=2000}={}){
  const states=new Map(),watches=new Map(),submissions=new Map(),plantVersions=new Map(),listeners=new Set();let requestRevision=0,queueWarning='';
  const getTasks=()=>structuredClone([...states.values()]);
  function emit(){for(const listener of listeners)try{listener(getTasks(),{connectionWarning:queueWarning});}catch{}}
  async function api(url,options={}){const revision=++requestRevision;const response=await request(url,{...options,headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(10000)});const value=await response.json();if(!response.ok)throw new Error(value.error||'后台收藏服务暂不可用');return {data:value,revision};}
  function publish(task,revision){
    if(!task||typeof task.id!=='string'||typeof task.plantId!=='string')throw new Error('后台任务响应无效');
    const version=plantVersions.get(task.plantId),currentCard=getCollection().find(card=>card.id===task.plantId);
    const incomingTime=Date.parse(task.plant?.updatedAt||'')||0,knownTime=Math.max(version?.time||0,Date.parse(currentCard?.updatedAt||'')||0);
    if((incomingTime&&knownTime&&incomingTime<knownTime)||(version&&revision<version.revision&&(version.deleted||incomingTime<=knownTime)))return states.get(version?.taskId)||task;
    const previous=states.get(task.id);if(previous&&!pendingTask(previous)&&pendingTask(task))return previous;
    plantVersions.set(task.plantId,{revision:Math.max(revision,version?.revision||0),time:Math.max(incomingTime,knownTime),taskId:task.id,deleted:task.status==='cancelled'&&task.reason==='card-deleted'&&!task.plant});
    states.set(task.id,task);while(states.size>100){const oldest=[...states.values()].find(item=>!pendingTask(item));if(!oldest)break;states.delete(oldest.id);}
    if(task.plant?.id===task.plantId){
      const previousCard=getCollection().find(card=>card.id===task.plantId);
      const plant=previousCard&&natureImageModel(previousCard).url&&!task.plant.imageUrl?{...task.plant,imageUrl:previousCard.imageUrl,imageKind:previousCard.imageKind,imageAttribution:previousCard.imageAttribution}:task.plant;
      onCollection([...getCollection().filter(card=>card.id!==task.plantId),plant]);
    }
    else if(task.status==='cancelled'&&task.reason==='card-deleted')onCollection(getCollection().filter(card=>card.id!==task.plantId));
    queueWarning='';onTask(task);emit();return task;
  }
  function watch(task){
    if(!pendingTask(task)||watches.has(task.id))return;
    const work=(async()=>{
      let current=task,failures=0;
      while(pendingTask(current)){
        await new Promise(resolve=>setTimeout(resolve,interval));
        try{const response=await api('/api/collection-tasks/'+encodeURIComponent(task.id));current=publish(response.data.task,response.revision);failures=0;}
        catch(error){if(++failures>3){const warning={...current,connectionWarning:'后台任务连接暂不可用，任务可能仍在本机运行；稍后重新查看即可。'};states.set(current.id,warning);onTask(warning);emit();return;}}
      }
    })().finally(()=>watches.delete(task.id));watches.set(task.id,work);
  }
  return {getTasks,subscribe(listener){listeners.add(listener);listener(getTasks(),{connectionWarning:queueWarning});return ()=>listeners.delete(listener);},forPlant(id){return [...states.values()].reverse().find(task=>task.plantId===id&&pendingTask(task))||[...states.values()].reverse().find(task=>task.plantId===id)||null;},
    async retry(id){const key='retry:'+id;if(submissions.has(key))return submissions.get(key);const work=(async()=>{const response=await api('/api/collection-tasks/'+encodeURIComponent(id)+'/retry',{method:'POST',body:'{}'});const task=publish(response.data.task,response.revision);watch(task);return task;})().finally(()=>submissions.delete(key));submissions.set(key,work);return work;},
    async submit(input){const key=JSON.stringify(input);if(submissions.has(key))return submissions.get(key);const work=(async()=>{const response=await api('/api/collection-tasks',{method:'POST',body:key});const task=publish(response.data.task,response.revision);watch(task);return task;})().finally(()=>submissions.delete(key));submissions.set(key,work);return work;},
    async resume(){
      try{const response=await api('/api/collection-tasks');queueWarning='';for(const task of Array.isArray(response.data.tasks)?response.data.tasks:[]){const state=publish(task,response.revision);watch(state);}emit();return true;}
      catch{queueWarning='后台队列连接暂不可用，任务可能仍在本机运行；稍后会在再次探索时重试。';for(const[id,task]of states)if(pendingTask(task))states.set(id,{...task,connectionWarning:queueWarning});emit();return false;}
    },
    async idle(){await Promise.all([...watches.values()]);}
  };
}
