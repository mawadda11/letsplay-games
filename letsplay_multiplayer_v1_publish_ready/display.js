import { db, ensureAuth, ref, get, set, update, remove, onValue, runTransaction } from "./firebase.js";
import { TOP10_QUESTIONS, ATRASH_PAIRS } from "./data.js";
import { createKalimState, activeFace, otherFace } from "./kalim-engine.js";
import { bestTop10Match, isAutoAccept } from "./top10-match.js";
import { $, roomCodeFromUrl, escapeHtml, formatGame, formatVariant, randomToken, cryptoRand, now } from "./common.js";

const room=roomCodeFromUrl(); let user,meta,members={},unsubs=[],hostToken=null,hostTokenExpiry=0,processing=false,kalimTimerSeconds=14,hostSelectedCard=null,lastKalimState=null;
const roomRef=p=>ref(db,`rooms/${room}${p?'/'+p:''}`);
function allMembers(){return Object.entries(members).filter(([,m])=>m&&m.name);}
function onlineMembers(){return allMembers().filter(([,m])=>m.online!==false);}
function renderMembers(){
  const box=$("members");box.innerHTML="";
  const ownerMember=members[meta?.ownerUid]||null;
  const crown=document.createElement("div");crown.className="member"+(ownerMember?.online===false?" offline":"");
  crown.innerHTML=`<span><span class="online-dot"></span> <b>👑 ${escapeHtml(ownerMember?.name||meta?.ownerName||"هوست الغرفة")}</b></span><span class="small">${ownerMember?.online===false?'غير متصل':'الهوست الأساسي · لاعب'}</span>`;box.appendChild(crown);
  for(const [uid,m] of allMembers()){
    if(uid===meta?.ownerUid)continue;
    const d=document.createElement("div");d.className="member"+(m.online===false?" offline":"");const role=m.role==='cohost'?'🛡️ هوست مساعد':(m.online===false?'غير متصل':'متصل');
    d.innerHTML=`<span><span class="online-dot"></span> <b>${escapeHtml(m.name)}</b></span><span class="small">${role}</span>`;box.appendChild(d);
  }
  if(onlineMembers().length<=1&&meta?.game!=="top10"){const e=document.createElement('div');e.className='muted';e.textContent='بانتظار دخول بقية اللاعبين…';box.appendChild(e);}
  renderManageList();
}
function renderManageList(){
  const box=$("manageList");if(!box)return;box.innerHTML=`<div class="member"><span><b>👑 ${escapeHtml(members[meta?.ownerUid]?.name||meta?.ownerName||"هوست الغرفة")}</b></span><span class="small">المالك الأساسي · لاعب · لا يمكن طرده</span></div>`;
  for(const [uid,m] of allMembers()){
    if(uid===meta?.ownerUid)continue;
    const d=document.createElement("div");d.className="member"+(m.online===false?" offline":"");d.innerHTML=`<span><b>${escapeHtml(m.name)}</b><div class="small">${m.role==='cohost'?'🛡️ هوست مساعد':m.online===false?'غير متصل':'لاعب'}</div></span><span style="display:flex;gap:6px;flex-wrap:wrap"><button class="secondary memberRoleBtn" data-u="${uid}" data-role="${m.role||''}">${m.role==='cohost'?'إزالة الهوست':'تعيين هوست'}</button><button class="danger memberKickBtn" data-u="${uid}">طرد</button></span>`;box.appendChild(d);
  }
  if(!allMembers().filter(([uid])=>uid!==meta?.ownerUid).length)box.innerHTML+=`<div class="muted">لا يوجد لاعبون آخرون داخل الغرفة حاليًا.</div>`;
  document.querySelectorAll('.memberRoleBtn').forEach(b=>b.onclick=()=>setMemberRole(b.dataset.u,b.dataset.role==='cohost'?'player':'cohost'));
  document.querySelectorAll('.memberKickBtn').forEach(b=>b.onclick=()=>kickMember(b.dataset.u));
}
async function setMemberRole(uid,role){if(uid===meta?.ownerUid)return;await update(roomRef(`members/${uid}`),{role});}
async function kickMember(uid){if(uid===meta?.ownerUid)return;if(!confirm('طرد هذا اللاعب من الغرفة؟'))return;await remove(roomRef(`members/${uid}`));}
function makeQr(el,url){el.innerHTML="";try{new QRCode(el,{text:url,width:176,height:176,correctLevel:QRCode.CorrectLevel.M});}catch{el.innerHTML='<div style="color:#111;font-size:11px">QR غير متاح<br>استخدموا الرابط</div>';}}
function setStatus(s){$("statusLabel").textContent=s==="lobby"?"بانتظار اللاعبين":s==="playing"?"جاري اللعب":s;}
async function setMetaStatus(status){await update(roomRef("meta"),{status});}

async function boot(){
  if(!room){$("boot").innerHTML='<h2>كود الغرفة غير موجود</h2>';return;} user=await ensureAuth();const ms=await get(roomRef("meta"));if(!ms.exists()){$("boot").innerHTML='<h2>الغرفة غير موجودة</h2>';return;}meta=ms.val();
  if(meta.game!=="top10"){location.replace(`play.html?room=${room}`);return;}
  if(meta.ownerUid!==user.uid){$("boot").innerHTML='<h2>هذه شاشة Top 10 الأساسية</h2><div class="muted">افتحها من الجهاز الذي أنشأ الغرفة.</div>';return;}
  // ترقية الغرف القديمة تلقائيًا: الهوست نفسه يصبح عضوًا/لاعبًا فعليًا بدون QR أو جهاز إضافي.
  if(meta.game!=="top10"){
    const existing=(await get(roomRef(`members/${user.uid}`))).val()||{};
    const all=(await get(roomRef("members"))).val()||{};
    for(const [uid,m] of Object.entries(all)){if(uid!==user.uid&&m?.role==="owner")await remove(roomRef(`members/${uid}`));}
    await update(roomRef(`members/${user.uid}`),{name:existing.name||meta.ownerName||"الهوست",joinedAt:existing.joinedAt||meta.createdAt||now(),online:true,role:"owner"});
    // تنظيف حقول الربط القديمة إن وجدت؛ لم يعد هناك أي ربط QR للهوست اللاعب.
    if(meta.ownerPlayerUid)await update(roomRef("meta"),{ownerPlayerUid:null});
  }
  $("boot").classList.add("hidden");$("main").classList.remove("hidden");$("roomCode").textContent=room;$("gameLabel").textContent=formatGame(meta.game)+(meta.game==="top10"?` · ${formatVariant(meta.variant)}`:"");setStatus(meta.status);
  const share=$("shareTopLink");if(share)share.onclick=async()=>{try{await navigator.clipboard.writeText(location.href);const old=share.textContent;share.textContent='✓ تم النسخ';setTimeout(()=>share.textContent=old,1200);}catch{prompt('انسخ رابط اللعبة:',location.href);}};
  $("manageMembersBtn").onclick=()=>{$("manageModal").classList.remove("hidden");renderManageList();};$("closeManage").onclick=()=>$("manageModal").classList.add("hidden");$("manageModal").onclick=e=>{if(e.target===$("manageModal"))$("manageModal").classList.add("hidden");};
  if(meta.game==="top10"){
    $("joinPanel").classList.add("hidden");$("lobby").classList.remove("two");$("membersTitle").textContent="إعداد Top 10";$("manageMembersBtn").classList.add("hidden");$("members").classList.add("hidden");
  }else{
    const joinUrl=new URL(`play.html?room=${room}`,location.href).href;$("joinUrl").textContent=joinUrl;makeQr($("joinQr"),joinUrl);
    const ownerPlay=$("ownerPlayBtn");ownerPlay.classList.remove("hidden");ownerPlay.onclick=()=>window.open(joinUrl,"_blank");
  }
  onValue(roomRef("members"),s=>{members=s.val()||{};renderMembers();renderLobbyControls();if(meta.game==="atrash")checkAtrashProgress();});
  onValue(roomRef("meta"),s=>{meta=s.val()||meta;setStatus(meta.status);renderLobbyControls();renderMembers();});
  if(meta.game==="top10")onValue(roomRef("public/top10"),s=>renderTop10(s.val()));
  if(meta.game==="atrash")onValue(roomRef("public/atrash"),s=>renderAtrash(s.val()));
  if(meta.game==="kalim")onValue(roomRef("public/kalim"),s=>renderKalim(s.val()));
  if(meta.game==="top10"&&meta.variant==="host")listenHostPair();
}

function renderLobbyControls(){
  const box=$("lobbyControls"); if(meta.status!=="lobby"){box.innerHTML='<div class="notice">بدأت اللعبة. استخدمي التحكم الموجود في شاشة اللعبة.</div>';return;}
  const count=onlineMembers().length;
  if(meta.game==="top10"){
    box.innerHTML=`<div class="field"><label>الفريق الأول</label><input id="teamAInput" value="الفريق أ"></div><div class="field"><label>الفريق الثاني</label><input id="teamBInput" value="الفريق ب"></div><div class="field"><label>عدد الجولات</label><input id="roundsInput" type="number" min="1" max="40" value="10"></div>${meta.variant==='host'?'<div class="status-message" id="pairInfo">لم يتم ربط جهاز الحكم.</div><button class="secondary" id="pairHostBtn">ربط جهاز الحكم</button><div id="hostPairBox" class="hidden"></div>':''}<button class="primary" id="startBtn">ابدأ Top 10</button>`;
    if(meta.variant==='host')$("pairHostBtn").onclick=startHostPair;
    $("startBtn").onclick=()=>startTop10();
  }else if(meta.game==="atrash"){
    box.innerHTML=`<div class="notice">${count<3?`تحتاج الأطرش 3 لاعبين على الأقل. العدد الحالي ${count}، والهوست محسوب تلقائيًا كلاعب.`:'جاهزين للبدء ✅ الهوست لاعب عادي وله صلاحيات إضافية.'}</div><div class="field"><label>عدد الجولات</label><input id="roundsInput" type="number" min="1" max="40" value="10"></div><button class="primary" id="startBtn" ${count<3?'disabled':''}>ابدأ الجولة الأولى</button>`;
    if(count>=3)$("startBtn").onclick=startAtrashFirst;
  }else{
    box.innerHTML=`<div class="notice">${count<2?`تحتاج كَلِم لاعبين على الأقل. العدد الحالي ${count}، والهوست محسوب تلقائيًا كلاعب.`:'جاهزين ✅ الهوست لاعب عادي وله صلاحيات إضافية.'}</div><div class="field"><label>وقت الدور</label><div class="timer-stepper"><button class="secondary" id="timerMinus" type="button" aria-label="تقليل الوقت">−</button><div class="timer-stepper-value"><b id="kalimTimerValue">${kalimTimerSeconds}</b><span>ثانية</span></div><button class="secondary" id="timerPlus" type="button" aria-label="زيادة الوقت">+</button></div><div class="small" style="text-align:center">من 9 إلى 15 ثانية</div></div><button class="primary" id="startBtn" ${count<2?'disabled':''}>ابدأ كَلِم</button>`;
    const syncTimer=()=>{const el=$("kalimTimerValue");if(el)el.textContent=kalimTimerSeconds;const mn=$("timerMinus"),pl=$("timerPlus");if(mn)mn.disabled=kalimTimerSeconds<=9;if(pl)pl.disabled=kalimTimerSeconds>=15;};
    $("timerMinus").onclick=()=>{kalimTimerSeconds=Math.max(9,kalimTimerSeconds-1);syncTimer();};$("timerPlus").onclick=()=>{kalimTimerSeconds=Math.min(15,kalimTimerSeconds+1);syncTimer();};syncTimer();
    if(count>=2)$("startBtn").onclick=startKalim;
  }
}

// ---------- Top 10 ----------
async function startTop10(){
  if(meta.variant==='host'&&!meta.hostUid){alert('اربط جهاز الحكم أولًا، أو أنشئ الغرفة بوضع بدون حكم.');return;}
  const max=Math.max(1,Math.min(40,+$("roundsInput").value||10));await set(roomRef("adminPrivate/top10"),{used:{},maxRounds:max});await set(roomRef("public/top10"),{phase:"ready",round:0,maxRounds:max,scores:{A:0,B:0},teams:{A:$("teamAInput").value.trim()||"الفريق أ",B:$("teamBInput").value.trim()||"الفريق ب"}});await setMetaStatus("playing");await nextTop10Round();$("lobby").classList.add("hidden");$("gameArea").classList.remove("hidden");
}
async function nextTop10Round(){
  const adm=(await get(roomRef("adminPrivate/top10"))).val()||{used:{},maxRounds:10}; const cur=(await get(roomRef("public/top10"))).val()||{}; const nextRound=(cur.round||0)+1;
  if(nextRound>(adm.maxRounds||10)){await update(roomRef("public/top10"),{phase:"finished"});return;}
  let choices=TOP10_QUESTIONS.map((_,i)=>i).filter(i=>!adm.used?.[i]);if(!choices.length){adm.used={};choices=TOP10_QUESTIONS.map((_,i)=>i);} const qi=choices[cryptoRand(choices.length)];adm.used=adm.used||{};adm.used[qi]=true;await set(roomRef("adminPrivate/top10"),adm);
  const q=TOP10_QUESTIONS[qi]; const t={phase:"playing",round:nextRound,maxRounds:adm.maxRounds,category:q.category,question:q.question,revealed:{},scores:cur.scores||{A:0,B:0},teams:cur.teams||{A:"الفريق أ",B:"الفريق ب"},hearts:{A:3,B:3},activeTeam:nextRound%2===1?"A":"B",lastMessage:""};await set(roomRef("public/top10"),t);await set(roomRef("adminPrivate/top10Current"),{questionIndex:qi,answers:q.answers}); if(meta.variant==='host')await set(roomRef("hostPrivate/current"),{question:q.question,answers:q.answers,round:nextRound}); await remove(roomRef("hostPending"));
}
function top10Html(s){
  const rev=s.revealed||{}, hearts=s.hearts||{A:3,B:3}, scores=s.scores||{A:0,B:0}, teams=s.teams||{A:'الفريق أ',B:'الفريق ب'};return `<div class="question-box"><div class="small">${escapeHtml(s.category||'')}</div><div class="question">${escapeHtml(s.question||'')}</div></div><div class="scorebar"><div class="team ${s.activeTeam==='A'?'active':''} ${hearts.A<=0?'elim':''}"><span>${escapeHtml(teams.A)}</span><b>${scores.A||0}</b><div class="hearts">${'❤️'.repeat(hearts.A||0)}${'🖤'.repeat(3-(hearts.A||0))}</div><div class="toolbar" style="justify-content:center"><button class="secondary scoreAdj" data-t="A" data-d="-1">−1</button><button class="secondary scoreAdj" data-t="A" data-d="1">+1</button></div></div><div class="team ${s.activeTeam==='B'?'active':''} ${hearts.B<=0?'elim':''}"><span>${escapeHtml(teams.B)}</span><b>${scores.B||0}</b><div class="hearts">${'❤️'.repeat(hearts.B||0)}${'🖤'.repeat(3-(hearts.B||0))}</div><div class="toolbar" style="justify-content:center"><button class="secondary scoreAdj" data-t="B" data-d="-1">−1</button><button class="secondary scoreAdj" data-t="B" data-d="1">+1</button></div></div></div><div class="entry"><input id="topAnswer" placeholder="اكتب إجابة ${escapeHtml(teams[s.activeTeam]||'الفريق')}..."><button class="primary" id="submitTop">إرسال</button></div><div class="notice" id="topMsg">${escapeHtml(s.lastMessage|| (meta.variant==='host'?'الإجابة ستذهب لجهاز الحكم للتأكيد.':'المطابقة المحلية تعمل تلقائيًا.'))}</div><div class="answers10">${Array.from({length:10},(_,i)=>`<div class="answer10 ${rev[i]!=null?'open':''}"><div class="rank">${i+1}</div><b class="${rev[i]!=null?'':'masked'}">${rev[i]!=null?escapeHtml(rev[i]):'••••••'}</b></div>`).join('')}</div><div class="toolbar"><button class="secondary" id="revealAllBtn">كشف الكل</button><button class="primary" id="nextTopBtn">السؤال التالي</button></div><div class="small">الجولة ${s.round||0} من ${s.maxRounds||0}</div>`;}
function renderTop10(s){if(!s)return;if(meta.status==='playing'){$("lobby").classList.add("hidden");$("gameArea").classList.remove("hidden");} if(s.phase==='finished'){$("gameArea").innerHTML='<div class="stage"><h2>انتهت Top 10 👏</h2><div class="scorebar"><div class="team"><span>'+escapeHtml(s.teams?.A||'A')+'</span><b>'+Number(s.scores?.A||0)+'</b></div><div class="team"><span>'+escapeHtml(s.teams?.B||'B')+'</span><b>'+Number(s.scores?.B||0)+'</b></div></div></div>';return;} if(!s.question)return;$("gameArea").innerHTML=top10Html(s);document.querySelectorAll('.scoreAdj').forEach(b=>b.onclick=()=>adjustTopScore(b.dataset.t,+b.dataset.d));$("submitTop").onclick=()=>submitTop10(s);$("topAnswer").onkeydown=e=>{if(e.key==='Enter')submitTop10(s)};$("nextTopBtn").onclick=nextTop10Round;$("revealAllBtn").onclick=()=>revealTopAll();}
async function adjustTopScore(t,d){await runTransaction(roomRef(`public/top10/scores/${t}`),v=>(Number(v)||0)+d);}
function switchActive(s){const o=s.activeTeam==='A'?'B':'A';if((s.hearts?.[o]||0)>0)return o;if((s.hearts?.[s.activeTeam]||0)>0)return s.activeTeam;return s.activeTeam;}
async function applyTopCorrect(index,answer){await runTransaction(roomRef("public/top10"),s=>{if(!s||s.revealed?.[index]!=null)return s;s.revealed=s.revealed||{};s.revealed[index]=answer;s.scores=s.scores||{A:0,B:0};s.scores[s.activeTeam]=(s.scores[s.activeTeam]||0)+(index+1);s.lastMessage=`✅ المركز ${index+1} — +${index+1} نقطة`;s.activeTeam=switchActive(s);return s;});}
async function applyTopWrong(){await runTransaction(roomRef("public/top10"),s=>{if(!s)return s;s.hearts=s.hearts||{A:3,B:3};s.hearts[s.activeTeam]=Math.max(0,(s.hearts[s.activeTeam]||0)-1);s.lastMessage='💔 الإجابة خارج القائمة';if(s.hearts.A<=0&&s.hearts.B<=0)s.phase='out';else s.activeTeam=switchActive(s);return s;});const s=(await get(roomRef("public/top10"))).val();if(s?.phase==='out')await revealTopAll();}
async function submitTop10(s){const input=$("topAnswer").value.trim();if(!input)return;$("topAnswer").value='';const adm=(await get(roomRef("adminPrivate/top10Current"))).val();if(!adm)return;if(meta.variant==='auto'){const rev=Object.keys(s.revealed||{}).map(Number);const b=bestTop10Match(input,adm.answers,rev);if(isAutoAccept(b))await applyTopCorrect(b.index,adm.answers[b.index]);else await applyTopWrong();}else{await set(roomRef("hostPending"),{text:input,activeTeam:s.activeTeam,submittedAt:now()});await update(roomRef("public/top10"),{lastMessage:'⏳ بانتظار تأكيد الحكم…'});}}
async function revealTopAll(){const adm=(await get(roomRef("adminPrivate/top10Current"))).val();if(!adm)return;const upd={};adm.answers.forEach((a,i)=>upd[i]=a);await update(roomRef("public/top10"),{revealed:upd,lastMessage:'تم كشف القائمة كاملة.'});}

// host pairing
function listenHostPair(){onValue(roomRef("hostJoin"),async s=>{if(!hostToken||Date.now()>hostTokenExpiry)return;const reqs=s.val()||{};for(const [uid,r] of Object.entries(reqs)){if(r?.token===hostToken){await update(roomRef("meta"),{hostUid:uid});await remove(roomRef("hostJoin"));hostToken=null;const info=$("pairInfo");if(info)info.textContent='✅ تم ربط جهاز الحكم.';const box=$("hostPairBox");if(box)box.classList.add('hidden');break;}}});}
function startHostPair(){hostToken=randomToken();hostTokenExpiry=Date.now()+20000;const url=new URL('host.html',location.href);url.searchParams.set('room',room);url.searchParams.set('token',hostToken);const box=$("hostPairBox");box.classList.remove('hidden');box.innerHTML='<div class="panel"><b>امسح هذا الرمز من جهاز الحكم.</b><div id="hostQr" class="qr"></div><div class="small" style="word-break:break-all">'+escapeHtml(url.href)+'</div><div class="small" id="pairCountdown"></div></div>';makeQr($("hostQr"),url.href);const tick=setInterval(()=>{const left=Math.max(0,Math.ceil((hostTokenExpiry-Date.now())/1000));const c=$("pairCountdown");if(c)c.textContent=`يختفي خلال ${left} ثانية`;if(left<=0){clearInterval(tick);hostToken=null;if(box)box.classList.add('hidden');}},500);}

// ---------- Atrash ----------
async function startAtrashFirst(){const max=Math.max(1,Math.min(40,+$("roundsInput").value||10));const scores={};for(const [uid,m] of onlineMembers())scores[uid]={name:m.name,score:0};await set(roomRef("adminPrivate/atrash"),{used:{},maxRounds:max});await set(roomRef("public/atrash"),{phase:"ready",round:0,maxRounds:max,scores});await setMetaStatus("playing");await startAtrashRound();$("lobby").classList.add('hidden');$("gameArea").classList.remove('hidden');}
async function startAtrashRound(){const list=onlineMembers();if(list.length<3){alert('تحتاج 3 لاعبين على الأقل');return;}const adm=(await get(roomRef("adminPrivate/atrash"))).val()||{used:{},maxRounds:10};const pub=(await get(roomRef("public/atrash"))).val()||{};const r=(pub.round||0)+1;if(r>(adm.maxRounds||10)){await update(roomRef("public/atrash"),{phase:'finished'});return;}let choices=ATRASH_PAIRS.map((_,i)=>i).filter(i=>!adm.used?.[i]);if(!choices.length){adm.used={};choices=ATRASH_PAIRS.map((_,i)=>i);}const qi=choices[cryptoRand(choices.length)];adm.used=adm.used||{};adm.used[qi]=true;const outsider=list[cryptoRand(list.length)][0];await set(roomRef("adminPrivate/atrash"),{...adm,current:{questionIndex:qi,outsiderUid:outsider}});await Promise.all([remove(roomRef("private")),remove(roomRef("answers")),remove(roomRef("answerStatus")),remove(roomRef("votes")),remove(roomRef("voteStatus"))]);const pair=ATRASH_PAIRS[qi];const privUpdates={};for(const [uid] of list)privUpdates[`rooms/${room}/private/${uid}`]={question:uid===outsider?pair.outsider:pair.main,round:r};await update(ref(db),privUpdates);await set(roomRef("public/atrash"),{phase:'answering',round:r,maxRounds:adm.maxRounds,scores:pub.scores||{},message:'بانتظار إجابات الجميع…'});}
async function checkAtrashProgress(){if(processing||meta?.game!=='atrash'||meta?.status!=='playing')return;const p=(await get(roomRef("public/atrash"))).val();if(!p)return;const n=onlineMembers().length;if(!n)return;if(p.phase==='answering'){const s=(await get(roomRef("answerStatus"))).val()||{};if(Object.keys(s).length>=n){processing=true;await update(roomRef("public/atrash"),{phase:'revealing'});const [ans,adm]=await Promise.all([get(roomRef("answers")),get(roomRef("adminPrivate/atrash/current"))]);const a=ans.val()||{}, cur=adm.val();const pair=ATRASH_PAIRS[cur.questionIndex];const revealed={};for(const [uid,m] of onlineMembers())revealed[uid]={name:m.name,text:a[uid]?.text||''};await update(roomRef("public/atrash"),{phase:'discussion',mainQuestion:pair.main,revealedAnswers:revealed,message:'ناقشوا الإجابات ثم ابدأوا التصويت.'});processing=false;}}
  else if(p.phase==='voting'){const s=(await get(roomRef("voteStatus"))).val()||{};if(Object.keys(s).length>=n){processing=true;await update(roomRef("public/atrash"),{phase:'tallying'});const [vs,adm]=await Promise.all([get(roomRef("votes")),get(roomRef("adminPrivate/atrash/current"))]);const votes=vs.val()||{},cur=adm.val(),out=cur.outsiderUid;const counts={};Object.values(votes).forEach(v=>{if(v?.targetUid)counts[v.targetUid]=(counts[v.targetUid]||0)+1;});const correct=Object.entries(votes).filter(([,v])=>v?.targetUid===out).map(([uid])=>uid);const threshold=Math.ceil(n/4);const outsiderPts=correct.length===0?2:(correct.length<=threshold?1:0);const scores=structuredClone(p.scores||{});for(const uid of correct){if(scores[uid])scores[uid].score=(scores[uid].score||0)+1;}if(scores[out])scores[out].score=(scores[out].score||0)+outsiderPts;const pair=ATRASH_PAIRS[cur.questionIndex];await update(roomRef("public/atrash"),{phase:'results',outsiderUid:out,outsiderName:members[out]?.name||'',outsiderQuestion:pair.outsider,voteCounts:counts,correctVoters:correct,outsiderPoints:outsiderPts,threshold,scores,message:'انتهت الجولة.'});processing=false;}}
}
function renderAtrash(p){
  if(!p)return;if(meta.status==='playing'){$("lobby").classList.add('hidden');$("gameArea").classList.remove('hidden');}
  if(p.phase==='finished'){$("gameArea").innerHTML='<div class="stage"><h2>انتهت اللعبة 👏</h2>'+scoresHtml(p.scores)+'</div>';return;}
  if(p.phase==='answering'||p.phase==='revealing'){
    $("gameArea").innerHTML=`<div class="stage"><h2>الجولة ${p.round}</h2><div class="muted">كل لاعب يشوف سؤاله الخاص على جهازه.</div><div class="notice">${escapeHtml(p.message||'بانتظار الجميع…')}</div></div>`;
    checkAtrashProgress();return;
  }
  if(p.phase==='discussion'){
    $("gameArea").innerHTML=`<div class="stage"><div class="real-question"><span class="small">السؤال الحقيقي</span><b>${escapeHtml(p.mainQuestion)}</b></div><div class="answer-list">${Object.entries(p.revealedAnswers||{}).map(([u,a])=>`<div class="answer-item"><b>${escapeHtml(a.name)}</b><span>${escapeHtml(a.text)}</span></div>`).join('')}</div><div class="notice">تناقشوا بينكم. الهوست يبدأ التصويت من صفحته كلاعب.</div></div>`;return;
  }
  if(p.phase==='voting'||p.phase==='tallying'){
    $("gameArea").innerHTML='<div class="stage"><h2>🗳️ التصويت</h2><div class="muted">كل لاعب يصوت من جهازه. النتائج تظهر بعد الجميع.</div></div>';checkAtrashProgress();return;
  }
  if(p.phase==='results'){
    $("gameArea").innerHTML=`<div class="stage"><div class="small">الأطرش هو</div><div class="winner">${escapeHtml(p.outsiderName)}</div><div class="small">سؤال الأطرش</div><div class="secret-question">${escapeHtml(p.outsiderQuestion)}</div><div class="answer-list">${Object.entries(p.voteCounts||{}).map(([uid,c])=>`<div class="answer-item"><b>${escapeHtml(members[uid]?.name||uid)}</b><span>${c} صوت</span></div>`).join('')}</div><div class="notice">كل مصيب +1 · الأطرش أخذ ${p.outsiderPoints} · حد الربع ${p.threshold}</div>${scoresHtml(p.scores)}<div class="muted">الجولة التالية يبدأها الهوست من صفحته كلاعب.</div></div>`;
  }
}
function scoresHtml(scores){const arr=Object.values(scores||{}).sort((a,b)=>(b.score||0)-(a.score||0));return `<div class="score-list" style="width:100%;margin:12px 0">${arr.map(s=>`<div class="score-item"><b>${escapeHtml(s.name)}</b><span style="color:var(--gold);font-weight:900">${s.score||0} نقطة</span></div>`).join('')}</div>`;}

// ---------- Kalim ----------
async function startKalim(){const list=onlineMembers().sort((a,b)=>(a[1].joinedAt||0)-(b[1].joinedAt||0));if(list.length<2)return;const timerSeconds=kalimTimerSeconds;const k=createKalimState(list,timerSeconds);await set(roomRef("public/kalim"),k);await setMetaStatus('playing');$("lobby").classList.add('hidden');$("gameArea").classList.remove('hidden');}
function remaining(k){if(!k)return 0;if(!k.timerRunning)return Math.max(0,k.remainingMs||0);return Math.max(0,(k.deadline||Date.now())-Date.now());}
function renderKalim(k){
  if(!k)return;lastKalimState=k;if(meta.status==='playing'){$("lobby").classList.add('hidden');$("gameArea").classList.remove('hidden');}
  const names=Object.fromEntries(allMembers().map(([u,m])=>[u,m.name]));const rem=remaining(k);const finished=!!k.winnerUid;if(!finished&&k.timerRunning&&rem<=0)stopExpiredKalim();
  const opponents=(k.order||[]).map(uid=>`<div class="opp ${uid===k.currentUid?'active':''}"><b>${escapeHtml(names[uid]||'لاعب')}</b><div class="small">${uid===k.currentUid?'دوره الآن':'بانتظار الدور'} · ${(k.hands?.[uid]||[]).length} بطاقات</div></div>`).join('');
  const word=(k.stacks||[]).map(st=>{const top=st[st.length-1];return `<div class="word-slot"><div class="game-card-letter"><span class="corner">${escapeHtml(top.other||'')}</span>${escapeHtml(top.letter)}</div><div class="depth">${st.length>1?'فوق '+(st.length-1):''}</div></div>`}).join('');
  $("gameArea").innerHTML=`<div class="kalim-layout"><div class="opponents">${opponents}</div><div class="question-box"><div class="small">${finished?'انتهت اللعبة':'الدور الآن'}</div><div class="question">${escapeHtml(names[finished?k.winnerUid:k.currentUid]||'')}</div><div class="timer" id="displayTimer">${finished?'—':Math.ceil(rem/1000)}</div><div class="word">${word}</div><div class="notice">${escapeHtml(k.lastAction||'')}</div><div class="toolbar" style="justify-content:center"><button class="secondary" id="pauseK" ${finished||k.transitionAt?'disabled':''}>${k.timerRunning?'⏸ إيقاف':'▶ استكمال'}</button><button class="secondary" id="resetK" ${finished?'disabled':''}>↻ ${Math.round((k.timerMs||14000)/1000)} ثانية</button><button class="secondary" id="returnK">↩ إرجاع الدور</button></div></div>${finished?`<div class="stage"><div class="winner">🏆 ${escapeHtml(names[k.winnerUid]||'الفائز')}</div><div class="small">انتهت الجولة كاملة.</div></div>`:''}</div>`;
  $("pauseK").onclick=toggleKalimPause;$("resetK").onclick=resetKalimTimer;$("returnK").onclick=returnKalimTurn;
}
function miniCard(c){const f=c.useBack?c.b:c.a,o=c.useBack?c.a:c.b;return `<div class="mini-card"><small>${escapeHtml(o)}</small>${escapeHtml(f)}</div>`;}
function applyAutomaticKalimPenalty(k,uid){
  if(!k||!uid||k.turnPlay?.uid===uid)return false;
  const hand=k.hands?.[uid],card=k.deck?.pop();if(!hand||!card)return false;
  hand.push(card);k.lastPenaltyDraws=k.lastPenaltyDraws||{};k.lastPenaltyDraws[uid]={cardId:card.id||null,drawnAt:Date.now()};return true;
}
function undoAutomaticKalimPenalty(k,uid){
  const info=k?.lastPenaltyDraws?.[uid],hand=k?.hands?.[uid];if(!info||!hand)return false;
  const idx=hand.findIndex(c=>c?.id===info.cardId);if(idx<0){delete k.lastPenaltyDraws[uid];return false;}
  const [card]=hand.splice(idx,1);k.deck=k.deck||[];k.deck.push(card);delete k.lastPenaltyDraws[uid];return true;
}
function undoKalimFinishingPlayFor(k,uid){
  const info=(k.winnerUid===uid?k.winningPlay:null)||(k.pendingWinnerUid===uid?k.pendingWinnerPlay:null);
  if(!info||info.uid!==uid)return false;
  const stack=k.stacks?.[info.slot];if(!stack)return false;
  let idx=info.cardId?stack.findIndex(x=>x?.card?.id===info.cardId):-1;
  if(idx<0)idx=stack.map((x,i)=>({x,i})).filter(v=>v.x?.ownerUid===uid&&v.x?.card).pop()?.i??-1;
  if(idx<0)return false;
  const [entry]=stack.splice(idx,1);if(!entry?.card)return false;
  k.hands[uid]=k.hands[uid]||[];k.hands[uid].push(entry.card);
  if(k.pendingWinnerUid===uid){k.pendingWinnerUid=null;k.pendingWinnerPlay=null;}
  if(k.winnerUid===uid){k.winnerUid=null;k.winningPlay=null;}
  return true;
}
function finalizeKalimWinnerAtRoundBoundary(k,nextIndex){
  const startIndex=Number.isInteger(k.roundStartIndex)?k.roundStartIndex:0;
  if(nextIndex!==startIndex||!k.pendingWinnerUid)return false;
  const uid=k.pendingWinnerUid;
  if((k.hands?.[uid]||[]).length!==0){k.pendingWinnerUid=null;k.pendingWinnerPlay=null;return false;}
  k.winnerUid=uid;k.winningPlay=k.pendingWinnerPlay||null;k.pendingWinnerUid=null;k.pendingWinnerPlay=null;
  k.timerRunning=false;k.remainingMs=0;k.bellStopped=true;k.transitionAt=null;k.starChoice=null;k.turnPlay=null;
  k.lastAction=`انتهت الجولة كاملة وفاز ${members[uid]?.name||'اللاعب'} 🏆`;return true;
}
function advanceKalimTurnState(k,nowMs){
  const order=k.order||[];if(!order.length)return;
  const nextIndex=((k.currentIndex||0)+1)%order.length;
  if(finalizeKalimWinnerAtRoundBoundary(k,nextIndex))return;
  const startIndex=Number.isInteger(k.roundStartIndex)?k.roundStartIndex:0;
  if(nextIndex===startIndex)k.roundNumber=(k.roundNumber||1)+1;
  const ms=k.timerMs||14000;k.currentIndex=nextIndex;k.currentUid=order[nextIndex];
  if(k.lastPenaltyDraws)delete k.lastPenaltyDraws[k.currentUid];
  k.remainingMs=ms;k.deadline=nowMs+ms;k.timerRunning=true;k.bellStopped=false;k.transitionAt=null;k.turnPlay=null;k.starChoice=null;k.lastAction='بدأ دور اللاعب التالي تلقائيًا.';
}
async function stopExpiredKalim(){
  await runTransaction(roomRef("public/kalim"),k=>{
    if(!k||k.winnerUid)return k;
    const nowMs=Date.now();
    if(k.timerRunning&&(k.deadline||0)<=nowMs){
      const uid=k.currentUid,penalized=applyAutomaticKalimPenalty(k,uid);
      k.timerRunning=false;k.remainingMs=0;k.transitionAt=nowMs+2000;k.bellStopped=true;k.starChoice=null;
      const who=members[uid]?.name||'اللاعب';
      k.lastAction=penalized?`انتهى وقت ${who} بدون بطاقة، فسحب بطاقة تلقائيًا`:(k.pendingWinnerUid===uid?`${who} خلص أوراقه، ونكمل الجولة حتى يأخذ الجميع نفس عدد الأدوار`:'انتهى الوقت.');
      return k;
    }
    if(!k.timerRunning&&k.transitionAt&&k.transitionAt<=nowMs)advanceKalimTurnState(k,nowMs);
    return k;
  });
}
async function toggleKalimPause(){await runTransaction(roomRef("public/kalim"),k=>{if(!k||k.winnerUid||k.transitionAt)return k;if(k.timerRunning){k.remainingMs=Math.max(0,(k.deadline||Date.now())-Date.now());k.timerRunning=false;k.lastAction='تم إيقاف الوقت.';}else{k.deadline=Date.now()+(k.remainingMs||k.timerMs||14000);k.timerRunning=true;k.lastAction='تم استكمال الوقت.';}return k;});}
async function resetKalimTimer(){await runTransaction(roomRef("public/kalim"),k=>{if(!k||k.winnerUid)return k;const ms=k.timerMs||14000;k.remainingMs=ms;k.deadline=Date.now()+ms;k.timerRunning=true;k.bellStopped=false;k.transitionAt=null;k.lastAction=`أُعيد الوقت إلى ${Math.round(ms/1000)} ثانية.`;return k;});}
async function returnKalimTurn(){
  const k=(await get(roomRef("public/kalim"))).val();if(!k)return;
  const names=Object.fromEntries(allMembers().map(([u,m])=>[u,m.name]));
  const allowed=k.winnerUid?[k.winnerUid]:(k.order||[]);
  const choices=allowed.map((u,i)=>`${i+1}: ${names[u]||u}`).join('\n');
  const n=prompt(k.winnerUid?'آخر كلمة للفائز مرفوضة؟ اختاريه لإلغاء الفوز وإرجاع بطاقته:\n'+choices:'اختاري رقم اللاعب:\n'+choices);
  const pos=Number(n)-1;if(pos<0||pos>=allowed.length)return;
  const uid=allowed[pos];
  await runTransaction(roomRef("public/kalim"),state=>{
    if(!state||state.starChoice)return state;
    if(state.winnerUid&&uid!==state.winnerUid)return state;
    const idx=(state.order||[]).indexOf(uid);if(idx<0)return state;
    const ms=state.timerMs||14000,nowMs=Date.now();
    const finishingReturned=undoKalimFinishingPlayFor(state,uid);
    const penaltyReturned=undoAutomaticKalimPenalty(state,uid);
    state.winnerUid=null;state.winningPlay=null;
    if(state.pendingWinnerUid===uid){state.pendingWinnerUid=null;state.pendingWinnerPlay=null;}
    state.currentIndex=idx;state.currentUid=uid;state.remainingMs=ms;state.deadline=nowMs+ms;state.timerRunning=true;state.bellStopped=false;state.transitionAt=null;state.turnPlay=null;state.starChoice=null;
    state.lastAction=finishingReturned?`أُعيد دور ${names[uid]||''} وعادت آخر بطاقة أنهى بها أوراقه`:penaltyReturned?`أُعيد الدور إلى ${names[uid]||''} وأُعيدت بطاقة العقوبة تلقائيًا`:`أُعيد الدور إلى ${names[uid]||''}`;
    return state;
  });
}
setInterval(async()=>{if(meta?.game==='kalim'&&meta?.status==='playing'){const s=(await get(roomRef("public/kalim"))).val();const el=$("displayTimer");if(s){if(!s.winnerUid)await stopExpiredKalim();if(el)el.textContent=s.winnerUid?'—':Math.ceil(remaining(s)/1000);}}},250);

boot().catch(e=>{$("boot").innerHTML='<h2>خطأ</h2><div class="notice">'+escapeHtml(e.message)+'</div>';});
