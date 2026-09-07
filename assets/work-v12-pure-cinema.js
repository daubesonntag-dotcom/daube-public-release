(() => {
  'use strict';
  const d=document,b=d.body,q=(s,r=d)=>r.querySelector(s),qa=(s,r=d)=>Array.from(r.querySelectorAll(s));
  if(b.dataset.v12Ready==='true') return;
  b.dataset.v12Ready='true';

  const mediaReduced=matchMedia('(prefers-reduced-motion: reduce)');
  const mediaCoarse=matchMedia('(pointer: coarse)');
  const reduced=mediaReduced.matches;
  const coarse=mediaCoarse.matches;
  const memory=Number(navigator.deviceMemory||8);
  const cores=Number(navigator.hardwareConcurrency||8);
  const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  const slowNetwork=Boolean(connection?.saveData||/^(slow-)?2g$/.test(connection?.effectiveType||''));
  const lowPower=reduced||coarse||memory<=4||cores<=4||slowNetwork;
  b.dataset.v12Quality=lowPower?'lite':'full';
  b.dataset.v12Data=slowNetwork?'reduced':'normal';

  const header=q('.site-header');
  const menu=q('.menu-button');
  const nav=q('.main-nav');
  const syncHeader=()=>header?.classList.toggle('is-solid',scrollY>18);
  const closeNav=(returnFocus=false)=>{
    if(!header||!menu) return;
    header.classList.remove('is-open');
    menu.setAttribute('aria-expanded','false');
    menu.setAttribute('aria-label','Open navigation');
    if(returnFocus) menu.focus();
  };
  syncHeader();
  addEventListener('scroll',syncHeader,{passive:true});

  if(menu&&header&&nav){
    menu.addEventListener('click',()=>{
      const open=!header.classList.contains('is-open');
      header.classList.toggle('is-open',open);
      menu.setAttribute('aria-expanded',String(open));
      menu.setAttribute('aria-label',open?'Close navigation':'Open navigation');
    });
    qa('a',nav).forEach(a=>a.addEventListener('click',()=>closeNav(false)));
    d.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&header.classList.contains('is-open')){
        e.preventDefault();
        closeNav(true);
      }
    });
  }

  const reveals=qa('.reveal');
  if(reduced||!('IntersectionObserver' in window)) reveals.forEach(el=>el.classList.add('is-visible'));
  else {
    const io=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add('is-visible');io.unobserve(entry.target);}
    }),{threshold:.12,rootMargin:'0px 0px -8%'});
    reveals.forEach(el=>io.observe(el));
  }

  const hero=q('.hero');
  let heroVisible=true;
  let heroRaf=0;
  const paintHero=()=>{
    heroRaf=0;
    if(lowPower||!hero||!heroVisible||d.hidden) return;
    const rect=hero.getBoundingClientRect();
    const p=Math.max(0,Math.min(1,-rect.top/Math.max(1,rect.height)));
    b.style.setProperty('--v12-hero-y',`${(p*12).toFixed(2)}px`);
    b.style.setProperty('--v12-hero-scale',(1.016+p*.014).toFixed(4));
  };
  const requestHero=()=>{if(!heroRaf&&!lowPower&&heroVisible&&!d.hidden) heroRaf=requestAnimationFrame(paintHero)};
  if(hero&&!lowPower){
    if('IntersectionObserver' in window){
      const heroIO=new IntersectionObserver(entries=>{
        heroVisible=entries.some(x=>x.isIntersecting);
        if(heroVisible) requestHero();
      },{rootMargin:'120px 0px'});
      heroIO.observe(hero);
    }
    addEventListener('scroll',requestHero,{passive:true});
    addEventListener('resize',requestHero,{passive:true});
    paintHero();
  } else {
    b.style.setProperty('--v12-hero-y','0px');
    b.style.setProperty('--v12-hero-scale','1.008');
  }
  addEventListener('pagehide',()=>{if(heroRaf){cancelAnimationFrame(heroRaf);heroRaf=0;}},{once:true});

  const services=qa('.service');
  const setService=i=>{
    services.forEach((card,n)=>{
      card.classList.toggle('is-v12-active',n===i);
      card.setAttribute('aria-pressed',String(n===i));
    });
  };
  services.forEach((card,i)=>{
    card.tabIndex=0;
    card.setAttribute('role','button');
    card.setAttribute('aria-pressed',i===0?'true':'false');
    if(i===0) card.classList.add('is-v12-active');
    const activate=()=>setService(i);
    card.addEventListener('click',activate);
    card.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();return;}
      let n=null;
      if(e.key==='ArrowRight'||e.key==='ArrowDown') n=(i+1)%services.length;
      if(e.key==='ArrowLeft'||e.key==='ArrowUp') n=(i-1+services.length)%services.length;
      if(e.key==='Home') n=0;
      if(e.key==='End') n=services.length-1;
      if(n!==null){e.preventDefault();setService(n);services[n]?.focus();}
    });
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
      if(e.key==='Enter'||e.key===' '){e.preventDefault();setProcess(i);return;}
      let n=null;
      if(e.key==='ArrowRight'||e.key==='ArrowDown') n=Math.min(process.length-1,i+1);
      if(e.key==='ArrowLeft'||e.key==='ArrowUp') n=Math.max(0,i-1);
      if(e.key==='Home') n=0;
      if(e.key==='End') n=process.length-1;
      if(n!==null){e.preventDefault();setProcess(n);process[n]?.focus();}
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
    reel.innerHTML=`<div class="v12-reel__inner"><header class="v12-reel__head"><div><p class="section-label">In motion</p><h2 id="v12-reel-title">Systems with rhythm.</h2></div><p>A restrained interactive study built from D’AUBE-owned work. The motion is part of the interface, not a claim about client footage.</p></header><div class="v12-reel__stage"><div class="v12-reel__art" aria-hidden="true"></div><div class="v12-reel__copy"><span class="v12-reel__meta"></span><h3 aria-live="polite"></h3><p></p><div class="v12-reel__controls"><button type="button" class="v12-reel__toggle" aria-pressed="false">Play</button>${scenes.map((_,i)=>`<button type="button" class="v12-reel__scene" data-scene="${i}" aria-label="Show scene ${i+1}" aria-pressed="${i===0}">0${i+1}</button>`).join('')}</div></div><div class="v12-reel__timeline" aria-hidden="true"><i></i></div></div></div>`;
    cta.before(reel);

    const meta=q('.v12-reel__meta',reel),title=q('.v12-reel__copy h3',reel),copy=q('.v12-reel__copy p',reel),toggle=q('.v12-reel__toggle',reel),sceneButtons=qa('.v12-reel__scene',reel);
    let active=0,playing=false,timer=0,reelVisible=false;
    const canAnimate=()=>playing&&!lowPower&&!d.hidden&&reelVisible;
    const renderScene=i=>{
      active=i;
      const s=scenes[i];
      reel.style.setProperty('--v12-reel-art',s.art);
      meta.textContent=s.meta;
      title.textContent=s.title;
      copy.textContent=s.copy;
      sceneButtons.forEach((btn,n)=>btn.setAttribute('aria-pressed',String(n===i)));
      if(title.animate&&!lowPower&&!d.hidden) title.animate([{opacity:.35,transform:'translateY(8px)'},{opacity:1,transform:'none'}],{duration:380,easing:'cubic-bezier(.16,1,.3,1)'});
      reel.classList.toggle('is-playing',canAnimate());
    };
    const stopTimer=()=>{if(timer){clearInterval(timer);timer=0}reel.classList.remove('is-playing');};
    const syncTimer=()=>{
      stopTimer();
      reel.classList.toggle('is-playing',canAnimate());
      if(canAnimate()) timer=setInterval(()=>renderScene((active+1)%scenes.length),6000);
    };
    toggle.addEventListener('click',()=>{
      playing=!playing;
      toggle.textContent=playing?'Pause':'Play';
      toggle.setAttribute('aria-pressed',String(playing));
      syncTimer();
    });
    sceneButtons.forEach((btn,i)=>{
      btn.addEventListener('click',()=>{renderScene(i);syncTimer();});
      btn.addEventListener('keydown',e=>{
        let n=null;
        if(e.key==='ArrowRight'||e.key==='ArrowDown') n=(i+1)%sceneButtons.length;
        if(e.key==='ArrowLeft'||e.key==='ArrowUp') n=(i-1+sceneButtons.length)%sceneButtons.length;
        if(e.key==='Home') n=0;
        if(e.key==='End') n=sceneButtons.length-1;
        if(n!==null){e.preventDefault();sceneButtons[n].focus();renderScene(n);syncTimer();}
      });
    });
    renderScene(0);

    if(lowPower){
      toggle.disabled=true;
      toggle.textContent='Motion off';
      toggle.setAttribute('aria-disabled','true');
    }
    if('IntersectionObserver' in window){
      const reelIO=new IntersectionObserver(entries=>entries.forEach(entry=>{
        reelVisible=entry.isIntersecting;
        if(reelVisible) reel.classList.add('is-visible');
        syncTimer();
      }),{threshold:.08,rootMargin:'80px 0px'});
      reelIO.observe(reel);
    } else {reelVisible=true;reel.classList.add('is-visible');}

    d.addEventListener('visibilitychange',()=>{requestHero();syncTimer();});
    d.addEventListener('freeze',stopTimer);
    d.addEventListener('resume',syncTimer);
    addEventListener('pagehide',stopTimer,{once:true});
    addEventListener('pageshow',()=>{requestHero();syncTimer();});
  } else {
    d.addEventListener('visibilitychange',requestHero);
    addEventListener('pageshow',requestHero);
  }
})();