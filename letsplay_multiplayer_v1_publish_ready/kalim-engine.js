import { KALIM_BALANCED_POOL, KALIM_START_WORDS, ARABIC_LETTERS } from "./data.js";
import { cryptoRand, shuffle } from "./common.js";

function regularLetter(){ return KALIM_BALANCED_POOL[cryptoRand(KALIM_BALANCED_POOL.length)]; }

let cardSeq=0;
function cardId(){cardSeq+=1;return `k-${Date.now().toString(36)}-${cardSeq.toString(36)}-${Math.random().toString(36).slice(2,7)}`;}

export function makeKalimCard(forceStar=false){
  const id=cardId();
  if(forceStar){
    const letter=regularLetter();
    return Math.random()<.5
      ? {id,a:"★",b:letter,useBack:false}
      : {id,a:letter,b:"★",useBack:false};
  }
  let a=regularLetter(), b=regularLetter();
  while(b===a)b=regularLetter();
  if(Math.random()<.5)[a,b]=[b,a];
  return {id,a,b,useBack:false};
}

export function activeFace(c){return c?.useBack?c.b:c.a;}
export function otherFace(c){return c?.useBack?c.a:c.b;}

export function createKalimState(memberEntries,timerSeconds=14){
  const deckSize=520;
  // تقريبًا نجمة لكل 16 بطاقة: 32 بطاقة نجمة ثابتة في كل جولة.
  const starCount=32;
  const deck=shuffle([
    ...Array.from({length:starCount},()=>makeKalimCard(true)),
    ...Array.from({length:deckSize-starCount},()=>makeKalimCard(false))
  ]);
  const hands={}; let di=0;
  for(const [uid] of memberEntries){hands[uid]=deck.slice(di,di+10);di+=10;}
  const word=KALIM_START_WORDS[cryptoRand(KALIM_START_WORDS.length)];
  const stacks=word.map(l=>[{letter:l,other:ARABIC_LETTERS[cryptoRand(ARABIC_LETTERS.length)],ownerUid:null,card:null}]);
  const order=memberEntries.map(([uid])=>uid);
  const timerMs=Math.max(9000,Math.min(15000,Number(timerSeconds||14)*1000));
  return {
    phase:"playing",order,currentIndex:0,currentUid:order[0],hands,deck:deck.slice(di),stacks,
    timerMs,timerRunning:true,bellStopped:false,remainingMs:timerMs,deadline:Date.now()+timerMs,
    transitionAt:null,turnPlay:null,starChoice:null,lastDraws:{},winnerUid:null,lastAction:"بدأت الجولة"
  };
}
