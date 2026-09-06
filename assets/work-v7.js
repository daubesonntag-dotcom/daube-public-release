(() => {
  const doc = document;
  const body = doc.body;
  const header = doc.querySelector('.site-header');
  const nav = doc.querySelector('.main-nav');
  const menu = doc.querySelector('.menu-button');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer:fine)').matches;
  const isHome = Boolean(doc.querySelector('.hero') && doc.querySelector('.work-section'));

  if (!doc.querySelector('link[data-work-v8]')) {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/assets/work-v8-cinematic.css?v=8';
    link.dataset.workV8 = 'true';
    doc.head.append(link);
  }

  const closeMenu = () => {
    if (!header || !menu) return;
    header.classList.remove('is-open');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Open navigation');
  };

  if (header && menu && nav) {
    menu.addEventListener('click', () => {
      const open = header.classList.toggle('is-open');
      menu.setAttribute('aria-expanded', String(open));
      menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    });
    nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
    addEventListener('resize', () => { if (innerWidth > 1000) closeMenu(); }, { passive: true });
  }

  const updateHeader = () => header?.classList.toggle('is-solid', scrollY > 28);
  updateHeader(); addEventListener('scroll', updateHeader, { passive: true });

  if (!reduced && isHome) {
    const top = doc.createElement('div'); top.className = 'cine-matte cine-matte--top';
    const bottom = doc.createElement('div'); bottom.className = 'cine-matte cine-matte--bottom';
    const mark = doc.createElement('div'); mark.className = 'cine-intro-mark';
    mark.innerHTML = '<div><span>D’AUBE SONNTAG</span><small>Meaning, made visible.</small></div>';
    body.append(top, bottom, mark);
    setTimeout(() => body.classList.add('cine-ready'), 480);
    setTimeout(() => { top.remove(); bottom.remove(); mark.remove(); }, 1900);
  } else body.classList.add('cine-ready');

  doc.querySelectorAll('.hero__title,.subhero__title').forEach((title) => {
    if (title.dataset.cineSplit) return;
    const lines = title.innerHTML.split(/<br\s*\/?>/i);
    if (lines.length < 2) return;
    title.innerHTML = lines.map((line) => `<span class="cine-line"><span>${line}</span></span>`).join('');
    title.dataset.cineSplit = 'true';
  });

  const reveals = [...doc.querySelectorAll('.reveal')];
  reveals.forEach((item, index) => item.style.setProperty('--delay', `${Math.min(index * 55, 220)}ms`));
  if (reduced || !('IntersectionObserver' in window)) reveals.forEach((item) => item.classList.add('is-visible'));
  else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: .07, rootMargin: '0px 0px -7% 0px' });
    reveals.forEach((item) => observer.observe(item));
  }

  const progress = doc.createElement('div'); progress.className = 'cine-progress'; progress.setAttribute('aria-hidden','true'); body.append(progress);
  const updateProgress = () => {
    const max = Math.max(1, doc.documentElement.scrollHeight - innerHeight);
    body.style.setProperty('--scroll', String(Math.max(0, Math.min(100, (scrollY / max) * 100))));
  };
  updateProgress(); addEventListener('scroll', updateProgress, { passive: true });

  const chapterCandidates = isHome ? [
    ['Dawn', '.hero'], ['Work', '.work-section'], ['Capabilities', '.services-section'], ['Process', '.process-section'], ['Proof', '.evidence-section']
  ] : [
    ['Intro', '.subhero'], ['Section 1', '.page-section:nth-of-type(2)'], ['Section 2', '.page-section:nth-of-type(3)'], ['Section 3', '.page-section:nth-of-type(4)']
  ];
  const chapters = chapterCandidates.map(([label, selector]) => ({ label, element: doc.querySelector(selector) })).filter((item) => item.element);
  if (chapters.length > 1) {
    const rail = doc.createElement('nav'); rail.className = 'cine-rail'; rail.setAttribute('aria-label','Page chapters');
    chapters.forEach((chapter, index) => {
      const button = doc.createElement('button'); button.type='button'; button.dataset.label=chapter.label; button.setAttribute('aria-label',`Go to ${chapter.label}`); if(index===0)button.classList.add('is-active');
      button.addEventListener('click',()=>chapter.element.scrollIntoView({behavior:reduced?'auto':'smooth',block:'start'})); chapter.button=button; rail.append(button);
    });
    body.append(rail);
    const setActiveChapter=()=>{const target=innerHeight*.38;let active=0;chapters.forEach((chapter,index)=>{if(chapter.element.getBoundingClientRect().top<=target)active=index});chapters.forEach((chapter,index)=>chapter.button.classList.toggle('is-active',index===active));};
    setActiveChapter(); addEventListener('scroll',setActiveChapter,{passive:true});
  }

  const setPointerPercent=(element,event,xName='--mx',yName='--my')=>{const rect=element.getBoundingClientRect();const x=((event.clientX-rect.left)/rect.width)*100;const y=((event.clientY-rect.top)/rect.height)*100;element.style.setProperty(xName,`${x}%`);element.style.setProperty(yName,`${y}%`)};

  let cursor;
  if (!reduced && fine) {
    cursor=doc.createElement('div');cursor.className='cine-cursor';cursor.setAttribute('aria-hidden','true');body.append(cursor);
    let cx=innerWidth/2,cy=innerHeight/2,tx=cx,ty=cy,cursorFrame=0;
    const paintCursor=()=>{cx+=(tx-cx)*.22;cy+=(ty-cy)*.22;cursor.style.transform=`translate3d(${cx}px,${cy}px,0) translate(-50%,-50%)`;if(Math.abs(tx-cx)>.2||Math.abs(ty-cy)>.2)cursorFrame=requestAnimationFrame(paintCursor);else cursorFrame=0};
    addEventListener('pointermove',(event)=>{tx=event.clientX;ty=event.clientY;body.style.setProperty('--cursor-x',`${tx}px`);body.style.setProperty('--cursor-y',`${ty}px`);if(!cursorFrame)cursorFrame=requestAnimationFrame(paintCursor)},{passive:true});
    doc.addEventListener('pointerover',(event)=>cursor.classList.toggle('is-hot',Boolean(event.target.closest('a,button,.work-card,.service,.process-step,.evidence-item,.panel,.price-card,.contact-card'))));
  }

  if (!reduced && fine) {
    doc.querySelectorAll('.hero,.subhero').forEach((scene)=>{
      scene.addEventListener('pointermove',(event)=>{const rect=scene.getBoundingClientRect();const nx=((event.clientX-rect.left)/rect.width-.5);const ny=((event.clientY-rect.top)/rect.height-.5);scene.style.setProperty('--cine-x',`${(nx*34).toFixed(2)}px`);scene.style.setProperty('--cine-y',`${(ny*24).toFixed(2)}px`);setPointerPercent(scene,event)},{passive:true});
      scene.addEventListener('pointerleave',()=>{scene.style.setProperty('--cine-x','0px');scene.style.setProperty('--cine-y','0px')});
    });
    doc.querySelectorAll('.button,.nav-cta').forEach((button)=>{button.classList.add('cine-magnetic');button.addEventListener('pointermove',(event)=>{const rect=button.getBoundingClientRect();const x=(event.clientX-rect.left-rect.width/2)*.16;const y=(event.clientY-rect.top-rect.height/2)*.16;button.style.transform=`translate3d(${x}px,${y}px,0)`},{passive:true});button.addEventListener('pointerleave',()=>button.style.transform='')});
  }

  const cards=[...doc.querySelectorAll('.work-card')];
  if(cards.length){
    const dialog=doc.createElement('div');dialog.className='cine-dialog';dialog.setAttribute('aria-hidden','true');dialog.innerHTML='<div class="cine-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="cine-dialog-title"><div class="cine-dialog__media"></div><div class="cine-dialog__content"><button class="cine-dialog__close" type="button" aria-label="Close project preview">×</button><small class="cine-dialog__meta"></small><h3 id="cine-dialog-title"></h3><p class="cine-dialog__copy"></p><div class="cine-dialog__actions"><a class="button button--light cine-dialog__link" href="/portfolio/">Inspect project</a></div></div></div>';body.append(dialog);
    const title=dialog.querySelector('h3'),meta=dialog.querySelector('.cine-dialog__meta'),copy=dialog.querySelector('.cine-dialog__copy'),media=dialog.querySelector('.cine-dialog__media'),link=dialog.querySelector('.cine-dialog__link');let lastFocus;
    const close=()=>{dialog.classList.remove('is-open');dialog.setAttribute('aria-hidden','true');body.style.overflow='';lastFocus?.focus?.()};dialog.querySelector('.cine-dialog__close').addEventListener('click',close);dialog.addEventListener('click',(event)=>{if(event.target===dialog)close()});doc.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&dialog.classList.contains('is-open'))close()});
    const open=(card,trigger)=>{lastFocus=trigger||card;title.textContent=card.querySelector('h3')?.textContent?.trim()||'D’AUBE project';meta.textContent=card.querySelector('.work-card__index')?.textContent?.trim()||'Selected work';copy.textContent=card.querySelector('p')?.textContent?.trim()||'';const primary=card.querySelector('a');link.href=primary?.href||'/portfolio/';const art=getComputedStyle(card).getPropertyValue('--art').trim();media.style.backgroundImage=art||'linear-gradient(145deg,#0d3452,#061725)';dialog.classList.add('is-open');dialog.setAttribute('aria-hidden','false');body.style.overflow='hidden';setTimeout(()=>dialog.querySelector('.cine-dialog__close').focus(),80)};
    cards.forEach((card)=>{card.tabIndex=card.tabIndex>=0?card.tabIndex:0;const inspect=doc.createElement('button');inspect.className='cine-inspect';inspect.type='button';inspect.textContent='+';inspect.setAttribute('aria-label',`Preview ${card.querySelector('h3')?.textContent||'project'}`);card.append(inspect);inspect.addEventListener('click',(event)=>{event.stopPropagation();open(card,inspect)});card.addEventListener('keydown',(event)=>{if((event.key==='Enter'||event.key===' ')&&!event.target.closest('a,button')){event.preventDefault();open(card,card)}});if(!reduced&&fine){card.addEventListener('pointermove',(event)=>{const rect=card.getBoundingClientRect();const nx=(event.clientX-rect.left)/rect.width-.5;const ny=(event.clientY-rect.top)/rect.height-.5;card.style.setProperty('--ry',`${(nx*5.5).toFixed(2)}deg`);card.style.setProperty('--rx',`${(-ny*4.2).toFixed(2)}deg`);setPointerPercent(card,event)},{passive:true});card.addEventListener('pointerleave',()=>{card.style.setProperty('--rx','0deg');card.style.setProperty('--ry','0deg')})}});
  }

  const services=[...doc.querySelectorAll('.service')];
  services.forEach((service)=>{service.tabIndex=0;const activate=()=>{services.forEach((item)=>item.classList.remove('is-active'));service.classList.add('is-active')};service.addEventListener('click',activate);service.addEventListener('focus',activate);if(fine)service.addEventListener('pointermove',(event)=>setPointerPercent(service,event,'--sx','--sy'),{passive:true})});

  const process=doc.querySelector('.process');
  if(process){const steps=[...process.querySelectorAll('.process-step')];if(steps.length){const detail=doc.createElement('div');detail.className='cine-process-detail';detail.innerHTML='<strong></strong><p></p>';process.insertAdjacentElement('afterend',detail);const activate=(step)=>{process.classList.add('has-active');steps.forEach((item)=>item.classList.toggle('is-active',item===step));detail.querySelector('strong').textContent=step.querySelector('h3')?.textContent||'';detail.querySelector('p').textContent=step.querySelector('p')?.textContent||'';detail.classList.add('is-visible')};steps.forEach((step)=>{step.tabIndex=0;step.addEventListener('click',()=>activate(step));step.addEventListener('keydown',(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate(step)}})});activate(steps[0])}}

  const evidence=[...doc.querySelectorAll('.evidence-item')];
  evidence.forEach((item,index)=>{item.tabIndex=0;if(index===0)item.classList.add('is-active');const activate=()=>{evidence.forEach((row)=>row.classList.remove('is-active'));item.classList.add('is-active')};item.addEventListener('click',activate);item.addEventListener('focus',activate)});
})();
