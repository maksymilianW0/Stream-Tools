// Uruchom: node --test src/tests/frontend.test.mjs   (Node 22.7+)
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// --- atrapa WebSocket ---
class FakeWS{
  static instances=[];
  constructor(url){ this.url=url; this.readyState=0; this.sent=[]; FakeWS.instances.push(this); }
  send(d){ this.sent.push(JSON.parse(d)); }
  close(){ if(this.readyState>=2) return; this.readyState=3; queueMicrotask(()=>this.onclose&&this.onclose({code:1000})); }
  // pomocnicy testowe
  open(){ this.readyState=1; }
  push(m){ this.onmessage&&this.onmessage({data:JSON.stringify(m)}); }
  die(code){ this.readyState=3; this.onclose&&this.onclose({code}); }
}
globalThis.WebSocket=FakeWS;

const { OBS, ObsError } = await import("../static/js/obs.js");
const { sha256Sync, obsAuth } = await import("../static/js/auth.js");
const { splitMessage, parseChannel } = await import("../static/js/chat.js");
const { throttle } = await import("../static/js/util.js");
const { orderScenes } = await import("../static/js/config.js");

const tick=()=>new Promise(r=>setTimeout(r,0));
const last=()=>FakeWS.instances.at(-1);

test("sha256Sync zgadza się z node:crypto", () => {
  for(const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "zażółć gęślą jaźń".repeat(9)]){
    const want=createHash("sha256").update(s).digest("hex");
    const got=Buffer.from(sha256Sync(new TextEncoder().encode(s))).toString("hex");
    assert.equal(got,want,s.slice(0,10));
  }
});

test("obsAuth daje ten sam wynik co referencyjna implementacja", async () => {
  const sha=b=>createHash("sha256").update(b).digest();
  const secret=sha("hasło"+"sól").toString("base64");
  const want=sha(secret+"wyzwanie").toString("base64");
  assert.equal(await obsAuth("hasło","sól","wyzwanie"),want);
});

test("udane połączenie, żądanie i zdarzenie close tylko raz", async () => {
  const obs=new OBS(); let closes=0; obs.on("close",()=>closes++);
  const p=obs.connect("h",4455,""); const ws=last(); ws.open();
  ws.push({op:0,d:{}}); await tick();
  assert.equal(ws.sent[0].op,1);
  ws.push({op:2,d:{}}); await p;
  assert.equal(obs.isOpen,true);

  const r=obs.req("GetStats"); const id=ws.sent.at(-1).d.requestId;
  ws.push({op:7,d:{requestId:id,requestStatus:{result:true},responseData:{x:1}}});
  assert.deepEqual(await r,{x:1});

  ws.die(1006); assert.equal(closes,1); assert.equal(obs.isOpen,false);
});

test("złe hasło: błąd krytyczny i brak zdarzenia close", async () => {
  const obs=new OBS(); let closes=0; obs.on("close",()=>closes++);
  const p=obs.connect("h",4455,"zle"); const ws=last(); ws.open();
  ws.push({op:0,d:{authentication:{salt:"s",challenge:"c"}}});
  await tick(); ws.die(4009);
  await assert.rejects(p,e=>e instanceof ObsError&&e.fatal&&e.message==="Złe hasło");
  assert.equal(closes,0);
});

test("brak hasła gdy OBS go wymaga: błąd krytyczny, bez pętli ponowień", async () => {
  const obs=new OBS(); let closes=0; obs.on("close",()=>closes++);
  const p=obs.connect("h",4455,""); const ws=last(); ws.open();
  ws.push({op:0,d:{authentication:{salt:"s",challenge:"c"}}});
  await assert.rejects(p,e=>e.fatal&&/hasła/.test(e.message));
  await tick(); await tick();
  assert.equal(closes,0);
});

test("nieudane połączenie: jedno odrzucenie, bez zdarzenia close", async () => {
  const obs=new OBS(); let closes=0; obs.on("close",()=>closes++);
  const p=obs.connect("h",4455,""); const ws=last();
  ws.onerror(); ws.die(1006);
  await assert.rejects(p,e=>!e.fatal&&/Nie można połączyć/.test(e.message));
  await tick(); assert.equal(closes,0);
});

test("close() w trakcie łączenia anuluje obietnicę", async () => {
  const obs=new OBS(); const p=obs.connect("h",4455,"");
  obs.close();
  await assert.rejects(p,e=>e.cancelled===true);
});

test("nowe connect() zamyka poprzednie gniazdo", async () => {
  const obs=new OBS(); const p1=obs.connect("a",1,""); const first=last();
  const p2=obs.connect("b",1,"");
  await assert.rejects(p1,e=>e.cancelled);
  assert.notEqual(last(),first); assert.equal(first.readyState,3);
  obs.close(); await assert.rejects(p2);
});

test("odpowiedź z błędem OBS ma fromObs=true", async () => {
  const obs=new OBS(); const p=obs.connect("h",4455,""); const ws=last(); ws.open();
  ws.push({op:0,d:{}}); ws.push({op:2,d:{}}); await p;
  const r=obs.req("GetInputMute",{inputName:"x"}); const id=ws.sent.at(-1).d.requestId;
  ws.push({op:7,d:{requestId:id,requestStatus:{result:false,comment:"nie"}}});
  await assert.rejects(r,e=>e.fromObs&&e.message==="nie");
});

test("splitMessage: emotki wg punktów kodowych", () => {
  const parts=splitMessage("Kappa 😀 Kappa","25:0-4,8-12");
  assert.deepEqual(parts.map(p=>p.emote||p.text),["25"," 😀 ","25"]);
  assert.deepEqual(splitMessage("zwykły tekst",""),[{text:"zwykły tekst"}]);
  assert.deepEqual(splitMessage("abc","1:5-9"),[{text:"abc"}]); // poza zakresem: ignoruj
});

test("parseChannel", () => {
  assert.equal(parseChannel("https://www.twitch.tv/MrExample?x=1"),"mrexample");
  assert.equal(parseChannel("#abc_12"),"abc_12");
  assert.equal(parseChannel("a b"),"");
  assert.equal(parseChannel("ab"),"");
});

test("throttle wysyła pierwszą i ostatnią wartość", async () => {
  const got=[]; const f=throttle(v=>got.push(v),30);
  f(1); f(2); f(3); await new Promise(r=>setTimeout(r,60));
  assert.deepEqual(got,[1,3]);
});

test("orderScenes: zapisana kolejność, potem reszta, bez duplikatów i nieistniejących", () => {
  assert.deepEqual(orderScenes(["A","B","C"],["C","X","C","A"]),["C","A","B"]);
});
