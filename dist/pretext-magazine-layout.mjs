import * as defaultPretext from './vendor/pretext/layout.js';

const MAX_FIGURES = 3;

function imageScore(guide) {
  if (!guide?.imageUrl || !/^(?:\/|https:\/\/)/.test(guide.imageUrl)) return -1;
  if (guide.imageKind === 'photo' || guide.imageKind === 'real') return 3;
  if (guide.imageKind === 'generated' || /\/generated-images\//.test(guide.imageUrl)) return 1;
  return 2;
}

function imageIdentity(url='') {
  const raw = String(url).trim();
  if (!raw) return '';
  try {
    const absolute = /^(?:https?:)?\/\//i.test(raw);
    const parsed = new URL(raw,'https://folio.local/');
    const path = parsed.pathname;
    return absolute ? `${parsed.protocol.toLowerCase()}//${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ''}${path}` : path;
  } catch {
    return raw.split(/[?#]/,1)[0];
  }
}

function normalizedIdentity(value) {
  return String(value || '').trim().replace(/\s+/g,' ').toLowerCase();
}

export function rankMagazineFigures(guides,limit=2) {
  const bounded = Math.max(0,Math.min(MAX_FIGURES,Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 2));
  if (bounded === 0) return [];
  const ranked = [...(guides ?? [])].map((guide,index)=>({guide,index,score:imageScore(guide)}))
    .filter(item=>item.score >= 0)
    .sort((a,b)=>b.score-a.score || a.index-b.index);
  const images = new Set(), taxonIds = new Set(), scientificNames = new Set(), unique = [];
  for (const item of ranked) {
    const image = imageIdentity(item.guide.imageUrl);
    const taxonId = normalizedIdentity(item.guide.taxonId);
    const scientificName = normalizedIdentity(item.guide.scientificName);
    if ((image && images.has(image)) || (taxonId && taxonIds.has(taxonId)) || (scientificName && scientificNames.has(scientificName))) continue;
    if (image) images.add(image);
    if (taxonId) taxonIds.add(taxonId);
    if (scientificName) scientificNames.add(scientificName);
    unique.push(item.guide);
    if (unique.length === bounded) break;
  }
  return unique;
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
  function layout({text='',width,lineHeight,font,letterSpacing=0,side='left',figures=[],figureWidth=112,figureHeight=88,featureWidth=figureWidth,featureHeight=figureHeight,gap=16}) {
    if (!supported(pretext) || !Number.isFinite(width) || width <= 0 || !Number.isFinite(lineHeight) || lineHeight <= 0 || !font) {
      return {supported:false,fallbackText:text,lines:[],figures:[],height:0};
    }
    const chosen = rankMagazineFigures(figures,MAX_FIGURES);
    const approxChars = Math.max(1,Math.floor(width/Math.max(8,parseFloat(font) || 16)));
    let priorBottom = 0;
    const placed = chosen.map((guide,index)=>{
      const role = index === 0 ? 'feature' : 'inset';
      const placedWidth = role === 'feature' ? featureWidth : figureWidth;
      const placedHeight = role === 'feature' ? featureHeight : figureHeight;
      const occurrence = Math.max(0,text.indexOf(guide.name ?? ''));
      const naturalY = Math.floor(occurrence/approxChars)*lineHeight;
      const y = Math.max(naturalY,priorBottom ? priorBottom+lineHeight : 0);
      priorBottom = y+placedHeight;
      const edge = (index + (side === 'right' ? 1 : 0)) % 2 === 0 ? 'left' : 'right';
      return {...guide,role,edge,x:edge==='left'?0:Math.max(0,width-placedWidth),y,width:placedWidth,height:placedHeight};
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
