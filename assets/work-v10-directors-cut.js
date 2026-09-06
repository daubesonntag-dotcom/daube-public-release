(() => {
  'use strict';
  const d=document,b=d.body,q=(s,r=d)=>r.querySelector(s),qa=(s,r=d)=>Array.from(r.querySelectorAll(s));
  if(b.dataset.directorV10==='ready') return;
  b.dataset.directorV10='ready';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine=matchMedia('(pointer:fine)').matches;
  const isHome=!!(q('.hero')&&q('.work-section'));
  if(!isHome) return;

  /* Director scene choreography */
  const scenes=qa('.hero,.work-section,.services-section,.process-section,.evidence-section,.cine-reel,.cta-section');
  scenes.forEach(el=>el.classList.add('director-scene'));
  const veil=d.createElement('div');veil.className='director-transition-veil';veil.setAttribute('aria-hidden','true');b.appendChild(veil);
  let scrollRaf=0;
  const paintScroll=()=>{
    scrollRaf=0;
    let active=null,best=Infinity;
    scenes.forEach(scene=>{
      const r=scene.getBoundingClientRect();
      const local=Math.max(0,Math.min(1,(innerHeight-r.top)/(innerHeight+r.height)));
      scene.style.setProperty('--director-local',local.toFixed(3));
      const distance=Math.abs(r.top-innerHeight*.18);
      if(distance<best){best=distance;active=scene;}
    });
    scenes.forEach(scene=>scene.classList.toggle('is-director-active',scene===active));
    const phase=Math.abs(((scrollY/Math.max(1,innerHeight))%1)-.5)*2;
    b.style.setProperty('--director-veil',String(Math.max(0,1-phase)*.24));
    b.style.setProperty('--director-scroll',String(Math.min(1,scrollY/Math.max(1,innerHeight))));
  };
  addEventListener('scroll',()=>{if(!scrollRaf)scrollRaf=requestAnimationFrame(paintScroll)},{passive:true});paintScroll();

  /* Living hero atmosphere and independent depth layers */
  const hero=q('.hero');
  if(hero){
    hero.classList.add('director-hero-scene');
    const atmosphere=d.createElement('div');atmosphere.className='director-hero-atmosphere';atmosphere.setAttribute('aria-hidden','true');
    atmosphere.innerHTML='<i class="director-glint"></i><i class="director-water"></i>';hero.appendChild(atmosphere);
    if(!reduced&&fine){
      hero.addEventListener('pointermove',e=>{
        const r=hero.getBoundingClientRect(),nx=(e.clientX-r.left)/r.width-.5,ny=(e.clientY-r.top)/r.height-.5;
        hero.style.setProperty('--director-img-x',(nx*10).toFixed(2)+'px');
        hero.style.setProperty('--director-img-y',(ny*7).toFixed(2)+'px');
        hero.style.setProperty('--director-copy-x',(-nx*7).toFixed(2)+'px');
        hero.style.setProperty('--director-copy-y',(-ny*5).toFixed(2)+'px');
      },{passive:true});
      hero.addEventListener('pointerleave',()=>['--director-img-x','--director-img-y','--director-copy-x','--director-copy-y'].forEach(v=>hero.style.removeProperty(v)));
    }
  }

  /* Selected Work -> spatial director gallery */
  const cards=qa('.work-card');
  const grid=q('.work-grid');
  if(cards.length&&grid&&!q('.director-gallery')){
    const gallery=d.createElement('div');gallery.className='director-gallery';
    gallery.innerHTML='<div class="director-gallery__stage"><div class="director-gallery__art" aria-hidden="true"></div><div class="director-gallery__copy" aria-live="polite"><span class="director-gallery__meta"></span><h3></h3><p></p><div class="director-gallery__actions"><a class="button button--light director-gallery__link" href="/portfolio/">Inspect project</a><button class="button director-gallery__preview" type="button">Open preview</button></div></div><div class="director-gallery__counter" aria-live="polite"></div></div><div class="director-gallery__nav" role="tablist" aria-label="Selected work"></div>';
    grid.parentNode.insertBefore(gallery,grid);
    const stage=q('.director-gallery__stage',gallery),art=q('.director-gallery__art',gallery),meta=q('.director-gallery__meta',gallery),title=q('h3',gallery),copy=q('.director-gallery__copy p',gallery),link=q('.director-gallery__link',gallery),preview=q('.director-gallery__preview',gallery),counter=q('.director-gallery__counter',gallery),nav=q('.director-gallery__nav',gallery);
    let current=0;
    const data=cards.map((card,i)=>({
      card,
      meta:q('.work-card__index',card)?.textContent?.trim()||`0${i+1} · Selected work`,
      title:q('h3',card)?.textContent?.trim()||'D’AUBE project',
      copy:q('p',card)?.textContent?.trim()||'',
      href:q('a',card)?.href||'/portfolio/',
      art:getComputedStyle(card).getPropertyValue('--art').trim()||'linear-gradient(145deg,#0d3452,#061725)'
    }));
    const tabs=data.map((item,i)=>{const btn=d.createElement('button');btn.type='button';btn.role='tab';btn.innerHTML=`<span>0${i+1}</span><strong>${item.title}</strong>`;btn.setAttribute('aria-label',`Show ${item.title}`);btn.addEventListener('click',()=>activate(i,true));nav.appendChild(btn);return btn;});
    function activate(index,focus=false){
      current=(index+data.length)%data.length;const item=data[current];
      art.style.setProperty('--director-art',item.art);stage.style.setProperty('--director-art',item.art);
      meta.textContent=item.meta;title.textContent=item.title;copy.textContent=item.copy;link.href=item.href;counter.textContent=`0${current+1} / 0${data.length}`;
      tabs.forEach((tab,i)=>{tab.classList.toggle('is-active',i===current);tab.setAttribute('aria-selected',String(i===current));tab.tabIndex=i===current?0:-1;});
      if(focus)tabs[current].focus({preventScroll:true});
    }
    preview.addEventListener('click',()=>q('.cine-inspect',data[current].card)?.click());
    gallery.addEventListener('keydown',e=>{if(e.key==='ArrowRight'){e.preventDefault();activate(current+1,true)}else if(e.key==='ArrowLeft'){e.preventDefault();activate(current-1,true)}else if(e.key==='Enter'&&e.target===stage){preview.click();}});
    stage.tabIndex=0;
    if(!reduced&&fine){stage.addEventListener('pointermove',e=>{const r=stage.getBoundingClientRect(),nx=(e.clientX-r.left)/r.width-.5,ny=(e.clientY-r.top)/r.height-.5;stage.style.setProperty('--director-art-x',(nx*-10).toFixed(2)+'px');stage.style.setProperty('--director-art-y',(ny*-7).toFixed(2)+'px');stage.style.setProperty('--director-x',((nx+.5)*100)+'%');stage.style.setProperty('--director-y',((ny+.5)*100)+'%');},{passive:true});stage.addEventListener('pointerleave',()=>{stage.style.setProperty('--director-art-x','0px');stage.style.setProperty('--director-art-y','0px');});}
    gallery.dataset.directorGallery='ready';activate(0);
  }

  /* Capabilities -> focus stage */
  const services=qa('.service');
  const capStage=q('.cine-service-detail');
  if(capStage){
    capStage.classList.add('director-capability-stage');capStage.dataset.directorCapabilityStage='ready';capStage.setAttribute('aria-live','polite');
    const visual=q('.cine-service-detail__visual',capStage);
    if(visual&&fine&&!reduced)visual.addEventListener('pointermove',e=>{const r=visual.getBoundingClientRect();visual.style.setProperty('--director-cap-x',((e.clientX-r.left)/r.width*100)+'%');visual.style.setProperty('--director-cap-y',((e.clientY-r.top)/r.height*100)+'%');},{passive:true});
    services.forEach((service,i)=>service.addEventListener('click',()=>capStage.dataset.capability=String(i+1)));
  }

  /* Process -> progress-driven live stage */
  const process=q('.process');const processStage=q('.cine-process-detail');
  if(process&&processStage){
    process.classList.add('director-process-track');process.dataset.directorProcess='ready';
    processStage.classList.add('director-process-stage');processStage.dataset.directorProcessStage='ready';processStage.setAttribute('aria-live','polite');
    const notes=d.createElement('div');notes.className='director-process-notes';notes.setAttribute('aria-hidden','true');processStage.appendChild(notes);
    const steps=qa('.process-step',process);
    const noteSets=[['Context','Constraints','Outcome'],['Scope','Acceptance','Proof'],['Working core','Integration','Handoff'],['Expected flows','Failure paths','Evidence']];
    const setStep=i=>{process.style.setProperty('--director-step',String(i));processStage.dataset.step=`0${i+1}`;notes.innerHTML=(noteSets[i]||noteSets[0]).map(x=>`<span>${x}</span>`).join('');};
    steps.forEach((step,i)=>{step.addEventListener('click',()=>setStep(i));step.addEventListener('focus',()=>setStep(i));});setStep(0);
  }

  /* Evidence focus follows interaction */
  const evidence=qa('.evidence-item'),evidenceSection=q('.evidence-section');
  if(evidenceSection&&fine&&!reduced)evidenceSection.addEventListener('pointermove',e=>{const r=evidenceSection.getBoundingClientRect();evidenceSection.style.setProperty('--director-evidence-x',((e.clientX-r.left)/r.width*100)+'%');evidenceSection.style.setProperty('--director-evidence-y',((e.clientY-r.top)/r.height*100)+'%');},{passive:true});
  evidence.forEach((item,i)=>item.dataset.directorEvidence=String(i+1));

  /* Studio Motion Study -> keyboard + richer control semantics */
  const reel=q('.cine-reel');
  if(reel){
    reel.dataset.directorReel='ready';reel.tabIndex=0;
    const controls=q('.cine-reel__controls',reel);if(controls){controls.classList.add('director-reel-controls');controls.dataset.directorReelControls='ready';}
    const play=q('.cine-reel__play',reel),sceneButtons=qa('.cine-reel__scenes button',reel),stageTop=q('.cine-reel__stage-top',reel);stageTop?.setAttribute('aria-live','polite');
    let selected=0;
    const sync=()=>{const idx=sceneButtons.findIndex(x=>x.classList.contains('is-active'));if(idx>=0)selected=idx;};
    sceneButtons.forEach((btn,i)=>btn.addEventListener('click',()=>selected=i));
    reel.addEventListener('keydown',e=>{sync();if(e.key==='ArrowRight'&&sceneButtons.length){e.preventDefault();selected=(selected+1)%sceneButtons.length;sceneButtons[selected].click();sceneButtons[selected].focus();}else if(e.key==='ArrowLeft'&&sceneButtons.length){e.preventDefault();selected=(selected-1+sceneButtons.length)%sceneButtons.length;sceneButtons[selected].click();sceneButtons[selected].focus();}else if((e.key===' '||e.key==='k')&&play&&!e.target.closest('a,button')){e.preventDefault();play.click();}});
  }

  /* Optional generated ambient soundscape: OFF by default and user-initiated only. */
  if(!reduced&&!q('.director-sound-toggle')){
    const sound=d.createElement('button');sound.type='button';sound.className='director-sound-toggle';sound.dataset.directorSoundToggle='ready';sound.setAttribute('aria-pressed','false');sound.setAttribute('aria-label','Turn ambient sound on');sound.textContent='Ambient off';b.appendChild(sound);
    let ctx=null,master=null,nodes=[];
    const buildAudio=()=>{
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return false;ctx=new AC();master=ctx.createGain();master.gain.value=0;master.connect(ctx.destination);
      const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=420;filter.Q.value=.8;filter.connect(master);
      [82.41,123.47,164.81].forEach((freq,i)=>{const osc=ctx.createOscillator(),g=ctx.createGain();osc.type=i===1?'triangle':'sine';osc.frequency.value=freq;g.gain.value=i===0?.012:.006;osc.connect(g);g.connect(filter);osc.start();nodes.push(osc,g);});
      const buffer=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*.12;const noise=ctx.createBufferSource(),ng=ctx.createGain(),nf=ctx.createBiquadFilter();noise.buffer=buffer;noise.loop=true;nf.type='lowpass';nf.frequency.value=180;ng.gain.value=.012;noise.connect(nf);nf.connect(ng);ng.connect(master);noise.start();nodes.push(noise,ng,nf,filter);return true;
    };
    const setOn=async on=>{if(on){if(!ctx&&!buildAudio())return;await ctx.resume();master.gain.cancelScheduledValues(ctx.currentTime);master.gain.linearRampToValueAtTime(.42,ctx.currentTime+1.2);}else if(ctx){master.gain.cancelScheduledValues(ctx.currentTime);master.gain.linearRampToValueAtTime(0,ctx.currentTime+.55);setTimeout(()=>ctx?.suspend(),650);}sound.setAttribute('aria-pressed',String(on));sound.setAttribute('aria-label',on?'Turn ambient sound off':'Turn ambient sound on');sound.textContent=on?'Ambient on':'Ambient off';};
    sound.addEventListener('click',()=>setOn(sound.getAttribute('aria-pressed')!=='true'));
    d.addEventListener('visibilitychange',()=>{if(d.hidden&&sound.getAttribute('aria-pressed')==='true')setOn(false)});
  }
})();
