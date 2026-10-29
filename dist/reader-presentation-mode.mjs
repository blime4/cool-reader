const KEY = 'folio-reader-presentation';
const MODES = new Set(['plain','guides','magazine']);

export function createReaderPresentationMode({buttons,storage,onChange=()=>{}}) {
  const controls = [...buttons];
  const stored = storage?.getItem?.(KEY);
  let value = MODES.has(stored) ? stored : 'guides';
  function render() {
    for (const button of controls) button.setAttribute('aria-pressed',String(button.dataset.readerPresentation === value));
  }
  function set(next,{persist=true,notify=true}={}) {
    if (!MODES.has(next) || next === value) return false;
    value = next;
    if (persist) storage?.setItem?.(KEY,value);
    render();
    if (notify) onChange(value);
    return true;
  }
  for (const button of controls) button.addEventListener('click',()=>set(button.dataset.readerPresentation));
  render();
  return {get value(){ return value; },set};
}
