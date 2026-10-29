import * as defaultPretext from '@chenglou/pretext';

const MAX_FIGURES = 3;

function imageScore(guide) {
  if (!guide?.imageUrl || !/^(?:\/|https:\/\/)/.test(guide.imageUrl)) return -1;
  if (guide.imageKind === 'photo' || guide.imageKind === 'real') return 3;
  if (guide.imageKind === 'generated' || /\/generated-images\//.test(guide.imageUrl)) return 1;
  return 2;
}

export function rankMagazineFigures(guides,limit=2) {
  const bounded = Math.max(0,Math.min(MAX_FIGURES,Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 2));
  return [...(guides ?? [])].map((guide,index)=>({guide,index,score:imageScore(guide)}))
    .filter(item=>item.score >= 0)
    .sort((a,b)=>b.score-a.score || a.index-b.index)
    .slice(0,bounded).map(item=>item.guide);
}

function supported(api) {
  return ['prepareWithSegments','layoutNextLineRange','materializeLineRange'].every(name=>typeof api?.[name] === 'function');
}

export function createMagazineLayouter({pretext=defaultPretext}={}) {
  const cache = new Map();
  function prepared(text,font,letterSpacing=0) {
    const key = `${font}\u0000${letterSpacing}\u0000${text}`;
    if (!cache.has(key)) cache.set(key,pretext.prepareWithSegments(text,font,{whiteSpace:'pre-wrap',letterSpacing}));
    return cache.get(key);
  }
  function layout({text='',width,lineHeight,font,letterSpacing=0,side='left',figures=[],figureWidth=112,figureHeight=88,gap=16}) {
    if (!supported(pretext) || !Number.isFinite(width) || width <= 0 || !Number.isFinite(lineHeight) || lineHeight <= 0 || !font) {
      return {supported:false,fallbackText:text,lines:[],figures:[],height:0};
    }
    const chosen = rankMagazineFigures(figures,MAX_FIGURES);
    const approxChars = Math.max(1,Math.floor(width/Math.max(8,parseFloat(font) || 16)));
    let priorBottom = 0;
    const placed = chosen.map((guide,index)=>{
      const occurrence = Math.max(0,text.indexOf(guide.name ?? ''));
      const naturalY = Math.floor(occurrence/approxChars)*lineHeight;
      const y = Math.max(naturalY,priorBottom ? priorBottom+lineHeight : 0);
      priorBottom = y+figureHeight;
      const edge = (index + (side === 'right' ? 1 : 0)) % 2 === 0 ? 'left' : 'right';
      return {...guide,edge,x:edge==='left'?0:Math.max(0,width-figureWidth),y,width:figureWidth,height:figureHeight};
    });
    const handle = prepared(text,font,letterSpacing);
    const lines = [];
    let cursor;
    let y = 0;
    let sourceOffset = 0;
    for (let guard=0; guard<Math.max(1,text.length*2+2); guard++) {
      const obstacle = placed.find(figure=>y >= figure.y && y < figure.y+figure.height);
      const availableWidth = Math.max(1,obstacle ? width-obstacle.width-gap : width);
      const x = obstacle?.edge === 'left' ? obstacle.width+gap : 0;
      const range = pretext.layoutNextLineRange(handle,availableWidth,cursor);
      if (range === null) break;
      const materialized = pretext.materializeLineRange(handle,range);
      const lineText = materialized.text ?? '';
      const sourceStart = sourceOffset;
      sourceOffset += lineText.length;
      lines.push({text:lineText,x,y,width:materialized.width ?? range.width ?? 0,availableWidth,sourceStart,sourceEnd:sourceOffset});
      if (range.end?.segmentIndex === cursor?.segmentIndex && range.end?.graphemeIndex === cursor?.graphemeIndex) break;
      cursor = range.end;
      y += lineHeight;
    }
    return {supported:true,lines,figures:placed,height:y,fallbackText:text};
  }
  return {layout,clear(){cache.clear();}};
}
