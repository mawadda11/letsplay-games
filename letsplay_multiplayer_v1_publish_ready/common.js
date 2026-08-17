export const $ = id => document.getElementById(id);
export const qs = new URLSearchParams(location.search);

export function roomCodeFromUrl(){ return (qs.get("room")||"").trim().toUpperCase(); }
export function cleanRoomCode(v){ return (v||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6); }
export function randomRoomCode(){
  const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes=new Uint32Array(6); crypto.getRandomValues(bytes);
  return Array.from(bytes,x=>alphabet[x%alphabet.length]).join("");
}
export function randomToken(){
  const b=new Uint8Array(18); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
export function escapeHtml(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]||c)); }
export function shuffle(a){ a=[...a]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
export function rand(n){ return Math.floor(Math.random()*n); }
export function cryptoRand(n){ if(n<=0)return 0; const a=new Uint32Array(1); crypto.getRandomValues(a); return a[0]%n; }
export function formatGame(g){ return g==="top10"?"Top 10":g==="atrash"?"الأطرش في الزفة":g==="kalim"?"كَلِم":g; }
export function formatVariant(v){ return v==="host"?"مع حكم":"بدون حكم"; }
export function now(){ return Date.now(); }
export function toast(el,text,kind=""){ if(!el)return; el.textContent=text; el.dataset.kind=kind; }
