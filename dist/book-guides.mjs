import {NATURE_WORDS} from './reading-links.mjs';
const IMAGE_HOSTS=new Set(['static.inaturalist.org','inaturalist-open-data.s3.amazonaws.com','upload.wikimedia.org']);
const normalize=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
function validName(value){return typeof value==='string'&&/^[\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z -]{1,59}$/u.test(value.trim())&&( /\p{Script=Han}/u.test(value)||value.trim().length>=3);}
function safeSource(value){if(typeof value!=='string'||value.length>2048)return '';try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function safeImage(value){
  if(typeof value!=='string'||value.length>2048)return '';
  if(/^\/plant-images\/[0-9a-f-]{36}\.jpg$/.test(value)||/^\/plant-assets\/\d{1,15}\.jpg$/.test(value))return value;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&IMAGE_HOSTS.has(url.hostname)?url.href:'';}catch{return '';}
}
function spans(text,name){
  if(!validName(name))return [];
  const pattern=new RegExp(name.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');const results=[];
  for(const match of text.matchAll(pattern)){
    const start=match.index,end=start+match[0].length;
    if(!/\p{Script=Han}/u.test(name)&&(/[A-Za-z]/.test(text[start-1]??'')||/[A-Za-z]/.test(text[end]??'')))continue;
    results.push({start,end});
  }
  return results;
}
function sameIdentity(a,b){
  if(a.kind&&b.kind&&a.kind!==b.kind)return false;
  if(a.taxonId&&b.taxonId)return String(a.taxonId)===String(b.taxonId);
  if(a.scientificName&&b.scientificName)return normalize(a.scientificName)===normalize(b.scientificName);
  return Boolean(a.id&&b.id&&a.id===b.id);
}
export function selectBookGuides(text,collected=[],seeds=[],{limit=2,names=NATURE_WORDS}={}){
  const source=typeof text==='string'?text:'';
  const count=Number.isFinite(limit)?Math.max(0,Math.min(3,Math.floor(limit))):2;if(!source||!count)return [];
  const buckets=new Map();
  for(const [items,isCollected] of [[collected,true],[seeds,false]]){
    if(!Array.isArray(items))continue;
    for(const item of items.slice(0,5000)){
      if(!item||!validName(item.name))continue;const key=normalize(item.name);const matches=spans(source,item.name);if(!matches.length)continue;
      if(!buckets.has(key))buckets.set(key,{name:item.name.trim(),matches,entries:[]});
      buckets.get(key).entries.push({...item,collected:isCollected,imageUrl:safeImage(item.imageUrl)});
    }
  }
  if(Array.isArray(names))for(const name of names.slice(0,5000)){
    if(!validName(name)||buckets.has(normalize(name)))continue;const matches=spans(source,name);if(matches.length)buckets.set(normalize(name),{name:name.trim(),matches,entries:[]});
  }
  const candidates=[];
  for(const bucket of buckets.values()){
    const groups=[];
    for(const entry of bucket.entries){const group=groups.find(group=>group.every(item=>sameIdentity(item,entry)));if(group)group.push(entry);else groups.push([entry]);}
    const ambiguous=groups.length>1;const entries=ambiguous?[]:groups[0]??[];
    const base=entries.find(item=>item.collected)??entries[0];
    const picture=entries.filter(item=>item.imageUrl).sort((a,b)=>Number(b.collected)-Number(a.collected))[0];
    const isCollected=bucket.entries.some(item=>item.collected);const imageUrl=picture?.imageUrl??'';
    candidates.push({name:bucket.name,imageUrl,imageAttribution:picture&&typeof picture.imageAttribution==='string'?picture.imageAttribution.slice(0,1000):'',sourceUrl:safeSource(picture?.sourceUrl??base?.sourceUrl),scientificName:typeof base?.scientificName==='string'?base.scientificName.slice(0,180):'',id:base?.id??'',taxonId:base?.taxonId??'',collected:isCollected,ambiguous,needsConfirmation:true,matchNote:ambiguous?'同名资料有多种物种，请先核对':'名称匹配 · 物种待核对',count:bucket.matches.length,matches:bucket.matches,priority:imageUrl?(isCollected?4:3):(isCollected?2:1)});
  }
  // Prefer the complete literal name where two names cover the same word.
  const occupied=[];
  for(const candidate of [...candidates].sort((a,b)=>b.name.length-a.name.length)){
    candidate.matches=candidate.matches.filter(span=>!occupied.some(other=>span.start<other.end&&span.end>other.start));
    occupied.push(...candidate.matches);
  }
  return candidates.filter(item=>item.matches.length).sort((a,b)=>b.priority-a.priority||a.matches[0].start-b.matches[0].start).slice(0,count).map(item=>{
    const {matches,priority,...guide}=item;const first=matches[0];
    return {...guide,name:source.slice(first.start,first.end),offset:first.start,length:first.end-first.start,ranges:matches.map(({start,end})=>({start,end})),count:matches.length,quote:source.slice(Math.max(0,first.start-65),first.end+100).slice(0,1000)};
  });
}
export function segmentGuideText(text,guides=[],selectedText='',{offset=0}={}){
  const source=typeof text==='string'?text:'';if(!source)return [];
  if(!Number.isSafeInteger(offset)||offset<0)throw new RangeError('文本起始位置无效');
  const ranges=[];
  for(const [guideIndex,guide] of (Array.isArray(guides)?guides:[]).slice(0,3).entries()){
    if(Array.isArray(guide?.ranges)){
      for(const span of guide.ranges){
        if(!Number.isSafeInteger(span?.start)||!Number.isSafeInteger(span?.end)||span.start<offset||span.end>offset+source.length||span.end<=span.start)continue;
        const start=span.start-offset,end=span.end-offset;
        if(typeof guide.name==='string'&&source.slice(start,end).toLowerCase()===guide.name.toLowerCase())ranges.push({start,end,guideIndex});
      }
    }else for(const span of spans(source,guide?.name))ranges.push({...span,guideIndex});
  }
  const chosen=[];for(const range of ranges.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.guideIndex-b.guideIndex))if(!chosen.some(other=>range.start<other.end&&range.end>other.start))chosen.push(range);
  const start=typeof selectedText==='string'&&selectedText?source.indexOf(selectedText):-1;const end=start>=0?start+selectedText.length:-1;
  const boundaries=new Set([0,source.length]);for(const range of chosen){boundaries.add(range.start);boundaries.add(range.end);}if(start>=0){boundaries.add(start);boundaries.add(end);}
  const stops=[...boundaries].sort((a,b)=>a-b);const segments=[];
  for(let index=0;index<stops.length-1;index++){const from=stops[index],to=stops[index+1];if(from===to)continue;const guide=chosen.find(range=>from>=range.start&&to<=range.end);segments.push({text:source.slice(from,to),start:from,end:to,guideIndex:guide?.guideIndex??null,selected:start>=0&&from>=start&&to<=end});}
  return segments;
}
