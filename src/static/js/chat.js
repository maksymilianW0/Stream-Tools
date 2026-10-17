import { $, store, h } from "./util.js";

const UNESC={":":";",s:" ",r:"\r",n:"\n","\\":"\\"};
const unescTag=v=>(v||"").replace(/\\(.)/g,(_,c)=>UNESC[c]??c);

/** Wyciąga samą nazwę kanału z wpisanego tekstu lub adresu. Zwraca "" gdy nieprawidłowa. */
export function parseChannel(raw){
  const c=String(raw||"").trim().replace(/^#/,"").replace(/[?#].*$/,"").replace(/\/+$/,"").split("/").pop().replace(/^[@#]/,"").toLowerCase();
  return /^[a-z0-9_]{3,25}$/.test(c)?c:"";
}

/** Dzieli wiadomość na kawałki tekstu i emotki (indeksy z tagu `emotes` są w punktach kodowych). */
export function splitMessage(text,emotesTag){
  const chars=Array.from(text), ranges=[];
  for(const part of (emotesTag||"").split("/")){
    const [id,pos]=part.split(":"); if(!id||!pos) continue;
    for(const r of pos.split(",")){
      const [s,e]=r.split("-").map(Number);
      if(Number.isInteger(s)&&Number.isInteger(e)&&e>=s) ranges.push({s,e,id});
    }
  }
  ranges.sort((a,b)=>a.s-b.s);
  const out=[]; let i=0;
  for(const r of ranges){
    if(r.s<i||r.e>=chars.length) continue;
    if(r.s>i) out.push({text:chars.slice(i,r.s).join("")});
    out.push({emote:r.id,name:chars.slice(r.s,r.e+1).join("")});
    i=r.e+1;
  }
  if(i<chars.length) out.push({text:chars.slice(i).join("")});
  return out;
}

/** Anonimowy czat Twitch (tylko odczyt). */
export class TwitchChat{
  constructor(log){ this.log=log; this.ws=null; this.channel=""; this.tries=0; this.timer=null; }

  line(user,color,text,{sys=false,action=false,emotes=""}={}){
    const log=this.log, stick=log.scrollTop+log.clientHeight>=log.scrollHeight-40;
    let el;
    if(sys){ el=h("div",{class:"sys"},text); }
    else{
      const name=h("b",{},user); if(/^#[0-9a-f]{6}$/i.test(color||"")) name.style.color=color;
      const body=splitMessage(text,emotes).map(p=>p.emote
        ? h("img",{class:"emote",alt:p.name,title:p.name,loading:"lazy",src:`https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(p.emote)}/default/dark/1.0`})
        : p.text);
      el=h("div",{class:"m"+(action?" action":"")},name,...body);
    }
    log.append(el);
    while(log.children.length>300) log.firstChild.remove();
    if(stick) log.scrollTop=log.scrollHeight;
  }

  sys(text){ this.line("","",text,{sys:true}); }

  join(raw,retry=false){
    const channel=parseChannel(raw);
    if(!channel){ this.sys("Nieprawidłowa nazwa kanału. Wpisz samą nazwę, np. mr3xw."); return; }
    $("chan").value=channel; store.set("chan",channel); this.channel=channel;
    clearTimeout(this.timer);
    if(this.ws){ this.ws.onclose=null; this.ws.onerror=null; this.ws.close(); }
    if(!retry){ this.tries=0; this.sys("Łączę z #"+channel+"…"); }
    let joined=false;
    const ws=this.ws=new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    ws.onopen=()=>{ ws.send("CAP REQ :twitch.tv/tags"); ws.send("PASS SCHMOOPIISFAKE"); ws.send("NICK justinfan"+Math.floor(Math.random()*90000+10000)); ws.send("JOIN #"+channel); };
    ws.onmessage=ev=>{
      ev.data.split("\r\n").filter(Boolean).forEach(line=>{
        if(line.startsWith("PING")){ ws.send("PONG :tmi.twitch.tv"); return; }
        if(!joined&&(/ 366 /.test(line)||/ JOIN #/.test(line))){ joined=true; this.tries=0; this.sys("Połączono z #"+channel); return; }
        const n=line.match(/NOTICE \S+ :(.*)$/);
        if(n){ this.sys("Twitch: "+n[1]); return; }
        const m=line.match(/^@(\S+) :([^!]+)![^ ]+ PRIVMSG #\S+ :(.*)$/);
        if(!m) return;
        const tags=Object.fromEntries(m[1].split(";").map(t=>{ const i=t.indexOf("="); return [t.slice(0,i),t.slice(i+1)]; }));
        let text=m[3], action=false;
        const a=text.match(/^\u0001ACTION (.*?)\u0001?$/);
        if(a){ action=true; text=a[1]; }
        this.line(unescTag(tags["display-name"])||m[2],tags.color,text,{action,emotes:tags.emotes});
      });
    };
    setTimeout(()=>{ if(this.ws===ws&&!joined) this.sys("Brak odpowiedzi od Twitcha. Sprawdź nazwę kanału i połączenie z internetem."); },10000);
    ws.onclose=e=>{
      if(this.ws!==ws) return;
      this.tries++;
      if(this.tries>5){ this.sys("Nie udało się połączyć z Twitchem (kod "+e.code+"). Sprawdź internet, blokery reklam/VPN i nazwę kanału, potem kliknij Połącz."); return; }
      const wait=Math.min(30,5*this.tries);
      this.sys("Rozłączono (kod "+e.code+"). Ponawiam za "+wait+" s…");
      this.timer=setTimeout(()=>{ if(this.ws===ws) this.join(channel,true); },wait*1000);
    };
  }

  /** Po powrocie z tła: odnów połączenie, jeśli gniazdo padło. */
  revive(){ if(this.channel&&(!this.ws||this.ws.readyState>1)) this.join(this.channel); }
}
