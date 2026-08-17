import { KALIM_BALANCED_POOL, KALIM_START_WORDS, ARABIC_LETTERS } from "./data.js";
import { cryptoRand, shuffle } from "./common.js";
export function makeKalimCard(){
  const letter=()=>KALIM_BALANCED_POOL[cryptoRand(KALIM_BALANCED_POOL.length)];
  let a=Math.random()<0.045?"★":letter(), b=letter(); while(b===a)b=letter();
  if(Math.random()<.5)[a,b]=[b,a]; return {a,b,useBack:false};
}
export function activeFace(c){return c?.useBack?c.b:c.a;} export function otherFace(c){return c?.useBack?c.a:c.b;}
export function createKalimState(memberEntries){
  const deck=shuffle(Array.from({length:520},makeKalimCard)); const hands={}; let di=0;
  for(const [uid] of memberEntries){ hands[uid]=deck.slice(di,di+10); di+=10; }
  const word=KALIM_START_WORDS[cryptoRand(KALIM_START_WORDS.length)];
  const stacks=word.map(l=>[{letter:l,other:ARABIC_LETTERS[cryptoRand(ARABIC_LETTERS.length)],ownerUid:null,card:null}]);
  const order=memberEntries.map(([uid])=>uid);
  return {phase:"playing",order,currentIndex:0,currentUid:order[0],hands,deck:deck.slice(di),stacks,timerRunning:true,bellStopped:false,remainingMs:14000,deadline:Date.now()+14000,winnerUid:null,lastAction:"بدأت الجولة"};
}
