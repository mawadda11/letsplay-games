import { db, ensureAuth, ref, get, set } from "./firebase.js";
import { $, randomRoomCode, cleanRoomCode, now } from "./common.js";
let game="top10", variant="auto";
document.querySelectorAll("[data-game]").forEach(b=>b.onclick=()=>{game=b.dataset.game;document.querySelectorAll("[data-game]").forEach(x=>x.classList.toggle("active",x===b));$("topVariant").classList.toggle("hidden",game!=="top10");});
document.querySelectorAll("[data-variant]").forEach(b=>b.onclick=()=>{variant=b.dataset.variant;document.querySelectorAll("[data-variant]").forEach(x=>x.classList.toggle("active",x===b));});
$("joinCode").addEventListener("input",e=>e.target.value=cleanRoomCode(e.target.value));
$("createBtn").onclick=async()=>{
  try{$("createBtn").disabled=true;$("createNotice").textContent="جاري إنشاء الغرفة…";const u=await ensureAuth();let code="";
    for(let i=0;i<8;i++){const c=randomRoomCode();const s=await get(ref(db,`rooms/${c}/meta`));if(!s.exists()){code=c;break;}}
    if(!code)throw new Error("تعذر إنشاء كود فريد، حاولي مرة ثانية.");
    await set(ref(db,`rooms/${code}/meta`),{ownerUid:u.uid,game,variant:game==="top10"?variant:"online",createdAt:now(),status:"lobby",round:0});
    location.href=`display.html?room=${code}`;
  }catch(e){$("createNotice").textContent="خطأ: "+e.message;$("createBtn").disabled=false;}
};
$("joinBtn").onclick=async()=>{try{const code=cleanRoomCode($("joinCode").value);if(code.length!==6)throw new Error("اكتبي كود الغرفة المكوّن من 6 خانات.");await ensureAuth();const s=await get(ref(db,`rooms/${code}/meta`));if(!s.exists())throw new Error("الغرفة غير موجودة.");location.href=`play.html?room=${code}`;}catch(e){$("joinNotice").textContent=e.message;}};
