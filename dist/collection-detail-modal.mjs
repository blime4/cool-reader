import {guideCollectionPayload,findCollectedGuide} from './guide-collection.mjs';
import {readingContext,applyReadingToCard} from './reading-links.mjs';
import {createNatureImage} from './nature-image-view.mjs';

const node=(tag,className='',text)=>{const element=document.createElement(tag);element.className=className;if(text!==undefined)element.textContent=text;return element;};
const list=value=>[...new Set(value.split(/[,，;；\n]+/u).map(item=>item.trim()).filter(Boolean))];
export function createCollectionDetailModal({mount,request=fetch,getCollection=()=>[],onCollection=()=>{},onSaved=()=>{},createImage=createNatureImage}){
  const dialog=node('dialog','collection-detail-modal');dialog.setAttribute('aria-label','详细收藏');mount.append(dialog);
  let active;
  const current=session=>active===session&&dialog.open;
  function close(){const trigger=active?.trigger;active=null;if(dialog.open)dialog.close();trigger?.focus?.();}
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!active?.saving)close();});
  dialog.addEventListener('close',()=>{if(!dialog.open)active=null;});
  async function open({plant,context={}}){
    const session={plant:structuredClone(plant),context:Object.freeze(readingContext(context)),trigger:document.activeElement,saving:false,loaded:false,conflict:false};active=session;
    const form=node('form','collection-detail-content');dialog.replaceChildren(form);
    const heading=node('h2','',plant.id?'编辑收藏':'详细收藏');const cancel=node('button','collection-detail-close','×');cancel.type='button';cancel.setAttribute('aria-label','关闭详细收藏');cancel.addEventListener('click',()=>{if(!session.saving)close();});
    const intro=node('p','collection-detail-hint','原文仅作为本次阅读出处保存在本机；名称和分类资料仍需核对。');
    const photo=node('div','collection-detail-photo');const credit=node('p','collection-detail-credit');
    const fields={};const grid=node('div','collection-detail-fields');
    function field(key,label,{max=120,rows,options}={}){
      const wrapper=node('label','collection-detail-field',label);const input=node(options?'select':rows?'textarea':'input');input.dataset.field=key;
      if(options)for(const [value,text]of options){const option=node('option','',text);option.value=value;input.append(option);}
      else{input.maxLength=max;if(rows)input.rows=rows;else input.type='text';}
      wrapper.append(input);grid.append(wrapper);fields[key]=input;return input;
    }
    field('name','名称',{max:120}).required=true;
    field('scientificName','学名',{max:180});
    field('kind','类别',{options:[['plant','植物'],['bird','鸟类'],['animal','其他动物'],['other','其他 / 待核对']]});
    field('status','认识状态',{options:[['想了解','想了解'],['已认识','已认识'],['待观察','待观察']]});
    field('aliases','别名（逗号或换行分隔）',{max:4000,rows:2});
    field('tags','标签（逗号或换行分隔）',{max:1300,rows:2});
    field('notes','阅读笔记',{max:12000,rows:7});
    const provenance=node('section','collection-detail-provenance');provenance.append(node('strong','','本次阅读出处'),node('p','',[session.context.sourceBook,session.context.chapter,session.context.page].filter(Boolean).join(' · ')),node('blockquote','',session.context.quote));
    const message=node('p','collection-detail-message','正在读取最新收藏…');message.setAttribute('role','status');
    const save=node('button','button button-dark','保存收藏');save.type='submit';save.dataset.action='save-detail';save.disabled=true;
    const reload=node('button','text-button','重新加载最新卡片（放弃本窗口修改）');reload.type='button';reload.dataset.action='reload-detail';reload.hidden=true;
    const actions=node('div','collection-detail-actions');actions.append(save,reload);form.append(cancel,heading,intro,photo,credit,grid,provenance,message,actions);
    if(!dialog.open)dialog.showModal();
    function fill(card){
      session.base=card;session.loaded=true;session.conflict=false;
      heading.textContent=card.id?'编辑收藏':'详细收藏';
      for(const key of ['name','scientificName','kind','status','notes'])fields[key].value=card[key]??(key==='kind'?'other':key==='status'?'想了解':'');
      fields.aliases.value=(Array.isArray(card.aliases)?card.aliases:[]).join('，');fields.tags.value=(Array.isArray(card.tags)?card.tags:[]).join('，');
      photo.replaceChildren(createImage(card));credit.textContent=card.imageAttribution||'';
      message.textContent=card.id?'已载入最新卡片；保存时会追加本次阅读出处。':'可补充资料后收藏；关闭窗口不会保存。';save.disabled=false;reload.hidden=true;
    }
    async function load(){
      session.loaded=false;save.disabled=true;reload.hidden=true;
      try{
        const response=await request('/api/plants');const data=await response.json();if(!current(session))return;
        if(!response.ok||!Array.isArray(data.plants))throw new Error(data.error||'无法读取最新收藏，请重试。');
        const existing=session.plant.id?data.plants.find(card=>card.id===session.plant.id):findCollectedGuide(data.plants,session.plant);
        if(session.plant.id&&!existing)throw new Error('该收藏已被删除或移除，请关闭窗口后重新核对。');
        if(existing&&!/^[a-f0-9]{64}$/.test(existing.editVersion||''))throw new Error('本机服务尚未提供版本保护，请重启本机服务后重试。');
        fill(existing||{...guideCollectionPayload(session.plant,session.context),notes:session.plant.notes||'',aliases:session.plant.aliases||[]});
      }catch(error){if(current(session)){message.textContent=error.message||'读取失败，请重试。';reload.hidden=false;}}
    }
    reload.addEventListener('click',()=>load());
    async function saveDetail(event){
      event.preventDefault();if(!current(session)||!session.loaded||session.saving||session.conflict)return;
      const values={name:fields.name.value.trim(),scientificName:fields.scientificName.value.trim(),kind:fields.kind.value,status:fields.status.value,aliases:list(fields.aliases.value),tags:list(fields.tags.value),notes:fields.notes.value};
      if(!values.name||values.name.length>120||values.scientificName.length>180){message.textContent='请填写名称，并检查名称和学名的长度。';return;}
      if(values.aliases.length>30||values.aliases.some(value=>value.length>120)||values.tags.length>30||values.tags.some(value=>value.length>40)){message.textContent='别名和标签最多各 30 项；别名每项不超过 120 字，标签不超过 40 字。';return;}
      const card=applyReadingToCard({...session.base,...values},session.context,{isNew:!session.base.id});
      if(card.notes.length>12000){message.textContent='追加本次出处后笔记超过 12000 字，请精简后再保存。';return;}
      const payload=session.base.id?{...values,notes:card.notes}:card;
      if(session.base.id)for(const key of Object.keys(session.context))if(card[key]!==session.base[key])payload[key]=card[key];
      session.saving=true;save.disabled=true;cancel.disabled=true;message.textContent='正在保存到本机收藏…';
      try{
        const response=await request(session.base.id?`/api/plants/${encodeURIComponent(session.base.id)}`:'/api/plants',{method:session.base.id?'PUT':'POST',headers:{'Content-Type':'application/json',...(session.base.id?{'If-Match':`"${session.base.editVersion}"`}:{})},body:JSON.stringify(payload)});
        const data=await response.json();
        if(response.status===409){if(current(session)){session.conflict=true;reload.hidden=false;}throw new Error(data.error||'卡片已修改或有重复收藏，请重新加载后核对；当前输入尚未保存。');}
        if(!response.ok||!data.plant?.id)throw new Error(data.error||'保存结果不完整，请重新加载收藏确认。');
        const known=getCollection();const previous=known.find(item=>item.id===data.plant.id);if(!previous||!previous.updatedAt||!data.plant.updatedAt||Date.parse(previous.updatedAt)<=Date.parse(data.plant.updatedAt))onCollection([...known.filter(item=>item.id!==data.plant.id),data.plant]);
        if(current(session)){onSaved({plant:data.plant,alreadyExists:Boolean(session.base.id),detailed:true});close();}
      }catch(error){if(current(session))message.textContent=error.message||'保存失败，请稍后重试。';}
      finally{session.saving=false;if(current(session)){save.disabled=session.conflict;cancel.disabled=false;}}
    }
    form.addEventListener('submit',saveDetail);
    // The button handler also serves keyboard-independent callers; preventDefault avoids a second native submit.
    save.addEventListener('click',saveDetail);
    await load();
  }
  return {open,close,isOpen:()=>Boolean(active&&dialog.open)};
}
