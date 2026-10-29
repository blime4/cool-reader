import {natureImageModel} from './nature-image-view.mjs';

export function sortPhotoCandidates(results) {
  return results.map((item,index)=>({item,index,photo:Boolean(natureImageModel(item).url)})).sort((a,b)=>Number(b.photo)-Number(a.photo)||a.index-b.index).map(entry=>entry.item);
}
export function unverifiedNameCard(name,scope = 'all') {
  return {name:String(name || '').trim().slice(0,120),kind:['plant','animal','bird'].includes(scope) ? scope : 'other',scientificName:'',family:'',genus:'',taxonId:'',imageUrl:'',sourceUrl:'',sourceBook:'',sourceLabel:'名称待核对 · 手动收纳',description:'按原名称先行收纳，暂无可靠分类资料。学名、具体类群和图片均待核对。',notes:'按名称先行收纳，尚未确认具体分类、学名或图片。',tags:['待核对'],status:'想了解'};
}
export function findExistingNameCard(cards,name,scope = 'all') {
  const group = item => ['animal','bird'].includes(item.kind) ? 'animal' : item.kind === 'other' ? 'other' : 'plant';
  const matches = cards.filter(item=>String(item.name || '').trim().toLocaleLowerCase() === String(name).trim().toLocaleLowerCase()).filter(item=>scope === 'all' || group(item) === (scope === 'bird' ? 'animal' : scope));
  return matches.length === 1 ? matches[0] : null;
}
export function taxonomyPresentation(item = {}) {
  const rank = String(item.taxonRank || item.rank || '').toLocaleLowerCase();
  const levels = {species:'种',subspecies:'亚种',genus:'属',subgenus:'亚属',family:'科',subfamily:'亚科',order:'目',suborder:'亚目',class:'纲',phylum:'门',kingdom:'界',tribe:'族',种:'种',属:'属',科:'科',目:'目'};
  const level = levels[rank];
  const higher = Boolean(level && !['种','亚种'].includes(level));
  const rankLabel = level ? `${level}级${higher ? '类群 · 非具体种' : '分类候选'}` : '分类层级待核对';
  const label = String(item.providerLabel || item.sourceLabel || '');
  const unverified = !item.scientificName && /待核对|手动收纳/.test(label);
  return {rankLabel,higher,sourceType:unverified ? '待核对名称' : /离线|本地/.test(label) ? '离线资料' : '来源资料'};
}
export function lookupWarning(data,results) {
  const warnings = [data.warning,...(Array.isArray(data.warnings) ? data.warnings : [])].filter(value=>typeof value === 'string' && value.trim());
  if (!warnings.length) return '';
  if (!results.length) return '在线资料暂不可用或暂无匹配。可以先收纳名称，之后再补充资料。';
  if (results.some(item=>taxonomyPresentation(item).sourceType === '离线资料')) return '已使用离线资料。部分在线来源暂不可用，仍可正常核对并收藏。';
  return '部分在线来源暂不可用，下面的资料仍可核对并收藏。';
}
