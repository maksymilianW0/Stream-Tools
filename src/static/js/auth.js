/* SHA-256 z zapasową implementacją: crypto.subtle nie istnieje na http:// w sieci LAN. */
const K=[],H0=[];
for(let c=2,n=0;n<64;c++){let p=true;for(let d=2;d*d<=c;d++)if(c%d===0){p=false;break}
  if(p){ if(n<8)H0[n]=(Math.pow(c,.5)*2**32)|0; K[n++]=(Math.pow(c,1/3)*2**32)|0; }}
const ror=(x,n)=>(x>>>n)|(x<<(32-n));

export function sha256Sync(msg){
  const l=msg.length,n=((l+9+63)>>6)<<6,b=new Uint8Array(n);
  b.set(msg);b[l]=0x80;const dv=new DataView(b.buffer);
  dv.setUint32(n-8,Math.floor(l*8/2**32));dv.setUint32(n-4,(l*8)>>>0);
  let hh0=H0.slice();const w=new Array(64);
  for(let i=0;i<n;i+=64){
    for(let t=0;t<16;t++)w[t]=dv.getUint32(i+4*t);
    for(let t=16;t<64;t++){
      const a=w[t-15],c=w[t-2];
      w[t]=(w[t-16]+(ror(a,7)^ror(a,18)^(a>>>3))+w[t-7]+(ror(c,17)^ror(c,19)^(c>>>10)))|0;
    }
    let [a,b2,c,d,e,f,g,hh]=hh0;
    for(let t=0;t<64;t++){
      const t1=(hh+(ror(e,6)^ror(e,11)^ror(e,25))+((e&f)^(~e&g))+K[t]+w[t])|0;
      const t2=((ror(a,2)^ror(a,13)^ror(a,22))+((a&b2)^(a&c)^(b2&c)))|0;
      hh=g;g=f;f=e;e=(d+t1)|0;d=c;c=b2;b2=a;a=(t1+t2)|0;
    }
    hh0=[a,b2,c,d,e,f,g,hh].map((x,j)=>(hh0[j]+x)|0);
  }
  const out=new Uint8Array(32),ov=new DataView(out.buffer);
  hh0.forEach((x,i)=>ov.setUint32(i*4,x));
  return out;
}

async function sha256(str){
  const data=new TextEncoder().encode(str);
  if(globalThis.crypto&&crypto.subtle) return new Uint8Array(await crypto.subtle.digest("SHA-256",data));
  return sha256Sync(data);
}

const b64=u8=>btoa(String.fromCharCode(...u8));

export async function obsAuth(password,salt,challenge){
  const secret=b64(await sha256(password+salt));
  return b64(await sha256(secret+challenge));
}
