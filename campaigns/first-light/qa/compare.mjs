import fs from 'node:fs/promises';import path from 'node:path';import pixelmatch from 'pixelmatch';import {PNG} from 'pngjs';
const here=new URL('.',import.meta.url),actualDir=new URL('./artifacts/',here),baseDir=new URL('./baselines/',here),diffDir=new URL('./artifacts/diffs/',here);await fs.mkdir(diffDir,{recursive:true});
let bases=[];try{bases=(await fs.readdir(baseDir)).filter(x=>x.endsWith('.png'))}catch{}
if(!bases.length){console.log('VISUAL_BASELINE_MISSING: capture artifacts generated; baseline comparison skipped.');process.exit(0)}
let failures=[];
for(const file of bases){
 const aPath=new URL(file,actualDir),bPath=new URL(file,baseDir);try{await fs.access(aPath)}catch{failures.push({file,error:'actual missing'});continue}
 const [ab,bb]=await Promise.all([fs.readFile(aPath),fs.readFile(bPath)]),a=PNG.sync.read(ab),b=PNG.sync.read(bb);if(a.width!==b.width||a.height!==b.height){failures.push({file,error:`dimension ${a.width}x${a.height} != ${b.width}x${b.height}`});continue}
 const d=new PNG({width:a.width,height:a.height}),n=pixelmatch(a.data,b.data,d.data,a.width,a.height,{threshold:.10,includeAA:false}),ratio=n/(a.width*a.height);await fs.writeFile(new URL(file,diffDir),PNG.sync.write(d));if(ratio>.0025)failures.push({file,diffPixels:n,ratio});else console.log(`VISUAL_PASS ${file} ${(ratio*100).toFixed(3)}%`)
}
if(failures.length){console.error('VISUAL_DIFF_FAIL',JSON.stringify(failures,null,2));process.exit(1)}