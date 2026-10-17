import { $, store, toast, buzz, throttle, h } from "./util.js";
import { OBS } from "./obs.js";
import { TwitchChat } from "./chat.js";
import { CFG, loadConfig, orderScenes } from "./config.js";
import { initSettings } from "./settings-ui.js";

const obs=new OBS();
const chat=new TwitchChat($("chatlog"));

const state={
  scene:"", sceneNames:[], streaming:false, recording:false, streamReconnecting:false,
  streamTc:"", recTc:"", inputs:[], specialNames:[], allInputNames:[], audioCapable:new Map()
};

/* ---------- połączenie z OBS ---------- */
let wantConnected=false, connecting=false, attempt=0, retryTimer=null, pollTimer=null;

function setLink(mode,text){
  $("dot").className="dot"+(mode==="ok"?" ok":mode==="retry"?" retry":"");
  $("banner").hidden=mode!=="retry";
  if(mode==="retry") $("banner-msg").textContent=text||"";
}
function setConnMsg(t,err){ const e=$("conn-msg"); e.textContent=t; e.className="msg"+(err?" err":""); }
const showConnect=()=>{ $("connect").hidden=false; };
const hideConnect=()=>{ $("connect").hidden=true; };

function scheduleRetry(reason){
  const wait=Math.min(15000,1500*2**Math.min(attempt,4)); attempt++;
  setLink("retry",`${reason}. Ponawiam za ${Math.round(wait/1000)} s…`);
  clearTimeout(retryTimer);
  retryTimer=setTimeout(()=>connectNow({silent:true}),wait);
}

async function connectNow({silent=false}={}){
  if(connecting) return;
  const host=$("host").value.trim(), pass=$("pass").value;
  if(!host){ setConnMsg("Podaj adres serwera OBS.",true); showConnect(); return; }
  clearTimeout(retryTimer); connecting=true; setConnMsg("Łączę…");
  try{
    await obs.connect(host,CFG.obsPort,pass);
  }catch(e){
    connecting=false;
    if(e.cancelled) return;
    setConnMsg(e.message,true);
    if(e.fatal){ wantConnected=false; setLink("off"); showConnect(); return; }
    if(silent||wantConnected) scheduleRetry(e.message); else showConnect();
    return;
  }
  connecting=false; attempt=0; wantConnected=true;
  store.set("host",host); store.set("pass",pass);
  state.audioCapable.clear();
  setLink("ok"); hideConnect(); setConnMsg(""); keepAwake();
  try{ await loadAll(); }catch(e){ toast(e.message); }
  startPolling();
}

function disconnect(){
  wantConnected=false; clearTimeout(retryTimer); obs.close(); connecting=false;
  stopPolling(); setLink("off");
}

obs.on("close",()=>{
  stopPolling(); attempt=0;
  if(wantConnected) scheduleRetry("Rozłączono z OBS"); else setLink("off");
});

/* ---------- stan i widoki ---------- */
function renderScenes(){
  const box=$("scenes"); box.replaceChildren();
  const list=orderScenes(state.sceneNames,CFG.pad.sceneOrder).filter(n=>!CFG.pad.scenes[n]?.hidden);
  if(!list.length){
    box.append(h("div",{class:"empty"},state.sceneNames.length?"Wszystkie sceny są ukryte. Pokaż je w ustawieniach.":"OBS nie ma żadnych scen."));
    return;
  }
  for(const name of list){
    const c=CFG.pad.scenes[name]||{};
    const b=h("button",{type:"button",class:"scene"+(name===state.scene?" active":""),"aria-pressed":String(name===state.scene)},c.label||name);
    if(c.color) b.style.setProperty("--tint",c.color);
    b.onclick=()=>obs.req("SetCurrentProgramScene",{sceneName:name}).catch(e=>toast(e.message));
    box.append(b);
  }
}

const tcText=(on,tc,onLabel,offLabel)=>on?(tc?`${onLabel} ${tc}`:onLabel):offLabel;
function renderOutputs(){
  $("b-stream").classList.toggle("live",state.streaming);
  $("t-stream").textContent=state.streamReconnecting?"ponawiam połączenie":tcText(state.streaming,state.streamTc,"na żywo","wyłączony");
  $("h-stream").textContent=state.streaming?"przytrzymaj, aby zakończyć":"przytrzymaj, aby włączyć";
  $("b-rec").classList.toggle("rec",state.recording);
  $("t-rec").textContent=tcText(state.recording,state.recTc,"nagrywa","wyłączone");
  $("h-rec").textContent=state.recording?"przytrzymaj, aby zakończyć":"dotknij, aby włączyć";
  $("p-live").hidden=!state.streaming;
  $("p-rec").hidden=!state.recording;
  document.title=(state.streaming?"● ":state.recording?"○ ":"")+"Stream Pad";
}

function renderAudio(){
  const box=$("audio"); box.replaceChildren();
  if(!state.inputs.length){ box.append(h("div",{class:"empty"},"Brak urządzeń audio. Wybierz je w ustawieniach.")); return; }
  for(const inp of state.inputs){
    const mute=h("button",{type:"button",class:"mute"+(inp.muted?" muted":""),onclick:()=>obs.req("ToggleInputMute",{inputName:inp.name}).catch(e=>toast(e.message))},inp.muted?"Wyciszony":"Włączony");
    const send=throttle(v=>obs.req("SetInputVolume",{inputName:inp.name,inputVolumeMul:v}).catch(()=>{}),60);
    const rg=h("input",{type:"range",min:0,max:100,value:Math.round(Math.cbrt(inp.vol)*100),"aria-label":"Głośność: "+inp.name});
    rg.oninput=()=>{ const v=Math.pow(rg.value/100,3); inp.vol=v; send(v); };
    rg.addEventListener("pointerdown",()=>{ inp.dragging=true; });
    for(const ev of ["pointerup","pointercancel"]) rg.addEventListener(ev,()=>setTimeout(()=>{ inp.dragging=false; },300));
    inp.slider=rg; inp.btn=mute;
    box.append(h("div",{class:"ch"},mute,h("div",{},h("div",{class:"name"},inp.name),rg)));
  }
}

async function readInput(name){
  if(state.audioCapable.get(name)===false) return null;
  try{
    const [m,v]=await Promise.all([obs.req("GetInputMute",{inputName:name}),obs.req("GetInputVolume",{inputName:name})]);
    state.audioCapable.set(name,true);
    return {name,muted:m.inputMuted,vol:v.inputVolumeMul};
  }catch(e){
    if(e.fromObs) state.audioCapable.set(name,false); // wejście bez dźwięku
    return null;
  }
}

async function refreshAudio(){
  const wanted=(CFG.pad.audioInputs??state.specialNames).filter(n=>state.allInputNames.includes(n));
  state.inputs=(await Promise.all(wanted.map(readInput))).filter(Boolean);
  renderAudio();
}

async function audioChoices(){
  const all=(await Promise.all(state.allInputNames.map(readInput))).filter(Boolean).map(r=>r.name);
  return {all,defaults:state.specialNames.filter(n=>all.includes(n))};
}

async function loadAll(){
  const sl=await obs.req("GetSceneList");
  state.scene=sl.currentProgramSceneName;
  state.sceneNames=sl.scenes.map(s=>s.sceneName).reverse();
  renderScenes();
  const [ss,rs]=await Promise.all([obs.req("GetStreamStatus"),obs.req("GetRecordStatus")]);
  state.streaming=ss.outputActive; state.recording=rs.outputActive;
  state.streamTc=ss.outputActive?(ss.outputTimecode||"").split(".")[0]:"";
  state.recTc=rs.outputActive?(rs.outputTimecode||"").split(".")[0]:"";
  renderOutputs();
  const sp=await obs.req("GetSpecialInputs");
  state.specialNames=[...new Set(Object.values(sp).filter(Boolean))];
  const list=await obs.req("GetInputList").catch(()=>({inputs:[]}));
  state.allInputNames=[...new Set([...state.specialNames,...list.inputs.map(i=>i.inputName)])];
  await refreshAudio();
}

let reloadTimer=null;
const reloadSoon=()=>{ clearTimeout(reloadTimer); reloadTimer=setTimeout(()=>loadAll().catch(()=>{}),250); };

/* ---------- statystyki i alarmy ---------- */
const LOW_DISK_GB=5;
let diskWarned=false;
function showDisk(mb){
  const gb=mb/1024, box=$("st-disk-wrap");
  $("st-disk").textContent=gb>=1000?(gb/1024).toFixed(1)+" TB":gb.toFixed(gb<100?1:0)+" GB";
  const low=gb<LOW_DISK_GB;
  box.classList.toggle("warn",low);
  if(low&&state.recording&&!diskWarned){ diskWarned=true; toast("Mało miejsca na dysku: "+gb.toFixed(1)+" GB"); buzz([200,100,200]); }
  if(gb>=LOW_DISK_GB+1) diskWarned=false;
}

async function poll(){
  if(document.visibilityState!=="visible") return;
  try{
    const s=await obs.req("GetStats");
    $("st-cpu").textContent=s.cpuUsage.toFixed(1)+"%";
    $("st-fps").textContent=s.activeFps.toFixed(0);
    $("st-drop").textContent=s.outputSkippedFrames+"/"+s.outputTotalFrames;
    if(typeof s.availableDiskSpace==="number") showDisk(s.availableDiskSpace);
    if(state.streaming){ const o=await obs.req("GetStreamStatus"); state.streamTc=(o.outputTimecode||"").split(".")[0]; }
    if(state.recording){ const o=await obs.req("GetRecordStatus"); state.recTc=(o.outputTimecode||"").split(".")[0]; }
    renderOutputs();
  }catch{}
}
function startPolling(){ stopPolling(); poll(); pollTimer=setInterval(poll,2000); }
function stopPolling(){ clearInterval(pollTimer); pollTimer=null; }

/* ---------- zdarzenia OBS ---------- */
obs.on("CurrentProgramSceneChanged",d=>{ state.scene=d.sceneName; renderScenes(); });
obs.on("SceneListChanged",reloadSoon);
obs.on("InputCreated",reloadSoon);
obs.on("InputRemoved",reloadSoon);
obs.on("InputNameChanged",reloadSoon);
obs.on("StreamStateChanged",d=>{
  if(d.outputState==="OBS_WEBSOCKET_OUTPUT_RECONNECTING"){ state.streamReconnecting=true; toast("Stream: utracono połączenie, ponawiam"); buzz([200,100,200]); }
  else{
    if(state.streamReconnecting&&d.outputState==="OBS_WEBSOCKET_OUTPUT_RECONNECTED") toast("Stream: połączenie odzyskane");
    state.streamReconnecting=false; state.streaming=d.outputActive; if(!d.outputActive) state.streamTc="";
  }
  renderOutputs();
});
obs.on("RecordStateChanged",d=>{ state.recording=d.outputActive; if(!d.outputActive) state.recTc=""; renderOutputs(); });
obs.on("InputMuteStateChanged",d=>{
  const i=state.inputs.find(x=>x.name===d.inputName);
  if(i&&i.btn){ i.muted=d.inputMuted; i.btn.className="mute"+(i.muted?" muted":""); i.btn.textContent=i.muted?"Wyciszony":"Włączony"; }
});
obs.on("InputVolumeChanged",d=>{
  const i=state.inputs.find(x=>x.name===d.inputName);
  if(i&&i.slider&&!i.dragging&&document.activeElement!==i.slider){ i.vol=d.inputVolumeMul; i.slider.value=Math.round(Math.cbrt(i.vol)*100); }
});
obs.on("ReplayBufferSaved",()=>toast("Powtórka zapisana"));

/* ---------- przyciski: przytrzymanie chroni przed przypadkowym dotknięciem ---------- */
function holdToConfirm(btn,ms,action,needsHold=()=>true){
  let t=null;
  const cancel=()=>{ if(t){ clearTimeout(t); t=null; } btn.classList.remove("holding"); };
  const start=()=>{
    if(btn.disabled||t) return;
    if(!needsHold()){ buzz(); action(); return; }
    btn.style.setProperty("--hold-ms",ms+"ms"); btn.classList.add("holding");
    t=setTimeout(()=>{ t=null; btn.classList.remove("holding"); buzz(30); action(); },ms);
  };
  btn.addEventListener("pointerdown",e=>{ if(e.button===0||e.pointerType==="touch") start(); });
  for(const ev of ["pointerup","pointerleave","pointercancel"]) btn.addEventListener(ev,cancel);
  btn.addEventListener("contextmenu",e=>e.preventDefault());
  btn.addEventListener("keydown",e=>{ if((e.key==="Enter"||e.key===" ")&&!e.repeat){ e.preventDefault(); start(); } });
  btn.addEventListener("keyup",e=>{ if(e.key==="Enter"||e.key===" ") cancel(); });
}

async function applyRecordSettings(){
  if(CFG.recordDir){
    try{ await obs.req("SetRecordDirectory",{recordDirectory:CFG.recordDir}); }
    catch{
      // starsze OBS (bez SetRecordDirectory): ustaw w profilu tryb prosty i zaawansowany
      try{
        await obs.req("SetProfileParameter",{parameterCategory:"SimpleOutput",parameterName:"FilePath",parameterValue:CFG.recordDir});
        await obs.req("SetProfileParameter",{parameterCategory:"AdvOut",parameterName:"RecFilePath",parameterValue:CFG.recordDir});
      }catch(e){ toast("Nie udało się ustawić katalogu nagrań: "+e.message); }
    }
  }
  if(CFG.recordFilenameFormat){
    try{ await obs.req("SetProfileParameter",{parameterCategory:"Output",parameterName:"FilenameFormatting",parameterValue:CFG.recordFilenameFormat}); }
    catch(e){ toast("Nie udało się ustawić nazwy pliku: "+e.message); }
  }
}

holdToConfirm($("b-stream"),1000,()=>obs.req(state.streaming?"StopStream":"StartStream").catch(e=>toast(e.message)));
holdToConfirm($("b-rec"),800,async()=>{
  try{
    if(!state.recording) await applyRecordSettings();
    await obs.req(state.recording?"StopRecord":"StartRecord");
  }catch(e){ toast(e.message); }
},()=>state.recording);
$("b-replay").onclick=()=>obs.req("SaveReplayBuffer").catch(()=>toast("Włącz bufor powtórek w OBS"));

/* ---------- okno połączenia ---------- */
async function discover(){
  $("scan-msg").textContent="Szukam OBS w sieci…"; $("found").replaceChildren();
  try{
    const r=await fetch("/api/discover"); const list=await r.json();
    $("scan-msg").textContent=list.length?"Znaleziono OBS:":"Nie znaleziono OBS. Wpisz adres ręcznie i sprawdź, czy serwer WebSocket jest włączony (Narzędzia → Ustawienia serwera WebSocket).";
    for(const ip of list){
      const c=h("button",{type:"button",class:"chip"+(ip===$("host").value?" sel":"")},ip);
      c.onclick=()=>{ $("host").value=ip; document.querySelectorAll(".chip").forEach(x=>x.classList.remove("sel")); c.classList.add("sel"); };
      $("found").append(c);
    }
    return list;
  }catch{ $("scan-msg").textContent="Skanowanie nie powiodło się. Wpisz adres ręcznie."; return []; }
}
function changeServer(){ disconnect(); showConnect(); discover(); }

$("go").onclick=()=>connectNow();
$("rescan").onclick=discover;
$("pass").addEventListener("keydown",e=>{ if(e.key==="Enter") connectNow(); });
$("b-banner-server").onclick=changeServer;

/* ---------- ustawienia ---------- */
const recDirText=()=>CFG.recordDir?"Nagrania trafiają do: "+CFG.recordDir:"Katalog nagrań: ustawienie z OBS";

initSettings({
  async getContext(){
    const connected=obs.isOpen;
    return {connected,sceneNames:state.sceneNames,audio:connected?await audioChoices():null};
  },
  async onSaved(prev){
    toast("Zapisano ustawienia");
    $("rec-dir").textContent=recDirText();
    renderScenes();
    if(obs.isOpen) await refreshAudio().catch(()=>{});
    if(CFG.twitchChannel&&CFG.twitchChannel!==prev.twitchChannel) chat.join(CFG.twitchChannel);
    if(CFG.obsPort!==prev.obsPort&&wantConnected){
      obs.close(); stopPolling(); attempt=0; setLink("retry","Zmieniono port OBS");
      setTimeout(()=>connectNow({silent:true}),0);
    }
  },
  onChangeServer:changeServer
});

/* ---------- czat ---------- */
$("chan-go").onclick=()=>chat.join($("chan").value);
$("chan").addEventListener("keydown",e=>{ if(e.key==="Enter") chat.join($("chan").value); });

/* ---------- zakładki (telefon) ---------- */
function setTab(tab){
  document.body.dataset.tab=tab; store.set("tab",tab);
  document.querySelectorAll("#tabbar button").forEach(b=>{
    const on=b.dataset.tab===tab; b.classList.toggle("on",on); b.setAttribute("aria-selected",String(on));
  });
}
document.querySelectorAll("#tabbar button").forEach(b=>{ b.onclick=()=>setTab(b.dataset.tab); });

/* ---------- telefon: wibracja, wybudzanie, powrót z tła ---------- */
document.addEventListener("click",e=>{ if(e.target.closest("button.scene,button.mute,#b-replay")) buzz(12); });

let wakeLock=null;
async function keepAwake(){
  // tylko w bezpiecznym kontekście (https lub localhost); w LAN po http API nie istnieje
  try{ if("wakeLock" in navigator&&document.visibilityState==="visible") wakeLock=await navigator.wakeLock.request("screen"); }catch{}
}
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState!=="visible") return;
  // przeglądarki mobilne zrywają WebSockety w tle, więc po powrocie łączymy ponownie
  if(wantConnected){
    if(obs.isOpen){ loadAll().catch(()=>{}); poll(); keepAwake(); }
    else if(!connecting){ clearTimeout(retryTimer); attempt=0; connectNow({silent:true}); }
  }
  chat.revive();
});

/* ---------- start ---------- */
(async function init(){
  const saved=store.get("tab"); setTab(["pad","audio","chat"].includes(saved)?saved:"pad");
  try{ await loadConfig(); }catch(e){ toast(e.message); }
  $("rec-dir").textContent=recDirText();
  renderScenes(); renderAudio(); renderOutputs();
  $("host").value=store.get("host"); $("pass").value=store.get("pass"); $("chan").value=store.get("chan");
  if(!$("chan").value&&CFG.twitchChannel) $("chan").value=CFG.twitchChannel;
  if($("chan").value) chat.join($("chan").value);

  if($("host").value){ wantConnected=true; connectNow({silent:true}); return; }
  showConnect();
  const found=await discover();
  if(found.length===1&&!$("host").value){ $("host").value=found[0]; connectNow(); }
})();
