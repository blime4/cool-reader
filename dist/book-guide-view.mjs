import {segmentGuideText} from './book-guides.mjs';

const node = (tag,className,text) => { const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element; };
const svgNode = tag => document.createElementNS('http://www.w3.org/2000/svg',tag);

export function createBookGuideView({stage,leaves,svg,cards,toggle,status,onLookup}) {
  let enabled = true, suspended = false, transitioning = false, frame = 0, active = -1, autoPage, rendered = {guides:[],parts:[]};
  let guideCards = [], paths = [], dots = [];
  function usable() { return enabled && !suspended && !transitioning && !stage.classList.contains('is-closed') && rendered.guides.length > 0; }
  function visibility() {
    const visible = usable();
    cards.hidden = !visible;
    svg.toggleAttribute('hidden',!visible);
    stage.classList.toggle('has-book-guides',enabled && rendered.guides.length > 0);
    stage.classList.toggle('book-guides-visible',visible);
    schedule();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
  function anchors(index) { return leaves.flatMap(leaf=>Array.from(leaf.querySelectorAll(`.book-guide-word[data-guide="${index}"]`))); }
  function visibleAnchor(index) {
    for (const word of anchors(index)) {
      const leaf = word.closest('.leaf-copy');
      // Use untransformed scroll geometry to reject clipped words, then the projected rectangle for the line.
      const top = word.offsetTop, bottom = top + word.offsetHeight;
      if (top < leaf.scrollTop || bottom > leaf.scrollTop + leaf.clientHeight) continue;
      const rect = word.getBoundingClientRect();
      if (rect.width && rect.height) return rect;
    }
    return null;
  }
  function measure() {
    frame = 0;
    if (!usable()) return;
    const stageRect = svg.getBoundingClientRect();
    svg.setAttribute('viewBox',`0 0 ${stageRect.width} ${stageRect.height}`);
    for (const [index,card] of guideCards.entries()) {
      const rect = visibleAnchor(index);
      paths[index].style.display = dots[index].style.display = rect ? '' : 'none';
      card.classList.toggle('guide-word-offscreen',!rect);
      if (!rect) continue;
      const cardRect = card.getBoundingClientRect();
      const x = (rect.left+rect.right)/2-stageRect.left, y = rect.bottom-stageRect.top;
      const endX = (cardRect.left+cardRect.right)/2-stageRect.left, endY = cardRect.top-stageRect.top;
      const elbowY = y + Math.max(20,(endY-y)*.55);
      paths[index].setAttribute('d',`M ${x} ${y} C ${x} ${elbowY}, ${endX} ${elbowY}, ${endX} ${endY}`);
      dots[index].setAttribute('cx',x); dots[index].setAttribute('cy',y);
    }
  }
  function emphasize(index) {
    active = index;
    for (const [i,card] of guideCards.entries()) {
      card.classList.toggle('is-emphasized',i === index);
      paths[i].classList.toggle('is-emphasized',i === index);
      for (const word of anchors(i)) word.classList.toggle('is-emphasized',i === index);
    }
  }
  function locate(index,focus = true) {
    const word = anchors(index)[0];
    if (!word) return;
    const leaf = word.closest('.leaf-copy');
    leaf.scrollTop = Math.max(0,word.offsetTop - leaf.clientHeight*.4);
    if (focus) word.focus({preventScroll:true});
    emphasize(index); schedule();
  }
  function paintLeaf(leaf,text,selectedText,guides,offset) {
    const scroll = leaf.scrollTop;
    leaf.replaceChildren(); let mark;
    for (const segment of segmentGuideText(text,guides,selectedText,{offset})) {
      let parent = leaf;
      if (segment.selected) { if (!mark) { mark = node('mark',''); leaf.append(mark); } parent = mark; } else mark = null;
      if (segment.guideIndex === null) { parent.append(document.createTextNode(segment.text)); continue; }
      const index = segment.guideIndex;
      const word = node('button','book-guide-word',segment.text);
      word.type = 'button'; word.dataset.guide = index;
      word.setAttribute('aria-label',`${guides[index].name}，定位书引图片`);
      word.addEventListener('mouseenter',()=>emphasize(index)); word.addEventListener('mouseleave',()=>emphasize(-1));
      word.addEventListener('focus',()=>emphasize(index)); word.addEventListener('blur',()=>emphasize(-1));
      word.addEventListener('click',()=>{ emphasize(index); guideCards[index]?.querySelector('.book-guide-locate')?.focus({preventScroll:true}); });
      parent.append(word);
    }
    leaf.scrollTop = scroll;
  }
  function render({guides,parts,key,autoLocate = false}) {
    rendered = {guides:guides.slice(0,2),parts,key,autoLocate};
    guideCards = []; paths = []; dots = []; cards.replaceChildren(); svg.replaceChildren();
    for (const [index,part] of parts.entries()) paintLeaf(leaves[index],part.text,part.selectedText,enabled ? rendered.guides : [],part.offset || 0);
    for (const [index,guide] of rendered.guides.entries()) {
      const card = node('article','book-guide-card'); card.setAttribute('aria-label',`${guide.name}书引图片卡`);
      const photo = node('div','book-guide-photo');
      const fallback = () => { photo.replaceChildren(node('span','book-guide-placeholder',guide.ambiguous ? '同名物种 · 请核对' : '暂无图片 · 去查找')); schedule(); };
      if (guide.imageUrl) {
        const image = node('img',''); image.alt = `${guide.name}名称匹配的参考图片，物种待核对`; image.src = guide.imageUrl; image.referrerPolicy = 'no-referrer';
        image.addEventListener('load',schedule); image.addEventListener('error',fallback,{once:true}); photo.append(image);
      } else fallback();
      const body = node('div','book-guide-body'); body.append(node('h3','',guide.name),node('p','book-guide-caution',guide.matchNote || '名称匹配 · 物种待核对'));
      const actions = node('div','book-guide-actions');
      const find = node('button','book-guide-locate','定位名称'); find.type = 'button'; find.addEventListener('click',()=>locate(index));
      const lookup = node('button','book-guide-lookup',guide.imageUrl ? (guide.collected ? '查看 / 去收藏 ↗' : '去收藏 ↗') : '查找图片 / 去收藏 ↗'); lookup.type = 'button'; lookup.addEventListener('click',()=>onLookup(guide));
      actions.append(find,lookup); body.append(actions);
      card.append(photo,body);
      if (guide.imageAttribution) { const credit = node('p','book-guide-credit',guide.imageAttribution); credit.title = guide.imageAttribution; card.append(credit); }
      card.addEventListener('mouseenter',()=>emphasize(index)); card.addEventListener('mouseleave',()=>emphasize(-1));
      card.addEventListener('focusin',()=>emphasize(index)); card.addEventListener('focusout',()=>emphasize(-1));
      guideCards.push(card); cards.append(card);
      const path = svgNode('path'); path.setAttribute('class','book-guide-line'); const dot = svgNode('circle'); dot.setAttribute('class','book-guide-dot'); dot.setAttribute('r','2.1');
      svg.append(path,dot); paths.push(path); dots.push(dot);
    }
    status.textContent = rendered.guides.length ? `本页 ${rendered.guides.length} 个名称` : '本页暂无书引';
    visibility(); emphasize(active);
    if (autoPage !== key) {
      autoPage = key;
      const index = rendered.guides.findIndex(guide=>guide.imageUrl);
      if (autoLocate && index >= 0) requestAnimationFrame(()=>{ if (rendered.key === key && usable() && !visibleAnchor(index)) locate(index,false); });
    }
  }
  toggle.addEventListener('click',()=>{ enabled = !enabled; toggle.setAttribute('aria-pressed',String(enabled)); toggle.textContent = enabled ? '已开启' : '已关闭'; render(rendered); });
  for (const leaf of leaves) leaf.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  stage.addEventListener('transitionend',event=>{ if (event.target.classList.contains('physical-book') && event.propertyName === 'transform') { transitioning = false; visibility(); } });
  stage.addEventListener('transitioncancel',event=>{ if (event.target.classList.contains('physical-book') && event.propertyName === 'transform') schedule(); });
  const observer = new ResizeObserver(schedule); observer.observe(stage); observer.observe(cards);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',event=>{ if (event.matches) { transitioning = false; visibility(); } });
  return {render,schedule, reset() { suspended = transitioning = false; visibility(); }, suspend(value) { suspended = value; visibility(); }, bookTransition() { transitioning = !matchMedia('(prefers-reduced-motion: reduce)').matches; visibility(); }};
}
