import test from 'node:test';
import assert from 'node:assert/strict';
import {createPretextMagazineView} from '../dist/pretext-magazine-view.mjs';

class Node {
  constructor(tag='div') { this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.className='';this.dataset={};this.style={};this.attrs=new Map();this.events=new Map();this._text='';this.src='';this.alt=''; }
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  set textContent(value){this._text=String(value);if(value!=='')this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  setAttribute(name,value){this.attrs.set(name,String(value));}
  addEventListener(type,listener){this.events.set(type,listener);}
  querySelectorAll(selector){const own=this.className.split(' ').includes(selector.slice(1))?[this]:[];return own.concat(this.children.flatMap(child=>child.querySelectorAll(selector)));}
}
const documentRef={createElement:tag=>new Node(tag)};

function layouter() {
  return {layout({text,figures}) { return {supported:true,lines:[{text:text.slice(0,3),x:0,y:0,sourceStart:0,sourceEnd:3},{text:text.slice(3),x:80,y:24,sourceStart:3,sourceEnd:text.length}],figures:figures.slice(0,1).map(guide=>({...guide,x:0,y:20,width:70,height:60}))}; }};
}

test('magazine view renders selectable source-mapped lines and text-only figure captions', () => {
  const left=new Node(),right=new Node();
  const view=createPretextMagazineView({leaves:[left,right],layouter:layouter(),documentRef});
  view.render({parts:[{text:'白蜡树在林中',offset:10},{text:'右页文字',offset:100}],guides:[{name:'白蜡树',scientificName:'Fraxinus',imageUrl:'/plant-assets/ash.jpg',imageKind:'photo'}],options:{width:220,lineHeight:24,font:'16px serif'}});
  const lines=left.querySelectorAll('.magazine-line');
  assert.equal(lines.map(line=>line.textContent).join(''),'白蜡树在林中');
  assert.deepEqual(lines.map(line=>[line.dataset.sourceStart,line.dataset.sourceEnd]),[['10','13'],['13','16']]);
  const figures=left.querySelectorAll('.magazine-figure');
  assert.equal(figures.length,1);
  assert.match(figures[0].textContent,/白蜡树/);
  assert.match(figures[0].textContent,/Fraxinus/);
  assert.doesNotMatch(figures[0].textContent,/<|>/);
});

test('figure click opens details and an image failure removes the obstacle then reflows', () => {
  const left=new Node(),right=new Node();let opened;let layouts=0;
  const engine={layout(input){layouts++;return layouter().layout(input);}};
  const view=createPretextMagazineView({leaves:[left,right],layouter:engine,documentRef,onFigure:guide=>{opened=guide;}});
  const guide={name:'苔藓',imageUrl:'/plant-assets/moss.jpg',imageKind:'reference'};
  view.render({parts:[{text:'苔藓铺满岩石',offset:0},{text:'',offset:7}],guides:[guide],options:{width:220,lineHeight:24,font:'16px serif'}});
  const figure=left.querySelectorAll('.magazine-figure')[0];
  figure.events.get('click')();
  assert.equal(opened,guide);
  figure.children.find(child=>child.tagName==='IMG').events.get('error')();
  assert.equal(left.querySelectorAll('.magazine-figure').length,0);
  assert.ok(layouts>=3);
});

test('late image error from a previous page cannot rewrite the current render', () => {
  const left=new Node(),right=new Node();
  const view=createPretextMagazineView({leaves:[left,right],layouter:layouter(),documentRef});
  view.render({parts:[{text:'旧页苔藓',offset:0},{text:'',offset:4}],guides:[{name:'苔藓',imageUrl:'/old.jpg'}],options:{width:200,lineHeight:24,font:'16px serif'}});
  const oldImage=left.querySelectorAll('.magazine-figure')[0].children.find(child=>child.tagName==='IMG');
  view.render({parts:[{text:'新页白蜡树',offset:20},{text:'',offset:25}],guides:[{name:'白蜡树',imageUrl:'/new.jpg'}],options:{width:200,lineHeight:24,font:'16px serif'}});
  oldImage.events.get('error')();
  assert.equal(left.textContent.includes('新页白蜡树'),true);
  assert.equal(left.textContent.includes('白蜡树'),true);
});

test('unsupported layout restores plain selectable text without figures', () => {
  const left=new Node(),right=new Node();
  const view=createPretextMagazineView({leaves:[left,right],layouter:{layout:({text})=>({supported:false,fallbackText:text,lines:[],figures:[]})},documentRef});
  const result=view.render({parts:[{text:'纯文字回退',offset:0},{text:'右页',offset:5}],guides:[],options:{width:200,lineHeight:24,font:'16px serif'}});
  assert.equal(result.supported,false);
  assert.equal(left.textContent,'纯文字回退');
  assert.equal(right.textContent,'右页');
});
