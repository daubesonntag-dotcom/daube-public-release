const CHANNEL_URL='./release-channel.json';
const LAST_VERSION_KEY='daube.studio.public.last-channel-version';
let deferredInstallPrompt=null;

function notify(message){
  const toast=document.querySelector('#toast');
  if(!toast){console.info(`[D’AUBE Studio] ${message}`);return;}
  toast.textContent=message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer=setTimeout(()=>toast.classList.remove('show'),3200);
}

function installButton(){
  const actions=document.querySelector('.top-actions');
  if(!actions) return null;
  let button=document.querySelector('#installAppButton');
  if(button) return button;
  button=document.createElement('button');
  button.id='installAppButton';
  button.type='button';
  button.textContent='⇩ Install';
  button.hidden=true;
  button.title='Install D’AUBE Studio Public Atelier';
  actions.prepend(button);
  button.addEventListener('click',async()=>{
    if(!deferredInstallPrompt){notify('Install is handled by your browser on this device.');return;}
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(()=>null);
    deferredInstallPrompt=null;
    button.hidden=true;
  });
  return button;
}

window.addEventListener('beforeinstallprompt',(event)=>{
  event.preventDefault();
  deferredInstallPrompt=event;
  const button=installButton();
  if(button) button.hidden=false;
});

window.addEventListener('appinstalled',()=>{
  deferredInstallPrompt=null;
  const button=document.querySelector('#installAppButton');
  if(button) button.hidden=true;
  notify('D’AUBE Studio Public Atelier installed.');
});

async function registerServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  try{
    const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
    registration.addEventListener('updatefound',()=>{
      const worker=registration.installing;
      if(!worker) return;
      worker.addEventListener('statechange',()=>{
        if(worker.state==='installed'&&navigator.serviceWorker.controller) notify('A verified Public Atelier update is ready. Reload when convenient.');
      });
    });
  }catch(error){
    console.warn('[D’AUBE Studio] service worker unavailable',error);
  }
}

async function checkReleaseChannel(){
  try{
    const response=await fetch(CHANNEL_URL,{cache:'no-store'});
    if(!response.ok) throw new Error(`channel ${response.status}`);
    const channel=await response.json();
    if(channel?.artifact!=='studio-public-atelier'||channel?.channel!=='stable'||!channel?.version) throw new Error('invalid stable channel');
    const version=String(channel.version);
    const label=document.querySelector('#projectName span');
    if(label) label.textContent=`public v${version}`;
    const previous=localStorage.getItem(LAST_VERSION_KEY);
    if(previous&&previous!==version) notify(`D’AUBE Studio ${version} is available on the stable channel.`);
    localStorage.setItem(LAST_VERSION_KEY,version);
    document.documentElement.dataset.publicVersion=version;
  }catch(error){
    console.warn('[D’AUBE Studio] release channel unavailable',error);
  }
}

installButton();
registerServiceWorker();
checkReleaseChannel();
