/* WORLD 1-1: GRASSLAND TOWN — VER 2.62 */
(()=>{
 "use strict";
 let active=false,dialogue=null,dialogueIndex=0,metVillagers=new Set(),notice="",noticeTimer=0;
 const npcs=[
  {id:"elder",x:360,name:"村人",color:"#e7bd72",lines:["おや、見かけない顔だね。","最近、草原の奥で草木が枯れたり、動物が姿を消したりしているんだ。","いつもと違うことが起きている気がしてね……気をつけておくれ。"]},
  {id:"guard",x:760,name:"町の見張り",color:"#8fc8ff",lines:["草原の奥にある古代遺跡を調べている研究者がいる。","今朝も調査に出かけたが、まだ戻っていない。","遺跡の近くでは凶暴な魔物も目撃されている。無理はするなよ。"]}
 ];
 const gateX=1240;
 const panel=document.getElementById("storyPanel");
 const startButton=document.getElementById("storyStartButton");
 const interact=document.getElementById("storyInteractButton");
 const originalDraw=draw;
 const originalUpdate=update;
 function setNotice(t){notice=t;noticeTimer=180}
 function start(){
  if(!adminUnlocked){
   document.getElementById("codePanel").style.display="block";
   document.getElementById("codeMessage").textContent="WORLD 1-1のテストプレイはアドミンのみ可能です。管理者コードを入力してください。";
   return;
  }
  active=true;dialogue=null;dialogueIndex=0;metVillagers=new Set();notice="町の人たちから話を聞こう。";noticeTimer=240;
  worldNumber=1;customStageTestMode=false;springPads=[];lavaZones=[];stageWalls=[];windZones=[];movingPlatforms=[];vanishPlatforms=[];lightningZones=[];
  platforms=[{x:0,y:430,w:1450,h:70}];enemies=[];coins=[];goal={x:gateX,y:340,w:45,h:90};
  boss={x:-500,y:-500,w:1,h:1,hp:0,maxHP:0,alive:false};bossDefeated=true;gameClear=false;stageCleared=false;
  player.x=75;player.y=388;player.vx=0;player.vy=0;player.jumps=0;playerHP=3;camera=0;currentTime=0;
  document.querySelector(".stage-top p").textContent="WORLD 1-1 : GRASSLAND TOWN";
  panel.style.display="none";document.getElementById("clearPanel").style.display="none";
  if(interact)interact.style.display="inline-block";
  beginSelectedWorld();
 }
 function nearestNpc(){
  const npc=npcs.find(n=>Math.abs((player.x+player.w/2)-n.x)<78&&Math.abs(player.y+player.h-430)<95);
  return npc||null;
 }
 function interactNow(){
  if(!active||gameClear)return;
  if(dialogue){dialogueIndex++;if(dialogueIndex>=dialogue.lines.length){metVillagers.add(dialogue.id);dialogue=null;setNotice(metVillagers.size===2?"町の人たちから話を聞いた。東の出口へ向かおう。":"話を聞いた。ほかの町の人にも話しかけよう。")}return;}
  const npc=nearestNpc();
  if(npc){dialogue={...npc,lines:npc.lines.slice()};dialogueIndex=0;return;}
  setNotice("近くに話せる人はいない。村人のそばで「E」または「話す」を押そう。");
 }
 function drawTown(){
  const c=ctx,cam=camera;
  c.clearRect(0,0,W,H);
  const sky=c.createLinearGradient(0,0,0,H);sky.addColorStop(0,"#70c9f0");sky.addColorStop(.7,"#d9f0c9");sky.addColorStop(1,"#f4e9b5");c.fillStyle=sky;c.fillRect(0,0,W,H);
  c.fillStyle="#fff2b0";c.beginPath();c.arc(735,90,38,0,Math.PI*2);c.fill();
  c.save();c.translate(-cam*.18,0);
  for(let i=0;i<7;i++){const x=i*250-40;c.fillStyle=i%2?"#8ab99a":"#78aa91";c.beginPath();c.moveTo(x-30,330);c.lineTo(x+85,190+(i%3)*25);c.lineTo(x+210,330);c.closePath();c.fill()}
  c.restore();
  c.fillStyle="#6fba61";c.fillRect(0,385,W,45);
  c.fillStyle="#4f963f";c.fillRect(0,420,W,10);
  c.save();c.translate(-cam,0);
  // Village path and wooden fence
  c.fillStyle="#c7a36c";c.fillRect(0,398,1450,32);
  for(let x=30;x<1450;x+=95){c.fillStyle="#8b603b";c.fillRect(x,365,7,35);c.fillRect(x+38,365,7,35);c.fillStyle="#b9824c";c.fillRect(x,372,45,5);c.fillRect(x,389,45,5)}
  // Houses
  const houses=[{x:95,w:155,h:105,roof:"#9a5142",wall:"#f1d39a"},{x:470,w:175,h:125,roof:"#6b4d85",wall:"#e6d4a5"},{x:900,w:185,h:115,roof:"#a65d3c",wall:"#f0d9a8"}];
  for(const h of houses){c.fillStyle="#795238";c.fillRect(h.x+12,330-h.h/2,h.w-24,h.h/2+58);c.fillStyle=h.wall;c.fillRect(h.x,330-h.h/2,h.w,h.h/2+58);c.fillStyle=h.roof;c.beginPath();c.moveTo(h.x-12,330-h.h/2);c.lineTo(h.x+h.w/2,330-h.h/2-65);c.lineTo(h.x+h.w+12,330-h.h/2);c.closePath();c.fill();c.fillStyle="#70452e";c.fillRect(h.x+h.w/2-17,350,34,80);c.fillStyle="#8bd8e8";c.fillRect(h.x+22,330-h.h/2+25,30,28);c.fillRect(h.x+h.w-52,330-h.h/2+25,30,28);c.strokeStyle="#fff1c8";c.lineWidth=3;c.strokeRect(h.x+22,330-h.h/2+25,30,28);c.strokeRect(h.x+h.w-52,330-h.h/2+25,30,28)}
  // Well
  c.fillStyle="#a7a9a2";c.beginPath();c.ellipse(690,395,36,13,0,0,Math.PI*2);c.fill();c.fillStyle="#6d7778";c.fillRect(655,365,70,30);c.fillStyle="#70b8d4";c.beginPath();c.ellipse(690,366,30,9,0,0,Math.PI*2);c.fill();
  // Gate
  c.fillStyle="#6e5139";c.fillRect(gateX,315,18,115);c.fillRect(gateX+72,315,18,115);c.fillRect(gateX,315,90,13);c.fillStyle="#f4d36e";c.font="bold 15px sans-serif";c.textAlign="center";c.fillText(metVillagers.size===2?"草原への道":"町の出口",gateX+45,300);
  // NPCs
  for(const n of npcs){c.save();c.translate(n.x,0);c.fillStyle="rgba(0,0,0,.18)";c.beginPath();c.ellipse(0,426,19,5,0,0,Math.PI*2);c.fill();c.fillStyle=n.color;c.fillRect(-13,382,26,38);c.fillStyle="#f1c49b";c.beginPath();c.arc(0,370,13,0,Math.PI*2);c.fill();c.fillStyle="#5a3828";c.fillRect(-13,357,26,8);c.fillStyle="#fff";c.font="bold 12px sans-serif";c.textAlign="center";c.fillText(n.name,0,350);if(Math.abs(player.x+player.w/2-n.x)<105){c.fillStyle="#fff4a8";c.font="bold 22px sans-serif";c.fillText("!",0,335)}c.restore()}
  // Player
  c.fillStyle="rgba(0,0,0,.2)";c.beginPath();c.ellipse(player.x+15,430,18,5,0,0,Math.PI*2);c.fill();
  c.fillStyle=playerSkin||"#9b8aff";c.fillRect(player.x,player.y+12,player.w,player.h-12);c.fillStyle="#f1c49b";c.beginPath();c.arc(player.x+15,player.y+8,11,0,Math.PI*2);c.fill();c.fillStyle="#27324b";c.fillRect(player.x+5,player.y,20,7);
  c.restore();
  // HUD
  c.fillStyle="rgba(5,17,38,.78)";c.fillRect(16,14,340,58);c.strokeStyle="#83f3d0";c.strokeRect(16,14,340,58);c.fillStyle="#d9fff1";c.font="bold 17px sans-serif";c.textAlign="left";c.fillText("WORLD 1-1  草原の町",29,38);c.font="12px sans-serif";c.fillStyle="#fff";c.fillText("町の人と話そう　"+metVillagers.size+"/2",29,58);
  if(noticeTimer>0&&!dialogue){c.fillStyle="rgba(5,17,38,.86)";c.fillRect(180,82,540,40);c.fillStyle="#fff";c.font="bold 15px sans-serif";c.textAlign="center";c.fillText(notice,450,107)}
  if(dialogue){c.fillStyle="rgba(4,12,30,.94)";c.fillRect(70,330,760,145);c.strokeStyle="#83f3d0";c.lineWidth=2;c.strokeRect(70,330,760,145);c.fillStyle="#9fffe0";c.font="bold 16px sans-serif";c.textAlign="left";c.fillText(dialogue.name,92,359);c.fillStyle="#fff";c.font="16px sans-serif";c.fillText(dialogue.lines[dialogueIndex]||"",92,395);c.fillStyle="#b8d6e8";c.font="12px sans-serif";c.textAlign="right";c.fillText("E / 話す ボタンで次へ",810,451)}
  if(player.x>=gateX-65&&metVillagers.size<2&&!dialogue){c.fillStyle="rgba(4,12,30,.88)";c.fillRect(210,150,480,54);c.fillStyle="#fff";c.font="bold 16px sans-serif";c.textAlign="center";c.fillText("先に町の人たちから話を聞こう。",450,183)}
 }
 function finishStage(){
  if(gameClear)return;gameClear=true;stageCleared=true;
  document.getElementById("clearTitle").textContent="WORLD 1-1 CLEAR!";
  document.getElementById("worldRewardText").textContent="町の人たちから情報を集めた。次は草原の奥へ！";
  document.getElementById("nextStageButton").style.display="none";
  document.getElementById("clearRestartButton").style.display="none";
  document.getElementById("clearPanel").style.display="block";
  if(interact)interact.style.display="none";
 }
 document.addEventListener("keydown",e=>{if(active&&(e.key==="e"||e.key==="E")){e.preventDefault();interactNow()}});
 if(interact)interact.addEventListener("click",interactNow);
 startButton.disabled=false;startButton.textContent="▶ PLAY　/　1-1 草原の町";
 startButton.addEventListener("click",start);
 document.getElementById("storyToggle").addEventListener("click",()=>{startButton.disabled=!adminUnlocked;startButton.textContent=adminUnlocked?"▶ PLAY　/　1-1 草原の町":"ADMIN ONLY　/　管理者限定"});
 const oldHome=document.getElementById("homeButton");
 oldHome.addEventListener("click",()=>{active=false;if(interact)interact.style.display="none"},{capture:true});
 const oldClearHome=document.getElementById("clearHomeButton");
 oldClearHome.addEventListener("click",()=>{active=false;if(interact)interact.style.display="none"},{capture:true});
 draw=function(){if(active){drawTown();return}originalDraw()};
 update=function(){if(active&&gameStarted&&!gameClear){if(noticeTimer>0)noticeTimer--;if(!dialogue&&player.x>=gateX-25&&metVillagers.size===2)finishStage()}originalUpdate()};
 if(!document.getElementById("storyInteractButton"))return;
})();
