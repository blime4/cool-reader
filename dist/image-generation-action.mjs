async function request(url,options={}){
  const response=await fetch(url,{...options,headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(10000)});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'本地图像服务未响应');return value;
}
export function createGenerationAction({getItem,onGenerated,isCurrent=()=>true}){
  const root=document.createElement('div');root.className='image-generation-action';
  const button=document.createElement('button');button.type='button';button.className='secondary-button';button.textContent='生成 AI 示意图';
  const message=document.createElement('p');message.setAttribute('role','status');message.textContent='没有可用实拍时，可由本地 Qwen 生成示意图；不能用于物种鉴定。';
  root.append(button,message);
  button.addEventListener('click',async()=>{
    button.disabled=true;
    const item=getItem();const identity=value=>JSON.stringify([value.name,value.scientificName||'',value.kind||'other']);
    const snapshot=identity(item);const current=()=>root.isConnected&&isCurrent()&&identity(getItem())===snapshot;
    try{
      const health=await request('/api/image-generation/health');if(!current())return;if(!health.ready)throw new Error(health.reason||'请先按 README 启动本地 Diffusers 服务。');
      const result=await request('/api/image-generation/jobs',{method:'POST',body:JSON.stringify({name:item.name,scientificName:item.scientificName||'',kind:item.kind||'other'})});
      if(!current())return;
      message.textContent='正在本机生成 AI 示意图，首次加载模型可能需要数分钟。可以继续阅读；当前卡片保存后才会保留新图。';
      const deadline=Date.now()+30*60*1000;
      while(Date.now()<deadline){
        await new Promise(resolve=>setTimeout(resolve,2000));
        if(!current())return;
        const {job}=await request(`/api/image-generation/jobs/${encodeURIComponent(result.job.id)}`);
        if(!current())return;
        if(job.status==='failed')throw new Error(job.error||'生成失败');
        if(job.status==='done'){message.textContent='AI 生成示意图已完成。请核对并保存卡片；这不是实拍，也不确认原书物种。';onGenerated(job.image);button.hidden=true;return;}
      }
      throw new Error('生成等待超时，请查看本地模型服务。');
    }catch(error){message.textContent=error.message||'本地生成未完成';}
    finally{button.disabled=false;}
  });
  return root;
}
