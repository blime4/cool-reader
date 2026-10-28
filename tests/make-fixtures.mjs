import {writeFile} from 'node:fs/promises';
import {zipSync,strToU8} from 'fflate';
const cn='林舟穿着蓝色外套，眼睛明亮。陈晚低声说，海边的灯光依然温柔。许远推开木门，缓缓走过安静的走廊。林舟抬起手，神情认真而坚定。陈晚笑着，声音清脆。';
await writeFile('tests/fixtures/导入测试.txt','第一章 灯塔\n'+cn.repeat(4)+'\n第二章 来信\n'+cn.repeat(4));
const files={
 'mimetype':strToU8('application/epub+zip'),
 'META-INF/container.xml':strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>'),
 'OPS/package.opf':strToU8('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>EPUB 顺序测试</dc:title></metadata><manifest><item id="second" href="two.xhtml"/><item id="first" href="one.xhtml"/></manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>'),
 'OPS/two.xhtml':strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head><body><h1>第二章 来信</h1><p>'+cn.repeat(4)+'</p></body></html>'),
 'OPS/one.xhtml':strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第一章 灯塔</h1><script>alert("SHOULD NOT RUN")</script><p>'+cn.repeat(4)+'</p></body></html>')
};
await writeFile('tests/fixtures/测试书.epub',zipSync(files));
const stream='BT /F1 14 Tf 50 760 Td (Chapter One - The Lighthouse) Tj 0 -30 Td /F1 11 Tf (Alice wore a blue coat. Her eyes were bright and her voice was soft.) Tj 0 -20 Td (Robert walked slowly by the old lighthouse. Alice smiled at Robert.) Tj 0 -20 Td (Alice was brave. The quiet sea reflected the golden light.) Tj ET';
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
let pdf='%PDF-1.4\n';const offsets=[0];
objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(x=>`${String(x).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
await writeFile('tests/fixtures/book.pdf',pdf);
await writeFile('tests/fixtures/broken.epub','not a zip');
console.log('TXT EPUB PDF fixtures created');
