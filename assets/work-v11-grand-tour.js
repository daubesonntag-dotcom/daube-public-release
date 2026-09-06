(() => {
  'use strict';
  const d=document,b=d.body,q=(s,r=d)=>r.querySelector(s),qa=(s,r=d)=>Array.from(r.querySelectorAll(s));
  if(b.dataset.grandTour==='ready'||!q('.hero')) return;
  b.dataset.grandTour='ready';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine=matchMedia('(pointer:fine)').matches;
  const scenes=[
    ['Dawn',q('.hero')],
    ['Work',q('.work-section')],
    ['Capabilities',q('.services-section')],
    ['Process',q('.process-section')],
    ['Proof',q('.evidence-section')],
    ['Motion',q('.cine-reel')],
    ['Finale',q('.cta-section')]
  ].filter(x=>x[1]);

  const hud=d.createElement('aside');
  hud.className='grand-tour-hud';
  hud.setAttribute('aria-label','Cinematic scene status');
  hud.innerHTML='<div class="grand-tour-hud__eyebrow">Now viewing<strong>DAWN</strong></div><i class="grand-tour-hud__rule" aria-hidden="true"></i><div class="grand-tour-hud__track" aria-hidden="true"><i></i></div><button class="grand-tour-hud__focus" type="button" aria-pressed="false">Focus</button>';
  b.appendChild(hud);
  const label=q('.grand-tour-hud__eyebrow strong',hud),focus=q('.grand-tour-hud__focus',hud);

  scenes.forEach(([name,el],i)=>{
    el.classList.add('grand-scene');
    el.dataset.grandScene=name.toLowerCase();
    if(!q('.grand-scene__number',el)){
      const n=d.createElement('span');n.className='grand-scene__number';n.setAttribute('aria-hidden','true');n.textContent=`0${i+1} / ${name}`;el.appendChild(n);
    }
  });

  const setFocus=on=>{
    b.classList.toggle('focus-mode',on);
    focus.setAttribute('aria-pressed',String(on));
    focus.textContent=on?'Focused':'Focus';
  };
  focus.addEventListener('click',()=>setFocus(!b.classList.contains('focus-mode')));
  d.addEventListener('keydown',e=>{
    if((e.key==='g'||e.key==='G')&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!/input|textarea|select/i.test(d.activeElement?.tagName||'')) setFocus(!b.classList.contains('focus-mode'));
  });

  let raf=0;
  const paint=()=>{
    raf=0;
    const doc=Math.max(1,d.documentElement.scrollHeight-innerHeight);
    const progress=Math.max(0,Math.min(1,scrollY/doc));
    b.style.setProperty('--grand-progress',progress.toFixed(4));
    let active=scenes[0],best=Infinity;
    scenes.forEach(pair=>{
      const el=pair[1],r=el.getBoundingClientRect();
      const local=Math.max(0,Math.min(1,(innerHeight-r.top)/(innerHeight+r.height)));
      el.style.setProperty('--grand-local',local.toFixed(3));
      const dist=Math.abs(r.top-innerHeight*.22);
      if(dist<best){best=dist;active=pair;}
    });
    scenes.forEach(pair=>pair[1].classList.toggle('is-grand-active',pair===active));
    label.textContent=active[0].toUpperCase();
  };
  addEventListener('scroll',()=>{if(!raf)raf=requestAnimationFrame(paint)},{passive:true});
  addEventListener('resize',()=>{if(!raf)raf=requestAnimationFrame(paint)},{passive:true});paint();

  if(fine&&!reduced){
    let pointerRaf=0,px=50,py=35;
    addEventListener('pointermove',e=>{
      px=e.clientX/innerWidth*100;py=e.clientY/innerHeight*100;
      if(!pointerRaf)pointerRaf=requestAnimationFrame(()=>{pointerRaf=0;b.style.setProperty('--grand-x',px.toFixed(2)+'%');b.style.setProperty('--grand-y',py.toFixed(2)+'%');});
    },{passive:true});
  }

  const serviceStage=q('.director-capability-stage');
  qa('.service').forEach((card,i)=>card.addEventListener('click',()=>{
    qa('.service').forEach(x=>x.classList.remove('is-active'));card.classList.add('is-active');
    serviceStage?.setAttribute('data-grand-selected',String(i+1));
  }));

  const navButtons=qa('.director-gallery__nav button');
  if(navButtons.length){
    navButtons.forEach(btn=>btn.addEventListener('click',()=>{
      const stage=q('.director-gallery__stage');
      stage?.animate?.([{filter:'brightness(.84) contrast(1.08)'},{filter:'brightness(1) contrast(1)'}],{duration:520,easing:'cubic-bezier(.16,1,.3,1)'});
    }));
  }
})();
