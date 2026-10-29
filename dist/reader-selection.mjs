import {selectedSpeciesName} from './reading-links.mjs';
export function captureReadingSelection(page,value,insideReading) {
  const text = String(value || '');
  if (!insideReading || !text.trim() || !page?.text?.includes(text)) return null;
  return {pageId:page.id,name:selectedSpeciesName(text),quote:text.slice(0,1000)};
}
export function readingPageMatches(text,matches) {
  if (!Array.isArray(matches)) return [];
  return matches.slice(0,16).flatMap(item=>{
    const name = String(item.literalName || '');
    if (!name || !Number.isInteger(item.offset) || item.offset < 0 || text.slice(item.offset,item.offset+name.length) !== name) return [];
    const candidates = Array.isArray(item.candidates) ? item.candidates.slice(0,3) : [];
    return [{name,offset:item.offset,count:Number.isInteger(item.count) ? Math.max(1,item.count) : 1,quote:text.slice(Math.max(0,item.offset-65),item.offset+name.length+100).slice(0,1000),candidates,records:candidates.map(candidate=>({...candidate,name,lookupName:candidate.name}))}];
  });
}
export function readingLookupName(literal,matches) {
  const match = matches.find(item=>item.name === literal);
  const names = [...new Set((match?.candidates || []).map(item=>item.name).filter(name=>typeof name === 'string' && name.trim() && name.length <= 120))];
  return names.length === 1 ? names[0] : literal;
}
