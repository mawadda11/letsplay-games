import { db, ensureAuth, ref, get, set } from "./firebase.js";
import { $, randomRoomCode, cleanRoomCode, now } from "./common.js";
let game="top10", variant="auto";
document.querySelectorAll("[data-game]").forEach(b=>b.onclick=()=>{game=b.dataset.game;document.querySelectorAll("[data-game]").forEach(x=>x.classList.toggle("active",x===b));$("topVariant").classList.toggle("hidden",game!=="top10");});
document.querySelectorAll("[data-variant]").forEach(b=>b.onclick=()=>{variant=b.dataset.variant;document.querySelectorAll("[data-variant]").forEach(x=>x.classList.toggle("active",x===b));});
$("joinCode").addEventListener("input",e=>e.target.value=cleanRoomCode(e.target.value));
$("createBtn").onclick=async()=>{
  try{$("createBtn").disabled=true;$("createNotice").textContent="جاري إنشاء الغرفة…";const ownerName=$("ownerName").value.trim();if(!ownerName)throw new Error("اكتبي اسم الهوست");const u=await ensureAuth();let code="";
    for(let i=0;i<8;i++){const c=randomRoomCode();const s=await get(ref(db,`rooms/${c}/meta`));if(!s.exists()){code=c;break;}}
    if(!code)throw new Error("تعذر إنشاء كود فريد، حاولي مرة ثانية.");
    const createdAt=now();
    await set(ref(db,`rooms/${code}/meta`),{ownerUid:u.uid,ownerName,game,variant:game==="top10"?variant:"online",createdAt,status:"lobby",round:0});
    // في كَلِم والأطرش: منشئ الغرفة هو أول لاعب فعلي تلقائيًا، وليس مجرد شاشة إدارة.
    if(game!=="top10"){
      await set(ref(db,`rooms/${code}/members/${u.uid}`),{name:ownerName,joinedAt:createdAt,online:true,role:"owner"});
    }
    location.href=game==="top10"?`display.html?room=${code}`:`play.html?room=${code}`;
  }catch(e){$("createNotice").textContent="خطأ: "+e.message;$("createBtn").disabled=false;}
};
$("joinBtn").onclick=async()=>{try{const code=cleanRoomCode($("joinCode").value);if(code.length!==6)throw new Error("اكتبي كود الغرفة المكوّن من 6 خانات.");await ensureAuth();const s=await get(ref(db,`rooms/${code}/meta`));if(!s.exists())throw new Error("الغرفة غير موجودة.");const roomMeta=s.val();if(roomMeta.game==="top10")throw new Error("Top 10 تُلعب من الشاشة المشتركة ولا تحتاج دخول اللاعبين بالجوال. إذا كانت اللعبة بوضع الحكم، استخدمي رابط الحكم الخاص.");location.href=`play.html?room=${code}`;}catch(e){$("joinNotice").textContent=e.message;}};
