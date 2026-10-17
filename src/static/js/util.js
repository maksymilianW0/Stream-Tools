export const $ = id => document.getElementById(id);

export const store = {
  get(k){ try{ return localStorage.getItem(k) || ""; }catch{ return ""; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch{} }
};

export function toast(t){
  const e=$("toast");
  e.textContent=t; e.classList.add("show");
  clearTimeout(toast.t); toast.t=setTimeout(()=>e.classList.remove("show"),2600);
}

export function buzz(pattern=12){ try{ navigator.vibrate&&navigator.vibrate(pattern); }catch{} }

/** Wywołuje fn najwyżej raz na ms; ostatnia wartość zawsze zostaje wysłana. */
export function throttle(fn, ms){
  let last=0, timer=null, lastArgs=[];
  return (...args)=>{
    lastArgs=args;
    const wait=ms-(Date.now()-last);
    if(wait<=0){ clearTimeout(timer); timer=null; last=Date.now(); fn(...lastArgs); }
    else if(!timer){ timer=setTimeout(()=>{ timer=null; last=Date.now(); fn(...lastArgs); },wait); }
  };
}

/** Mały helper do budowania DOM: h("button",{class:"x",onclick:fn},"tekst") */
export function h(tag, props, ...kids){
  const n=document.createElement(tag);
  for(const [k,v] of Object.entries(props||{})){
    if(v==null||v===false) continue;
    if(k==="class") n.className=v;
    else if(k==="style") n.style.cssText=v;
    else if(k.startsWith("on")) n[k]=v;
    else n.setAttribute(k, v===true?"":v);
  }
  n.append(...kids.flat().filter(c=>c!=null&&c!==false));
  return n;
}
