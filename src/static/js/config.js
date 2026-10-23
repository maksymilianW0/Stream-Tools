/* Konfiguracja współdzielona z serwerem (GET/PUT /api/config → config.json). */
export const CFG={
  obsPort:4455, recordDir:"", recordFilenameFormat:"", obsOnThisPc:true, twitchChannel:"", webPort:8080,
  pad:{scenes:{},sceneOrder:[],audioInputs:null,actions:[]}
};

function apply(d){
  Object.assign(CFG,d);
  CFG.pad={scenes:{},sceneOrder:[],audioInputs:null,actions:[],...(d.pad||{})};
}

export async function loadConfig(){
  const r=await fetch("/api/config");
  if(!r.ok) throw new Error("Nie udało się wczytać konfiguracji ("+r.status+")");
  apply(await r.json());
}

export async function saveConfig(next){
  const r=await fetch("/api/config",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(next)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){
    const list=Array.isArray(data.detail)?data.detail:[data.detail||"Nie udało się zapisać ustawień"];
    throw new Error(list.map(i=>typeof i==="string"?i:(i.msg||"błąd")).join(" "));
  }
  apply(data);
}

/** Kolejność scen: najpierw zapisana, potem pozostałe w domyślnej kolejności. */
export function orderScenes(names,order){
  const seen=new Set(), out=[];
  for(const n of order){ if(names.includes(n)&&!seen.has(n)){ seen.add(n); out.push(n); } }
  return [...out,...names.filter(n=>!seen.has(n))];
}
