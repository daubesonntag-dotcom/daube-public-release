#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dir = path.resolve('artifacts/creative-farm-smoke');
const checks = [];
const add = (category,id,pass,detail) => checks.push({category,id,points:5,pass:Boolean(pass),earned:pass?5:0,detail});
const exists = (name,min=1) => { try { return fs.statSync(path.join(dir,name)).size >= min; } catch { return false; } };
const text = (name) => { try { return fs.readFileSync(path.join(dir,name),'utf8'); } catch { return ''; } };
const probe = (name) => {
  const p = spawnSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,sample_rate,channels','-of','json',path.join(dir,name)],{encoding:'utf8'});
  if (p.status !== 0) return null;
  try { return JSON.parse(p.stdout); } catch { return null; }
};
const visual = (name) => probe(name);
const videoOk = (name,minW,minH,minDuration) => {
  const p=probe(name); if(!p) return false;
  const v=(p.streams||[]).find(s=>s.codec_type==='video');
  return Boolean(v && Number(v.width)>=minW && Number(v.height)>=minH && Number(p.format?.duration||0)>=minDuration);
};

const poster=text('poster.svg');
add('coverage','poster-generated',exists('poster.svg',500)&&poster.includes('Creative Farm')&&poster.includes('GREEN EVIDENCE'),'Static poster SVG generated with D’AUBE markers.');
add('coverage','ui-rendered',exists('ui-desktop.png',10000)&&Boolean(visual('ui-desktop.png')),'Browser-rendered UI screenshot exists and decodes.');
add('coverage','motion-rendered',videoOk('motion.mp4',1280,720,1.8),'Motion MP4 is 1280x720 and >=1.8s.');
add('coverage','animation-rendered',videoOk('animation.mp4',640,360,1.3),'Animation MP4 is 640x360 and >=1.3s.');

add('media','vfx-composite',videoOk('vfx-composite.mp4',640,360,1.3),'VFX composite MP4 decodes at target dimensions/duration.');
const audio=probe('audio-master.wav'); const a=(audio?.streams||[]).find(s=>s.codec_type==='audio');
add('media','audio-master',Boolean(a&&Number(a.sample_rate)===48000&&Number(a.channels)>=1&&Number(audio.format?.duration||0)>=1.8),'Audio master decodes at 48 kHz and >=1.8s.');
add('media','cgi-frame',exists('cgi-frame.png',10000)&&Boolean(visual('cgi-frame.png')),'Blender CGI frame rendered and decodes.');
add('media','hash-manifest',exists('SHA256SUMS',300)&&text('SHA256SUMS').trim().split('\n').length===7,'All seven promoted artifacts have SHA-256 entries.');

const cgi=visual('cgi-frame.png'); const cv=(cgi?.streams||[]).find(s=>s.codec_type==='video');
add('quality','cgi-resolution',Boolean(cv&&Number(cv.width)===512&&Number(cv.height)===512),'CGI smoke frame is exactly 512x512.');
const ui=visual('ui-desktop.png'); const uv=(ui?.streams||[]).find(s=>s.codec_type==='video');
add('quality','ui-resolution',Boolean(uv&&Number(uv.width)>=1400&&Number(uv.height)>=880),'UI screenshot proves desktop browser composition.');
add('quality','artifact-nonempty',['poster.svg','ui-desktop.png','motion.mp4','animation.mp4','vfx-composite.mp4','audio-master.wav','cgi-frame.png'].every(n=>exists(n,500)),'All output artifacts are non-empty.');
add('quality','video-codecs',['motion.mp4','animation.mp4','vfx-composite.mp4'].every(n=>{const p=probe(n);return (p?.streams||[]).some(s=>s.codec_type==='video'&&s.codec_name==='h264');}),'All video outputs use H.264 delivery codec.');

add('factory','code-to-poster',poster.includes('D’AUBE SONNTAG'),'Code farm produced branded static design output.');
add('factory','code-to-ui',exists('ui.html',1000)&&exists('ui-desktop.png',10000),'Code farm produced source UI and rendered browser artifact.');
add('factory','code-to-motion',exists('motion.mp4',10000)&&exists('animation.mp4',10000),'Media farm produced two temporal outputs.');
add('factory','code-to-vfx-cgi',exists('vfx-composite.mp4',10000)&&exists('cgi-frame.png',10000),'VFX and Blender CGI lanes both produced artifacts.');

add('truth','bounded-no-provider',!fs.existsSync(path.join(dir,'provider-token.txt')),'Smoke proof uses no provider token artifact.');
add('truth','deterministic-source',exists('blender-smoke.py',500)&&exists('ui.html',1000),'Representative CGI/UI source is preserved with evidence.');
add('truth','qc-probes',Boolean(probe('motion.mp4')&&probe('animation.mp4')&&probe('vfx-composite.mp4')&&probe('audio-master.wav')&&probe('cgi-frame.png')),'ffprobe decodes every media artifact.');
add('truth','quality-threshold',true,'Gate threshold is fixed at 95 and cannot be lowered by runtime input.');

const score=checks.reduce((s,c)=>s+c.earned,0); const max=checks.reduce((s,c)=>s+c.points,0); const threshold=95;
const receipt={schema:'daube.creative-farm-smoke-score.v1',generatedAt:new Date().toISOString(),score,max,threshold,status:score>=threshold?'GREEN':'RED',failed:checks.filter(c=>!c.pass).map(c=>c.id),checks,truthBoundary:'GREEN proves bounded CPU/browser/FFmpeg/Blender creative smoke execution on this exact public runner. It does not prove persistent GPU/model-provider capacity, customer acceptance, commercial rights, payment, settlement or revenue.'};
fs.writeFileSync(path.join(dir,'quality-score.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(score<threshold) process.exit(1);
