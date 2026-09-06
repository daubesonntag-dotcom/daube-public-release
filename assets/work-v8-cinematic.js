(() => {
  'use strict';
  const d = document;
  const b = d.body;
  const q = (s, r = d) => r.querySelector(s);
  const qa = (s, r = d) => Array.from(r.querySelectorAll(s));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(pointer:fine)').matches;
  const isHome = !!(q('.hero') && q('.work-section'));

  /* Valid cross-browser transform variables for the parallax layer. */
  const hotfix = d.createElement('style');
  hotfix.textContent = '.hero__media,.subhero__media{transform:translate3d(var(--cine-bg-x,0px),var(--cine-bg-y,0px),0)!important}.hero__media img,.subhero__media img{transform:translate3d(var(--cine-img-x,0px),var(--cine-img-y,0px),0) scale(1.055)!important}.hero__copy,.subhero__inner{transform:translate3d(var(--cine-copy-x,0px),var(--cine-copy-y,0px),0)!important}';
  d.head.appendChild(hotfix);

  /* Header and mobile navigation. */
  const header = q('.site-header');
  const nav = q('.main-nav');
  const menu = q('.menu-button');
  function closeMenu(){
    if(!header || !menu) return;
    header.classList.remove('is-open');
    menu.setAttribute('aria-expanded','false');
    menu.setAttribute('aria-label','Open navigation');
  }
  if(header && nav && menu){
    menu.addEventListener('click',() => {
      const open = header.classList.toggle('is-open');
      menu.setAttribute('aria-expanded',String(open));
      menu.setAttribute('aria-label',open ? 'Close navigation' : 'Open navigation');
    });
    qa('a',nav).forEach(a => a.addEventListener('click',closeMenu));
    addEventListener('resize',() => { if(innerWidth > 1000) closeMenu(); },{passive:true});
  }
  function headerState(){ if(header) header.classList.toggle('is-solid',scrollY > 28); }
  headerState(); addEventListener('scroll',headerState,{passive:true});

  /* Film-open entrance, homepage only. */
  if(!reduced && isHome){
    const top=d.createElement('div'), bottom=d.createElement('div'), mark=d.createElement('div');
    top.className='cine-matte cine-matte--top'; bottom.className='cine-matte cine-matte--bottom'; mark.className='cine-intro-mark';
    mark.innerHTML='<div><span>D’AUBE SONNTAG</span><small>Meaning, made visible.</small></div>';
    b.append(top,bottom,mark);
    setTimeout(() => b.classList.add('cine-ready'),420);
    setTimeout(() => { top.remove(); bottom.remove(); mark.remove(); },1800);
  } else b.classList.add('cine-ready');

  /* Split title lines for a proper cinematic reveal. */
  qa('.hero__title,.subhero__title').forEach(title => {
    if(title.dataset.cineSplit) return;
    const lines=title.innerHTML.split(/<br\s*\/?>/i);
    if(lines.length < 2) return;
    title.innerHTML=lines.map(line => '<span class="cine-line"><span>'+line+'</span></span>').join('');
    title.dataset.cineSplit='1';
  });

  /* Scroll reveal. */
  const reveals=qa('.reveal');
  if(reduced || !('IntersectionObserver' in window)) reveals.forEach(el => el.classList.add('is-visible'));
  else {
    const io=new IntersectionObserver(entries => entries.forEach(entry => {
      if(!entry.isIntersecting) return;
      entry.target.classList.add('is-visible'); io.unobserve(entry.target);
    }),{threshold:.07,rootMargin:'0px 0px -7% 0px'});
    reveals.forEach(el => io.observe(el));
  }

  /* Global film progress. */
  const progress=d.createElement('div'); progress.className='cine-progress'; progress.setAttribute('aria-hidden','true'); b.appendChild(progress);
  function scrollState(){
    const max=Math.max(1,d.documentElement.scrollHeight-innerHeight);
    b.style.setProperty('--scroll',String(Math.max(0,Math.min(100,scrollY/max*100))));
  }
  scrollState(); addEventListener('scroll',scrollState,{passive:true});

  /* Chapter rail. */
  const chapterDefs=isHome ? [['Dawn','.hero'],['Work','.work-section'],['Capabilities','.services-section'],['Process','.process-section'],['Proof','.evidence-section']] : [['Intro','.subhero'],['Section 1','.page-section'],['Section 2','.page-section:nth-of-type(3)'],['Section 3','.page-section:nth-of-type(4)']];
  const chapters=chapterDefs.map(def => ({label:def[0],element:q(def[1])})).filter(x => x.element);
  if(chapters.length>1){
    const rail=d.createElement('nav'); rail.className='cine-rail'; rail.setAttribute('aria-label','Page chapters');
    chapters.forEach((chapter,i) => {
      const btn=d.createElement('button'); btn.type='button'; btn.dataset.label=chapter.label; btn.setAttribute('aria-label','Go to '+chapter.label); if(i===0) btn.classList.add('is-active');
      btn.addEventListener('click',() => chapter.element.scrollIntoView({behavior:reduced?'auto':'smooth',block:'start'}));
      chapter.button=btn; rail.appendChild(btn);
    });
    b.appendChild(rail);
    function activeChapter(){
      const y=innerHeight*.4; let active=0;
      chapters.forEach((c,i) => { if(c.element.getBoundingClientRect().top<=y) active=i; });
      chapters.forEach((c,i) => c.button.classList.toggle('is-active',i===active));
    }
    activeChapter(); addEventListener('scroll',activeChapter,{passive:true});
  }

  function pointerPercent(el,e,xName,yName){
    const r=el.getBoundingClientRect();
    el.style.setProperty(xName,((e.clientX-r.left)/r.width*100)+'%');
    el.style.setProperty(yName,((e.clientY-r.top)/r.height*100)+'%');
  }

  /* Cursor lens and hero parallax on precision pointers. */
  if(!reduced && fine){
    const cursor=d.createElement('div'); cursor.className='cine-cursor'; cursor.setAttribute('aria-hidden','true'); b.appendChild(cursor);
    let cx=innerWidth/2,cy=innerHeight/2,tx=cx,ty=cy,raf=0;
    function paint(){cx+=(tx-cx)*.22;cy+=(ty-cy)*.22;cursor.style.transform='translate3d('+cx+'px,'+cy+'px,0) translate(-50%,-50%)';if(Math.abs(tx-cx)>.2||Math.abs(ty-cy)>.2)raf=requestAnimationFrame(paint);else raf=0;}
    addEventListener('pointermove',e => {tx=e.clientX;ty=e.clientY;b.style.setProperty('--cursor-x',tx+'px');b.style.setProperty('--cursor-y',ty+'px');if(!raf)raf=requestAnimationFrame(paint);},{passive:true});
    d.addEventListener('pointerover',e => cursor.classList.toggle('is-hot',!!e.target.closest('a,button,.work-card,.service,.process-step,.evidence-item,.panel,.price-card,.contact-card')));

    qa('.hero,.subhero').forEach(scene => {
      scene.addEventListener('pointermove',e => {
        const r=scene.getBoundingClientRect(); const nx=(e.clientX-r.left)/r.width-.5; const ny=(e.clientY-r.top)/r.height-.5;
        scene.style.setProperty('--cine-bg-x',(-nx*8).toFixed(2)+'px'); scene.style.setProperty('--cine-bg-y',(-ny*6).toFixed(2)+'px');
        scene.style.setProperty('--cine-img-x',(nx*6).toFixed(2)+'px'); scene.style.setProperty('--cine-img-y',(ny*4).toFixed(2)+'px');
        scene.style.setProperty('--cine-copy-x',(-nx*4).toFixed(2)+'px'); scene.style.setProperty('--cine-copy-y',(-ny*3).toFixed(2)+'px');
        pointerPercent(scene,e,'--mx','--my');
      },{passive:true});
      scene.addEventListener('pointerleave',() => ['--cine-bg-x','--cine-bg-y','--cine-img-x','--cine-img-y','--cine-copy-x','--cine-copy-y'].forEach(v => scene.style.removeProperty(v)));
    });

    qa('.button,.nav-cta').forEach(btn => {
      btn.classList.add('cine-magnetic');
      btn.addEventListener('pointermove',e => {const r=btn.getBoundingClientRect();const x=(e.clientX-r.left-r.width/2)*.16;const y=(e.clientY-r.top-r.height/2)*.16;btn.style.transform='translate3d('+x+'px,'+y+'px,0)';},{passive:true});
      btn.addEventListener('pointerleave',() => btn.style.transform='');
    });
  }

  /* Selected Work quick-view dialog. */
  const cards=qa('.work-card');
  if(cards.length){
    const dialog=d.createElement('div'); dialog.className='cine-dialog'; dialog.setAttribute('aria-hidden','true');
    dialog.innerHTML='<div class="cine-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="cine-dialog-title"><div class="cine-dialog__media"></div><div class="cine-dialog__content"><button class="cine-dialog__close" type="button" aria-label="Close project preview">×</button><small class="cine-dialog__meta"></small><h3 id="cine-dialog-title"></h3><p class="cine-dialog__copy"></p><div class="cine-dialog__actions"><a class="button button--light cine-dialog__link" href="/portfolio/">Inspect project</a></div></div></div>';
    b.appendChild(dialog);
    const title=q('#cine-dialog-title',dialog), meta=q('.cine-dialog__meta',dialog), copy=q('.cine-dialog__copy',dialog), media=q('.cine-dialog__media',dialog), link=q('.cine-dialog__link',dialog), closeBtn=q('.cine-dialog__close',dialog);
    let lastFocus=null;
    function closeDialog(){dialog.classList.remove('is-open');dialog.setAttribute('aria-hidden','true');b.style.overflow='';if(lastFocus&&lastFocus.focus)lastFocus.focus();}
    function openDialog(card,trigger){
      lastFocus=trigger||card;
      title.textContent=(q('h3',card)||{}).textContent||'D’AUBE project'; meta.textContent=(q('.work-card__index',card)||{}).textContent||'Selected work'; copy.textContent=(q('p',card)||{}).textContent||'';
      const a=q('a',card); link.href=a?a.href:'/portfolio/'; const art=getComputedStyle(card).getPropertyValue('--art').trim(); media.style.backgroundImage=art||'linear-gradient(145deg,#0d3452,#061725)';
      dialog.classList.add('is-open');dialog.setAttribute('aria-hidden','false');b.style.overflow='hidden';setTimeout(() => closeBtn.focus(),60);
    }
    closeBtn.addEventListener('click',closeDialog); dialog.addEventListener('click',e => {if(e.target===dialog)closeDialog();}); d.addEventListener('keydown',e => {if(e.key==='Escape'&&dialog.classList.contains('is-open'))closeDialog();});
    cards.forEach(card => {
      card.tabIndex=0;
      const inspect=d.createElement('button'); inspect.type='button'; inspect.className='cine-inspect'; inspect.textContent='+'; inspect.setAttribute('aria-label','Preview '+((q('h3',card)||{}).textContent||'project')); card.appendChild(inspect);
      inspect.addEventListener('click',e => {e.stopPropagation();openDialog(card,inspect);});
      card.addEventListener('keydown',e => {if((e.key==='Enter'||e.key===' ')&&!e.target.closest('a,button')){e.preventDefault();openDialog(card,card);}});
      if(!reduced&&fine){card.addEventListener('pointermove',e => {const r=card.getBoundingClientRect();const nx=(e.clientX-r.left)/r.width-.5;const ny=(e.clientY-r.top)/r.height-.5;card.style.setProperty('--ry',(nx*5.5).toFixed(2)+'deg');card.style.setProperty('--rx',(-ny*4.2).toFixed(2)+'deg');pointerPercent(card,e,'--mx','--my');},{passive:true});card.addEventListener('pointerleave',() => {card.style.setProperty('--rx','0deg');card.style.setProperty('--ry','0deg');});}
    });
  }

  /* Tap-select capabilities. */
  const services=qa('.service');
  services.forEach(service => {
    service.tabIndex=0;
    function active(){services.forEach(x => x.classList.remove('is-active'));service.classList.add('is-active');}
    service.addEventListener('click',active);service.addEventListener('focus',active);if(fine)service.addEventListener('pointermove',e => pointerPercent(service,e,'--sx','--sy'),{passive:true});
  });

  /* Process selector with a live detail panel. */
  const process=q('.process');
  if(process){
    const steps=qa('.process-step',process);
    if(steps.length){
      const detail=d.createElement('div');detail.className='cine-process-detail';detail.innerHTML='<strong></strong><p></p>';process.insertAdjacentElement('afterend',detail);
      function activate(step){process.classList.add('has-active');steps.forEach(x => x.classList.toggle('is-active',x===step));q('strong',detail).textContent=(q('h3',step)||{}).textContent||'';q('p',detail).textContent=(q('p',step)||{}).textContent||'';detail.classList.add('is-visible');}
      steps.forEach(step => {step.tabIndex=0;step.addEventListener('click',() => activate(step));step.addEventListener('keydown',e => {if(e.key==='Enter'||e.key===' '){e.preventDefault();activate(step);}});}); activate(steps[0]);
    }
  }

  /* Evidence selector. */
  const evidence=qa('.evidence-item');
  evidence.forEach((item,i) => {item.tabIndex=0;if(i===0)item.classList.add('is-active');function active(){evidence.forEach(x => x.classList.remove('is-active'));item.classList.add('is-active');}item.addEventListener('click',active);item.addEventListener('focus',active);});
})();
