// Ejecuta todos los archivos de prueba aunque uno falle. No mezcla pruebas físicas en paralelo.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files=readdirSync(new URL('../tests/',import.meta.url)).filter(f=>f.endsWith('.test.mjs')).sort();
let failed=0;
for(const file of files){
  const result=spawnSync(process.execPath,[`tests/${file}`],{encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024});
  console.log(`${result.status===0?'PASS':'FAIL'} ${file}`);
  if(result.status!==0){failed++;console.log(result.error?.message??'');console.log((result.stdout+result.stderr).slice(-5000));}
}
console.log(`RESULTADO: ${files.length-failed}/${files.length} archivos aprobados`);
process.exitCode=failed?1:0;
