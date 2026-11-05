import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const rootDirectory=fileURLToPath(new URL('./',import.meta.url));
const port=Number(process.env.PORT)||5174;
const production=process.argv.includes('--production');
const compress=promisify(gzip),cache=new Map();
const mimeTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.wasm':'application/wasm'};
createServer(async(request,response)=>{
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
  try {
    const urlPath=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const filePath=resolve(rootDirectory,`.${urlPath==='/'?'/index.html':urlPath}`);
    const rel=relative(rootDirectory,filePath);
    if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||rel.split('/').includes('node_modules')||rel.includes('\0')){response.writeHead(403).end();return;}
    const info=await stat(filePath);
    if(!info.isFile()){response.writeHead(404).end();return;}
    const useGzip=production&&/\bgzip\b/.test(request.headers['accept-encoding']??'');
    const key=`${filePath}:${info.mtimeMs}:${useGzip}`;
    let entry=production?cache.get(key):null;
    if(!entry){
      const raw=await readFile(filePath);
      entry={etag:`"${createHash('sha256').update(raw).digest('hex')}"`,data:useGzip?await compress(raw):raw};
      if(production){if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(key,entry);}
    }
    const headers={'Content-Type':mimeTypes[extname(filePath)]??'application/octet-stream','Cache-Control':production?'public, max-age=0, must-revalidate':'no-store','X-Content-Type-Options':'nosniff',Vary:'Accept-Encoding',ETag:entry.etag};
    if(useGzip)headers['Content-Encoding']='gzip';
    if(production&&request.headers['if-none-match']===entry.etag){response.writeHead(304,headers).end();return;}
    response.writeHead(200,{...headers,'Content-Length':entry.data.length});response.end(request.method==='HEAD'?undefined:entry.data);
  }catch(error){response.writeHead(error instanceof URIError?400:404).end('No disponible');}
}).listen(port,()=>console.log(`ElCad 3D en http://localhost:${port} (${production?'distribución':'desarrollo'})`));
