// Fullscreen is presentation only: it never changes the book or reading position.
export function createReaderFullscreen({panel,enterButton,exitButton,orientationButton,sizeSelect,document:doc = document,onLayout = ()=>{}}) {
  let active = false, front = false, native = false, generation = 0, previousFocus, overflow = '', inertSiblings = [];
  let exitingNative = 0, size = 'large';
  function update(value) {
    if (active === value) return;
    active = value;
    panel.classList.toggle('reader-fullscreen',value);
    panel.classList.toggle('reader-front-view',value && front);
    enterButton.setAttribute('aria-pressed',String(value));
    exitButton.hidden = orientationButton.hidden = !value;
    if (sizeSelect) { sizeSelect.hidden = !value; sizeSelect.value = size; panel.dataset.readerSize = size; }
    if (value) {
      previousFocus = doc.activeElement; overflow = doc.body.style.overflow; doc.body.style.overflow = 'hidden';
      // The CSS fallback has the same keyboard boundary as native fullscreen.
      for (let branch = panel; branch.parentElement && branch !== doc.body; branch = branch.parentElement) {
        for (const sibling of branch.parentElement.children) if (sibling !== branch && !sibling.inert && sibling.tagName !== 'DIALOG' && sibling.id !== 'toast') { sibling.inert = true; inertSiblings.push(sibling); }
      }
      exitButton.focus({preventScroll:true});
    } else {
      doc.body.style.overflow = overflow;
      for (const sibling of inertSiblings) sibling.inert = false;
      inertSiblings = []; previousFocus?.focus({preventScroll:true});
    }
    onLayout({active,front,orientationChanged:false});
  }
  async function enter() {
    if (active) return;
    const version = ++generation; update(true);
    try {
      if (typeof panel.requestFullscreen === 'function') {
        await panel.requestFullscreen();
        if (version !== generation) { if (!active && doc.fullscreenElement === panel) await doc.exitFullscreen(); return; }
        native = doc.fullscreenElement === panel;
      }
    } catch { /* Embedded browsers may deny native fullscreen; CSS mode remains usable. */ }
  }
  async function exit() {
    ++generation;
    native = false;
    // Restore presentation immediately, even if the browser rejects or stalls its native exit.
    update(false);
    if (doc.fullscreenElement === panel) {
      exitingNative++;
      try { await doc.exitFullscreen(); } catch {} finally { exitingNative--; }
    }
  }
  function resize() {
    if (!sizeSelect || !['standard','large','extra'].includes(sizeSelect.value)) return;
    size = sizeSelect.value; panel.dataset.readerSize = size;
    onLayout({active,front,orientationChanged:false});
  }
  function orientation() {
    if (!active) return;
    front = !front; panel.classList.toggle('reader-front-view',front);
    orientationButton.setAttribute('aria-pressed',String(front));
    orientationButton.textContent = front ? '正放 · 切换斜放' : '斜放 · 切换正放';
    onLayout({active,front,orientationChanged:true});
  }
  enterButton.addEventListener('click',enter);
  exitButton.addEventListener('click',exit);
  orientationButton.addEventListener('click',orientation);
  if (sizeSelect) { sizeSelect.value = size; sizeSelect.addEventListener('change',resize); }
  doc.addEventListener('fullscreenchange',()=>{
    if (doc.fullscreenElement === panel) native = true;
    else if (native) { native = false; if (!exitingNative) { ++generation; update(false); } }
  });
  doc.addEventListener('keydown',event=>{
    if (!active || doc.querySelector('dialog[open]')) return;
    if (event.key === 'Escape' && !native) { event.preventDefault(); exit(); }
    if (event.key !== 'Tab') return;
    const controls = [...panel.querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]')].filter(item=>!item.disabled && !item.hidden && item.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  return {enter,exit,orientation,resize,get active() { return active; }};
}
