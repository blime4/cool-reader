import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBookFile,decodeText,readBookFile} from '../dist/importers.mjs';
const file=(name,text)=>({name,size:Buffer.byteLength(text),arrayBuffer:async()=>new TextEncoder().encode(text).buffer});
test('accepts supported extensions and rejects oversized or unsupported files',()=>{
 assert.equal(validateBookFile({name:'novel.TXT',size:100}),'txt');
 assert.throws(()=>validateBookFile({name:'image.png',size:100}),/TXT|格式/);
 assert.throws(()=>validateBookFile({name:'book.pdf',size:26*1024*1024}),/25/);
 assert.throws(()=>validateBookFile({name:'book.txt',size:0}),/空/);
});
test('decodes UTF-8 and UTF-16LE Chinese without corrupting punctuation',()=>{
 assert.equal(decodeText(new TextEncoder().encode('林舟：你好。')),'林舟：你好。');
 const b=Buffer.concat([Buffer.from([255,254]),Buffer.from('第一章\r\n海边','utf16le')]);
 assert.equal(decodeText(new Uint8Array(b)),'第一章\r\n海边');
});
test('reads the actual local TXT contents and derives its filename title',async()=>{
 const result=await readBookFile(file('海边来信.txt','第一章\n林舟走到海边。\n第二章\n陈晚穿着蓝色外套。'));
 assert.equal(result.title,'海边来信');
 assert.match(result.text,/蓝色外套/);
});
test('rejects binary masquerading as TXT',async()=>{
 await assert.rejects(readBookFile({name:'binary.txt',size:8,arrayBuffer:async()=>new Uint8Array([0,0,1,0,255,0,2,0]).buffer}),/文本|文字/);
});
