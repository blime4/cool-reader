import {guideSizeProfile} from './guide-size.mjs';
export const normalizeGuideDensity = value=>[4,8,12,16].includes(Number(value)) ? Number(value) : 4;
export function createGuideDensity({select,stage,storage,onChange = ()=>{}}) {
  let value = 4;
  try { value = normalizeGuideDensity(storage?.getItem('folio-guide-density')); } catch {}
  const apply = ()=>{ select.value = String(value); stage.dataset.guideDensity = String(value); };
  apply();
  select.addEventListener('change',()=>{ value = normalizeGuideDensity(select.value); apply(); try { storage?.setItem('folio-guide-density',String(value)); } catch {} onChange(value); });
  return {get value() { return value; }};
}
export function guideRailLayout({width,height,book,size = 'small'}) {
  const profile = guideSizeProfile(size);
  const rails = [], gap = 12, top = 34, bottom = height-38;
  const left = Math.max(gap,book.left-gap), right = Math.min(width-gap,book.right+gap);
  const side = (edge,x,w)=>{if(w >= profile.minSide && bottom-top >= profile.minRailHeight) rails.push({edge,x,y:top,width:Math.min(profile.sideWidth,w),height:bottom-top,vertical:true});};
  if (width >= 740) { side('left',gap,left-gap); const w = Math.min(profile.sideWidth,width-gap-right); side('right',width-gap-w,w); }
  const sideLeft = rails.find(rail=>rail.edge === 'left'), sideRight = rails.find(rail=>rail.edge === 'right');
  const x = sideLeft ? sideLeft.x+sideLeft.width+gap : gap, end = sideRight ? sideRight.x-gap : width-gap;
  const add = (edge,y,space)=>{ if (space >= profile.minRailHeight && end-x >= profile.minSide) { const h = Math.min(profile.railHeight,space); rails.push({edge,x,y:edge === 'bottom'?bottom-h:y,width:end-x,height:h,vertical:false}); } };
  add('top',top,book.top-gap-top); add('bottom',book.bottom+gap,bottom-book.bottom-gap);
  return {mode:rails.length ? width < 740 ? 'edge' : 'perimeter' : 'folded',rails};
}

export function createGuidePerimeter({stage,book,cards,browse,dialog,close,getSize = ()=>'small',onLayout = ()=>{},document:doc = document}) {
  let frame = 0;
  stage.dataset.guideRailMode = 'pending';
  const guides = ()=>[...cards.querySelectorAll('.book-guide-card')];
  const schedule = ()=>{ if (!frame) frame = requestAnimationFrame(arrange); };
  function arrange() {
    frame = 0; const items = guides(); browse.hidden = cards.hidden || !items.length; browse.textContent = `浏览书引 · ${items.length}`;
    if (dialog.open) { onLayout(); return; }
    const bounds = stage.getBoundingClientRect(), projected = book.getBoundingClientRect();
    const layout = guideRailLayout({width:bounds.width,height:bounds.height,size:getSize(),book:{left:projected.left-bounds.left,top:projected.top-bounds.top,right:projected.right-bounds.left,bottom:projected.bottom-bounds.top}});
    stage.dataset.guideRailMode = layout.mode;
    if (layout.mode === 'folded') { cards.dataset.railFolded = 'true'; onLayout(); return; }
    delete cards.dataset.railFolded;
    const rails = layout.rails.map(position=>{
      const rail = doc.createElement('div'); rail.className = `guide-perimeter-rail rail-${position.edge}`;
      rail.setAttribute('aria-label',`${{left:'左侧',right:'右侧',top:'上沿',bottom:'下沿'}[position.edge]}书引，可滚动浏览`); rail.tabIndex = 0;
      for (const [key,value] of Object.entries({left:position.x,top:position.y,width:position.width,height:position.height})) rail.style[key] = `${value}px`;
      rail.addEventListener('scroll',onLayout,{passive:true}); return rail;
    });
    items.forEach((item,index)=>rails[index%rails.length].append(item)); cards.replaceChildren(...rails); onLayout();
  }
  browse.addEventListener('click',()=>{
    const items = guides(); cards.replaceChildren(...items); delete cards.dataset.railFolded;
    dialog.querySelector('.guide-density-dialog-body').append(cards); dialog.showModal(); onLayout();
  });
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{ stage.append(cards); browse.focus({preventScroll:true}); schedule(); });
  const mutations = new MutationObserver(records=>{ if (!cards.children.length || records.some(record=>[...record.addedNodes].some(node=>node.classList?.contains('book-guide-card')))) schedule(); });
  mutations.observe(cards,{childList:true});
  const geometry = new ResizeObserver(schedule); geometry.observe(stage); geometry.observe(book);
  const presentation = new MutationObserver(schedule); presentation.observe(stage.parentElement,{attributes:true,attributeFilter:['class']});
  stage.addEventListener('transitionend',schedule); window.addEventListener('resize',schedule,{passive:true});
  schedule(); return {schedule};
}
