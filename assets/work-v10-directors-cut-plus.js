(() => {
  'use strict';
  const d=document,q=(s,r=d)=>r.querySelector(s),qa=(s,r=d)=>Array.from(r.querySelectorAll(s));
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine=matchMedia('(pointer:fine)').matches;
  const gallery=q('.director-gallery');
  if(gallery&&!gallery.dataset.swipeReady){
    gallery.dataset.swipeReady='true';
    const stage=q('.director-gallery__stage',gallery),tabs=qa('.director-gallery__nav button',gallery);
    let startX=0,startY=0,tracking=false;
    const selectedIndex=()=>Math.max(0,tabs.findIndex(x=>x.classList.contains('is-active')));
    const move=dir=>{const at=selectedIndex(),next=(at+dir+tabs.length)%tabs.length;stage.classList.remove('is-swipe-left','is-swipe-right');void stage.offsetWidth;stage.classList.add(dir>0?'is-swipe-left':'is-swipe-right');tabs[next]?.click();setTimeout(()=>stage.classList.remove('is-swipe-left','is-swipe-right'),460);};
    stage.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;tracking=true;startX=e.clientX;startY=e.clientY;stage.classList.add('is-dragging');stage.setPointerCapture?.(e.pointerId);});
    stage.addEventListener('pointerup',e=>{if(!tracking)return;tracking=false;stage.classList.remove('is-dragging');const dx=e.clientX-startX,dy=e.clientY-startY;if(Math.abs(dx)>56&&Math.abs(dx)>Math.abs(dy)*1.15)move(dx<0?1:-1);stage.releasePointerCapture?.(e.pointerId);});
    stage.addEventListener('pointercancel',()=>{tracking=false;stage.classList.remove('is-dragging')});
    if(fine&&!reduced)stage.addEventListener('wheel',e=>{if(Math.abs(e.deltaX)>Math.abs(e.deltaY)&&Math.abs(e.deltaX)>26){e.preventDefault();move(e.deltaX>0?1:-1)}},{passive:false});
  }

  const hero=q('.hero'),reel=q('.cine-reel');
  if(hero&&reel&&!q('.director-hero-reel',hero)){
    const launcher=d.createElement('button');launcher.type='button';launcher.className='director-hero-reel';launcher.dataset.directorHeroReel='ready';launcher.setAttribute('aria-label','Open Studio Motion Study');launcher.innerHTML='<span class="director-hero-reel__icon" aria-hidden="true">▶</span><span class="director-hero-reel__copy"><strong>Studio motion</strong><span>View interactive reel</span></span>';
    launcher.addEventListener('click',()=>reel.scrollIntoView({behavior:reduced?'auto':'smooth',block:'start'}));hero.appendChild(launcher);
  }
})();
