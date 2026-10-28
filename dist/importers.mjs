const MAX_FILE = 25 * 1024 * 1024;
const MAX_TEXT = 2_000_000;

export function validateBookFile(file) {
  const ext = file?.name?.split('.').pop().toLowerCase();
  if (!['txt', 'epub', 'pdf'].includes(ext)) throw new Error('请选择 TXT、EPUB 或 PDF 格式的书籍。');
  if (!file.size) throw new Error('文件为空，请重新选择。');
  if (file.size > MAX_FILE) throw new Error('文件超过 25 MB，请选择较小的书籍。');
  return ext;
}

export function decodeText(bytes) {
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}

function ensureText(text) {
  if (text.length > MAX_TEXT) throw new Error('当前版本支持最多 200 万字，请拆分书籍后导入。');
  const controls = text.match(/[\x00-\x08\x0E-\x1F]/g)?.length || 0;
  if (controls > text.length * 0.01 || !/[\p{L}\p{N}]/u.test(text)) throw new Error('无法读取有效文字，请确认文件是文本书籍。');
  return text.replace(/\u0000/g, '');
}

function xml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('EPUB 文档结构损坏，无法解析。');
  return doc;
}

function tags(doc, name) { return [...doc.getElementsByTagNameNS('*', name)]; }

function resolvePath(base, href) {
  let decoded;
  try { decoded = decodeURIComponent(href.split('#')[0]); } catch { decoded = href.split('#')[0]; }
  if (/^[a-z]+:/i.test(decoded)) throw new Error('EPUB 包含不支持的外部章节。');
  const parts = base.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

async function readEpub(bytes, fallbackTitle, progress) {
  const { unzipSync } = await import('./vendor/fflate.mjs');
  let size = 0, entries = 0;
  let files;
  try {
    files = unzipSync(bytes, { filter: entry => {
      if (++entries > 5000) throw new Error('EPUB 文件条目过多。');
      if (!/\.(xml|opf|html|xhtml|htm)$/i.test(entry.name)) return false;
      size += entry.originalSize;
      if (size > 60 * 1024 * 1024 || entry.originalSize > 10 * 1024 * 1024) throw new Error('EPUB 解压文字过大，请拆分后导入。');
      return true;
    } });
  } catch (err) { throw new Error(err.message?.includes('EPUB') ? err.message : '无法打开 EPUB，请确认文件完整且未加密。'); }
  const read = path => {
    if (!files[path]) throw new Error('EPUB 缺少必要的章节文件。');
    return decodeText(files[path]);
  };
  const root = tags(xml(read('META-INF/container.xml')), 'rootfile')[0]?.getAttribute('full-path');
  if (!root) throw new Error('无法找到 EPUB 的书籍目录。');
  const opf = xml(read(root));
  const title = tags(opf, 'title')[0]?.textContent?.trim() || fallbackTitle;
  const manifest = new Map(tags(opf, 'item').map(item => [item.getAttribute('id'), item]));
  const spine = tags(opf, 'itemref').filter(item => item.getAttribute('linear') !== 'no');
  const chapters = [];
  let length = 0;
  for (let i = 0; i < spine.length; i++) {
    const item = manifest.get(spine[i].getAttribute('idref'));
    if (!item) throw new Error('EPUB 阅读顺序包含缺失章节。');
    const source = read(resolvePath(root, item.getAttribute('href') || ''));
    const doc = xml(source);
    for (const el of [...tags(doc, 'script'), ...tags(doc, 'style'), ...tags(doc, 'svg')]) el.parentNode?.removeChild(el);
    const heading = ['h1','h2','h3','title'].map(n => tags(doc,n)[0]?.textContent?.trim()).find(Boolean);
    const body = tags(doc, 'body')[0] || doc.documentElement;
    const collect = node => {
      if (node.nodeType === 3) return node.nodeValue || '';
      if (node.nodeType !== 1) return '';
      const text = [...node.childNodes].map(collect).join('');
      return /^(p|div|h[1-6]|li|section|br|blockquote)$/i.test(node.localName) ? text + '\n' : text;
    };
    const text = collect(body).replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
    length += text.length;
    if (length > MAX_TEXT) throw new Error('当前版本支持最多 200 万字，请拆分书籍后导入。');
    if (text) chapters.push({ title: heading || `第 ${i+1} 节`, text });
    progress(`正在解析 EPUB · ${i+1} / ${spine.length}`);
  }
  if (!chapters.length) throw new Error('EPUB 中没有可读取的文字，可能已加密。');
  return { title, text: ensureText(chapters.map(c=>c.text).join('\n\n')), chapters };
}

async function readPdf(bytes, title, progress) {
  const pdfjs = await import('./vendor/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
  const base = new URL('./vendor/', import.meta.url).href;
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/' });
  let pdf;
  try {
    pdf = await task.promise;
    if (pdf.numPages > 1000) throw new Error('当前版本支持最多 1000 页 PDF，请拆分后导入。');
    const chapters = [];
    let length = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      progress(`正在提取 PDF 文字 · ${n} / ${pdf.numPages}`);
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
      length += text.length;
      if (length > MAX_TEXT) throw new Error('当前版本支持最多 200 万字，请拆分书籍后导入。');
      chapters.push({ title: `PDF 第 ${n} 页`, text });
      page.cleanup();
    }
    const text = chapters.map(c=>c.text).join('\n\n');
    if (text.replace(/\s/g,'').length < 30) throw new Error('这份 PDF 没有足够的文字层。扫描版请先进行 OCR，或上传 TXT / EPUB。');
    return { title, text: ensureText(text), chapters: chapters.filter(c=>c.text.trim()) };
  } catch (err) {
    if (err.name === 'PasswordException') throw new Error('暂不支持加密 PDF，请上传无密码版本。');
    throw err;
  } finally { await (pdf ? pdf.destroy() : task.destroy()); }
}

export async function readBookFile(file, onProgress = () => {}) {
  const ext = validateBookFile(file);
  onProgress('正在读取本地文件…');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const title = file.name.replace(/\.[^.]+$/, '');
  if (ext === 'epub') return readEpub(bytes, title, onProgress);
  if (ext === 'pdf') return readPdf(bytes, title, onProgress);
  return { title, text: ensureText(decodeText(bytes)) };
}

