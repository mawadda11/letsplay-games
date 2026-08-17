import { TOP10_SYNONYM_GROUPS } from "./data.js";

export function normalizeArabic(s){
  return String(s||"").toLowerCase().normalize("NFD")
    .replace(/[ً-ٰٟ]/g,"")
    .replace(/[أإآٱ]/g,"ا").replace(/ؤ/g,"و").replace(/ئ/g,"ي").replace(/ى/g,"ي").replace(/ة/g,"ه")
    .replace(/^(ال)(?=[؀-ۿ])/,'')
    .replace(/[^؀-ۿa-z0-9]/g,"");
}
function lev(a,b){const m=a.length,n=b.length,d=Array.from({length:m+1},()=>Array(n+1).fill(0));for(let i=0;i<=m;i++)d[i][0]=i;for(let j=0;j<=n;j++)d[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[m][n];}
function variants(answer){
  const n=normalizeArabic(answer), out=[answer];
  for(const group of TOP10_SYNONYM_GROUPS){ if(group.some(x=>normalizeArabic(x)===n)) out.push(...group); }
  return [...new Set(out)];
}
function scoreOne(input,candidate){
  const a=normalizeArabic(input), b=normalizeArabic(candidate); if(!a||!b)return 0;
  if(a===b)return 100;
  if(a.length>=3&&b.length>=3&&(a.includes(b)||b.includes(a)))return 94;
  const dist=lev(a,b), max=Math.max(a.length,b.length); if(max>=4&&dist===1)return 91;
  const sim=max?1-dist/max:0; return Math.round(sim*84);
}
export function bestTop10Match(input,answers,revealed=[]){
  let best={index:-1,score:0,via:""};
  answers.forEach((ans,i)=>{ if(revealed.includes(i))return; for(const v of variants(ans)){const s=scoreOne(input,v); if(s>best.score)best={index:i,score:s,via:v};} });
  return best;
}
export function isAutoAccept(best){ return best.index>=0 && best.score>=90; }
