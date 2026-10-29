const STORAGE_KEY = 'folio.readerTypography.v1';
export const TYPOGRAPHY_PRESETS = Object.freeze({
  paper:{fontSize:16,lineHeight:1.9,letterSpacing:.2,pagePadding:28,fontFamily:'serif'},
  immersive:{fontSize:19,lineHeight:2.15,letterSpacing:.4,pagePadding:34,fontFamily:'kai'},
  compact:{fontSize:14,lineHeight:1.55,letterSpacing:0,pagePadding:18,fontFamily:'serif'},
});
export const DEFAULT_TYPOGRAPHY = TYPOGRAPHY_PRESETS.paper;
const ranges = {fontSize:[12,24],lineHeight:[1.45,2.4],letterSpacing:[0,2],pagePadding:[12,44]};
const fonts = {serif:'var(--serif)',kai:'"KaiTi","STKaiti","Kaiti SC",serif',sans:'var(--sans)'};
const clamp = (value,[min,max],fallback) => Number.isFinite(Number(value)) ? Math.min(max,Math.max(min,Number(value))) : fallback;
export function normalizeTypography(value={}) {
  return {
    fontSize:clamp(value.fontSize,ranges.fontSize,DEFAULT_TYPOGRAPHY.fontSize),
    lineHeight:clamp(value.lineHeight,ranges.lineHeight,DEFAULT_TYPOGRAPHY.lineHeight),
    letterSpacing:clamp(value.letterSpacing,ranges.letterSpacing,DEFAULT_TYPOGRAPHY.letterSpacing),
    pagePadding:clamp(value.pagePadding,ranges.pagePadding,DEFAULT_TYPOGRAPHY.pagePadding),
    fontFamily:Object.hasOwn(fonts,value.fontFamily) ? value.fontFamily : DEFAULT_TYPOGRAPHY.fontFamily,
  };
}
export function typographyPreset(settings) {
  return Object.entries(TYPOGRAPHY_PRESETS).find(([,preset])=>Object.keys(preset).every(key=>preset[key]===settings[key]))?.[0] || '';
}
export function createReaderTypography({panel,toggle,close,root,inputs,outputs,presetButtons=[],reset,storage,document:doc=document,onChange=()=>{}}) {
  function read() { try { return normalizeTypography(JSON.parse(storage?.getItem(STORAGE_KEY) || '{}')); } catch { return normalizeTypography(); } }
  let settings = read();
  function render({persist=true}={}) {
    root.style.setProperty('--reader-full-font-size',`${settings.fontSize}px`);
    root.style.setProperty('--reader-page-font-size',`${(settings.fontSize * .5125).toFixed(2)}px`);
    root.style.setProperty('--reader-line-height',String(settings.lineHeight));
    root.style.setProperty('--reader-letter-spacing',`${settings.letterSpacing}px`);
    root.style.setProperty('--reader-full-page-padding-x',`${settings.pagePadding}px`);
    root.style.setProperty('--reader-page-padding-x',`${Math.round(settings.pagePadding * 9 / 14)}px`);
    root.style.setProperty('--reader-page-font',fonts[settings.fontFamily]);
    for (const [key,input] of Object.entries(inputs)) {
      if (key === 'fontFamily') for (const radio of input) radio.checked = radio.value === settings.fontFamily;
      else input.value = String(settings[key]);
    }
    outputs.fontSize.value = `${settings.fontSize} px`;
    outputs.lineHeight.value = settings.lineHeight.toFixed(2);
    outputs.letterSpacing.value = `${settings.letterSpacing.toFixed(1)} px`;
    outputs.pagePadding.value = `${settings.pagePadding} px`;
    const selected = typographyPreset(settings);
    for (const button of presetButtons) button.setAttribute('aria-pressed',String(button.dataset.readerPreset === selected));
    if (persist) { try { storage?.setItem(STORAGE_KEY,JSON.stringify(settings)); } catch {} }
    onChange({...settings});
  }
  function update(key,value) { settings = normalizeTypography({...settings,[key]:value}); render(); }
  function setOpen(value) { panel.hidden = !value; toggle.setAttribute('aria-expanded',String(value)); if (value) close.focus({preventScroll:true}); else toggle.focus({preventScroll:true}); }
  toggle.addEventListener('click',()=>setOpen(panel.hidden)); close.addEventListener('click',()=>setOpen(false));
  for (const key of ['fontSize','lineHeight','letterSpacing','pagePadding']) inputs[key].addEventListener('input',event=>update(key,event.target.value));
  for (const radio of inputs.fontFamily) radio.addEventListener('change',event=>{ if (event.target.checked) update('fontFamily',event.target.value); });
  for (const button of presetButtons) button.addEventListener('click',()=>{ settings = normalizeTypography(TYPOGRAPHY_PRESETS[button.dataset.readerPreset]); render(); });
  reset.addEventListener('click',()=>{ settings = normalizeTypography(); render(); });
  doc.addEventListener('keydown',event=>{ if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); setOpen(false); } });
  doc.addEventListener('pointerdown',event=>{ if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) setOpen(false); });
  render({persist:false});
  return {get settings(){ return {...settings}; },update,setOpen,reset(){ settings=normalizeTypography();render(); }};
}
