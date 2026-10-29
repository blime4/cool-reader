const INTERACTIVE = 'button,a,input,textarea,select,summary,label,[role="button"],[role="link"],[contenteditable]:not([contenteditable="false"]),.book-guide-card,.floating-fragments,.generation-queue,#reader-typography-panel,#selection-explorer,dialog';
const modified = event=>event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing;
const control = target=>Boolean(target?.closest?.(INTERACTIVE));

export function chapterNavigationTarget(pages,index,direction) {
  const chapter = pages[index]?.chapterId;
  if (chapter === undefined) return null;
  let position = index;
  while (position >= 0 && position < pages.length && pages[position].chapterId === chapter) position += direction;
  if (!pages[position]) return null;
  const target = pages[position].chapterId;
  while (position > 0 && pages[position-1].chapterId === target) position--;
  return position;
}

export function createReaderNavigation({stage,document:doc = document,getSelection = ()=>doc.getSelection?.()?.toString() || '',getTarget,getPages,navigate,disabled = ()=>false,clickDelay = 500}) {
  let gesture = null, timer;
  const blocked = event=>event.defaultPrevented || modified(event) || control(event.target) || disabled() || Boolean(doc.querySelector('dialog[open]'));
  function cancel() { clearTimeout(timer); gesture = null; }
  function scrollbar(event) {
    const leaf = event.target?.closest?.('.leaf-copy');
    if (!leaf) return false;
    const rect = leaf.getBoundingClientRect();
    const vertical = leaf.scrollHeight > leaf.clientHeight, horizontal = leaf.scrollWidth > leaf.clientWidth;
    if (event.target === leaf && ((vertical && Number.isFinite(event.offsetX) && event.offsetX >= leaf.clientWidth) || (horizontal && Number.isFinite(event.offsetY) && event.offsetY >= leaf.clientHeight))) return true;
    const gutter = Math.max(12,leaf.offsetWidth-leaf.clientWidth) * rect.width / (leaf.offsetWidth || rect.width || 1);
    return (vertical && event.clientX >= rect.right-gutter) || (horizontal && event.clientY >= rect.bottom-12);
  }
  function destination(direction,chapter = false) {
    const pages = getPages(), index = getTarget();
    const next = chapter ? chapterNavigationTarget(pages,index,direction) : Math.max(0,Math.min(pages.length-1,index+direction));
    if (next !== null && next >= 0 && next !== index) navigate(next);
  }
  function down(event) {
    cancel();
    if (event.button !== 0 || blocked(event) || doc.activeElement?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])') || getSelection().trim() || scrollbar(event)) return;
    gesture = {x:event.clientX,y:event.clientY,id:event.pointerId,released:false};
  }
  function move(event) { if (gesture && Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y) > 6) cancel(); }
  function up(event) {
    if (!gesture) return;
    if (event.pointerId !== gesture.id || Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y) > 6) { cancel(); return; }
    gesture.released = true;
  }
  function click(event) {
    if (event.detail > 1 || !gesture?.released || blocked(event) || getSelection().trim()) { cancel(); return; }
    gesture = null;
    const pages = getPages();
    const rect = stage.getBoundingClientRect();
    const direction = event.target.closest?.('.leaf-left') ? -1 : event.target.closest?.('.leaf-right') ? 1 : event.clientX < rect.left+rect.width/2 ? -1 : 1;
    // Allow a normal double-click interval before committing a single-click page turn.
    timer = setTimeout(()=>{ if (getPages() === pages && !blocked(event) && !getSelection().trim()) destination(direction); },clickDelay);
  }
  function key(event) {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) || blocked(event) || control(doc.activeElement) || getSelection().trim()) return;
    event.preventDefault(); cancel();
    destination(['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1,['ArrowUp','ArrowDown'].includes(event.key));
  }
  const listeners = [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',cancel],['scroll',cancel],['wheel',cancel],['click',click],['dblclick',cancel]];
  const outside = event=>{ if (!stage.contains(event.target)) cancel(); };
  const selectionChanged = ()=>{ if (getSelection().trim()) cancel(); };
  for (const [name,listener] of listeners) stage.addEventListener(name,listener,name === 'scroll');
  doc.addEventListener('keydown',key);
  doc.addEventListener('pointerdown',outside);
  doc.addEventListener('selectionchange',selectionChanged);
  return {cancel,destroy() { cancel(); for (const [name,listener] of listeners) stage.removeEventListener(name,listener,name === 'scroll'); doc.removeEventListener('keydown',key); doc.removeEventListener('pointerdown',outside); doc.removeEventListener('selectionchange',selectionChanged); }};
}
