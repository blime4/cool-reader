const pending = task=>['queued','running'].includes(task.status);
const bounded = (value,limit)=>String(value || '').slice(0,limit);
export function queuePresentation(tasks = []) {
  const rows = tasks.filter(task=>task && typeof task.id === 'string').map(task=>{
    const active = pending(task);
    const stage = task.connectionWarning && active ? '连接暂不可用 · 任务可能仍在运行' : task.status === 'done' ? ({'image-present':'已同步 · 保留已有图片','encounter-recorded':'阅读出处已收藏','image-added':'配图已同步到收藏','image-replaced':'配图已同步到收藏'}[task.reason] || '任务已完成') : task.status === 'failed' ? '配图未完成 · 收藏已保留' : task.status === 'cancelled' ? '任务已停止' : ({queued:'排队中',generating:'正在本机生成',writing:'正在写入收藏'}[task.phase || task.status] || '后台处理中');
    const detail = task.status === 'failed' ? task.error : task.connectionWarning || (task.reason === 'identity-changed' ? '名称或分类已修改，未写入旧结果。' : task.reason === 'card-deleted' ? '收藏已删除，未重新创建卡片。' : '');
    return {id:task.id,name:bounded(task.plant?.name || task.name || '未命名任务',120),active,status:task.status,stage,detail:bounded(detail,220)};
  }).sort((a,b)=>Number(b.active)-Number(a.active));
  const active = rows.filter(row=>row.active).length, failed = rows.filter(row=>row.status === 'failed').length, done = rows.filter(row=>row.status === 'done').length;
  return {rows,active,failed,label:active ? `正在生成 ${active}` : failed ? `待处理 ${failed}` : done ? `已完成 ${done}` : `生成记录 ${rows.length}`};
}

export function createGenerationQueueView({root}) {
  const node = (tag,className,text)=>{ const value = document.createElement(tag); value.className = className; if (text !== undefined) value.textContent = text; return value; };
  let tasks = [], expanded = false, timer, completionKey = '', presentation = queuePresentation();
  const dismissed = new Set();
  const toggle = node('button','generation-queue-toggle'); toggle.type = 'button';
  toggle.setAttribute('aria-live','polite');
  const panel = node('section','generation-queue-panel'); panel.id = `${root.id}-list`; panel.hidden = true;
  panel.setAttribute('aria-label','后台生成队列'); toggle.setAttribute('aria-controls',panel.id);
  const heading = node('div','generation-queue-heading'), title = node('strong','','后台配图'), clear = node('button','','清理已结束'); clear.type = 'button';
  heading.append(title,clear);
  const list = node('ul','generation-queue-list');
  const hint = node('p','generation-queue-hint','可继续翻页，配图会同步到收藏。AI 示意图不能用于物种鉴定。');
  panel.append(heading,list,hint); root.replaceChildren(toggle,panel); root.hidden = true;
  function expand(value) { expanded = value; panel.hidden = !value; toggle.setAttribute('aria-expanded',String(value)); }
  function render() {
    presentation = queuePresentation(tasks.filter(task=>!dismissed.has(task.id)));
    const hadFocus = root.contains(document.activeElement);
    root.hidden = presentation.rows.length === 0;
    root.classList.toggle('has-active-tasks',presentation.active > 0); root.classList.toggle('has-failed-tasks',presentation.failed > 0);
    toggle.textContent = `${presentation.active ? '◌ ' : '✓ '}${presentation.label}`;
    toggle.setAttribute('aria-label',`${presentation.label}，${expanded ? '收起' : '展开'}后台队列`);
    clear.disabled = !presentation.rows.some(row=>!row.active);
    list.replaceChildren();
    for (const row of presentation.rows) {
      const item = node('li',`generation-queue-row task-${row.status}`);
      item.append(node('strong','',row.name),node('span','',row.stage));
      if (row.detail) item.append(node('p','',row.detail)); list.append(item);
    }
    if (root.hidden) { expand(false); if (hadFocus) document.getElementById?.('toggle-book')?.focus({preventScroll:true}); }
    const key = !presentation.active && presentation.rows.length ? JSON.stringify(presentation.rows.map(row=>[row.id,row.status])) : '';
    if (key !== completionKey) {
      clearTimeout(timer); completionKey = key;
      if (key) timer = setTimeout(()=>{ if (expanded && panel.contains(document.activeElement)) toggle.focus({preventScroll:true}); expand(false); },6000);
    }
  }
  toggle.addEventListener('click',()=>{ expand(!expanded); render(); });
  clear.addEventListener('click',()=>{ for (const task of tasks) if (!pending(task)) dismissed.add(task.id); render(); });
  root.addEventListener('keydown',event=>{ if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); expand(false); toggle.focus({preventScroll:true}); } });
  expand(false);
  return {update(next) { tasks = Array.isArray(next) ? next : []; for (const task of tasks) if (pending(task)) dismissed.delete(task.id); render(); },get presentation() { return presentation; },destroy() { clearTimeout(timer); }};
}
