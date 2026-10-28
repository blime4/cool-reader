import {readFile,writeFile,readdir,lstat,mkdir,rename,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ApiError,validatePlant,duplicate,openStore,MAX_COLLECTION_BYTES} from './plants-store.mjs';
const ID=/^[A-Za-z0-9_-]{1,80}$/;
async function directory(folder,create=false){
  if(create){try{await mkdir(folder);}catch(error){if(error.code!=='EEXIST')throw error;}}
  const info=await lstat(folder);if(!info.isDirectory()||info.isSymbolicLink())throw new Error(`拒绝符号链接或无效目录：${folder}`);
}
async function regular(file){const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw new Error(`拒绝符号链接或无效文件：${file}`);return info;}
function scalar(value){
  value=value.trim();if(!value)return '';
  if(value.startsWith('"')||value.startsWith('[')||value.startsWith('{'))return JSON.parse(value);
  if(value.startsWith("'")){if(!value.endsWith("'"))throw new Error('quote');return value.slice(1,-1).replace(/''/g,"'");}
  return value.replace(/\s+#.*$/,'');
}
function parse(raw,id){
  const match=raw.replace(/\r\n?/g,'\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);if(!match)throw new Error('frontmatter');
  const fields=Object.create(null);let listKey='';
  for(const line of match[1].split('\n')){
    if(!line.trim()||line.trim().startsWith('#'))continue;
    const list=line.match(/^\s+-\s+(.*)$/);if(list&&listKey){fields[listKey].push(scalar(list[1]));continue;}
    const field=line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);if(!field)throw new Error('frontmatter');
    listKey='';const [,key,value]=field;
    if(key==='tags'&&!value.trim()){fields[key]=[];listKey=key;}else fields[key]=scalar(value);
  }
  if(String(fields.folioPlant)!=='1'||fields.id!==id)throw new Error('identity');
  const heading=match[2].match(/(?:^|\n)## 阅读笔记[ \t]*\n/);if(!heading)throw new Error('notes heading');
  const notes=match[2].slice(heading.index+heading[0].length).replace(/^\n/,'').replace(/\n$/,'');
  const plant=validatePlant({...fields,notes},{restore:true});
  plant.notes=notes;
  return {plant,fields,prefix:match[2].slice(0,heading.index),raw};
}
function render(plant,previous,attachment){
  const fields={...(previous?.fields??{}),folioPlant:1,...plant};delete fields.notes;
  if(attachment)fields.attachment=attachment;
  const front=Object.entries(fields).map(([key,value])=>`${key}: ${JSON.stringify(value)}`).join('\n');
  const prefix=previous?.prefix??`# ${plant.name}\n\n${attachment?`![${plant.name.replace(/[\[\]]/g,'')}](../附件/${attachment})\n`:''}`;
  return `---\n${front}\n---\n${prefix}\n## 阅读笔记\n\n${plant.notes}\n`;
}
export async function openObsidianStore({vault,folder='FOLIO植物志',dataDir,staticDir}){
  if(typeof vault!=='string'||!path.isAbsolute(vault)||typeof folder!=='string'||!folder.trim()||folder==='.'||folder==='..'||/[\\/:\x00]/.test(folder))throw new Error('Obsidian 仓库或管理目录路径无效');
  vault=path.resolve(vault);await directory(vault);await directory(path.join(vault,'.obsidian'));
  const managed=path.join(vault,folder);const cards=path.join(managed,'卡片');const images=path.join(managed,'附件');const trash=path.join(managed,'已删除');const snapshots=path.join(managed,'快照');
  for(const dir of [managed,cards,images,trash,snapshots])await directory(dir,true);
  async function check(){for(const dir of [vault,path.join(vault,'.obsidian'),managed,cards,images,trash,snapshots])await directory(dir);}
  async function load(){
    await check();const records=new Map();let bytes=0;
    for(const name of await readdir(cards)){
      if(!/\.md$/i.test(name))continue;const id=name.slice(0,-3);if(!ID.test(id))continue;
      const file=path.join(cards,name);await regular(file);const raw=await readFile(file,'utf8');
      // Human notes with descriptive filenames are unrelated unless marked as a FOLIO card.
      if(!raw.includes('folioPlant:')&&!/^[0-9a-f-]{36}$/i.test(id))continue;
      try{const record=parse(raw,id);bytes+=Buffer.byteLength(raw);records.set(id,record);}catch(error){throw new Error(`Obsidian 植物卡片格式损坏，请先修复：${file}`,{cause:error});}
    }
    const plants=[...records.values()].map(record=>record.plant);const seen=[];for(const plant of plants){if(duplicate(seen,plant))throw new Error('Obsidian 植物卡片存在重复编号或名称');seen.push(plant);}
    if(plants.length>5000||bytes>MAX_COLLECTION_BYTES)throw new ApiError(413,'Obsidian 植物收藏不能超过 5000 条或 20 MB');
    return records;
  }
  async function attachment(plant,previous){
    if(previous?.fields.attachment){const name=previous.fields.attachment;if(!/^[A-Za-z0-9_-]{1,80}\.jpg$/.test(name))throw new Error('附件路径格式无效');await regular(path.join(images,name));return name;}
    let source;if(/^\/plant-images\/[0-9a-f-]{36}\.jpg$/.test(plant.imageUrl))source=path.join(dataDir,'images',path.basename(plant.imageUrl));
    if(/^\/plant-assets\/\d{1,15}\.jpg$/.test(plant.imageUrl))source=path.join(staticDir,'plant-assets',path.basename(plant.imageUrl));
    if(!source)return '';
    try{const info=await regular(source);if(info.size>8*1024*1024)return '';const name=plant.id+'.jpg';const target=path.join(images,name);await copyFile(source,target,1);return name;}catch(error){if(error.code==='ENOENT')return '';if(error.code==='EEXIST'){await regular(path.join(images,plant.id+'.jpg'));return plant.id+'.jpg';}throw error;}
  }
  let queue=Promise.resolve();
  const store={info:{type:'obsidian',vaultPath:vault,folderPath:managed},list:async()=>[...(await load()).values()].map(record=>record.plant),
    async imageForUrl(url){for(const record of (await load()).values()){if(record.plant.imageUrl===url&&record.fields.attachment){const name=record.fields.attachment;if(!/^[A-Za-z0-9_-]{1,80}\.jpg$/.test(name))throw new Error('附件路径格式无效');const file=path.join(images,name);await regular(file);return readFile(file);}}return null;},
    mutate(operation){
      const job=queue.then(async()=>{
        const before=await load();const next=[...before.values()].map(record=>structuredClone(record.plant));const result=await operation(next);
        const checked=next.map(plant=>({...validatePlant(plant,{restore:true}),notes:plant.notes??''}));const seen=[];for(const plant of checked){if(duplicate(seen,plant))throw new ApiError(409,'植物卡片重复');seen.push(plant);}
        if(checked.length>5000||Buffer.byteLength(JSON.stringify({version:1,plants:checked},null,2))>MAX_COLLECTION_BYTES)throw new ApiError(413,'植物收藏总容量不能超过 20 MB 或 5000 条');
        const changes=[];
        for(const plant of checked){const previous=before.get(plant.id);if(previous&&JSON.stringify(previous.plant)===JSON.stringify(plant))continue;const image=await attachment(plant,previous);changes.push({id:plant.id,text:render(plant,previous,image),previous});}
        const deleted=[...before.keys()].filter(id=>!checked.some(plant=>plant.id===id));
        const changed=new Map(changes.map(change=>[change.id,change.text]));
        const totalBytes=checked.reduce((sum,plant)=>sum+Buffer.byteLength(changed.get(plant.id)??before.get(plant.id).raw),0);
        if(totalBytes>MAX_COLLECTION_BYTES)throw new ApiError(413,'Obsidian 植物卡片总容量不能超过 20 MB');
        await check();
        for(const change of changes){const file=path.join(cards,change.id+'.md');if(change.previous){await regular(file);if(await readFile(file,'utf8')!==change.previous.raw)throw new ApiError(409,'卡片已在 Obsidian 中修改，请刷新后重试');}else{try{await lstat(file);throw new ApiError(409,'同名文件已存在，未覆盖');}catch(error){if(error.code!=='ENOENT')throw error;}}}
        for(const id of deleted){const file=path.join(cards,id+'.md');await regular(file);if(await readFile(file,'utf8')!==before.get(id).raw)throw new ApiError(409,'卡片已在 Obsidian 中修改，请刷新后重试');}
        for(const change of changes){const file=path.join(cards,change.id+'.md');if(change.previous)await copyFile(file,path.join(snapshots,`${change.id}-${Date.now()}-${randomUUID()}.md`),1);const temp=path.join(cards,`.${change.id}-${randomUUID()}.tmp`);await writeFile(temp,change.text,{flag:'wx'});await rename(temp,file);}
        for(const id of deleted)await rename(path.join(cards,id+'.md'),path.join(trash,`${id}-${Date.now()}-${randomUUID()}.md`));
        return result;
      });queue=job.catch(()=>{});return job;
    }
  };
  await store.list();
  const marker=path.join(managed,'.folio-migration.json');let migrated=false;
  try{await regular(marker);const state=JSON.parse(await readFile(marker,'utf8'));if(state.version!==1)throw new Error('迁移标记格式无效');migrated=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!migrated){
    const legacy=await openStore(dataDir);const initial=await store.list();const deletedNames=await readdir(trash);
    const additions=legacy.list().filter(plant=>!duplicate(initial,plant)&&!deletedNames.some(name=>name.startsWith(plant.id+'-')));
    if(additions.length)await store.mutate(next=>{for(const plant of additions)if(!duplicate(next,plant))next.push(plant);});
    await writeFile(marker,JSON.stringify({version:1,completedAt:new Date().toISOString()}),{flag:'wx'});
  }
  return store;
}
