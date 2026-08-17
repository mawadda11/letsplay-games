import { db, ensureAuth, ref, get, set, update, remove, onValue, push, runTransaction, onDisconnect } from "./firebase.js";
import { ATRASH_PAIRS } from "./data.js";
import { createKalimState, activeFace, otherFace } from "./kalim-engine.js";
import { $, roomCodeFromUrl, escapeHtml, now, cryptoRand } from "./common.js";

const room=roomCodeFromUrl();
let user,meta,me,members={},selectedCard=null,selectedVote=null,lastPublic=null;
let ownerTimerSeconds=14,atrashProcessing=false,atrashActionProcessing=false,submittingAnswer=false,submittingVote=false;
const rr=p=>ref(db,`rooms/${room}${p?'/'+p:''}`);
const isOwner=()=>user?.uid===meta?.ownerUid||me?.role==='owner';
const canModerateKalim=()=>isOwner()||me?.role==='cohost';
const activeMembers=()=>Object.entries(members).filter(([,m])=>m&&m.name&&m.online!==false);

async function copyInviteLink(btn=$("inviteBtn")){
  const url=new URL(`play.html?room=${room}`,location.href).href;
  try{
    await navigator.clipboard.writeText(url);
    if(btn){const old=btn.textContent;btn.textContent='✓ تم النسخ';setTimeout(()=>{if(btn)btn.textContent=old||'🔗 رابط الدخول';},1200);}
  }catch{
    prompt('انسخ رابط الدخول:',url);
  }
}

async function boot(){
  if(!room){$("joinMsg").textContent='كود الغرفة غير موجود';return;}
  user=await ensureAuth();
  const ms=await get(rr('meta'));
  if(!ms.exists()){$("joinMsg").textContent='الغرفة غير موجودة';return;}
  meta=ms.val();$("joinRoomLabel").textContent=room;
  if(meta.game==='top10'){$("joinStage").innerHTML='<div class="stage"><h2>Top 10 لا تحتاج دخول لاعب</h2><div class="muted">ارجع لشاشة Top 10 الرئيسية. وإذا اخترتم وضع الحكم، استخدم رابط الحكم الخاص.</div></div>';return;}
  const invite=$("inviteBtn");if(invite){invite.classList.remove('hidden');invite.onclick=()=>copyInviteLink(invite);}
  const old=(await get(rr(`members/${user.uid}`))).val();
  if(old){
    me=old;$("joinStage").classList.add('hidden');$("playerApp").classList.remove('hidden');startListeners();return;
  }
}

$("joinRoomBtn").onclick=async()=>{
  try{
    const name=$("playerName").value.trim();if(!name)throw new Error('اكتب اسمك');
    const ms=(await get(rr('meta'))).val();
    if(ms.status!=='lobby')throw new Error('بدأت اللعبة بالفعل ولا يمكن دخول لاعب جديد الآن.');
    me={name,joinedAt:now(),online:true,role:'player'};
    await set(rr(`members/${user.uid}`),me);
    $("joinStage").classList.add('hidden');$("playerApp").classList.remove('hidden');startListeners();
  }catch(e){$("joinMsg").textContent=e.message;}
};

function startListeners(){
  update(rr(`members/${user.uid}`),{online:true});
  onDisconnect(rr(`members/${user.uid}/online`)).set(false);
  onValue(rr('members'),s=>{
    members=s.val()||{};
    if(!members[user.uid]){
      $("playerApp").innerHTML='<div class="stage"><h2>تم إخراجك من الغرفة</h2></div>';
      return;
    }
    me=members[user.uid]||me;refreshCohostUi();render();
  });
  onValue(rr('meta'),s=>{meta=s.val()||meta;refreshCohostUi();render();});
  if(meta.game==='atrash'){
    onValue(rr('public/atrash'),s=>{lastPublic=s.val();renderAtrash(lastPublic);if(isOwner())checkAtrashProgress();});
    onValue(rr(`private/${user.uid}`),()=>renderAtrash(lastPublic));
    onValue(rr(`answerStatus/${user.uid}`),()=>{if(lastPublic?.phase==='answering')renderAtrash(lastPublic);});
    onValue(rr(`voteStatus/${user.uid}`),()=>{if(lastPublic?.phase==='voting')renderAtrash(lastPublic);});
    if(isOwner()){
      onValue(rr('answerStatus'),()=>checkAtrashProgress());
      onValue(rr('voteStatus'),()=>checkAtrashProgress());
      onValue(rr('atrashAction'),s=>handleAtrashAction(s.val()));
    }
  }
  if(meta.game==='kalim'){
    onValue(rr('public/kalim'),s=>{lastPublic=s.val();renderKalim(lastPublic)});
    onValue(rr('chat'),s=>renderChat(s.val()||{}));
  }
}

function render(){
  if(meta?.status==='lobby'){renderLobby();return;}
  if(meta?.game==='atrash'){
    if(lastPublic)renderAtrash(lastPublic);
    else $("playerApp").innerHTML='<div class="stage"><h2>بدأت اللعبة</h2><div class="muted">جاري تحميل سؤالك…</div></div>';
    return;
  }
  if(meta?.game==='kalim'){if(lastPublic)renderKalim(lastPublic);return;}
  if(meta?.game==='top10')renderTop10Player();
}

function lobbyPeopleHtml(){
  const ownerUid=meta?.ownerUid, ownerMember=ownerUid?members[ownerUid]:null;
  let people=`<div class="member ${ownerMember?.online===false?'offline':''}"><b>👑 ${escapeHtml(meta?.ownerName||ownerMember?.name||'الهوست')}</b><span class="small">${ownerMember?.online===false?'غير متصل':'الهوست الأساسي · لاعب'}</span></div>`;
  people+=Object.entries(members).filter(([uid,m])=>uid!==ownerUid&&m?.role!=='owner').map(([uid,m])=>`<div class="member ${m.online===false?'offline':''}"><b>${escapeHtml(m.name)} ${m.role==='cohost'?'🛡️':''}</b><span class="small">${m.online===false?'غير متصل':m.role==='cohost'?'هوست مساعد':'متصل'}</span>${me?.role==='cohost'&&uid!==user.uid?`<button class="danger coKick" data-u="${uid}">طرد</button>`:''}</div>`).join('');
  return people;
}

function renderLobby(){
  const game=meta.game==='atrash'?'الأطرش في الزفة':meta.game==='kalim'?'كَلِم':'Top 10';
  const count=activeMembers().length;
  let ownerControls='';
  if(isOwner()&&meta.game==='atrash'){
    ownerControls=`<div class="owner-lobby-controls">
      <div class="field"><label>عدد الجولات</label><input id="ownerRoundsInput" type="number" min="1" max="40" value="10"></div>
      <button class="primary" id="ownerStartAtr" ${count<3?'disabled':''}>ابدأ الجولة الأولى</button>
      <div class="small">${count<3?`تحتاج 3 لاعبين على الأقل. الموجود الآن ${count}.`:'جاهزين للبدء.'}</div>
    </div>`;
  }else if(isOwner()&&meta.game==='kalim'){
    ownerControls=`<div class="owner-lobby-controls">
      <div class="field"><label>وقت الدور</label>
        <div class="timer-stepper">
          <button class="secondary" id="ownerTimerMinus" type="button">−</button>
          <div class="timer-stepper-value"><b id="ownerTimerValue">${ownerTimerSeconds}</b><span>ثانية</span></div>
          <button class="secondary" id="ownerTimerPlus" type="button">+</button>
        </div>
      </div>
      <button class="primary" id="ownerStartKalim" ${count<2?'disabled':''}>ابدأ كَلِم</button>
      <div class="small">${count<2?`تحتاج لاعبين على الأقل. الموجود الآن ${count}.`:'جاهزين للبدء.'}</div>
    </div>`;
  }
  const ownerTools='';
  $("playerApp").innerHTML=`<div class="panel player-lobby">
    <div class="small">الغرفة ${room}</div><h2>${game}</h2>
    <div class="notice">أنت داخل الغرفة باسم <b>${escapeHtml(me?.name||'')}</b>${isOwner()?' 👑':''}.</div>
    <div class="member-list">${lobbyPeopleHtml()}</div>
    ${ownerControls}${ownerTools}
  </div>`;
  document.querySelectorAll('.coKick').forEach(b=>b.onclick=async()=>{if(confirm('طرد هذا اللاعب؟'))await remove(rr(`members/${b.dataset.u}`));});
  const sa=$("ownerStartAtr");if(sa)sa.onclick=startAtrashFirstFromPlayer;
  const sk=$("ownerStartKalim");if(sk)sk.onclick=startKalimFromPlayer;
  const mn=$("ownerTimerMinus"),pl=$("ownerTimerPlus");
  const sync=()=>{const v=$("ownerTimerValue");if(v)v.textContent=ownerTimerSeconds;if(mn)mn.disabled=ownerTimerSeconds<=9;if(pl)pl.disabled=ownerTimerSeconds>=15;};
  if(mn)mn.onclick=()=>{ownerTimerSeconds=Math.max(9,ownerTimerSeconds-1);sync();};
  if(pl)pl.onclick=()=>{ownerTimerSeconds=Math.min(15,ownerTimerSeconds+1);sync();};
  sync();refreshCohostUi();
}

function renderTop10Player(){$("playerApp").innerHTML='<div class="panel"><h2>Top 10</h2><div class="notice">Top 10 تُلعب من الشاشة المشتركة.</div></div>';}

function refreshCohostUi(){
  const btn=$("cohostBtn");if(!btn)return;const owner=isOwner(),isCo=me?.role==='cohost';const canManage=owner||isCo;
  btn.classList.toggle('hidden',!canManage);btn.textContent=owner?'👑 إدارة':'🛡️ إدارة';
  if(!canManage){$("cohostPanel").classList.add('hidden');return;}
  btn.onclick=()=>{renderCohostPanel();$("cohostPanel").classList.remove('hidden');};
  $("cohostClose").onclick=()=>$("cohostPanel").classList.add('hidden');
}

function renderCohostPanel(){
  const list=$("cohostList");if(!list)return;const owner=isOwner();list.innerHTML="";
  const o=document.createElement('div');o.className='member';
  o.innerHTML=`<span><b>👑 ${escapeHtml(meta?.ownerName||members[meta?.ownerUid]?.name||'الهوست')}</b><div class="small">الهوست الأساسي · لاعب</div></span><span class="small">لا يمكن طرده</span>`;list.appendChild(o);
  Object.entries(members).forEach(([uid,m])=>{
    if(uid===user.uid||uid===meta?.ownerUid||m?.role==='owner')return;
    const d=document.createElement('div');d.className='member';
    const roleBtn=owner?`<button class="secondary ownerRoleBtn" data-u="${uid}" data-role="${m.role||''}">${m.role==='cohost'?'إزالة الهوست':'تعيين هوست'}</button>`:'';
    d.innerHTML=`<span><b>${escapeHtml(m.name)}</b><div class="small">${m.role==='cohost'?'هوست مساعد':'لاعب'}</div></span><span style="display:flex;gap:6px;flex-wrap:wrap">${roleBtn}<button class="danger cohostKick" data-u="${uid}">طرد</button></span>`;
    list.appendChild(d);
  });
  document.querySelectorAll('.ownerRoleBtn').forEach(b=>b.onclick=async()=>{await update(rr(`members/${b.dataset.u}`),{role:b.dataset.role==='cohost'?'player':'cohost'});renderCohostPanel();});
  document.querySelectorAll('.cohostKick').forEach(b=>b.onclick=async()=>{if(confirm('طرد هذا اللاعب؟'))await remove(rr(`members/${b.dataset.u}`));});
  const extra=$("cohostExtra");if(extra)extra.innerHTML='';
}

// Atrash owner controller
async function startAtrashFirstFromPlayer(){
  if(!isOwner())return;
  const count=activeMembers().length;if(count<3)return;
  const max=Math.max(1,Math.min(40,+$("ownerRoundsInput")?.value||10));
  const scores={};for(const [uid,m] of activeMembers())scores[uid]={name:m.name,score:0};
  await set(rr("adminPrivate/atrash"),{used:{},maxRounds:max});
  await set(rr("public/atrash"),{phase:"ready",round:0,maxRounds:max,scores});
  await update(rr("meta"),{status:"playing"});
  await startAtrashRoundFromPlayer();
}

async function startAtrashRoundFromPlayer(){
  if(!isOwner())return;
  const list=activeMembers();if(list.length<3){alert('تحتاج 3 لاعبين على الأقل');return;}
  const adm=(await get(rr("adminPrivate/atrash"))).val()||{used:{},maxRounds:10};
  const pub=(await get(rr("public/atrash"))).val()||{};
  const r=(pub.round||0)+1;
  if(r>(adm.maxRounds||10)){await update(rr("public/atrash"),{phase:'finished'});return;}
  let choices=ATRASH_PAIRS.map((_,i)=>i).filter(i=>!adm.used?.[i]);
  if(!choices.length){adm.used={};choices=ATRASH_PAIRS.map((_,i)=>i);}
  const qi=choices[cryptoRand(choices.length)];adm.used=adm.used||{};adm.used[qi]=true;
  const outsider=list[cryptoRand(list.length)][0];
  await set(rr("adminPrivate/atrash"),{...adm,current:{questionIndex:qi,outsiderUid:outsider}});
  await Promise.all([remove(rr("private")),remove(rr("answers")),remove(rr("answerStatus")),remove(rr("votes")),remove(rr("voteStatus"))]);
  const pair=ATRASH_PAIRS[qi];const rootUpdates={};
  for(const [uid] of list)rootUpdates[`rooms/${room}/private/${uid}`]={question:uid===outsider?pair.outsider:pair.main,round:r};
  await update(ref(db),rootUpdates);
  await set(rr("public/atrash"),{phase:'answering',round:r,maxRounds:adm.maxRounds,scores:pub.scores||{},message:'بانتظار إجابات الجميع…'});
}

async function checkAtrashProgress(){
  if(!isOwner()||atrashProcessing||meta?.game!=='atrash'||meta?.status!=='playing')return;
  const p=(await get(rr("public/atrash"))).val();if(!p)return;
  const list=activeMembers(),n=list.length;if(!n)return;
  if(p.phase==='answering'){
    const s=(await get(rr("answerStatus"))).val()||{};
    if(Object.keys(s).filter(uid=>list.some(([u])=>u===uid)).length>=n){
      atrashProcessing=true;
      try{
        await update(rr("public/atrash"),{phase:'revealing'});
        const [ansSnap,admSnap]=await Promise.all([get(rr("answers")),get(rr("adminPrivate/atrash/current"))]);
        const a=ansSnap.val()||{},cur=admSnap.val();if(!cur)return;
        const pair=ATRASH_PAIRS[cur.questionIndex],revealed={};
        for(const [uid,m] of list)revealed[uid]={name:m.name,text:a[uid]?.text||''};
        await update(rr("public/atrash"),{phase:'discussion',mainQuestion:pair.main,revealedAnswers:revealed,message:'ناقشوا الإجابات ثم ابدأوا التصويت.'});
      }finally{atrashProcessing=false;}
    }
  }else if(p.phase==='voting'){
    const s=(await get(rr("voteStatus"))).val()||{};
    if(Object.keys(s).filter(uid=>list.some(([u])=>u===uid)).length>=n){
      atrashProcessing=true;
      try{
        await update(rr("public/atrash"),{phase:'tallying'});
        const [vs,admSnap]=await Promise.all([get(rr("votes")),get(rr("adminPrivate/atrash/current"))]);
        const votes=vs.val()||{},cur=admSnap.val();if(!cur)return;
        const out=cur.outsiderUid,counts={};
        Object.values(votes).forEach(v=>{if(v?.targetUid)counts[v.targetUid]=(counts[v.targetUid]||0)+1;});
        const correct=Object.entries(votes).filter(([,v])=>v?.targetUid===out).map(([uid])=>uid);
        const threshold=Math.ceil(n/4),outsiderPts=correct.length===0?2:(correct.length<=threshold?1:0);
        const scores=structuredClone(p.scores||{});
        for(const uid of correct){if(scores[uid])scores[uid].score=(scores[uid].score||0)+1;}
        if(scores[out])scores[out].score=(scores[out].score||0)+outsiderPts;
        const pair=ATRASH_PAIRS[cur.questionIndex];
        await update(rr("public/atrash"),{phase:'results',outsiderUid:out,outsiderName:members[out]?.name||'',outsiderQuestion:pair.outsider,voteCounts:counts,correctVoters:correct,outsiderPoints:outsiderPts,threshold,scores,message:'انتهت الجولة.'});
      }finally{atrashProcessing=false;}
    }
  }
}

function waitScreen(title,sub){
  $("playerApp").innerHTML=`<div class="stage"><h2>${title}</h2><div class="muted">${sub}</div></div>`;
}

async function requestAtrashAction(type){
  await set(rr('atrashAction'),{type,byUid:user.uid,ts:now()});
}

async function handleAtrashAction(action){
  if(!isOwner()||!action||atrashActionProcessing)return;
  atrashActionProcessing=true;
  try{
    const p=(await get(rr('public/atrash'))).val();
    if(action.type==='startVote'&&p?.phase==='discussion'){
      await Promise.all([remove(rr('votes')),remove(rr('voteStatus'))]);
      await update(rr('public/atrash'),{phase:'voting',message:'التصويت سري.'});
    }else if(action.type==='nextRound'&&p?.phase==='results'){
      await startAtrashRoundFromPlayer();
    }
  }finally{
    await remove(rr('atrashAction')).catch(()=>{});
    atrashActionProcessing=false;
  }
}

async function renderAtrash(p){
  if(!p){renderLobby();return;}
  if(p.phase==='answering'){
    const [privSnap,ansSnap]=await Promise.all([get(rr(`private/${user.uid}`)),get(rr(`answers/${user.uid}`))]);
    const priv=privSnap.val(),ans=ansSnap.val();
    if(ans){waitScreen('تم إرسال جوابك ✓','بانتظار إجابات الجميع…');return;}
    $("playerApp").innerHTML=`<div class="stage atrash-player-stage">
      <div class="small">سؤالك الخاص — الجولة ${p.round}</div>
      <div class="secret-question">${escapeHtml(priv?.question||'جاري تجهيز سؤالك…')}</div>
      <form class="entry atrash-entry" id="atrAnswerForm" style="width:100%">
        <input id="atrAnswer" autocomplete="off" enterkeyhint="send" placeholder="اكتب جوابك...">
        <button class="primary" type="submit" id="atrSend">إرسال الإجابة</button>
      </form>
      <div class="status-message" id="atrActionMsg">جوابك ما يظهر للبقية إلا بعد ما يخلص الجميع.</div>
    </div>`;
    $("atrAnswerForm").onsubmit=e=>{e.preventDefault();sendAtrashAnswer();};refreshCohostUi();return;
  }
  if(p.phase==='revealing'){waitScreen('لحظة…','جاري إظهار الإجابات.');return;}
  if(p.phase==='discussion'){
    $("playerApp").innerHTML=`<div class="stage">
      <div class="real-question"><span class="small">السؤال الحقيقي</span><b>${escapeHtml(p.mainQuestion)}</b></div>
      <div class="answer-list">${Object.values(p.revealedAnswers||{}).map(a=>`<div class="answer-item"><b>${escapeHtml(a.name)}</b><span>${escapeHtml(a.text)}</span></div>`).join('')}</div>
      <div class="muted" style="margin:12px 0">تناقشوا بينكم، وبعدها أي لاعب يقدر يبدأ التصويت.</div>
      <button class="primary" id="startVoteBtn">ابدأ التصويت</button>
    </div>`;
    const b=$("startVoteBtn");if(b)b.onclick=async()=>{b.disabled=true;b.textContent='جاري البدء…';try{await requestAtrashAction('startVote');}catch{b.disabled=false;b.textContent='ابدأ التصويت';}};
    refreshCohostUi();return;
  }
  if(p.phase==='voting'){
    const voted=(await get(rr(`votes/${user.uid}`))).val();
    if(voted){waitScreen('تم تصويتك ✓','بانتظار تصويت الجميع…');return;}
    selectedVote=null;
    $("playerApp").innerHTML=`<div class="panel atrash-player-stage">
      <h2>مين الأطرش؟ 🗳️</h2>
      <div class="vote-list">${Object.entries(members).filter(([u,m])=>u!==user.uid&&m?.online!==false).map(([u,m])=>`<button type="button" class="vote-option" data-u="${u}">${escapeHtml(m.name)}</button>`).join('')}</div>
      <button class="primary" id="voteBtn" disabled>تأكيد التصويت</button>
      <div class="status-message" id="voteActionMsg">اختيارك سري.</div>
    </div>`;
    document.querySelectorAll('.vote-option').forEach(b=>b.onclick=()=>{selectedVote=b.dataset.u;document.querySelectorAll('.vote-option').forEach(x=>x.classList.toggle('selected',x===b));$("voteBtn").disabled=false;});
    $("voteBtn").onclick=sendVote;refreshCohostUi();return;
  }
  if(p.phase==='tallying'){waitScreen('نحسب الأصوات…','لحظات وتظهر النتيجة.');return;}
  if(p.phase==='results'){
    $("playerApp").innerHTML=`<div class="stage">
      <div class="small">الأطرش</div><div class="winner">${escapeHtml(p.outsiderName)}</div>
      <div class="small">سؤال الأطرش</div><div class="secret-question">${escapeHtml(p.outsiderQuestion)}</div>
      <div class="notice">الأطرش أخذ ${p.outsiderPoints} · حد الربع ${p.threshold}</div>
      <div class="score-list" style="width:100%">${Object.values(p.scores||{}).sort((a,b)=>(b.score||0)-(a.score||0)).map(s=>`<div class="score-item"><b>${escapeHtml(s.name)}</b><span>${s.score||0} نقطة</span></div>`).join('')}</div>
      <button class="primary" id="nextAtrBtn">الجولة التالية</button>
    </div>`;
    const b=$("nextAtrBtn");if(b)b.onclick=async()=>{b.disabled=true;b.textContent='جاري التجهيز…';try{await requestAtrashAction('nextRound');}catch{b.disabled=false;b.textContent='الجولة التالية';}};refreshCohostUi();return;
  }
  if(p.phase==='finished'){$("playerApp").innerHTML='<div class="stage"><h2>انتهت اللعبة 👏</h2></div>';refreshCohostUi();return;}
}

async function sendAtrashAnswer(){
  if(submittingAnswer)return;
  const input=$("atrAnswer"),btn=$("atrSend"),msg=$("atrActionMsg");const t=input?.value.trim();if(!t)return;
  submittingAnswer=true;if(btn){btn.disabled=true;btn.textContent='جاري الإرسال…';}if(input)input.disabled=true;if(msg)msg.textContent='جاري حفظ إجابتك…';
  try{
    const updates={};
    updates[`rooms/${room}/answers/${user.uid}`]={text:t,name:me.name,submittedAt:now()};
    updates[`rooms/${room}/answerStatus/${user.uid}`]=true;
    await update(ref(db),updates);
    waitScreen('تم إرسال جوابك ✓','بانتظار إجابات الجميع…');
    if(isOwner())checkAtrashProgress();
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent='إرسال الإجابة';}if(input)input.disabled=false;if(msg)msg.textContent='تعذر الإرسال، حاولي مرة ثانية.';
  }finally{submittingAnswer=false;}
}

async function sendVote(){
  if(submittingVote||!selectedVote)return;
  const btn=$("voteBtn"),msg=$("voteActionMsg");submittingVote=true;
  if(btn){btn.disabled=true;btn.textContent='جاري الإرسال…';}if(msg)msg.textContent='جاري حفظ تصويتك…';
  try{
    const updates={};
    updates[`rooms/${room}/votes/${user.uid}`]={targetUid:selectedVote,submittedAt:now()};
    updates[`rooms/${room}/voteStatus/${user.uid}`]=true;
    await update(ref(db),updates);
    waitScreen('تم تصويتك ✓','بانتظار تصويت الجميع…');
    if(isOwner())checkAtrashProgress();
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent='تأكيد التصويت';}if(msg)msg.textContent='تعذر إرسال التصويت، حاولي مرة ثانية.';
  }finally{submittingVote=false;}
}

// Kalim owner start
async function startKalimFromPlayer(){
  if(!isOwner())return;
  const list=activeMembers().sort((a,b)=>(a[1].joinedAt||0)-(b[1].joinedAt||0));
  if(list.length<2)return;
  const k=createKalimState(list,ownerTimerSeconds);
  await set(rr("public/kalim"),k);
  await update(rr("meta"),{status:'playing'});
}

// Kalim
function face(c){return c?.useBack?c.b:c.a;}
function other(c){return c?.useBack?c.a:c.b;}
function cardHtml(c,i,sel=false,disabled=false){
  const f=face(c),o=other(c);
  return `<button class="game-card-letter ${sel?'selected':''} ${f==='★'?'star':''}" data-card="${i}" ${disabled?'disabled':''}><span class="corner">${escapeHtml(o)}</span>${escapeHtml(f)}</button>`;
}
function mini(c){return `<div class="mini-card"><small>${escapeHtml(other(c))}</small>${escapeHtml(face(c))}</div>`;}
function rem(k){return k?.timerRunning?Math.max(0,(k.deadline||Date.now())-Date.now()):Math.max(0,k?.remainingMs||0);}
function starGraceRemaining(k){
  const sc=k?.starChoice;if(!sc||sc.resumed)return 0;
  return Math.max(0,(sc.graceUntil||0)-Date.now());
}
function arabicLetter(v){
  const chars=Array.from(String(v||'').trim());
  return chars.length===1 && /[\u0621-\u064A]/.test(chars[0]) ? chars[0] : '';
}

function renderKalim(k){
  if(!k){renderLobby();return;}
  const names=Object.fromEntries(Object.entries(members).map(([u,m])=>[u,m.name]));
  const myHand=k.hands?.[user.uid]||[];
  const active=k.currentUid===user.uid;
  const playedThisTurn=active&&k.turnPlay?.uid===user.uid;
  const choosingStar=active&&k.starChoice?.uid===user.uid;
  const handLocked=!active||!!k.transitionAt||!!k.turnPlay||!!k.starChoice;
  const opp=(k.order||[]).filter(u=>u!==user.uid).map(u=>`<div class="opp ${u===k.currentUid?'active':''}"><b>${escapeHtml(names[u]||'لاعب')}</b><div class="small">${u===k.currentUid?'دوره الآن':'بانتظار'} · ${(k.hands?.[u]||[]).length}</div><div class="opp-cards">${(k.hands?.[u]||[]).map(mini).join('')}</div></div>`).join('');
  const word=(k.stacks||[]).map((st,i)=>{
    const top=st[st.length-1];
    const undoable=playedThisTurn&&k.turnPlay?.slot===i;
    const canPlace=active&&!k.transitionAt&&!k.turnPlay&&!k.starChoice&&selectedCard!=null;
    const enabled=undoable||canPlace;
    return `<button class="word-slot ghost ${undoable?'undoable':''}" data-slot="${i}" style="padding:0;border:none" ${enabled?'':'disabled'}><div class="game-card-letter"><span class="corner">${escapeHtml(top.other||'')}</span>${escapeHtml(top.letter)}</div><div class="depth">${undoable?'اضغط للإرجاع':st.length>1?'فوق '+(st.length-1):''}</div></button>`;
  }).join('');
  const turnHint=playedThisTurn?'<div class="turn-hint">✓ نزلت بطاقة هذا الدور. لو كانت بالخطأ اضغط البطاقة المميزة في الوسط لإرجاعها أولًا.</div>':'';
  const starModal=choosingStar?`<div class="star-choice-backdrop"><div class="star-choice-card"><div class="star-choice-icon">★</div><h3>اختار حرف النجمة</h3><p>عندك 4 ثوانٍ مجانية، وبعدها يكمل وقتك الأساسي من حيث توقف.</p><div class="star-grace" id="starGraceText">${k.starChoice?.resumed?'بدأ وقتك الأساسي':`المهلة المجانية: ${Math.ceil(starGraceRemaining(k)/1000)} ث`}</div><form id="starChoiceForm"><input id="starLetterInput" maxlength="1" inputmode="text" autocomplete="off" placeholder="مثال: م" autofocus><div class="star-choice-actions"><button class="primary" type="submit">تأكيد الحرف</button><button class="secondary" id="cancelStarChoice" type="button">إلغاء</button></div><div class="status-message" id="starChoiceMsg"></div></form></div></div>`:'';
  const deckEmpty=!(k.deck?.length);
  const moderator=canModerateKalim();
  const myLastDraw=k.lastDraws?.[user.uid]||null;
  const undoDrawBtn=myLastDraw?'<button class="secondary" id="undoLastDrawBtn">↩ إرجاع آخر سحب</button>':'';
  $("playerApp").innerHTML=`<div class="kalim-layout"><div class="opponents">${opp}</div><div class="question-box"><div class="small">الدور الآن</div><div class="question">${escapeHtml(names[k.currentUid]||'')}</div><div class="timer" id="kTimer">${Math.ceil(rem(k)/1000)}</div><div class="word">${word}</div><div class="game-status">${escapeHtml(k.lastAction||'')}</div>${turnHint}<div class="toolbar kalim-actions" style="justify-content:center"><button class="primary" id="bellBtn" ${active&&!k.starChoice?'':'disabled'}>🔔 الجرس</button><button class="secondary" id="drawBtn" ${deckEmpty||k.winnerUid?'disabled':''}>+ سحب</button>${undoDrawBtn}<button class="secondary" id="resetTimerBtn" ${moderator&&!k.transitionAt&&!k.starChoice?'':'disabled'}>↻ إعادة الوقت</button><button class="secondary" id="pauseBtn" ${moderator&&!k.transitionAt&&!k.starChoice?'':'disabled'}>${k.timerRunning?'⏸ إيقاف':'▶ استكمال'}</button><button class="secondary" id="returnTurnBtn" ${moderator&&!k.starChoice?'':'disabled'}>↩ إرجاع الدور</button></div></div>${k.winnerUid?`<div class="stage"><div class="winner">🏆 ${escapeHtml(names[k.winnerUid]||'الفائز')}</div></div>`:''}<div class="my-hand-wrap"><div style="display:flex;justify-content:space-between"><b>${escapeHtml(me.name)}${isOwner()?' 👑':me?.role==='cohost'?' 🛡️':''}</b><span class="small">${myHand.length} بطاقات · ضغطتان سريعًا لقلب البطاقة</span></div><div class="hand">${myHand.map((c,i)=>cardHtml(c,i,selectedCard===i,handLocked)).join('')}</div></div><button class="chat-fab" id="chatToggle">💬</button><div class="chat-drawer ${chatOpen?'':'hidden'}" id="chatDrawer"><div class="manage-head"><b>الدردشة</b><button class="secondary" id="chatClose">إغلاق</button></div><div class="chat" id="chatBox"></div><div class="entry"><input id="chatInput" placeholder="رسالة..."><button class="primary" id="chatSend">إرسال</button></div></div>${starModal}</div>`;
  document.querySelectorAll('[data-card]').forEach(b=>{b.onclick=e=>handleCardTap(+b.dataset.card,e);});
  document.querySelectorAll('[data-slot]').forEach(b=>{b.onclick=()=>playSlot(+b.dataset.slot);});
  const draw=$("drawBtn");if(draw)draw.onclick=drawCard;
  const bellBtn=$("bellBtn");if(bellBtn)bellBtn.onclick=bell;
  const pauseBtn=$("pauseBtn");if(pauseBtn)pauseBtn.onclick=pauseResume;
  const resetBtn=$("resetTimerBtn");if(resetBtn)resetBtn.onclick=resetKalimTimer;
  const returnBtn=$("returnTurnBtn");if(returnBtn)returnBtn.onclick=openReturnTurnDialog;
  const undoDraw=$("undoLastDrawBtn");if(undoDraw)undoDraw.onclick=undoLastDraw;
  const chatSend=$("chatSend");if(chatSend)chatSend.onclick=sendChat;
  const chatToggle=$("chatToggle");if(chatToggle)chatToggle.onclick=()=>{chatOpen=true;$("chatDrawer").classList.remove("hidden");};
  const chatClose=$("chatClose");if(chatClose)chatClose.onclick=()=>{chatOpen=false;$("chatDrawer").classList.add("hidden");};
  const starForm=$("starChoiceForm");if(starForm)starForm.onsubmit=e=>{e.preventDefault();confirmStarLetter();};
  const cancelStar=$("cancelStarChoice");if(cancelStar)cancelStar.onclick=cancelStarChoice;
  if(choosingStar)setTimeout(()=>$("starLetterInput")?.focus(),40);
  renderChatCache();refreshCohostUi();
}

let lastCardTap={i:null,at:0};
function handleCardTap(i,e){
  const t=Date.now();
  if(lastCardTap.i===i&&t-lastCardTap.at<=360){e?.preventDefault?.();lastCardTap={i:null,at:0};flipCard(i);return;}
  lastCardTap={i,at:t};selectCard(i);
}
function selectCard(i){
  if(!lastPublic||lastPublic.currentUid!==user.uid||lastPublic.transitionAt||lastPublic.turnPlay||lastPublic.starChoice)return;
  selectedCard=i;renderKalim(lastPublic);
}
async function flipCard(i){
  await runTransaction(rr('public/kalim'),k=>{
    if(!k||k.currentUid!==user.uid||k.transitionAt||k.turnPlay||k.starChoice)return k;
    const c=k.hands?.[user.uid]?.[i];if(c)c.useBack=!c.useBack;return k;
  });
  selectedCard=i;
}

async function beginStarChoice(slot,idx){
  const result=await runTransaction(rr('public/kalim'),k=>{
    if(!k||k.currentUid!==user.uid||k.transitionAt||k.turnPlay||k.starChoice)return k;
    const card=k.hands?.[user.uid]?.[idx];if(!card)return k;
    const f=card.useBack?card.b:card.a;if(f!=='★')return k;
    const n=Date.now();
    const remaining=k.timerRunning?Math.max(0,(k.deadline||n)-n):Math.max(0,k.remainingMs||0);
    if(remaining<=0)return k;
    k.remainingMs=remaining;k.timerRunning=false;
    k.starChoice={uid:user.uid,slot,cardIndex:idx,graceUntil:n+4000,baseRemainingMs:remaining,resumed:false};
    k.lastAction=`${me.name} يختار حرف النجمة`;
    return k;
  });
  if(result?.committed)selectedCard=null;
}

async function playSlot(slot){
  if(!lastPublic||lastPublic.currentUid!==user.uid||lastPublic.transitionAt)return;
  if(lastPublic.turnPlay){
    if(lastPublic.turnPlay.uid===user.uid&&lastPublic.turnPlay.slot===slot)await undoSlot(slot);
    return;
  }
  if(lastPublic.starChoice)return;
  if(selectedCard==null)return;
  const c=lastPublic?.hands?.[user.uid]?.[selectedCard];if(!c)return;
  if(face(c)==='★'){await beginStarChoice(slot,selectedCard);return;}
  const idx=selectedCard;selectedCard=null;
  await runTransaction(rr('public/kalim'),k=>{
    if(!k||k.currentUid!==user.uid||k.transitionAt||k.turnPlay||k.starChoice)return k;
    const hand=k.hands?.[user.uid]||[],card=hand[idx];if(!card)return k;
    const f=card.useBack?card.b:card.a,o=card.useBack?card.a:card.b;
    hand.splice(idx,1);
    k.stacks[slot].push({letter:f,other:o,ownerUid:user.uid,card});
    k.turnPlay={uid:user.uid,slot};
    if(k.lastDraws)delete k.lastDraws[user.uid];
    k.lastAction=`${me.name} وضع حرف ${f}`;
    if(hand.length===0)k.winnerUid=user.uid;
    return k;
  });
}

async function confirmStarLetter(){
  const input=$("starLetterInput"),msg=$("starChoiceMsg");
  const letter=arabicLetter(input?.value);
  if(!letter){if(msg)msg.textContent='اكتب حرفًا عربيًا واحدًا.';input?.focus();return;}
  const result=await runTransaction(rr('public/kalim'),k=>{
    const sc=k?.starChoice;
    if(!k||!sc||sc.uid!==user.uid||k.currentUid!==user.uid||k.transitionAt||k.turnPlay)return k;
    const hand=k.hands?.[user.uid]||[],card=hand[sc.cardIndex];if(!card)return k;
    const f=card.useBack?card.b:card.a,o=card.useBack?card.a:card.b;if(f!=='★')return k;
    const n=Date.now();
    if(!sc.resumed){
      const elapsedAfterGrace=Math.max(0,n-(sc.graceUntil||n));
      const remaining=Math.max(0,(sc.baseRemainingMs||0)-elapsedAfterGrace);
      if(remaining<=0){k.timerRunning=false;k.remainingMs=0;k.bellStopped=true;k.transitionAt=n+2000;k.starChoice=null;k.lastAction='انتهى الوقت.';return k;}
      k.remainingMs=remaining;k.deadline=n+remaining;k.timerRunning=true;
    }
    hand.splice(sc.cardIndex,1);
    k.stacks[sc.slot].push({letter,other:o,ownerUid:user.uid,card});
    k.turnPlay={uid:user.uid,slot:sc.slot};
    if(k.lastDraws)delete k.lastDraws[user.uid];
    k.starChoice=null;
    k.lastAction=`${me.name} استخدم النجمة كحرف ${letter}`;
    if(hand.length===0)k.winnerUid=user.uid;
    return k;
  });
  if(!result?.committed&&msg)msg.textContent='انتهت فرصة اللعب في هذا الدور.';
}

async function cancelStarChoice(){
  await runTransaction(rr('public/kalim'),k=>{
    const sc=k?.starChoice;if(!k||!sc||sc.uid!==user.uid)return k;
    const n=Date.now();
    if(!sc.resumed){
      const elapsedAfterGrace=Math.max(0,n-(sc.graceUntil||n));
      const remaining=Math.max(0,(sc.baseRemainingMs||0)-elapsedAfterGrace);
      if(remaining<=0){k.timerRunning=false;k.remainingMs=0;k.bellStopped=true;k.transitionAt=n+2000;k.starChoice=null;k.lastAction='انتهى الوقت.';return k;}
      k.remainingMs=remaining;k.deadline=n+remaining;k.timerRunning=true;
    }
    k.starChoice=null;k.lastAction='تم إلغاء اختيار النجمة.';return k;
  });
}

async function undoSlot(slot){
  await runTransaction(rr('public/kalim'),k=>{
    if(!k||k.currentUid!==user.uid||k.transitionAt||k.starChoice)return k;
    if(!k.turnPlay||k.turnPlay.uid!==user.uid||k.turnPlay.slot!==slot)return k;
    const st=k.stacks?.[slot];if(!st||st.length<=1)return k;
    const top=st[st.length-1];if(top.ownerUid!==user.uid||!top.card)return k;
    st.pop();k.hands[user.uid]=k.hands[user.uid]||[];k.hands[user.uid].push(top.card);
    k.turnPlay=null;if(k.winnerUid===user.uid)k.winnerUid=null;
    k.lastAction=`${me.name} رجّع بطاقته ويقدر يختار بطاقة ثانية`;
    return k;
  });
}

// السحب متاح لكل لاعب في أي وقت، حتى لو لم يكن دوره.
// كل لاعب يستطيع التراجع عن آخر بطاقة سحبها فقط، إلى أن يسحب مرة أخرى أو يلعب بطاقة.
async function drawCard(){
  selectedCard=null;
  await runTransaction(rr('public/kalim'),k=>{
    if(!k||k.winnerUid)return k;
    const hand=k.hands?.[user.uid];if(!hand)return k;
    const c=k.deck?.pop();
    if(c){
      if(!c.id)c.id=`${user.uid}-${Date.now()}-${hand.length}`;
      hand.push(c);
      k.lastDraws=k.lastDraws||{};
      k.lastDraws[user.uid]={cardId:c.id,drawnAt:Date.now()};
      k.lastAction=`${me.name} سحب بطاقة`;
    }
    return k;
  });
}

async function undoLastDraw(){
  selectedCard=null;
  await runTransaction(rr('public/kalim'),k=>{
    if(!k)return k;
    const info=k.lastDraws?.[user.uid],hand=k.hands?.[user.uid];
    if(!info||!hand)return k;
    const idx=hand.findIndex(c=>c?.id===info.cardId);
    if(idx<0){delete k.lastDraws[user.uid];return k;}
    const [card]=hand.splice(idx,1);
    k.deck=k.deck||[];k.deck.push(card);
    delete k.lastDraws[user.uid];
    k.lastAction=`${me.name} رجّع آخر بطاقة سحبها`;
    return k;
  });
}

async function bell(){
  await runTransaction(rr('public/kalim'),k=>{
    if(!k||k.currentUid!==user.uid||k.starChoice)return k;
    const n=Date.now();
    if(!k.bellStopped){
      k.remainingMs=k.timerRunning?Math.max(0,(k.deadline||n)-n):(k.remainingMs||0);
      k.timerRunning=false;k.bellStopped=true;k.transitionAt=n+2000;k.lastAction=`${me.name} أنهى دوره`;
      return k;
    }
    const ms=k.timerMs||14000;
    k.currentIndex=((k.currentIndex||0)+1)%k.order.length;k.currentUid=k.order[k.currentIndex];
    k.remainingMs=ms;k.deadline=n+ms;k.timerRunning=true;k.bellStopped=false;k.transitionAt=null;k.turnPlay=null;k.starChoice=null;
    k.lastAction='بدأ دور اللاعب التالي';return k;
  });
}

async function pauseResume(){
  if(!canModerateKalim())return;
  await runTransaction(rr('public/kalim'),k=>{
    if(!k||k.transitionAt||k.starChoice)return k;
    if(k.timerRunning){k.remainingMs=Math.max(0,(k.deadline||Date.now())-Date.now());k.timerRunning=false;k.lastAction='تم إيقاف الوقت.';}
    else{k.deadline=Date.now()+(k.remainingMs||k.timerMs||14000);k.timerRunning=true;k.lastAction='تم استكمال الوقت.';}
    return k;
  });
}

async function resetKalimTimer(){
  if(!canModerateKalim())return;
  await runTransaction(rr('public/kalim'),k=>{
    if(!k||k.transitionAt||k.starChoice)return k;
    const ms=k.timerMs||14000,n=Date.now();
    k.remainingMs=ms;k.deadline=n+ms;k.timerRunning=true;k.bellStopped=false;
    k.lastAction=`أُعيد الوقت إلى ${Math.round(ms/1000)} ثانية.`;
    return k;
  });
}

function openReturnTurnDialog(){
  if(!canModerateKalim()||!lastPublic)return;
  document.getElementById('returnTurnDialog')?.remove();
  const names=Object.fromEntries(Object.entries(members).map(([u,m])=>[u,m.name]));
  const overlay=document.createElement('div');overlay.id='returnTurnDialog';overlay.className='manage-modal';
  overlay.innerHTML=`<div class="manage-card"><div class="manage-head"><b>↩ إرجاع الدور</b><button class="secondary" id="returnTurnClose">إغلاق</button></div><div class="small" style="margin-bottom:10px">اختار اللاعب الذي تريد إرجاع الدور له.</div><div class="member-list">${(lastPublic.order||[]).map(u=>`<button class="return-turn-option ${u===lastPublic.currentUid?'current':''}" data-u="${u}"><b>${escapeHtml(names[u]||'لاعب')}</b><span class="small">${u===lastPublic.currentUid?'دوره الآن':'إرجاع الدور'}</span></button>`).join('')}</div></div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('#returnTurnClose').onclick=close;
  overlay.onclick=e=>{if(e.target===overlay)close();};
  overlay.querySelectorAll('.return-turn-option').forEach(b=>b.onclick=async()=>{b.disabled=true;await returnKalimTurnTo(b.dataset.u);close();});
}

async function returnKalimTurnTo(uid){
  if(!canModerateKalim())return;
  await runTransaction(rr('public/kalim'),k=>{
    if(!k||k.starChoice)return k;
    const idx=(k.order||[]).indexOf(uid);if(idx<0)return k;
    const ms=k.timerMs||14000,n=Date.now();
    k.currentIndex=idx;k.currentUid=uid;k.remainingMs=ms;k.deadline=n+ms;k.timerRunning=true;k.bellStopped=false;k.transitionAt=null;k.turnPlay=null;k.starChoice=null;
    k.lastAction=`تم إرجاع الدور إلى ${members[uid]?.name||'اللاعب'}`;
    return k;
  });
}

async function tickKalimClock(){
  if(!lastPublic)return;
  const nowMs=Date.now();
  const graceDue=lastPublic.starChoice&&!lastPublic.starChoice.resumed&&(lastPublic.starChoice.graceUntil||0)<=nowMs;
  const timerDue=lastPublic.timerRunning&&(lastPublic.deadline||0)<=nowMs;
  const transitionDue=!lastPublic.timerRunning&&lastPublic.transitionAt&&lastPublic.transitionAt<=nowMs;
  if(!graceDue&&!timerDue&&!transitionDue)return;
  await runTransaction(rr('public/kalim'),k=>{
    if(!k)return k;const n=Date.now();
    if(k.starChoice&&!k.starChoice.resumed&&(k.starChoice.graceUntil||0)<=n){
      const deadline=(k.starChoice.graceUntil||n)+Math.max(0,k.starChoice.baseRemainingMs||0);
      const remaining=Math.max(0,deadline-n);
      k.starChoice.resumed=true;k.remainingMs=remaining;k.deadline=deadline;k.timerRunning=remaining>0;
      k.lastAction='انتهت مهلة النجمة المجانية وبدأ الوقت الأساسي.';
    }
    if(k.timerRunning&&(k.deadline||0)<=n){
      k.timerRunning=false;k.remainingMs=0;k.bellStopped=true;k.transitionAt=n+2000;k.starChoice=null;
      k.lastAction='انتهى الوقت.';
      return k;
    }
    if(!k.timerRunning&&k.transitionAt&&k.transitionAt<=n){
      const ms=k.timerMs||14000;
      k.currentIndex=((k.currentIndex||0)+1)%k.order.length;k.currentUid=k.order[k.currentIndex];
      k.remainingMs=ms;k.deadline=n+ms;k.timerRunning=true;k.bellStopped=false;k.transitionAt=null;k.turnPlay=null;k.starChoice=null;
      k.lastAction='بدأ دور اللاعب التالي تلقائيًا.';
    }
    return k;
  });
}

let chatOpen=false;
let chatCache={};
function renderChat(v){chatCache=v;renderChatCache();}
function renderChatCache(){
  const b=$("chatBox");if(!b)return;
  const arr=Object.values(chatCache||{}).sort((a,b)=>(a.ts||0)-(b.ts||0)).slice(-30);
  b.innerHTML=arr.map(m=>`<div class="chat-msg"><b>${escapeHtml(m.name)}</b>: ${escapeHtml(m.text)}</div>`).join('');b.scrollTop=b.scrollHeight;
}
async function sendChat(){const i=$("chatInput"),t=i?.value.trim();if(!t)return;i.value='';const p=push(rr('chat'));await set(p,{uid:user.uid,name:me.name,text:t,ts:now()});}

setInterval(()=>{
  const e=$("kTimer");if(e&&lastPublic)e.textContent=Math.ceil(rem(lastPublic)/1000);
  const sg=$("starGraceText");
  if(sg&&lastPublic?.starChoice?.uid===user?.uid){sg.textContent=lastPublic.starChoice.resumed?'بدأ وقتك الأساسي':`المهلة المجانية: ${Math.ceil(starGraceRemaining(lastPublic)/1000)} ث`;}
  if(meta?.game==='kalim'&&meta?.status==='playing')tickKalimClock();
},250);
boot().catch(e=>{$("joinMsg").textContent=e.message});
