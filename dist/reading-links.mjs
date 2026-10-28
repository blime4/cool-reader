export const NATURE_WORDS = ['松鼠','麻雀','蚂蚁','苔藓','蘑菇','蚯蚓','山毛榉','枫树','橡树','白蜡树','红雀','地衣','银杏','水杉','红豆杉','蕨类','啄木鸟','乌鸦','狐狸','赤狐','喜鹊','鹿角蕨','合欢'];
const identifier = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value) ? value : '';
const bookIdentifier = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) ? value : '';
export function readingContext(input = {}) {
  return { bookId: bookIdentifier(input.bookId), pageId: identifier(input.pageId), chapterId: identifier(input.chapterId), sourceBook: String(input.sourceBook ?? input.book ?? '').slice(0,300), chapter: String(input.chapter ?? '').slice(0,200), page: String(input.page ?? '').slice(0,40), quote: String(input.quote ?? '').slice(0,1000) };
}
export function collectionLink(name, context) {
  const value = readingContext(context); const params = new URLSearchParams({lookup:String(name).trim().slice(0,120)});
  for (const [key,item] of Object.entries(value)) if (item) params.set(key === 'sourceBook' ? 'book' : key,item);
  return `/plants.html?${params}`;
}
export function readerLink(context) {
  const value = readingContext(context); if (!value.bookId) return '';
  const params = new URLSearchParams({bookId:value.bookId});
  for (const key of ['pageId','chapterId','quote']) if (value[key]) params.set(key,value[key]);
  return `/index.html?${params}`;
}
export function applyReadingToCard(card, context, {isNew = false} = {}) {
  const provenance = readingContext(context);
  const result = {...card};
  const originalTitle = String(card.sourceBook || '').replace(/[《》]/g,'').trim();
  const newTitle = provenance.sourceBook.replace(/[《》]/g,'').trim();
  const sameBook = card.bookId && provenance.bookId ? card.bookId === provenance.bookId : (Math.min(originalTitle.length,newTitle.length) >= 4 && (originalTitle.startsWith(newTitle) || newTitle.startsWith(originalTitle)));
  if (isNew) Object.assign(result,provenance);
  else if (sameBook) for (const [key,value] of Object.entries(provenance)) if (!result[key] && value) result[key] = value;
  const route = readerLink(provenance);
  const citation = ['阅读摘记：',`来源：《${provenance.sourceBook || '未记录书名'}》`,`章节：${provenance.chapter || '未记录章节'}`,`位置：${provenance.page || '未记录页码'}`,provenance.quote,route ? `[回到书中](http://127.0.0.1:4173${route})` : ''].filter(Boolean).join('\n');
  const notes = String(card.notes || '');
  result.notes = notes.includes(citation) ? notes : `${notes}${notes ? '\n\n' : ''}${citation}`;
  return result;
}
export function contextFromSearch(search) {
  const params = new URLSearchParams(search); return {name:(params.get('lookup') || '').trim().slice(0,120),...readingContext(Object.fromEntries(params))};
}
export function selectedSpeciesName(text) {
  const value = String(text || '').trim(); return /^(?:[\p{Script=Han}]{2,12}|[A-Za-z][A-Za-z -]{2,29})$/u.test(value) ? value : '';
}
export function natureMatches(text, names = []) {
  const source = String(text || ''); const matches = [];
  for (const name of [...new Set(names.map(value => String(value).trim()))]) {
    if (name.length < 2 || name.length > 80 || (!/\p{Script=Han}/u.test(name) && name.length < 3)) continue;
    const lower = source.toLocaleLowerCase(), needle = name.toLocaleLowerCase(); let position = 0, count = 0, first = -1;
    while ((position = lower.indexOf(needle,position)) >= 0) {
      const before = source[position-1] || '', after = source[position+name.length] || '';
      if (/\p{Script=Han}/u.test(name) || (!/[A-Za-z]/.test(before) && !/[A-Za-z]/.test(after))) { count++; if (first < 0) first = position; }
      position += name.length;
    }
    if (count) matches.push({name,count,offset:first,quote:source.slice(Math.max(0,first-65),first+name.length+100).slice(0,1000)});
  }
  return matches.sort((a,b)=>a.offset-b.offset);
}
