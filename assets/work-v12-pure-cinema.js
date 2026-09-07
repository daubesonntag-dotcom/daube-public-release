(() => {
  'use strict';
  const d=document,b=d.body,q=(s,r=d)=>r.querySelector(s),qa=(s,r=d)=>Array.from(r.querySelectorAll(s));
  if(b.dataset.v12Ready==='true') return;
  b.dataset.v12Ready='true';

  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const header=q('.site-header');
  const menu=q('.menu-button');
  const nav=q('.main-nav');

  const syncHeader=()=>header?.classList.toggle('is-solid',scrollY>18);
  syncHeader();
  addEventListener('scroll',syncHeader,{passive:true});

  if(menu&&header&&nav){
    menu.addEventListener('click',()=>{
      const open=!header.classList.contains('is-open');
      header.classList.toggle('is-open',open);
      menu.setAttribute('aria-expanded',String(open));
      menu.setAttribute('aria-label',open?'Close navigation':'Open navigation');
    });
    qa('a',nav).forEach(a=>a.addEventListener('click',()=>{
      header.classList.remove('is-open');
      menu.setAttribute('aria-expanded','false');
      menu.setAttribute('aria-label','Open navigation');
    }));
  }

  const reveals=qa('.reveal');
  if(reduced||!('IntersectionObserver' in window)) reveals.forEach(el=>el.classList.add('is-visible'));
  else {
    const io=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add('is-visible');io.unobserve(entry.target);}
    }),{threshold:.12,rootMargin:'0px 0px -8%'});
    reveals.forEach(el=>io.observe(el));
  }

  if(!reduced){
    let raf=0;
    const paintHero=()=>{
      raf=0;
      const hero=q('.hero');
      if(!hero) return;
      const rect=hero.getBoundingClientRect();
      const p=Math.max(0,Math.min(1,-rect.top/Math.max(1,rect.height)));
      b.style.setProperty('--v12-hero-y',`${(p*14).toFixed(2)}px`);
      b.style.setProperty('--v12-hero-scale',(1.018+p*.018).toFixed(4));
    };
    const request=()=>{if(!raf)raf=requestAnimationFrame(paintHero)};
    addEventListener('scroll',request,{passive:true});
    addEventListener('resize',request,{passive:true});
    paintHero();
  }

  qa('.service').forEach((card,i,all)=>{
    card.tabIndex=0;
    card.setAttribute('role','button');
    card.setAttribute('aria-pressed',i===0?'true':'false');
    if(i===0) card.classList.add('is-v12-active');
    const activate=()=>{
      all.forEach(x=>{x.classList.remove('is-v12-active');x.setAttribute('aria-pressed','false')});
      card.classList.add('is-v12-active');
      card.setAttribute('aria-pressed','true');
    };
    card.addEventListener('click',activate);
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}});
  });

  const process=qa('.process-step');
  const processWrap=q('.process');
  const setProcess=i=>{
    process.forEach((step,n)=>{
      step.classList.toggle('is-v12-active',n===i);
      step.setAttribute('aria-pressed',String(n===i));
    });
    const pct=process.length>1?i/(process.length-1)*100:100;
    b.style.setProperty('--v12-process',`${pct.toFixed(1)}%`);
  };
  process.forEach((step,i)=>{
    step.tabIndex=0;
    step.setAttribute('role','button');
    step.addEventListener('click',()=>setProcess(i));
    step.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){e.preventDefault();setProcess(i)}
      if(e.key==='ArrowRight'){e.preventDefault();setProcess(Math.min(process.length-1,i+1));process[Math.min(process.length-1,i+1)]?.focus();}
      if(e.key==='ArrowLeft'){e.preventDefault();setProcess(Math.max(0,i-1));process[Math.max(0,i-1)]?.focus();}
    });
  });
  if(processWrap&&process.length) setProcess(0);

  const evidence=q('.evidence-section');
  const cta=q('.cta-section');
  const workCards=qa('.work-card');
  if(evidence&&cta&&workCards.length){
    const scenes=workCards.slice(0,3).map((card,i)=>({
      meta:q('.work-card__index',card)?.textContent?.trim()||`Scene ${i+1}`,
      title:q('h3',card)?.textContent?.trim()||'D’AUBE system',
      copy:q('p',card)?.textContent?.trim()||'',
      art:i===0?"url('https://cdn.creativeclaw.co/u/218f016f/images/c2b5ff65-757c-4da3-b4fc-06a9e4f9a72f.png')":i===1?'radial-gradient(circle at 72% 26%,rgba(255,255,255,.55),transparent 12%),linear-gradient(155deg,#dfe7e8 0%,#7c9aaa 34%,#153047 100%)':'radial-gradient(circle at 76% 20%,rgba(218,177,116,.75),transparent 6%),linear-gradient(145deg,#0b2337,#061521 70%)'
    }));

    const reel=d.createElement('section');
    reel.className='v12-reel reveal';
    reel.setAttribute('aria-labelledby','v12-reel-title');
    reel.innerHTML=`<div class="v12-reel__inner"><header class="v12-reel__head"><div><p class="section-label">In motion</p><h2 id="v12-reel-title">Systems with rhythm.</h2></div><p>A restrained interactive study built from D’AUBE-owned work. The motion is part of the interface, not a claim about client footage.</p></header><div class="v12-reel__stage"><div class="v12-reel__art" aria-hidden="true"></div><div class="v12-reel__copy"><span class="v12-reel__meta"></span><h3></h3><p></p><div class="v12-reel__controls"><button type="button" class="v12-reel__toggle" aria-pressed="false">Play</button>${scenes.map((_,i)=>`<button type="button" class="v12-reel__scene" data-scene="${i}" aria-pressed="${i===0}">0${i+1}</button>`).join('')}</div></div><div class="v12-reel__timeline" aria-hidden="true"><i></i></div></div></div>`;
    cta.before(reel);

    const meta=q('.v12-reel__meta',reel),title=q('.v12-reel__copy h3',reel),copy=q('.v12-reel__copy p',reel),toggle=q('.v12-reel__toggle',reel),sceneButtons=qa('.v12-reel__scene',reel);
    let active=0,playing=false,timer=0;
    const renderScene=i=>{
      active=i;
      const s=scenes[i];
      reel.style.setProperty('--v12-reel-art',s.art);
      meta.textContent=s.meta;
      title.textContent=s.title;
      copy.textContent=s.copy;
      sceneButtons.forEach((btn,n)=>btn.setAttribute('aria-pressed',String(n===i)));
      if(title.animate&&!reduced) title.animate([{opacity:.35,transform:'translateY(8px)'},{opacity:1,transform:'none'}],{duration:420,easing:'cubic-bezier(.16,1,.3,1)'});
      reel.classList.remove('is-playing');
      if(playing&&!reduced) requestAnimationFrame(()=>reel.classList.add('is-playing'));
    };
    const stopTimer=()=>{if(timer){clearInterval(timer);timer=0}};
    const syncTimer=()=>{
      stopTimer();
      if(playing&&!reduced) timer=setInterval(()=>renderScene((active+1)%scenes.length),6000);
    };
    toggle.addEventListener('click',()=>{
      playing=!playing;
      toggle.textContent=playing?'Pause':'Play';
      toggle.setAttribute('aria-pressed',String(playing));
      reel.classList.toggle('is-playing',playing&&!reduced);
      syncTimer();
    });
    sceneButtons.forEach(btn=>btn.addEventListener('click',()=>{renderScene(Number(btn.dataset.scene));syncTimer();}));
    renderScene(0);

    if(reduced){toggle.disabled=true;toggle.textContent='Motion off';toggle.setAttribute('aria-disabled','true');}
    if(!reduced&&'IntersectionObserver' in window){
      const reelIO=new IntersectionObserver(entries=>entries.forEach(entry=>{
        if(entry.isIntersecting) reel.classList.add('is-visible');
      }),{threshold:.08});
      reelIO.observe(reel);
    } else reel.classList.add('is-visible');
  }
})();
