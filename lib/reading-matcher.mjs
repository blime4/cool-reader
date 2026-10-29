import {ApiError} from './plants-store.mjs';
const validTerm=value=>typeof value==='string'&&value.trim().length>=2&&value.trim().length<=80&&!/[<>\u0000-\u001f]/.test(value)&&/\p{L}/u.test(value);
export function buildNameMatcher(records=[]){
  const terms=new Map();
  for(const record of records){
    if(!record||typeof record.scientificName!=='string'||!record.scientificName)continue;
    for(const [values,type] of [[[record.name,record.scientificName],'exact'],[record.aliases??[],'alias'],[record.readingTerms??[],'candidate']]){
      if(!Array.isArray(values))continue;
      for(const value of values){if(!validTerm(value))continue;const name=value.trim(),key=name.toLowerCase();
        if(!terms.has(key))terms.set(key,{name,key,items:[]});const item=terms.get(key);
        const identity=(record.kind??'other')+':'+record.scientificName.toLowerCase();
        if(item.items.some(candidate=>candidate.identity===identity))continue;
        item.items.push({record,type,identity});
      }
    }
  }
  const prefixes=new Map();for(const term of terms.values()){const prefix=term.key.slice(0,2);if(!prefixes.has(prefix))prefixes.set(prefix,[]);prefixes.get(prefix).push(term);}
  for(const bucket of prefixes.values())bucket.sort((a,b)=>b.name.length-a.name.length);
  return function matchPage(text){
    if(typeof text!=='string'||text.length>10000)throw new ApiError(400,'每次仅匹配一页不超过 10000 字的原文');
    const found=new Map();
    for(let offset=0;offset<text.length-1;offset++){
      const bucket=prefixes.get(text.slice(offset,offset+2).toLowerCase());if(!bucket)continue;
      for(const term of bucket){
        const end=offset+term.name.length;if(text.slice(offset,end).toLowerCase()!==term.key)continue;
        if(!/\p{Script=Han}/u.test(term.name)&&(/[A-Za-z]/.test(text[offset-1]??'')||/[A-Za-z]/.test(text[end]??'')))continue;
        if(!found.has(term.key))found.set(term.key,{literalName:text.slice(offset,end),offset,length:end-offset,count:0,ranges:[],quote:text.slice(Math.max(0,offset-65),end+100).slice(0,1000),term});
        const match=found.get(term.key);match.count++;match.ranges.push({start:offset,end});offset=end-1;break;
      }
    }
    return [...found.values()].slice(0,16).map(({term,...match})=>{
      const groupRanks=['phylum','class','subclass','order','suborder','infraorder','family','subfamily','superfamily','tribe','genus','subgenus'];
      const sameGroupKind=term.items.every(item=>item.record.kind===term.items[0].record.kind&&groupRanks.includes(item.record.taxonRank));
      const representative=record=>sameGroupKind&&record.imageUrl&&record.readingRepresentative?.literalName?.toLowerCase()===term.key&&validTerm(record.readingRepresentative.name)&&validTerm(record.readingRepresentative.scientificName)?record.readingRepresentative:null;
      return {...match,candidates:[...term.items].sort((a,b)=>Number(Boolean(representative(b.record)))-Number(Boolean(representative(a.record)))||Number(Boolean(b.record.imageUrl))-Number(Boolean(a.record.imageUrl))).slice(0,3).map(({record,type})=>{
      const result={};for(const key of ['name','scientificName','kind','taxonId','taxonRank','imageUrl','imageAttribution','imageLicense','imageSource','sourceUrl','sourceUrls','sourceLabel','description','readingNote'])if(record[key]!==undefined)result[key]=record[key];
      return {...result,...(representative(record)?{readingRepresentative:representative(record)}:{}),matchType:type,matchNote:type==='candidate'?(record.readingNote??'原文用字线索，候选身份待核对，不代表标准别名。'):(record.matchNote??'名称字面匹配，原书物种身份仍待核对。')};
    })};});
  };
}
