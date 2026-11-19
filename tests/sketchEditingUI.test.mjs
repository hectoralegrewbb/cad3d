import assert from 'node:assert/strict';
import { SketchEditor } from '../src/ui/sketchEditor.js';
import { commands } from '../src/core/commands.js';
import { createPart } from '../src/core/partModel.js';
const editor=Object.create(SketchEditor.prototype);
let state=commands.addFeature(createPart('UI'),'sketch'),status='',isError=false;
const add=e=>state=commands.addEntity(state,'sketch1',e);
add({t:'poly',closed:false,pts:[{x:0,y:0},{x:20,y:0}]});add({t:'poly',closed:false,pts:[{x:10,y:-10},{x:10,y:10}]});
Object.assign(editor,{part:state,params:{},sketchId:'sketch1',view:{scale:100},canvas:{style:{}},h:{onReplaceEntities(sk,id,entities){state=commands.replaceSketchEntities(state,sk,id,entities);editor.part=state;},onEditStatus(text,error=false){status=text;isError=error;},onAddEntity(sk,e){add(e);editor.part=state;},onToolChange(){}},render(){},closeTyped(){},openTyped(){}});
editor.setTool('trim');editor.editAt([15,0]);assert.equal(state.features[0].entities.length,2);assert.equal(isError,false);assert.match(status,/aplicada/);
editor.editAt([100,100]);assert.equal(isError,true);assert.match(status,/Acercate/);
editor.setTool('join');editor.editAt([5,0]);assert.ok(editor.editFirst);editor.cancelOperation();assert.equal(editor.tool,'select');assert.equal(editor.editFirst,null);
const arc=editor.arcFromPoints([[0,0],[5,5],[10,0]]);assert.equal(arc.closed,false);assert.ok(Math.abs(arc.pts[0].bulge+1)<1e-6);assert.throws(()=>editor.arcFromPoints([[0,0],[5,0],[10,0]]),/alineados/);
editor.setTool('arc');editor.pointerDownTool(0,0);editor.pointerDownTool(5,0);editor.pointerDownTool(10,0);assert.equal(isError,true);assert.equal(editor.draft.pts.length,2);editor.pointerDownTool(5,5);assert.equal(editor.tool,'select');assert.equal(state.features[0].entities.at(-1).closed,false);
const line=editor.entityFromDraft('line',[0,0],[10,0],{length:{value:25},angle:{value:90}});assert.equal(line.closed,false);assert.ok(Math.abs(line.pts[1].x)<1e-6);assert.equal(line.pts[1].y,25);
// Open arcs have no clickable chord and their canvas trace is not implicitly closed or filled.
let closes=0,fills=0;editor.ctx={beginPath(){},moveTo(){},lineTo(){},closePath(){closes++;},fill(){fills++;},stroke(){},fillRect(){}};editor.toScreen=(x,y)=>[x,y];editor.drawDimensions=()=>{};
editor.drawEntity({id:'a',...arc});assert.equal(closes,0);assert.equal(fills,0);
editor.part={...state,features:[{id:'sketch1',type:'sketch',entities:[{id:'a',...arc}]}]};assert.equal(editor.hitEntity(5,0),null);assert.equal(editor.hitEntity(5,5).id,'a');
editor.ctx.closePath=()=>{closes++;};editor.drawEntity({id:'r',t:'rect',x:0,y:0,w:10,h:5});assert.equal(closes,1);assert.equal(fills,1);
// Removal of constrained geometry is rejected through the UI and the reducer.
editor.part={...state,features:[{id:'sketch1',type:'sketch',entities:[{id:'a',...arc}],constraints:[{id:'k',a:'a',type:'horizontal'}]}]};const before=JSON.stringify(editor.part);editor.setTool('split');editor.editAt([5,5]);assert.equal(isError,true);assert.match(status,/restricciones/);assert.equal(JSON.stringify(editor.part),before);
console.log('sketchEditingUI: pointer editing, cancellation, arc recovery, no phantom fill/chord, restriction protection OK (without browser layout)');
editor.part={...state,features:[{id:'sketch1',type:'sketch',entities:[{id:'arcClose',...arc}]}]};state=editor.part;editor.setTool('close');editor.editAt([5,5]);assert.equal(isError,false);assert.equal(state.features[0].entities[0].closed,true,'one arc can be closed by its straight chord');
