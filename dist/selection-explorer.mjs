import {readingContext} from './reading-links.mjs';
import {unverifiedNameCard,sortPhotoCandidates,taxonomyPresentation,findExistingNameCard} from './collection-lookup-ui.mjs';
import {createNatureImage,natureImageModel} from './nature-image-view.mjs';
import {createGenerationAction} from './image-generation-action.mjs';
import {findCollectedGuide,guideCollectionPayload} from './guide-collection.mjs';
import {createBackgroundCollectionClient} from './background-collection.mjs';
import {createCollectionDetailModal} from './collection-detail-modal.mjs';

export function selectionExplorerName(value){
  if(typeof value!=='string')return '';
  const name=value.trim(),length=[...name].length;
  return length>=2&&length<=40&&/\p{L}/u.test(name)&&!/[\u0000-\u001f\u007f]/u.test(name)?name:'';
}
export function sameExplorerSelection(previous,next){
  return Boolean(previous&&next&&previous.anchorNode&&previous.focusNode&&previous.quote===next.quote&&previous.anchorNode===next.anchorNode&&previous.focusNode===next.focusNode&&previous.anchorOffset===next.anchorOffset&&previous.focusOffset===next.focusOffset);
}
const genericNameParts=new Set(['植物','动物','動物','生物','物种','物種','鸟类','鳥類','菌类','菌類','树木','樹木','类群','類群','林地','森林','野生','普通','常见','常見']);
const genericEnglishParts=new Set(['plant','plants','animal','animals','bird','birds','tree','trees','species','genus','family','wild','common','woodland','forest','leaf','leaves','red','blue','green','white','black','brown','yellow','large','small']);
function nameParts(value){
  const name=typeof value==='string'?value.normalize('NFKC').toLocaleLowerCase().trim():'';
  const parts=new Set((name.match(/[a-z]{3,}/g)||[]).filter(part=>!genericEnglishParts.has(part)));
  for(const group of name.match(/[\p{Script=Han}]+/gu)||[]){
    const chars=[...group.replace(/[属屬科门門纲綱目种種類类]+$/u,'')];
    for(let index=0;index+1<chars.length;index++){const part=chars[index]+chars[index+1];if(!genericNameParts.has(part))parts.add(part);}
  }
  return {name,parts};
}
function relevantCandidate(query,item){
  // Older/local callers without match metadata keep their existing behavior. Explicit fuzzy
  // provider results must earn relevance; a photograph never upgrades a name match.
  if(!item.matchType||['exact','alias'].includes(item.matchType))return true;
  const needle=nameParts(query);
  const names=[item.name,item.scientificName,item.matchedTerm,...(Array.isArray(item.aliases)?item.aliases:[]),...(Array.isArray(item.readingTerms)?item.readingTerms:[])];
  return names.some(value=>{const candidate=nameParts(value);return Boolean(candidate.name&&(candidate.name===needle.name||[...candidate.parts].some(part=>needle.parts.has(part))));});
}
const node=(tag,className,text)=>{const value=document.createElement(tag);value.className=className;if(text!==undefined)value.textContent=text;return value;};
const action=(text,name,callback)=>{const button=node('button','selection-explorer-button',text);button.type='button';button.dataset.action=name;button.addEventListener('click',callback);return button;};

export function createSelectionExplorer({root,getPageKey,collector,request=fetch,getCollection=()=>[],onCollection=()=>{},createGeneration=createGenerationAction,createImage=createNatureImage,createDetails=createCollectionDetailModal,onSaved=()=>{}}){
  let active,knownCards=getCollection(),collectionRevision=0,detailModal;
  const current=(session,draft)=>active===session&&getPageKey()===session.pageKey&&!root.hidden&&root.isConnected&&(!draft||session.draft===draft);
  const pendingTask=task=>['queued','running'].includes(task?.status);
  const storedCard=item=>findCollectedGuide(knownCards,item)||(!item.scientificName&&!item.taxonId&&(!item.kind||item.kind==='other')?findExistingNameCard(knownCards,item.name):null);
  const taskMessage=task=>task.connectionWarning|| (pendingTask(task)?'已收藏，正在后台排队或生成配图，可以继续翻页阅读。':task.status==='failed'?`已收藏，后台配图暂未完成：${task.error||'请稍后重试。'}`:task.status==='cancelled'?task.reason==='identity-changed'?'收藏名称或分类已修改，旧生成结果未写入。':'卡片已被删除，后台任务未重新创建它。':['image-added','image-replaced'].includes(task.reason)?'AI 示意图已安全写入同一收藏，原笔记已保留。':'已同步收藏并追加这次阅读出处，已有图片未被覆盖。');
  function syncCollection(next){
    knownCards=next;collectionRevision++;
    if(active?.draft&&current(active)&&!active.saving){const card=storedCard(active.draft);if(card&&(!active.saved||active.draft.id!==card.id||active.draft.imageUrl!==card.imageUrl))choose(active,card);}
  }
  function acceptCollection(next){syncCollection(next);onCollection(next);}
  const background=createBackgroundCollectionClient({request,getCollection:()=>knownCards,onCollection:acceptCollection,onTask:task=>{if(active?.draft?.id===task.plantId&&current(active)){if(task.status==='failed'&&task.retryable&&!active.saving)choose(active,task.plant||active.draft);active.status.textContent=taskMessage(task);}}});
  function invalidate(){detailModal?.close();active?.controller.abort();active=null;root.hidden=true;root.replaceChildren();}
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();invalidate();}});

  function choose(session,item){
    if(!current(session)||session.saving)return;
    const stored=storedCard(item);const sourceItem=stored?{...item,...stored}:item;
    const draft={...sourceItem,imageUrl:natureImageModel(sourceItem).url};session.draft=draft;session.saved=Boolean(stored);
    const details=session.details;details.replaceChildren();
    const photo=node('div','selection-explorer-photo');
    const title=node('h4','',draft.name);
    const caution=node('p','selection-explorer-caution',draft.imageKind==='generated'?'AI 生成示意图 · 非实拍，不能用于物种鉴定':draft.matchNote||'名称线索 · 物种待核对');
    const metadata=node('p','selection-explorer-meta',`${draft.scientificName||'学名待核对'} · ${taxonomyPresentation(draft).rankLabel}`);
    const source=node('p','selection-explorer-meta',draft.sourceLabel||'按原名称收纳 · 尚未确认分类资料');
    let generation,generating=false,backgroundButton,detailButton;
    function offerGeneration(){
      if(!current(session,draft)||generation||session.saved||draft.imageUrl||pendingTask(background.forPlant(draft.id)))return;
      generation=createGeneration({getItem:()=>draft,isCurrent:()=>current(session,draft)&&!session.saving&&!session.saved,onBusyChange:busy=>{
        if(!current(session,draft)||(busy&&(session.saving||session.saved)))return;
        generating=busy===true;save.disabled=generating||session.saving||session.saved;
        if(detailButton)detailButton.disabled=generating||session.saving;
        if(backgroundButton)backgroundButton.disabled=generating||session.saving||pendingTask(background.forPlant(draft.id));
        save.setAttribute('aria-busy',String(generating||session.saving));
        if(generating){save.textContent='生成中 · 完成后可收藏';session.status.textContent='正在生成 AI 示意图，请等待完成后再收藏。';}
        else if(!session.saved&&!session.saving){save.textContent='快速收藏';session.status.textContent='暂未得到可用生成图片，请查看任务提示；也可按原名待核对收藏。';}
      },onGenerated:image=>{
        if(!current(session,draft)||session.saved||session.saving)return;
        const url=natureImageModel(image).url;
        if(!/^\/generated-images\/[a-f0-9-]{36}\.jpg$/.test(url)){session.status.textContent='生成图片地址无效，未替换当前图片。';return;}
        session.status.textContent='AI 示意图已完成，请核对后收藏；非实拍，不能用于物种鉴定。';
        choose(session,{...draft,imageUrl:url,imageKind:'generated',imageAttribution:typeof image.imageAttribution==='string'?image.imageAttribution.slice(0,1000):'AI 生成示意图 · 非实拍，不能用于物种鉴定'});
      }});
      details.append(generation);
    }
    photo.append(createImage(draft));
    const save=action(session.saved?'已收藏 ✓':draft.imageKind==='generated'?'收藏 AI 示意图卡片':'快速收藏','save',async()=>{
      if(!current(session,draft)||generating||session.saving||session.saved)return;
      session.saving=true;save.disabled=true;save.textContent='收藏中…';save.setAttribute('aria-busy','true');
      try{
        const result=await collector.collect({...draft},session.context);
        if(!current(session,draft))return;
        acceptCollection([...knownCards.filter(card=>card.id!==result.plant.id),result.plant]);
        session.saving=false;choose(session,result.plant);
        session.status.textContent=result.alreadyExists?'已有同名或同种收藏，本次未覆盖原卡。可在万物收藏中继续补充资料。':'已保存这次阅读遇见，可以继续阅读。';
        onSaved(result);
      }catch(error){if(current(session,draft))session.status.textContent=error.message||'收藏暂未完成，请重试。';}
      finally{session.saving=false;if(current(session,draft)){save.disabled=session.saved||generating;save.setAttribute('aria-busy',String(generating));if(!session.saved)save.textContent=generating?'生成中 · 完成后可收藏':'重试收藏';}}
    });
    save.disabled=session.saved;
    detailButton=action(stored?'编辑详细收藏':'详细收藏','detail',async()=>{
      if(!current(session,draft)||generating||session.saving)return;
      detailModal??=createDetails({mount:root.parentElement||document.body||root,request,getCollection:()=>knownCards,onCollection:acceptCollection,createImage,onSaved});
      await detailModal.open({plant:structuredClone(draft),context:session.context});
    });
    async function submitBackground(generate,regenerate=false){
      if(!current(session,draft)||generating||session.saving||(generate&&pendingTask(background.forPlant(draft.id))))return;
      session.saving=true;save.disabled=true;if(backgroundButton)backgroundButton.disabled=true;
      try{
        const task=await background.submit({plant:guideCollectionPayload(draft,session.context),...(stored?{plantId:stored.id}:{}),context:session.context,generate,regenerate});
        if(!current(session,draft))return;
        session.saving=false;choose(session,task.plant||draft);session.status.textContent=taskMessage(task);
        if(task.plant)onSaved({plant:task.plant,alreadyExists:Boolean(stored),background:true,task});
      }catch(error){if(current(session,draft))session.status.textContent=error.message||'后台收藏未开始，请重试。';}
      finally{session.saving=false;if(current(session,draft)){save.disabled=session.saved||generating;if(backgroundButton)backgroundButton.disabled=generating||pendingTask(background.forPlant(draft.id));}}
    }
    details.append(title,photo,caution,metadata,source);
    if(draft.imageAttribution)details.append(node('p','selection-explorer-credit',draft.imageAttribution));
    details.append(save,detailButton);
    const failedTask=background.forPlant(draft.id);
    if(failedTask?.status==='failed'&&failedTask.retryable)details.append(action('恢复服务后重试配图','retry-background',async()=>{if(!current(session,draft)||session.saving)return;session.saving=true;try{const task=await background.retry(failedTask.id);if(current(session,draft)){session.saving=false;choose(session,task.plant||draft);session.status.textContent=taskMessage(task);}}catch(error){if(current(session,draft))session.status.textContent=error.message||'重试连接暂不可用，收藏仍保留。';}finally{session.saving=false;}}));
    if(stored)details.append(action('追加本次阅读出处','record-encounter',()=>submitBackground(false)));
    if(!draft.imageUrl){
      const task=background.forPlant(draft.id);
      backgroundButton=action(pendingTask(task)?'后台配图中 · 可继续阅读':stored?'后台补图并记录遇见':'后台生成并收藏','background',()=>submitBackground(true));
      backgroundButton.disabled=pendingTask(task);details.append(backgroundButton);
      if(pendingTask(task))session.status.textContent=taskMessage(task);
    }
    else if(stored&&/^\/generated-images\/[a-f0-9-]{36}\.jpg$/.test(draft.imageUrl)){
      const task=background.forPlant(draft.id);backgroundButton=action(pendingTask(task)?'后台重新生成中 · 可继续阅读':'重新生成 AI 示意图','regenerate',()=>submitBackground(true,true));backgroundButton.disabled=pendingTask(task);details.append(backgroundButton);
    }
    if(!draft.imageUrl)offerGeneration();
  }

  async function open({text,context={},pageKey=getPageKey()}){
    const name=selectionExplorerName(text);if(!name){invalidate();return false;}
    invalidate();
    syncCollection(getCollection());
    const session={name,pageKey,context:Object.freeze(readingContext({...context,quote:context.quote??text})),controller:new AbortController(),saving:false,saved:false};active=session;
    root.hidden=false;
    const header=node('div','selection-explorer-heading');const title=node('h3','',`探索「${name}」`);title.id='selection-explorer-title';
    const close=action('×','close',invalidate);close.setAttribute('aria-label','关闭选词探索');
    header.append(title,close);root.setAttribute('aria-labelledby',title.id);
    const status=node('p','selection-explorer-status','正在按名称查找资料…');status.setAttribute('role','status');session.status=status;
    const results=node('div','selection-explorer-results');session.details=node('div','selection-explorer-details');
    root.append(header,node('p','selection-explorer-intro','名称线索需核对。仅查询名称，原书片段留在本机。'),status,results,session.details);
    const timer=setTimeout(()=>session.controller.abort(),22000);
    const revision=collectionRevision;
    const refreshing=(async()=>{try{const response=await request('/api/plants',{signal:session.controller.signal});const data=await response.json();if(response.ok&&Array.isArray(data.plants)&&current(session)&&revision===collectionRevision)acceptCollection(data.plants);}catch{}})();
    void background.resume().catch(()=>{});
    try{
      const response=await request(`/api/search?q=${encodeURIComponent(name)}&kind=all`,{signal:session.controller.signal});
      if(!current(session))return false;
      const data=await response.json();if(!current(session))return false;
      await refreshing;if(!current(session))return false;
      if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'查询暂不可用');
      const candidates=sortPhotoCandidates((Array.isArray(data.results)?data.results:[]).filter(item=>item&&typeof item.name==='string'&&item.name.trim()&&item.name.length<=120&&relevantCandidate(name,item)).slice(0,20)).slice(0,6);
      const warning=typeof data.warning==='string'?data.warning.slice(0,300):'';
      status.textContent=candidates.length?`找到 ${candidates.length} 条参考资料，请选择候选；名称相同不代表已确认原书物种。${warning}`:`暂未找到匹配资料。可按原名生成 AI 示意图，或直接待核对收纳。${warning}`;
      for(const candidate of candidates){
        const image=natureImageModel(candidate);
        const button=action(`${candidate.name} · ${candidate.scientificName||'学名待核对'} · ${image.url?'有参考图':'暂无可用图片'}`,'choose',()=>choose(session,candidate));
        results.append(button);
      }
      if(candidates.length)results.append(action(`仍按原名「${name}」待核对收纳`,'keep-name',()=>choose(session,unverifiedNameCard(name))));
      else choose(session,unverifiedNameCard(name));
    }catch(error){
      if(!current(session))return false;
      status.textContent='资料查询暂不可用，未确认名称对应的物种。仍可按原名生成 AI 示意图或待核对收纳。';
      choose(session,unverifiedNameCard(name));
    }finally{clearTimeout(timer);}
    return true;
  }
  async function regenerateGuide(guide,context){
    const source=Object.freeze(readingContext(context));
    let card=storedCard(guide)||findCollectedGuide(getCollection(),guide);
    if(!card){
      if(!/^\/generated-images\/[a-f0-9-]{36}\.jpg$/.test(natureImageModel(guide).url))throw new Error('仅 AI 示意图可重新生成');
      card=(await background.submit({plant:guideCollectionPayload(guide,source),context:source,generate:false})).plant;
    }
    if(!card||!/^\/generated-images\/[a-f0-9-]{36}\.jpg$/.test(natureImageModel(card).url))throw new Error('仅 AI 示意图可重新生成，资料照片会保留');
    return background.submit({plant:guideCollectionPayload({...card,lookupName:card.name},source),plantId:card.id,context:source,generate:true,regenerate:true});
  }
  return {open,invalidate,syncCollection,regenerateGuide,retryTask:background.retry,detailOpen:()=>detailModal?.isOpen()===true,resumeTasks:background.resume,subscribeTasks:background.subscribe,getTasks:background.getTasks,taskForGuide(guide){const card=storedCard(guide)||findCollectedGuide(getCollection(),guide);return card?background.forPlant(card.id):null;}};
}
