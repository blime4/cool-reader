import {applyReadingToCard,readingContext} from './reading-links.mjs';
import {natureImageModel} from './nature-image-view.mjs';
const text = (value,limit) => typeof value === 'string' ? value.trim().slice(0,limit) : '';
const group = kind => ['animal','bird'].includes(kind) ? 'animal' : kind === 'other' ? 'other' : 'plant';
const ranks = new Set(['species','subspecies','variety','form','genus','subgenus','tribe','subfamily','family','superfamily','order','suborder','infraorder','class','subclass','phylum']);
function sourceUrl(value) { try { const url = new URL(value); return typeof value === 'string' && value.length <= 2048 && ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
export function guideCollectionPayload(guide,context) {
  const broad = guide.representative === true;
  const uncertain = guide.ambiguous === true || broad;
  const base = {
    name:text(guide.lookupName || guide.name,120),kind:['plant','animal','bird','other'].includes(guide.kind) ? guide.kind : 'other',
    scientificName:uncertain ? '' : text(guide.scientificName,180),taxonId:!uncertain && /^\d{1,15}$/.test(String(guide.taxonId || '')) ? String(guide.taxonId) : '',
    taxonRank:!uncertain && ranks.has(guide.taxonRank) ? guide.taxonRank : '',family:text(guide.family,120),genus:text(guide.genus,120),
    imageUrl:natureImageModel(guide).url,imageAttribution:text(guide.imageAttribution,1000),sourceUrl:sourceUrl(guide.sourceUrl),
    sourceUrls:[...new Set((Array.isArray(guide.sourceUrls) ? guide.sourceUrls : []).map(sourceUrl).filter(Boolean))].slice(0,8),
    sourceLabel:broad ? '书引 · 类群代表图（待核对）' : '书引 · 名称线索（待核对）',
    description:text(guide.matchNote,6000) || '书中名称匹配，仅作为待核对线索。',
    notes:broad ? `广义类群收藏：照片是类群代表图，非具体种确认。\n${text(guide.matchNote,1000)}` : `由书中名称线索快速收纳，物种身份待核对。\n${text(guide.matchNote,1000)}`,
    tags:broad ? ['待核对','类群','类群代表图'] : ['待核对'],status:'想了解',
  };
  if (!base.name) throw new Error('书引名称为空，请先确认名称。');
  return applyReadingToCard(base,readingContext(context),{isNew:true});
}
export function findCollectedGuide(cards,guide) {
  const name = text(guide.lookupName || guide.name,120).toLocaleLowerCase();
  return cards.find(card=>{
    if (guide.id && card.id === guide.id) return true;
    if (card.taxonId && guide.taxonId) return String(card.taxonId) === String(guide.taxonId);
    if (group(card.kind) !== group(guide.kind)) return false;
    if (card.scientificName && guide.scientificName) return card.scientificName.toLocaleLowerCase() === guide.scientificName.toLocaleLowerCase();
    return String(card.name || '').trim().toLocaleLowerCase() === name;
  }) || null;
}
export function createGuideCollector({getCollection,onCollection,request = fetch}) {
  const pending = new Map();
  return {
    collect(guide,context) {
      const payload = guideCollectionPayload(guide,context);
      const existing = findCollectedGuide(getCollection(),payload);
      if (existing) return Promise.resolve({plant:existing,alreadyExists:true});
      const key = JSON.stringify([payload.kind,payload.name.toLocaleLowerCase(),payload.taxonId || payload.scientificName]);
      if (pending.has(key)) return pending.get(key);
      const job = (async()=>{
        const response = await request('/api/plants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const data = await response.json().catch(()=>({}));
        if (response.status === 409) {
          const refreshed = await request('/api/plants',{method:'GET'});
          const latest = await refreshed.json().catch(()=>({}));
          if (refreshed.ok && Array.isArray(latest.plants)) onCollection(latest.plants);
          const found = findCollectedGuide(getCollection(),payload);
          if (!found) throw new Error('已有相似收藏，请在万物收藏中核对；未新增重复卡片。');
          return {plant:found,alreadyExists:true};
        }
        if (!response.ok || !data.plant?.id) throw new Error(data.error || '暂时无法收藏，请稍后重试。');
        onCollection([...getCollection().filter(card=>card.id !== data.plant.id),data.plant]);
        return {plant:data.plant,alreadyExists:false};
      })();
      const tracked = job.finally(()=>pending.delete(key)); pending.set(key,tracked); return tracked;
    },
  };
}
