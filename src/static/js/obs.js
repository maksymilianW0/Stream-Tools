import { obsAuth } from "./auth.js";

export class ObsError extends Error{
  constructor(msg,{fatal=false,cancelled=false,fromObs=false}={}){
    super(msg); this.fatal=fatal; this.cancelled=cancelled; this.fromObs=fromObs;
  }
}

const CONNECT_TIMEOUT=8000, REQUEST_TIMEOUT=8000;

/** Klient OBS WebSocket v5. Jedno gniazdo naraz; zdarzenie "close" tylko po udanym połączeniu. */
export class OBS{
  constructor(){ this.ws=null; this.opened=false; this.pending=new Map(); this.id=0; this.handlers={}; this._cancel=null; }

  on(ev,fn){ this.handlers[ev]=fn; }
  get isOpen(){ return !!this.ws && this.ws.readyState===1 && this.opened; }

  connect(host,port,password){
    this.close();
    return new Promise((resolve,reject)=>{
      let settled=false, timer=null;
      const ws=new WebSocket(`ws://${host}:${port}`);
      this.ws=ws; this.opened=false;
      const fail=(msg,opts)=>{
        if(settled) return;
        settled=true; clearTimeout(timer); this._cancel=null;
        reject(new ObsError(msg,opts));
        try{ ws.close(); }catch{}
      };
      this._cancel=()=>fail("Anulowano",{cancelled:true});
      timer=setTimeout(()=>fail(`Brak odpowiedzi z ${host}:${port}`),CONNECT_TIMEOUT);

      ws.onerror=()=>fail(`Nie można połączyć z ${host}:${port}`);
      ws.onclose=e=>{
        if(this.ws!==ws) return;
        this._rejectPending(new ObsError("rozłączono"));
        if(!settled){ fail(e.code===4009?"Złe hasło":`Połączenie zamknięte (${e.code})`,{fatal:e.code===4009}); return; }
        if(this.opened){ this.opened=false; this.handlers.close&&this.handlers.close(); }
      };
      ws.onmessage=async ev=>{
        let m; try{ m=JSON.parse(ev.data); }catch{ return; }
        if(m.op===0){
          const d={rpcVersion:1,eventSubscriptions:2047};
          if(m.d.authentication){
            if(!password){ fail("OBS wymaga hasła",{fatal:true}); return; }
            try{ d.authentication=await obsAuth(password,m.d.authentication.salt,m.d.authentication.challenge); }
            catch{ fail("Nie udało się obliczyć hasła",{fatal:true}); return; }
          }
          if(ws.readyState===1) ws.send(JSON.stringify({op:1,d}));
        }else if(m.op===2){
          if(!settled){ settled=true; clearTimeout(timer); this._cancel=null; this.opened=true; resolve(); }
        }else if(m.op===5){
          const f=this.handlers[m.d.eventType]; f&&f(m.d.eventData||{});
        }else if(m.op===7){
          const p=this.pending.get(m.d.requestId); if(!p) return;
          this.pending.delete(m.d.requestId);
          m.d.requestStatus.result
            ? p.resolve(m.d.responseData||{})
            : p.reject(new ObsError(m.d.requestStatus.comment||"błąd",{fromObs:true}));
        }
      };
    });
  }

  req(type,data){
    return new Promise((resolve,reject)=>{
      if(!this.isOpen) return reject(new ObsError("brak połączenia"));
      const id=String(++this.id);
      const t=setTimeout(()=>{ this.pending.delete(id); reject(new ObsError("OBS nie odpowiada")); },REQUEST_TIMEOUT);
      this.pending.set(id,{
        resolve:v=>{ clearTimeout(t); resolve(v); },
        reject:e=>{ clearTimeout(t); reject(e); }
      });
      this.ws.send(JSON.stringify({op:6,d:{requestType:type,requestId:id,requestData:data}}));
    });
  }

  _rejectPending(err){
    for(const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  /** Zamyka gniazdo bez wywoływania "close"; przerywa też trwające łączenie. */
  close(){
    const ws=this.ws, cancel=this._cancel;
    if(cancel) cancel();
    this.ws=null; this.opened=false;
    this._rejectPending(new ObsError("rozłączono"));
    if(ws){ ws.onclose=ws.onerror=ws.onmessage=null; try{ ws.close(); }catch{} }
  }
}
