import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {request} from 'node:http';
const server=spawn(process.execPath,['serve.mjs','--production'],{env:{...process.env,PORT:'5189'},stdio:['ignore','pipe','pipe']});
const get=(path,headers={})=>new Promise((resolve,reject)=>{
 const req=request({hostname:'127.0.0.1',port:5189,path,headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end();
});
try{
 await once(server.stdout,'data');
 const index=await get('/');assert.equal(index.status,200);assert.match(index.body.toString(),/ElCad/);
 const cached=await get('/',{'if-none-match':index.headers.etag});assert.equal(cached.status,304);
 const gzip=await get('/styles.css',{'accept-encoding':'gzip'});assert.equal(gzip.headers['content-encoding'],'gzip');
 const bad=await get('/%XX');assert.equal(bad.status,400);assert.equal((await get('/')).status,200);
 assert.equal((await get('/..%2Fpackage.json')).status,403);
 console.log('server OK');
}finally{server.kill();}
