import {readFile,writeFile,stat,mkdir,rename,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ApiError} from './plants-store.mjs';
const BOOK_ID=/^[a-f0-9]{40}$/;
const POSITION_ID=/^[A-Za-z0-9_-]{1,80}$/;
const MAX_BOOK=25*1024*1024;
function position(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.bookId!=='string'||!BOOK_ID.test(value.bookId)||typeof value.pageId!=='string'||!POSITION_ID.test(value.pageId)||typeof value.chapterId!=='string'||!POSITION_ID.test(value.chapterId))throw new ApiError(400,'阅读位置编号格式无效');
  return {bookId:value.bookId,pageId:value.pageId,chapterId:value.chapterId};
}
export async function openReadingLibrary({bookPath,dataDir}){
  let book=null;let bytes=null;let warning;
  if(bookPath){
    try{
      if(typeof bookPath!=='string'||!path.isAbsolute(bookPath)||path.extname(bookPath).toLowerCase()!=='.epub')throw new Error('format');
      const info=await stat(bookPath);if(!info.isFile()||info.size>MAX_BOOK||info.size<4)throw new Error('size');
      const content=await readFile(bookPath);if(content.length>MAX_BOOK||!content.subarray(0,4).equals(Buffer.from([80,75,3,4])))throw new Error('signature');
      const id=createHash('sha256').update(content).digest('hex').slice(0,40);
      book={id,title:path.basename(bookPath,path.extname(bookPath)).slice(0,160),format:'epub',url:`/api/library/${id}/file`};bytes=content;
    }catch{warning='配置的电子书暂时无法读取，请检查文件是否存在、是否为 EPUB，以及大小是否在 25 MB 以内。';}
  }
  const progressFile=path.join(dataDir,'book-progress.json');let queue=Promise.resolve();
  function configured(id){if(typeof id!=='string'||!BOOK_ID.test(id))throw new ApiError(400,'书籍编号格式无效');if(!book||id!==book.id)throw new ApiError(404,'此书未配置或不存在');}
  async function readStates(){
    try{
      const info=await lstat(progressFile);if(!info.isFile()||info.isSymbolicLink()||info.size>64*1024)throw new Error('progress size');
      const parsed=JSON.parse(await readFile(progressFile,'utf8'));
      if(parsed?.version!==1||!parsed.states||typeof parsed.states!=='object'||Array.isArray(parsed.states)||Object.keys(parsed.states).length>100)throw new Error('progress schema');
      const states=Object.create(null);
      for(const [id,state] of Object.entries(parsed.states)){
        const value=position(state);if(id!==value.bookId||typeof state.updatedAt!=='string'||!Number.isFinite(Date.parse(state.updatedAt)))throw new Error('progress identity');
        states[id]={...value,updatedAt:state.updatedAt};
      }
      return states;
    }catch(error){if(error.code==='ENOENT')return Object.create(null);throw new Error('阅读进度文件损坏，原文件未被覆盖，请先修复 book-progress.json。',{cause:error});}
  }
  return {
    list:()=>({books:book?[{...book}]:[],...(warning?{warning}:{})}),
    async file(id){configured(id);return Buffer.from(bytes);},
    async getState(id){configured(id);await queue;return (await readStates())[id]??null;},
    putState(input){
      const job=queue.then(async()=>{
        const value=position(input);configured(value.bookId);const states=await readStates();
        const state={...value,updatedAt:new Date().toISOString()};states[value.bookId]=state;
        const keys=Object.keys(states);if(keys.length>100){keys.sort((a,b)=>states[a].updatedAt.localeCompare(states[b].updatedAt));delete states[keys[0]];}
        const serialized=JSON.stringify({version:1,states},null,2);if(Buffer.byteLength(serialized)>64*1024)throw new ApiError(413,'阅读进度数据过大');
        await mkdir(dataDir,{recursive:true});const temporary=path.join(dataDir,`book-progress-${randomUUID()}.tmp`);
        await writeFile(temporary,serialized,{flag:'wx'});await rename(temporary,progressFile);return state;
      });queue=job.catch(()=>{});return job;
    }
  };
}
