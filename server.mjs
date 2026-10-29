import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {ApiError,validatePlant,duplicate,openStore,MAX_COLLECTION_BYTES} from './lib/plants-store.mjs';
import {cacheImage,imageType} from './lib/plants-network.mjs';
import {searchPlantSources} from './lib/plant-search.mjs';
import {openObsidianStore} from './lib/obsidian-store.mjs';
import {openReadingLibrary} from './lib/reading-library.mjs';
import {buildNameMatcher} from './lib/reading-matcher.mjs';
import {openImageGeneration} from './lib/image-generation.mjs';
import {createCollectionTasks} from './lib/collection-tasks.mjs';
const project=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(project,'dist');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.bcmap':'application/octet-stream','.pfb':'application/octet-stream','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
function editVersion(plant){return createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(plant).filter(([key])=>key!=='editVersion').sort(([a],[b])=>a.localeCompare(b))))).digest('hex');}
function editablePlant(plant){return {...plant,editVersion:editVersion(plant)};}
async function body(req,max=2*1024*1024){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))throw new ApiError(415,'请使用 JSON 请求');
  const message=`请求内容不能超过 ${max/1024/1024} MB`;if(Number(req.headers['content-length'])>max)throw new ApiError(413,message);
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw new ApiError(413,message);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(400,'JSON 格式无效');}
}
export async function createServer({dataDir=path.join(project,'data'),obsidianVault,obsidianFolder='FOLIO植物志',readingBookPath,natureCatalogPath=path.join(root,'nature-catalog.json'),imageGeneration}={}){
  dataDir=path.resolve(dataDir);const store=obsidianVault?await openObsidianStore({vault:obsidianVault,folder:obsidianFolder,dataDir,staticDir:root}):await openStore(dataDir);
  const library=await openReadingLibrary({bookPath:readingBookPath,dataDir});
  const generator=await openImageGeneration({dataDir,config:imageGeneration});
  const collectionTasks=createCollectionTasks({store,generator});
  let seeds=[];try{const content=JSON.parse(await readFile(path.join(root,'plants-seed.json'),'utf8'));seeds=Array.isArray(content)?content:content.plants??content.results??[];}catch(error){if(error.code!=='ENOENT')throw error;}
  try{
    const catalog=JSON.parse(await readFile(natureCatalogPath,'utf8'));const records=Array.isArray(catalog)?catalog:catalog.records;
    if(!Array.isArray(records))throw new Error('离线自然名录格式无效');
    seeds.push(...records.map(record=>({...record,offline:true})));
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const matchReadingPage=buildNameMatcher(seeds);
  const server=http.createServer(async(req,res)=>{
    try{
      const port=server.address()?.port;
      const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`]);
      if(!allowedHosts.has(req.headers.host))throw new ApiError(403,'仅允许本机访问');
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw new ApiError(403,'不允许跨站访问本机资料');
      const url=new URL(req.url,`http://${req.headers.host}`);const method=req.method;
      if(url.pathname==='/api/health'&&method==='GET')return json(res,200,{app:'folio-plants',ok:true});
      if(url.pathname==='/api/image-generation/health'&&method==='GET')return json(res,200,await generator.health());
      if(url.pathname==='/api/collection-tasks'&&method==='POST')return json(res,202,{task:await collectionTasks.start(await body(req,128*1024))});
      if(url.pathname==='/api/collection-tasks'&&method==='GET')return json(res,200,{tasks:await collectionTasks.list()});
      const collectionTask=url.pathname.match(/^\/api\/collection-tasks\/([a-f0-9-]{36})$/);
      if(collectionTask&&method==='GET')return json(res,200,{task:await collectionTasks.get(collectionTask[1])});
      if(url.pathname==='/api/image-generation/jobs'&&method==='POST')return json(res,202,{job:await generator.start(await body(req,4096))});
      const generationJob=url.pathname.match(/^\/api\/image-generation\/jobs\/([a-f0-9-]{36})$/);
      if(generationJob&&method==='GET')return json(res,200,{job:generator.get(generationJob[1])});
      if(url.pathname==='/api/reading-matches'&&method==='POST'){
        const input=await body(req,64*1024);return json(res,200,{matches:matchReadingPage(input?.text)});
      }
      if(url.pathname==='/api/library'&&method==='GET')return json(res,200,library.list());
      const libraryFile=url.pathname.match(/^\/api\/library\/([a-f0-9]{40})\/file$/);
      if(libraryFile&&(method==='GET'||method==='HEAD')){
        const bytes=await library.file(libraryFile[1]);res.writeHead(200,{'Content-Type':'application/epub+zip','Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});return res.end(method==='HEAD'?undefined:bytes);
      }
      if(url.pathname==='/api/reading-state'&&method==='GET')return json(res,200,{state:await library.getState(url.searchParams.get('bookId'))});
      if(url.pathname==='/api/reading-state'&&method==='PUT')return json(res,200,{state:await library.putState(await body(req,16*1024))});
      if(url.pathname==='/api/storage'&&method==='GET')return json(res,200,store.info??{type:'json',folderPath:dataDir});
      if(url.pathname==='/api/plants'&&method==='GET')return json(res,200,{plants:(await store.list()).map(editablePlant)});
      if(url.pathname==='/api/backup'&&method==='GET'){
        res.setHeader('Content-Disposition',`attachment; filename="folio-plants-backup.json"; filename*=UTF-8''${encodeURIComponent('植物收藏备份.json')}`);
        return json(res,200,{version:1,plants:await store.list()});
      }
      if(url.pathname==='/api/search'&&method==='GET'){
        const query=(url.searchParams.get('q')??'').trim();if(!query||query.length>120)throw new ApiError(400,'请输入 1 至 120 字的植物名称');
        const kind=url.searchParams.get('kind')??'all';
        if(!['all','plant','animal','bird'].includes(kind))throw new ApiError(400,'查询范围无效');
        try{return json(res,200,await searchPlantSources(query,{localSeeds:seeds,kind}));}catch{return json(res,200,{results:[],warning:'在线物种查询暂不可用。可稍后重试，或手动添加并标注待核对。'});}
      }
      if(url.pathname==='/api/plants'&&method==='POST'){
        const input=validatePlant(await body(req));
        if(duplicate(await store.list(),input))throw new ApiError(409,'这株植物已在收藏中');
        const cached=await cacheImage(input.imageUrl,dataDir);input.imageUrl=cached.imageUrl;
        const now=new Date().toISOString();const plant={...input,id:randomUUID(),createdAt:now,updatedAt:now};
        await store.mutate(next=>{if(next.length>=5000)throw new ApiError(400,'最多收藏 5000 种植物');if(duplicate(next,plant))throw new ApiError(409,'这株植物已在收藏中');next.push(plant);});
        return json(res,201,{plant:editablePlant(plant),...(cached.warning?{warning:cached.warning}:{})});
      }
      if(url.pathname==='/api/restore'&&method==='POST'){
        const input=await body(req,MAX_COLLECTION_BYTES);if(input?.version!==1||!Array.isArray(input.plants)||input.plants.length>5000)throw new ApiError(400,'备份格式无效，最多 5000 条植物');
        const incoming=input.plants.map(plant=>validatePlant(plant,{restore:true}));
        const result=await store.mutate(next=>{let imported=0,skipped=0;for(const plant of incoming){if(duplicate(next,plant)){skipped++;continue;}if(next.length>=5000)throw new ApiError(400,'合并后不能超过 5000 条植物');const now=new Date().toISOString();next.push({...plant,createdAt:plant.createdAt??now,updatedAt:plant.updatedAt??now});imported++;}return {imported,skipped};},{snapshot:true});
        return json(res,200,result);
      }
      const match=url.pathname.match(/^\/api\/plants\/([A-Za-z0-9_-]{1,80})$/);
      if(match&&(method==='PUT'||method==='DELETE')){
        const patch=method==='PUT'?await body(req):null;
        if(method==='PUT'&&(!patch||typeof patch!=='object'||Array.isArray(patch)))throw new ApiError(400,'资料格式无效');
        const expected=req.headers['if-match'];
        if(method==='PUT'&&expected!==undefined&&!/^"[a-f0-9]{64}"$/.test(expected))throw new ApiError(400,'卡片版本格式无效，请重新加载');
        const plant=await store.mutate(next=>{const index=next.findIndex(p=>p.id===match[1]);if(index<0)throw new ApiError(404,'未找到植物');
          if(method==='DELETE'){next.splice(index,1);return null;}
          if(expected!==undefined&&expected!==`"${editVersion(next[index])}"`)throw new ApiError(409,'卡片已在其他窗口或 Obsidian 中修改，请重新加载后核对再保存');
          const previous=next[index];const updated={...validatePlant({...previous,...patch}),id:previous.id,createdAt:previous.createdAt,updatedAt:new Date().toISOString()};
          if(duplicate(next.filter((_,i)=>i!==index),updated))throw new ApiError(409,'与已有植物重复');
          // Editing an image keeps a remote allowlisted URL; add-time caching remains bounded.
          next[index]=updated;return updated;
        });return json(res,200,method==='DELETE'?{deleted:true}:{plant:editablePlant(plant)});
      }
      if(url.pathname.startsWith('/api/'))throw new ApiError(404,'接口不存在');
      if(method!=='GET'&&method!=='HEAD')throw new ApiError(405,'请求方法不受支持');
      const generated=url.pathname.match(/^\/generated-images\/([a-f0-9-]{36})\.jpg$/);
      if(generated){
        const bytes=store.imageForUrl?await store.imageForUrl(url.pathname)??await generator.file(generated[1]):await generator.file(generated[1]);
        res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'});return res.end(method==='HEAD'?undefined:bytes);
      }
      let file;let mime;
      if(store.imageForUrl&&(/^\/plant-assets\/\d{1,15}\.jpg$/.test(url.pathname)||/^\/plant-images\/[0-9a-f-]{36}\.jpg$/.test(url.pathname))){
        const bytes=await store.imageForUrl(url.pathname);
        if(bytes){mime=imageType(bytes);if(!mime)throw new ApiError(404,'图片无效');res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});return res.end(method==='HEAD'?undefined:bytes);}
      }
      if(url.pathname.startsWith('/plant-images/')){
        if(!/^\/plant-images\/[0-9a-f-]{36}\.jpg$/.test(url.pathname))throw new ApiError(404,'图片不存在');
        file=path.join(dataDir,'images',path.basename(url.pathname));
        const bytes=await readFile(file);mime=imageType(bytes);if(!mime)throw new ApiError(404,'图片无效');
        res.writeHead(200,{'Content-Type':mime,'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'});return res.end(method==='HEAD'?undefined:bytes);
      }
      const decoded=decodeURIComponent(url.pathname==='/'?'/plants.html':url.pathname);
      if(decoded.split(/[\\/]/).some(part=>part.startsWith('.'))||decoded.includes('\0'))throw new ApiError(404,'文件不存在');
      file=path.resolve(root,'.'+decoded);if(!file.startsWith(root+path.sep))throw new ApiError(404,'文件不存在');
      if(!(await stat(file)).isFile())throw new ApiError(404,'文件不存在');
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(method==='HEAD'?undefined:await readFile(file));
    }catch(error){const status=error.status??(error.code==='ENOENT'||error instanceof URIError?404:500);json(res,status,{error:status===500?'本机服务处理失败，请检查服务器输出。':error.message});if(status===500)console.error(error);}
  });return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  (async()=>{let config={};try{config=JSON.parse(await readFile(path.join(project,'config.local.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}return createServer(config);})().then(server=>server.listen(4173,'127.0.0.1',()=>console.log('Folio: http://127.0.0.1:4173'))).catch(error=>{console.error(error.message);process.exitCode=1;});
}

