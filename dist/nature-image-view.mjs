const HOSTS = new Set(['static.inaturalist.org','inaturalist-open-data.s3.amazonaws.com','upload.wikimedia.org','birdnet.cornell.edu','static.avicommons.org']);
const SHAPES = {
  plant:['M53 131C40 77 49 37 91 15C114 55 111 104 53 131Z','M53 131 90 28M70 92l-15-19m27-8 18-13M53 131l-8 28'],
  bird:['M31 99Q25 72 45 60Q55 35 74 47L96 43L83 56Q106 80 83 101Q65 116 43 103L20 119L31 99Z','M46 70Q60 63 75 82Q60 96 45 89M71 53h1M55 107l-3 21m12-24 5 24M24 131h78'],
  animal:['M22 111L27 88Q31 75 48 76L69 78L76 65L86 54L91 70Q105 79 98 91L90 94L87 127L79 127L77 104L48 106L42 128L33 128L34 101M27 88Q7 70 13 52','M87 79h1M48 106l8 22M70 105l-1 22'],
  other:['M63 29a42 42 0 1 0 0 84a42 42 0 1 0 0-84M91 104l25 30','M63 47v25l16 11M44 26l-6-9M89 31l8-7M22 64H12'],
};
export function natureImageModel(item = {}) {
  let url = '';
  const value = typeof item.imageUrl === 'string' ? item.imageUrl : '';
  if (/^\/plant-assets\/\d{1,15}\.jpg$/.test(value) || /^\/plant-images\/[0-9a-f-]{36}\.jpg$/.test(value)) url = value;
  else try { const parsed = new URL(value); if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && HOSTS.has(parsed.hostname)) url = parsed.href; } catch {}
  const kind = Object.hasOwn(SHAPES,item.kind) ? item.kind : 'other';
  const higher = ['genus','subgenus','family','subfamily','tribe','order','suborder','class','phylum','kingdom'].includes(String(item.taxonRank || '').toLocaleLowerCase());
  return {name:String(item.name || '未命名记录').slice(0,120),kind,url,paths:SHAPES[kind],caption:'名称封面 · 待补实拍',photoLabel:higher ? '类群代表照片' : '资料参考照片'};
}
export function createNatureImage(item, {timeoutMs = 10000,onStateChange = () => {}} = {}) {
  const model = natureImageModel(item);
  const root = document.createElement('div'); root.className = `nature-image nature-image-${model.kind}`; root.dataset.imageState = model.url ? 'loading' : 'cover';
  const cover = document.createElement('div'); cover.className = 'nature-name-cover'; cover.setAttribute('role','img'); cover.setAttribute('aria-label',`${model.name}名称示意封面，非实拍，待补实拍`);
  const drawing = document.createElementNS('http://www.w3.org/2000/svg','svg'); drawing.setAttribute('viewBox','0 0 130 165'); drawing.setAttribute('aria-hidden','true'); drawing.setAttribute('class','nature-cover-drawing');
  for (const value of model.paths) { const path = document.createElementNS(drawing.namespaceURI || 'http://www.w3.org/2000/svg','path'); path.setAttribute('d',value); drawing.append(path); }
  const name = document.createElement('strong'); name.textContent = model.name;
  const caption = document.createElement('span'); caption.textContent = model.url ? '参考照片载入中 · 当前为名称封面' : model.caption;
  cover.append(drawing,name,caption); root.append(cover);
  if (!model.url) return root;
  const image = document.createElement('img'); image.className = 'nature-real-photo'; image.alt = `${model.name}的资料参考图，名称对应关系需核对`; image.referrerPolicy = 'no-referrer'; image.loading = 'lazy';
  const status = document.createElement('span'); status.className = 'nature-photo-status'; status.textContent = '照片载入中';
  let timer, failed = false;
  const update = value => {
    root.dataset.imageState = value; cover.setAttribute('aria-hidden',value === 'photo' ? 'true' : 'false');
    status.textContent = value === 'photo' ? model.photoLabel : value === 'error' ? '照片未载入' : '照片响应较慢';
    if (value !== 'photo') caption.textContent = value === 'error' ? '照片载入失败 · 当前为名称封面' : '照片响应较慢 · 当前为名称封面';
    onStateChange(value);
  };
  image.addEventListener('load',()=>{ if (failed || root.dataset.imageState === 'photo') return; clearTimeout(timer); update('photo'); });
  image.addEventListener('error',()=>{ if (failed) return; failed = true; clearTimeout(timer); image.hidden = true; update('error'); },{once:true});
  if (timeoutMs > 0) timer = setTimeout(()=>update('timeout'),timeoutMs);
  image.src = model.url; root.append(image,status);
  return root;
}
