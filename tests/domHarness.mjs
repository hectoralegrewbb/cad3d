// DOM mínimo para verificar el cableado de eventos; no reemplaza QA de layout/navegador.
export class TestElement extends EventTarget {
  constructor(tag='div'){super();this.tagName=tag;this.nodeType=1;this.children=[];this.attributes={};this.value='';this.disabled=false;this.classList={add(){},remove(){},toggle(){}};}
  setAttribute(key,value){this.attributes[key]=String(value);if(key==='value')this.value=String(value);}
  append(...nodes){for(const n of nodes){this.children.push(n);n.parentElement=this;if(this.tagName==='select'&&(this.children.length===1||'selected' in n.attributes))this.value=n.value;}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  set textContent(value){this.children=[];this.text=String(value);}
  get textContent(){return (this.text??'')+this.children.map(n=>n.textContent).join('');}
  matches(selector){return selector.split(',').map(s=>s.trim()).includes(this.tagName);}
  querySelectorAll(selector){return this.children.filter(n=>n.nodeType===1).flatMap(n=>[...(n.matches(selector)?[n]:[]),...n.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
}
export function testDocument(){const doc=new TestElement('document');doc.createElement=tag=>new TestElement(tag);doc.createTextNode=text=>({nodeType:3,textContent:String(text)});return doc;}
export async function flush(){for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));}
