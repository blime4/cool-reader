const PROFILES = {
  small:{cardWidth:142,photoHeight:47,titleSize:12,textSize:7,buttonSize:8,buttonHeight:20,cardMaxHeight:220,padding:7,creditSize:6,minSide:128,sideWidth:164,minRailHeight:100,railHeight:140},
  medium:{cardWidth:176,photoHeight:76,titleSize:14,textSize:9,buttonSize:10,buttonHeight:28,cardMaxHeight:270,padding:9,creditSize:8,minSide:182,sideWidth:190,minRailHeight:176,railHeight:176},
  large:{cardWidth:212,photoHeight:104,titleSize:16,textSize:11,buttonSize:12,buttonHeight:34,cardMaxHeight:320,padding:11,creditSize:9,minSide:218,sideWidth:226,minRailHeight:216,railHeight:216},
};
export const normalizeGuideSize = value=>Object.hasOwn(PROFILES,value) ? value : 'medium';
export const guideSizeProfile = value=>PROFILES[normalizeGuideSize(value)];
export function createGuideSize({select,root,storage,onChange = ()=>{}}) {
  let value = 'medium'; try { value = normalizeGuideSize(storage?.getItem('folio-guide-size')); } catch {}
  function apply() {
    select.value = value;
    const profile = guideSizeProfile(value);
    for (const [key,field] of Object.entries({'card-width':'cardWidth','photo-height':'photoHeight','title-size':'titleSize','text-size':'textSize','button-size':'buttonSize','button-height':'buttonHeight','card-max-height':'cardMaxHeight','padding':'padding','credit-size':'creditSize'})) root.style.setProperty(`--guide-${key}`,`${profile[field]}px`);
  }
  apply();
  select.addEventListener('change',()=>{ value = normalizeGuideSize(select.value); apply(); try { storage?.setItem('folio-guide-size',value); } catch {} onChange(value); });
  return {get value() { return value; }};
}
