import { $, h } from "./util.js";
import { CFG, saveConfig, orderScenes } from "./config.js";
import { parseChannel } from "./chat.js";

const COLORS=["#35e0c0","#ff4560","#ffb547","#5aa9ff","#a78bfa","#f472b6"];

/**
 * Panel ustawień. Zależności z app.js:
 *  getContext()     → {connected, sceneNames, audio:{all,defaults}|null}
 *  onSaved(prev)    → wywoływane po udanym zapisie
 *  onChangeServer() → otwiera okno wyboru serwera OBS
 */
export function initSettings({getContext,onSaved,onChangeServer}){
  const root=$("settings"), body=$("settings-body"), msg=$("settings-msg"), saveBtn=$("settings-save");
  let draft=null, ctx=null, audioMode="keep"; // keep | custom | default

  const close=()=>{ root.hidden=true; };
  const say=(t,err)=>{ msg.textContent=t; msg.className="msg"+(err?" err":""); };

  function makeDraft(){
    const scenes=orderScenes(ctx.sceneNames,CFG.pad.sceneOrder).map(name=>{
      const c=CFG.pad.scenes[name]||{};
      return {name,label:c.label||"",color:c.color||"",hidden:!!c.hidden};
    });
    return {
      obsPort:String(CFG.obsPort), recordDir:CFG.recordDir, recordFilenameFormat:CFG.recordFilenameFormat,
      obsOnThisPc:CFG.obsOnThisPc, twitchChannel:CFG.twitchChannel, scenes, audio:audioList(CFG.pad.audioInputs)
    };
  }
  function audioList(selected){
    if(!ctx.audio) return null;
    const sel=(selected??ctx.audio.defaults).filter(n=>ctx.audio.all.includes(n));
    return [...sel.map(name=>({name,on:true})),...ctx.audio.all.filter(n=>!sel.includes(n)).map(name=>({name,on:false}))];
  }

  async function open(){
    say("Wczytuję…"); root.hidden=false;
    try{ ctx=await getContext(); }catch{ ctx={connected:false,sceneNames:[],audio:null}; }
    say(""); draft=makeDraft(); audioMode="keep";
    render(); body.scrollTop=0; $("settings-close").focus();
  }

  function field(label,key,{hint="",type="text",...attrs}={}){
    const id="f-"+key;
    const input=h("input",{type,id,value:draft[key],autocomplete:"off",autocapitalize:"off",spellcheck:"false",...attrs,oninput:()=>{ draft[key]=input.value; }});
    return h("div",{class:"field"},h("label",{for:id},label),input,hint&&h("div",{class:"hintline"},hint));
  }
  function check(label,key){
    const input=h("input",{type:"checkbox",id:"f-"+key,checked:draft[key],onchange:()=>{ draft[key]=input.checked; }});
    return h("label",{class:"check",for:"f-"+key},input,label);
  }
  function mover(list,i,isAudio){
    const mv=d=>{
      const j=i+d; if(j<0||j>=list.length) return;
      [list[i],list[j]]=[list[j],list[i]]; if(isAudio) audioMode="custom"; render();
    };
    return h("div",{class:"move"},
      h("button",{type:"button","aria-label":"Przesuń wyżej",disabled:i===0,onclick:()=>mv(-1)},"▲"),
      h("button",{type:"button","aria-label":"Przesuń niżej",disabled:i===list.length-1,onclick:()=>mv(1)},"▼"));
  }

  function sceneRows(){
    return draft.scenes.map((s,i)=>{
      const label=h("input",{type:"text",value:s.label,placeholder:s.name,maxlength:60,"aria-label":"Tekst na przycisku sceny "+s.name,oninput:()=>{ s.label=label.value; }});
      const sw=["",...COLORS].map(c=>h("button",{type:"button",class:"sw"+(c===s.color?" sel":"")+(c?"":" none"),style:c?`background:${c}`:null,"aria-label":c?"Kolor "+c:"Bez koloru","aria-pressed":String(c===s.color),onclick:()=>{ s.color=c; render(); }},c?"":"×"));
      const vis=h("input",{type:"checkbox",checked:!s.hidden,onchange:()=>{ s.hidden=!vis.checked; }});
      return h("div",{class:"row"},mover(draft.scenes,i,false),
        h("div",{class:"rowmain"},h("div",{class:"rowtitle"},s.name),label,h("div",{class:"swatches"},sw),h("label",{class:"check"},vis,"Pokaż przycisk")));
    });
  }
  function audioRows(){
    return draft.audio.map((a,i)=>{
      const on=h("input",{type:"checkbox",checked:a.on,onchange:()=>{ a.on=on.checked; audioMode="custom"; }});
      return h("div",{class:"row"},mover(draft.audio,i,true),h("div",{class:"rowmain"},h("label",{class:"check"},on,a.name)));
    });
  }

  function resetPad(){
    draft.scenes=ctx.sceneNames.map(name=>({name,label:"",color:"",hidden:false}));
    draft.audio=audioList(null); audioMode="default"; render(); say("Układ przywrócony. Zapisz zmiany, aby go zastosować.");
  }

  function render(){
    const st=body.scrollTop, offline=!ctx.connected;
    body.replaceChildren(
      h("section",{},h("h3",{},"OBS"),
        field("Port serwera WebSocket","obsPort",{type:"number",min:1,max:65535,inputmode:"numeric"}),
        h("button",{type:"button",class:"btn ghost",onclick:()=>{ close(); onChangeServer(); }},"Zmień serwer OBS")),
      h("section",{},h("h3",{},"Nagrywanie"),
        field("Katalog nagrań","recordDir",{hint:"Ścieżka na komputerze z OBS. Puste = bez zmiany ustawień OBS."}),
        field("Schemat nazwy pliku","recordFilenameFormat",{hint:"Składnia OBS, np. %CCYY-%MM-%DD_%hh-%mm-%ss. Puste = bez zmiany."}),
        check("OBS działa na tym samym komputerze co serwer Stream Pad","obsOnThisPc")),
      h("section",{},h("h3",{},"Czat"),
        field("Domyślny kanał Twitch","twitchChannel",{hint:"Sama nazwa albo adres kanału."})),
      h("section",{},h("h3",{},"Sceny"),
        offline||!draft.scenes.length
          ? h("div",{class:"msg"},offline?"Połącz się z OBS, aby dopasować przyciski scen.":"OBS nie ma żadnych scen.")
          : h("div",{class:"rows"},sceneRows())),
      h("section",{},h("h3",{},"Dźwięk"),
        offline||!draft.audio
          ? h("div",{class:"msg"},"Połącz się z OBS, aby wybrać urządzenia audio.")
          : h("div",{class:"rows"},audioRows())),
      !offline&&h("button",{type:"button",class:"btn ghost",onclick:resetPad},"Przywróć domyślny układ"));
    body.scrollTop=st;
  }

  function payload(){
    const raw=draft.twitchChannel.trim();
    const channel=raw?parseChannel(raw):"";
    if(raw&&!channel) throw new Error("Kanał Twitch: wpisz samą nazwę (3–25 znaków).");
    const port=Number(draft.obsPort);
    if(!Number.isInteger(port)||port<1||port>65535) throw new Error("Port OBS musi być liczbą od 1 do 65535.");

    const pad={scenes:{...CFG.pad.scenes},sceneOrder:[...CFG.pad.sceneOrder],audioInputs:CFG.pad.audioInputs};
    if(draft.scenes.length){
      const absent=CFG.pad.sceneOrder.filter(n=>!ctx.sceneNames.includes(n));
      pad.sceneOrder=[...draft.scenes.map(s=>s.name),...absent];
      for(const s of draft.scenes){
        const v={label:s.label.trim(),color:s.color,hidden:s.hidden};
        if(!v.label&&!v.color&&!v.hidden) delete pad.scenes[s.name]; else pad.scenes[s.name]=v;
      }
    }
    if(draft.audio){
      if(audioMode==="default") pad.audioInputs=null;
      else if(audioMode==="custom") pad.audioInputs=draft.audio.filter(a=>a.on).map(a=>a.name);
    }
    return {obsPort:port,recordDir:draft.recordDir.trim(),recordFilenameFormat:draft.recordFilenameFormat.trim(),obsOnThisPc:draft.obsOnThisPc,twitchChannel:channel,pad};
  }

  saveBtn.onclick=async()=>{
    let p; try{ p=payload(); }catch(e){ say(e.message,true); return; }
    const prev={obsPort:CFG.obsPort,twitchChannel:CFG.twitchChannel};
    saveBtn.disabled=true; say("Zapisuję…");
    try{ await saveConfig(p); }
    catch(e){ say(e.message,true); saveBtn.disabled=false; return; }
    saveBtn.disabled=false; close();
    await onSaved(prev);
  };
  $("settings-cancel").onclick=close;
  $("settings-close").onclick=close;
  root.addEventListener("keydown",e=>{ if(e.key==="Escape") close(); });
  $("b-settings").onclick=open;
  return {open};
}
