import React, { useEffect, useRef, useState } from 'react';

const DESIGN_W = 1728;
const DESIGN_H = 1117;

const ANIMATION_CSS = `
.srha-inner *{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased;}
#camera{position:absolute;inset:0;perspective:2100px;overflow:hidden;}
#ui-rig{position:absolute;inset:0;}
#frame-glass{position:absolute;left:100px;top:117px;width:1504px;height:885px;border-radius:45px;background:linear-gradient(0deg,rgba(188,185,255,0.2),rgba(188,185,255,0.2)),linear-gradient(0deg,rgba(255,255,255,0.204) 0%,rgba(255,255,255,0.068) 30%,rgba(255,255,255,0) 70%,rgba(224,237,255,0.1125) 100%),linear-gradient(316.97deg,rgba(255,255,255,0.136) 17.24%,rgba(255,255,255,0) 58.62%,rgba(217,235,255,0.135) 86.21%),radial-gradient(38.46% 38.46% at 11.54% 19.23%,rgba(255,235,255,0.054) 0%,rgba(230,255,240,0.036) 70%,rgba(240,240,255,0) 100%),radial-gradient(20% 20% at 0% 0%,rgba(255,255,255,0.0078) 0%,rgba(250,250,255,0.013) 30%,rgba(255,250,250,0.0052) 60%,rgba(252,252,255,0) 100%);box-shadow:0px 0px 60px rgba(255,255,255,0.0612),0px 17.2px 40px -6px rgba(0,0,0,0.37),0px 3px 12px -3px rgba(0,0,0,0.24),inset 1.125px 1.8px 11.6px rgba(209,230,255,0.225),inset 0px 1.5px 4.02px rgba(255,255,255,0.306),inset -0.54px 0px 1.5px rgba(38,115,255,0.081),inset 0.54px 0px 1.5px rgba(255,38,64,0.0675),inset 0px 0px 0.89px rgba(242,242,255,0.0208);backdrop-filter:blur(33.5px);}
.col{position:absolute;top:117px;width:405px;height:885px;background:rgba(217,217,217,0.08);border:1px solid rgba(255,255,255,0.31);}
#colL{left:101px;border-radius:45px 0 0 45px;}
#colR{left:1199px;border-radius:0 45px 45px 0;}
.hstrip{position:absolute;top:120px;width:405px;height:76px;border:1px solid rgba(255,255,255,0.31);}
#hsL{left:101px;border-radius:45px 0 0 0;} #hsR{left:1199px;border-radius:0 45px 0 0;}
.lbl24{font-weight:600;font-size:24px;line-height:31px;color:rgba(255,255,255,0.73);position:absolute;}
#timer{position:absolute;left:672px;top:43px;width:298px;text-align:center;font-weight:600;font-size:64px;line-height:83px;color:rgba(150,150,150,0.51);font-variant-numeric:tabular-nums;}
#countpill{position:absolute;left:1208px;top:63px;width:126px;height:44px;border-radius:24px;background:linear-gradient(0deg,rgba(255,255,255,0.1365),rgba(255,255,255,0.1365)),linear-gradient(0deg,rgba(255,255,255,0.186) 0%,rgba(255,255,255,0.062) 30%,rgba(255,255,255,0) 70%,rgba(224,237,255,0.1125) 100%),linear-gradient(316.97deg,rgba(255,255,255,0.124) 17.24%,rgba(255,255,255,0) 58.62%,rgba(217,235,255,0.135) 86.21%),radial-gradient(38.46% 38.46% at 11.54% 19.23%,rgba(255,235,255,0.054) 0%,rgba(230,255,240,0.036) 70%,rgba(240,240,255,0) 100%);box-shadow:0px 0px 60px rgba(255,255,255,0.0558),0px 17.2px 40px -6px rgba(0,0,0,0.37),0px 3px 12px -3px rgba(0,0,0,0.24),inset 1.125px 1.8px 11.6px rgba(209,230,255,0.225),inset 0px 1.5px 3.93px rgba(255,255,255,0.279),inset -0.54px 0px 1.5px rgba(38,115,255,0.081),inset 0.54px 0px 1.5px rgba(255,38,64,0.0675);backdrop-filter:blur(33.5px);display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600;font-size:22px;color:rgba(255,255,255,0.36);}
#wb{position:absolute;left:555px;top:175px;width:581px;height:622px;background:#FFFFFF;overflow:hidden;border-radius:2px;box-shadow:0 30px 80px rgba(5,15,90,.30);}
.qpill{position:absolute;width:92.9px;height:33.96px;border-radius:24px;background:linear-gradient(0deg,rgba(255,255,255,0.1365),rgba(255,255,255,0.1365)),linear-gradient(0deg,rgba(255,255,255,0.186) 0%,rgba(255,255,255,0.062) 30%,rgba(255,255,255,0) 70%,rgba(224,237,255,0.1125) 100%),linear-gradient(316.97deg,rgba(255,255,255,0.124) 17.24%,rgba(255,255,255,0) 58.62%,rgba(217,235,255,0.135) 86.21%),radial-gradient(38.46% 38.46% at 11.54% 19.23%,rgba(255,235,255,0.054) 0%,rgba(230,255,240,0.036) 70%,rgba(240,240,255,0) 100%);box-shadow:0px 0px 60px rgba(255,255,255,0.0558),0px 17.2px 40px -6px rgba(0,0,0,0.37),0px 3px 12px -3px rgba(0,0,0,0.24),inset 1.125px 1.8px 11.6px rgba(209,230,255,0.225),inset 0px 1.5px 3.93px rgba(255,255,255,0.279),inset -0.54px 0px 1.5px rgba(38,115,255,0.081),inset 0.54px 0px 1.5px rgba(255,38,64,0.0675);backdrop-filter:blur(33.5px);display:flex;align-items:center;justify-content:center;gap:7px;font-weight:600;font-size:12px;color:#FFFFFF;top:832.94px;}
#toolbar{position:absolute;left:658.6px;top:892.42px;width:399.57px;height:73.92px;border-radius:40px;background:linear-gradient(0deg,rgba(110,131,255,0.47),rgba(110,131,255,0.47)),linear-gradient(0deg,rgba(255,255,255,0.156) 0%,rgba(255,255,255,0.052) 30%,rgba(255,255,255,0) 70%,rgba(224,237,255,0.1125) 100%),linear-gradient(316.97deg,rgba(255,255,255,0.104) 17.24%,rgba(255,255,255,0) 58.62%,rgba(217,235,255,0.135) 86.21%);box-shadow:0px 0px 60px rgba(255,255,255,0.0468),0px 17.2px 40px -6px rgba(0,0,0,0.37),0px 3px 12px -3px rgba(0,0,0,0.24),inset 1.125px 1.8px 11.6px rgba(209,230,255,0.225),inset 0px 1.5px 3.78px rgba(255,255,255,0.234);backdrop-filter:blur(33.5px);display:flex;align-items:center;justify-content:center;gap:52px;}
#toolbar svg{opacity:.75;}
#fmode{position:absolute;left:1408px;top:128px;width:183px;height:60px;border-radius:24px;background:linear-gradient(0deg,rgba(31,158,248,0.135),rgba(31,158,248,0.135)),linear-gradient(0deg,rgba(255,255,255,0.18) 0%,rgba(255,255,255,0.06) 30%,rgba(255,255,255,0) 70%,rgba(224,237,255,0.1125) 100%),linear-gradient(316.97deg,rgba(255,255,255,0.12) 17.24%,rgba(255,255,255,0) 58.62%,rgba(217,235,255,0.135) 86.21%);box-shadow:0px 0px 55px rgba(255,255,255,0.054),0px 14.8px 36px -6px rgba(0,0,0,0.33),0px 3px 12px -3px rgba(0,0,0,0.21),inset 1.125px 1.8px 11.6px rgba(209,230,255,0.225),inset 0px 1.5px 3.9px rgba(255,255,255,0.27);backdrop-filter:blur(26.5px);display:flex;align-items:center;justify-content:center;gap:9px;font-weight:600;font-size:15px;color:rgba(255,255,255,0.36);transition:all .8s;}
#fmode.on{color:#CFFFDD;box-shadow:0 0 26px rgba(80,220,140,.35),inset 0 0 12px rgba(120,255,180,.25);}
#endbtn{position:absolute;left:1447px;top:920px;width:138px;height:54px;border-radius:24px;background:linear-gradient(0deg,rgba(255,51,51,0.36),rgba(255,51,51,0.36)),linear-gradient(0deg,rgba(255,255,255,0.18) 0%,rgba(255,255,255,0.06) 30%,rgba(255,255,255,0) 70%,rgba(224,237,255,0.1125) 100%),linear-gradient(316.97deg,rgba(255,255,255,0.12) 17.24%,rgba(255,255,255,0) 58.62%,rgba(217,235,255,0.135) 86.21%);box-shadow:0px 0px 55px rgba(255,255,255,0.054),0px 14.8px 36px -6px rgba(0,0,0,0.33),0px 3px 12px -3px rgba(0,0,0,0.21),inset 1.125px 1.8px 11.6px rgba(209,230,255,0.225),inset 0px 1.5px 3.9px rgba(255,255,255,0.27);backdrop-filter:blur(26.5px);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:16px;color:rgba(255,255,255,0.5);}
#callbtn{position:absolute;left:1226px;top:918px;width:197px;height:57px;border-radius:24px;background:rgba(217,217,217,0.46);display:flex;align-items:center;gap:10px;padding-left:8px;font-weight:600;font-size:16px;color:rgba(255,255,255,0.73);}
#callbtn .ph{width:45px;height:45px;border-radius:50%;background:rgba(68,151,22,0.75);display:flex;align-items:center;justify-content:center;}
#tfeed{position:absolute;left:120px;top:206px;width:368px;height:600px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;gap:10px;}
.prow{display:flex;align-items:center;gap:8px;margin:0 0 4px 2px;}
.bav{width:22px;height:22px;border-radius:50%;display:inline-block;border:1px solid rgba(255,255,255,.4);}
.bwho{font-weight:600;font-size:12px;color:rgba(255,255,255,.8);}
.bts{font-weight:500;font-size:10px;color:rgba(255,255,255,.45);margin-left:6px;}
.bub{max-width:300px;padding:12px 15px;font-size:13px;line-height:1.5;color:rgba(255,255,255,.92);box-shadow:0px 4px 20px 5px rgba(0,0,0,0.18);}
.bub.peer{background:rgba(144,179,255,0.2);border:1px solid #55619E;border-radius:20px 20px 20px 0px;}
.bub.reg{background:rgba(21,53,122,0.58);border:1px solid #233F86;border-radius:20px 20px 20px 0px;}
.bub.you{background:rgba(217,217,217,0.2);border:1px solid rgba(255,255,255,0.31);border-radius:20px 20px 0px 20px;align-self:flex-end;}
.bub.you .bts{display:block;text-align:right;margin-top:4px;}
#typing{position:absolute;left:122px;top:812px;display:flex;gap:6px;align-items:center;font-size:12px;color:rgba(255,255,255,.6);font-weight:600;opacity:0;transition:opacity .4s;}
#typing.in{opacity:1;}
.vtile{position:absolute;border-radius:24px;overflow:hidden;background:linear-gradient(0deg,rgba(255,255,255,0.1305),rgba(255,255,255,0.1305)),linear-gradient(0deg,rgba(255,255,255,0.162) 0%,rgba(255,255,255,0.054) 30%,rgba(255,255,255,0) 70%,rgba(224,237,255,0.1125) 100%),linear-gradient(316.97deg,rgba(255,255,255,0.108) 17.24%,rgba(255,255,255,0) 58.62%,rgba(217,235,255,0.135) 86.21%);box-shadow:0px 0px 54.5px rgba(255,255,255,0.0486),0px 14.56px 35.6px -6px rgba(0,0,0,0.326),0px 3px 12px -3px rgba(0,0,0,0.207),inset 1.125px 1.8px 11.6px rgba(209,230,255,0.225),inset 0px 1.5px 3.81px rgba(255,255,255,0.243);backdrop-filter:blur(25.8px);}
.mono{border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);border:2px solid rgba(255,255,255,.5);box-shadow:0 6px 18px rgba(10,20,80,.35);}
.tname{position:absolute;left:2px;right:2px;bottom:0;background:rgba(23,23,23,0.2);border-radius:0 0 24px 24px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-weight:600;font-size:13px;color:rgba(255,255,255,.85);}
.tic{display:flex;gap:8px;align-items:center;}
.tbars{display:inline-flex;gap:2px;align-items:flex-end;height:12px;}
.tbars.off{display:none;}
.vtile.speak .tbars.off{display:inline-flex;}
.vtile.speak{box-shadow:0 0 0 2.5px rgba(140,255,190,.8),0 24px 50px rgba(20,30,110,.3);}
.tbars i{width:3px;background:#8CFFBE;border-radius:2px;display:block;height:8px;animation:beq 1s infinite ease-in-out alternate;}
.tbars i:nth-child(2){animation-delay:.15s}.tbars i:nth-child(3){animation-delay:.3s}.tbars i:nth-child(4){animation-delay:.45s}
@keyframes beq{from{transform:scaleY(.4)}to{transform:scaleY(1.15)}}
.ghostlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:rgba(255,255,255,.55);font-size:12px;font-weight:600;background:rgba(30,38,90,.35);backdrop-filter:blur(6px);transition:opacity .9s cubic-bezier(.22,1,.36,1);z-index:2;}
.gring{width:44px;height:44px;border-radius:50%;border:2px dashed rgba(255,255,255,.45);}
.joined .ghostlay{opacity:0;}
#notifs{position:absolute;right:70px;top:130px;width:300px;z-index:50;}
.notif{display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:24px;margin-bottom:10px;font-size:13px;font-weight:600;color:rgba(255,255,255,.9);background:linear-gradient(0deg,rgba(255,255,255,0.1365),rgba(255,255,255,0.1365)),linear-gradient(0deg,rgba(255,255,255,0.186) 0%,rgba(255,255,255,0.062) 30%,rgba(255,255,255,0) 70%,rgba(224,237,255,0.1125) 100%),linear-gradient(316.97deg,rgba(255,255,255,0.124) 17.24%,rgba(255,255,255,0) 58.62%,rgba(217,235,255,0.135) 86.21%),radial-gradient(38.46% 38.46% at 11.54% 19.23%,rgba(255,235,255,0.054) 0%,rgba(230,255,240,0.036) 70%,rgba(240,240,255,0) 100%);box-shadow:0px 0px 60px rgba(255,255,255,0.0558),0px 17.2px 40px -6px rgba(0,0,0,0.37),0px 3px 12px -3px rgba(0,0,0,0.24),inset 1.125px 1.8px 11.6px rgba(209,230,255,0.225),inset 0px 1.5px 3.93px rgba(255,255,255,0.279),inset -0.54px 0px 1.5px rgba(38,115,255,0.081),inset 0.54px 0px 1.5px rgba(255,38,64,0.0675);backdrop-filter:blur(33.5px);opacity:0;transform:translateX(26px);transition:all .8s cubic-bezier(.22,1,.36,1);}
.notif.in{opacity:1;transform:none;}.notif.out{opacity:0;transform:translateY(-14px);}
.react{position:absolute;font-size:22px;opacity:0;transform:translateY(12px) scale(.6);transition:all .7s cubic-bezier(.22,1,.36,1);filter:drop-shadow(0 4px 8px rgba(20,30,110,.3));z-index:55;}
.react.pop{opacity:.8;transform:none;}.react.gone{opacity:0;transform:translateY(-22px) scale(.9);}
.sticky{position:absolute;width:118px;padding:10px 12px;font-size:11.5px;line-height:1.35;color:#5c4a00;background:linear-gradient(180deg,#FFF3A8,#FFE97A);box-shadow:0 8px 18px rgba(90,70,0,.18);border-radius:3px;font-family:'Segoe Print','Bradley Hand',cursive;opacity:0;transform:scale(.7) rotate(-3deg);transition:all .7s cubic-bezier(.22,1,.36,1);}
.sticky.in{opacity:1;transform:scale(1) rotate(-3deg);}
.sticky.pink{background:linear-gradient(180deg,#FFD9E8,#FFC0DA);color:#7a2148;}
.sticky.pink.in{transform:scale(1) rotate(2.2deg);}
.cursor{position:absolute;pointer-events:none;opacity:0;transition:opacity .5s;offset-path:path('M 416 178 C 376 256, 296 296, 246 376 C 226 416, 296 464, 356 444');offset-distance:0%;z-index:5;}
.cursor.go{opacity:1;animation:crs 3.5s cubic-bezier(.45,.05,.55,.95) forwards;}
@keyframes crs{to{offset-distance:100%;}}
.cursor .tag{font-size:10px;font-weight:700;color:#fff;padding:3px 8px;border-radius:8px;margin-left:12px;background:#C9A33A;display:inline-block;}
#aicard{position:absolute;left:120px;top:0px;width:368px;padding:14px 16px;border-radius:20px;background:rgba(21,53,122,0.58);border:1px solid #233F86;box-shadow:0px 4px 20px 5px rgba(0,0,0,0.25);opacity:0;transform:translateY(12px);transition:all .8s cubic-bezier(.22,1,.36,1);z-index:6;}
#aicard.in{opacity:1;transform:none;}
#aicard .h{font-weight:700;font-size:11px;letter-spacing:.8px;color:#9FB6FF;}
#aicard .b{font-size:12.5px;color:rgba(255,255,255,.9);margin-top:6px;line-height:1.5;}
#aicard .sB,#aicard .sC{display:none;}
#aicard.q .sA{display:none}#aicard.q .sB{display:block}
#aicard.done .sA,#aicard.done .sB{display:none}#aicard.done .sC{display:block}
.msg{opacity:0;transform:translateY(10px);transition:opacity .7s cubic-bezier(.22,1,.36,1),transform .7s cubic-bezier(.22,1,.36,1);}
.msg.in{opacity:1;transform:none;}
.el{opacity:0;}.el.on{opacity:1;transition:opacity .5s;}
.el .stroke{stroke-dasharray:1;stroke-dashoffset:1;}
.el.on .stroke{animation:draw 1.3s cubic-bezier(.4,0,.2,1) forwards;}
.el .fade{opacity:0;}.el.on .fade{animation:fin .8s .5s cubic-bezier(.22,1,.36,1) forwards;}
@keyframes draw{to{stroke-dashoffset:0}}@keyframes fin{to{opacity:1}}
#particles span{position:absolute;border-radius:50%;background:rgba(255,255,255,.5);filter:blur(1px);animation:drift 14s ease-in-out infinite alternate;}
@keyframes drift{from{transform:translateY(0)}to{transform:translateY(-46px)}}
#glare{position:absolute;left:100px;top:117px;width:1504px;height:885px;border-radius:45px;overflow:hidden;pointer-events:none;z-index:60;}
#glare i{position:absolute;top:-20%;bottom:-20%;width:26%;left:-30%;transform:rotate(12deg);background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.12),rgba(255,255,255,0));animation:sweep 13s cubic-bezier(.4,0,.2,1) infinite;}
@keyframes sweep{0%,55%{left:-30%}80%,100%{left:120%}}
#bg-gradient{animation:breathe 9s ease-in-out infinite alternate;}
@keyframes breathe{from{transform:scale(1)}to{transform:scale(1.03)}}
#grade-vignette{position:absolute;inset:0;pointer-events:none;z-index:90;background:radial-gradient(105% 92% at 50% 44%,rgba(0,0,0,0) 46%,rgba(8,10,50,.42) 100%);}
#grade-light{position:absolute;inset:0;pointer-events:none;z-index:91;mix-blend-mode:soft-light;background:linear-gradient(165deg,rgba(255,255,255,.5) 0%,rgba(255,255,255,0) 34%);}
@keyframes campath{
 0%  {transform:scale(.84) rotateX(11deg) translateY(26px);}
 11% {transform:scale(.92) rotateX(9deg) translateY(14px);animation-timing-function:cubic-bezier(.55,.05,.35,1);}
 17% {transform:scale(1.42) rotateY(15deg) rotateX(2deg) translateX(468px) translateY(-18px);}
 28% {transform:scale(1.47) rotateY(13deg) rotateX(2deg) translateX(452px) translateY(-26px);animation-timing-function:cubic-bezier(.55,.05,.35,1);}
 34% {transform:scale(1.52) rotateY(-7deg) rotateX(3deg) translateY(-34px);}
 45% {transform:scale(1.58) rotateY(-8.5deg) rotateX(3deg) translateY(-42px);animation-timing-function:cubic-bezier(.55,.05,.35,1);}
 52% {transform:scale(1.2) rotateY(-19deg) rotateX(8deg) translateX(-158px) translateY(6px);}
 64% {transform:scale(1.24) rotateY(-17deg) rotateX(7.5deg) translateX(-146px);animation-timing-function:cubic-bezier(.55,.05,.35,1);}
 70% {transform:scale(1.3) rotateX(-10deg) rotateY(7deg) translateY(128px) translateX(-120px);}
 80% {transform:scale(1.33) rotateX(-9deg) rotateY(6deg) translateY(118px) translateX(-108px);animation-timing-function:cubic-bezier(.55,.05,.35,1);}
 88% {transform:scale(.8) rotateX(7deg) rotateY(-5deg) translateY(14px);}
 100%{transform:scale(.76) rotateX(7.5deg) rotateY(-4.5deg) translateY(18px);}
}
#ui-rig{animation:campath 14s cubic-bezier(.55,.05,.35,1) forwards;transform-origin:50% 44%;filter:drop-shadow(0 70px 130px rgba(5,10,70,.4));}
`;

const BODY_HTML = `
<div id="camera" style="perspective-origin:50% 45%;"><div id="ui-rig">

<div id="bg-gradient" style="position:absolute;inset:-25%;overflow:hidden;background:#FFFFFF;">
  <div style="position:absolute;width:1896px;height:1432px;left:372px;top:233px;filter:blur(66px);">
    <div style="position:absolute;width:1896px;height:1432px;left:0;top:0;background:#D6DBFF;border-radius:50%;filter:blur(2px);"></div>
    <div style="position:absolute;width:1596.3px;height:1205.65px;left:149.85px;top:113.18px;background:#7B8AFF;border-radius:50%;filter:blur(2px);"></div>
    <div style="position:absolute;width:1296.61px;height:963.57px;left:299.7px;top:234.21px;background:#3B50EC;border-radius:50%;filter:blur(2px);"></div>
    <div style="position:absolute;width:1007.32px;height:748.22px;left:445.38px;top:342.67px;background:#0527BD;border-radius:50%;filter:blur(2px);"></div>
    <div style="position:absolute;width:830.41px;height:627.19px;left:532.79px;top:413.41px;background:#253EFF;border-radius:50%;filter:blur(2px);"></div>
    <div style="position:absolute;width:686.81px;height:518.73px;left:605.64px;top:468.43px;background:#000FE0;border-radius:50%;filter:blur(2px);"></div>
  </div>
</div>
<div id="particles"><span style="left:220px;top:260px;width:4px;height:4px;opacity:0.5;animation-delay:0s;"></span><span style="left:1500px;top:210px;width:3px;height:3px;opacity:0.4;animation-delay:2s;"></span><span style="left:360px;top:880px;width:5px;height:5px;opacity:0.35;animation-delay:4s;"></span><span style="left:1290px;top:950px;width:3px;height:3px;opacity:0.45;animation-delay:1s;"></span><span style="left:840px;top:120px;width:4px;height:4px;opacity:0.4;animation-delay:3s;"></span><span style="left:1620px;top:620px;width:4px;height:4px;opacity:0.3;animation-delay:5s;"></span><span style="left:140px;top:600px;width:3px;height:3px;opacity:0.4;animation-delay:6s;"></span></div>

<div id="timer">45:06</div>
<div id="countpill"><svg width="20" height="17" viewBox="0 0 24 20" fill="none" stroke="rgba(255,255,255,.36)" stroke-width="2"><circle cx="8" cy="6" r="3.4"/><path d="M2 18c0-3.6 2.8-6 6-6s6 2.4 6 6"/><circle cx="17" cy="7" r="2.6"/><path d="M15.5 12.4c2.8.2 5 2.4 5 5.6"/></svg><span>8</span></div>

<div id="frame-glass"></div>
<div id="glare"><i></i></div>
<div id="colL" class="col"></div><div id="colR" class="col"></div>
<div id="hsL" class="hstrip"></div><div id="hsR" class="hstrip"></div>
<span class="lbl24" style="left:188px;top:143px;">Live Transcript</span>
<span class="lbl24" style="left:1256px;top:143px;">AI Tutor</span>
<div id="fmode"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3.2"/><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/></svg><span>Focus Mode</span></div>

<div id="tfeed"><div class="msg" id="msg0"><div class="prow"><span class="bav" style="background:linear-gradient(135deg,#9AB0E8,#5E77C9)"></span><span class="bwho">Prof. Rao</span><span class="bts">00:08</span></div><div class="bub peer">Alright &#8212; cache coherency. Two cores cache the same line. Who owns the truth?</div></div><div class="msg" id="msg1"><div class="prow"><span class="bav" style="background:linear-gradient(135deg,#9AB0E8,#5E77C9)"></span><span class="bwho">Prof. Rao</span><span class="bts">01:12</span></div><div class="bub peer">Four states: <b>M</b>odified, <b>E</b>xclusive, <b>S</b>hared, <b>I</b>nvalid. MESI.</div></div><div class="msg" id="msg2"><div class="prow"><span class="bav" style="background:linear-gradient(135deg,#799FE7,#4A6FB8)"></span><span class="bwho">Marcus</span><span class="bts">03:41</span></div><div class="bub peer">does MESI invalidate the Exclusive state on a remote <i>read</i>?</div></div><div class="msg" id="msg3"><div class="prow"><span class="bav" style="background:linear-gradient(135deg,#8E8BF0,#3B50EC)"></span><span class="bwho">Reggie</span><span class="bts">03:44</span></div><div class="bub reg">Close &#8212; a remote read moves E &#8594; S. Invalidation happens on a remote <b>write</b>. Adding it to the board.</div></div><div class="msg" id="msg4"><div class="bub you">so Modified means the line is dirty?<span class="bts">07:02</span></div></div><div class="msg" id="msg5"><div class="prow"><span class="bav" style="background:linear-gradient(135deg,#9AB0E8,#5E77C9)"></span><span class="bwho">Prof. Rao</span><span class="bts">07:15</span></div><div class="bub peer">Exactly &#8212; memory is stale, that core must write back before anyone else reads.</div></div><div class="msg" id="msg6"><div class="prow"><span class="bav" style="background:linear-gradient(135deg,#8E8BF0,#3B50EC)"></span><span class="bwho">Reggie</span><span class="bts">16:20</span></div><div class="bub reg">State diagram is on the board &#8212; E&#8594;S and the invalidate path are the two people miss.</div></div><div class="msg" id="msg7"><div class="prow"><span class="bav" style="background:linear-gradient(135deg,#F4CE63,#C9A33A)"></span><span class="bwho">Wei</span><span class="bts">29:30</span></div><div class="bub peer">walking through the transition table now, watch the board</div></div><div class="msg" id="msg8"><div class="prow"><span class="bav" style="background:linear-gradient(135deg,#8E8BF0,#3B50EC)"></span><span class="bwho">Reggie</span><span class="bts">37:58</span></div><div class="bub reg">Quiz on the invalidate path is ready &#8212; 3 questions, 90 seconds.</div></div><div class="msg" id="msg9"><div class="prow"><span class="bav" style="background:linear-gradient(135deg,#8E8BF0,#3B50EC)"></span><span class="bwho">Reggie</span><span class="bts">44:41</span></div><div class="bub reg">Session summary saved. Weak spots: remote-write invalidation, write-back timing. Flashcards are in your deck.</div></div>
  <div id="aicard"><div class="sA"><div class="h">&#10022; REGGIE &middot; SUMMARY &middot; LIVE</div><div class="b">&#8226; E &#8594; S on remote read &#8212; no invalidation<br>&#8226; Invalidate fires on remote <b>write</b></div></div>
  <div class="sB"><div class="h">&#10022; REGGIE &middot; QUIZ &middot; 3/3</div><div class="b">&#8226; Invalidate path &#8212; <b>correct</b><br>&#8226; Write-back timing &#8212; review tonight</div></div>
  <div class="sC"><div class="h">&#10022; REGGIE &middot; SESSION COMPLETE</div><div class="b">&#8226; 45 min &middot; 4 concepts covered<br>&#8226; Flashcards + summary in your deck</div></div></div>
</div>
<div id="typing">&#10022; Reggie is typing <span style="letter-spacing:2px;">&middot;&middot;&middot;</span></div>

<div class="qpill" style="left:90px;"><svg width="17" height="17" viewBox="0 0 24 24" fill="rgba(255,255,255,0.36)"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.7 1.4 5 3.6 6.6L5 21.5l4.3-2c.9.2 1.8.3 2.7.3 5.5 0 10-3.9 10-8.7S17.5 3 12 3z"/></svg>Chat</div>
<div class="qpill" style="left:202.88px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.36)" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h8M12 4v16"/></svg>Board</div>
<div class="qpill" style="left:314.76px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(255,255,255,0.36)"><path d="M4 10v4h2v-4H4zm4-3v10h2V7H8zm4-4v18h2V3h-2zm4 6v6h2V9h-2z"/></svg>Voice</div>
<div class="qpill" style="left:427.63px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.36)" stroke-width="2"><circle cx="10" cy="7" r="3.4"/><path d="M4 20c0-3.4 2.7-5.6 6-5.6s6 2.2 6 5.6M19 8v6M22 11h-6"/></svg>Invite</div>

<div id="wb"><svg width="581" height="622" viewBox="0 0 581 622" style="position:absolute;inset:0;"><defs><marker id="ar" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9" fill="none" stroke="#2B3674" stroke-width="1.6"/></marker></defs><g opacity=".35"><circle cx="30" cy="30" r="1" fill="#C9CEE8"/><circle cx="30" cy="72" r="1" fill="#C9CEE8"/><circle cx="30" cy="114" r="1" fill="#C9CEE8"/><circle cx="30" cy="156" r="1" fill="#C9CEE8"/><circle cx="30" cy="198" r="1" fill="#C9CEE8"/><circle cx="30" cy="240" r="1" fill="#C9CEE8"/><circle cx="30" cy="282" r="1" fill="#C9CEE8"/><circle cx="30" cy="324" r="1" fill="#C9CEE8"/><circle cx="30" cy="366" r="1" fill="#C9CEE8"/><circle cx="30" cy="408" r="1" fill="#C9CEE8"/><circle cx="30" cy="450" r="1" fill="#C9CEE8"/><circle cx="30" cy="492" r="1" fill="#C9CEE8"/><circle cx="30" cy="534" r="1" fill="#C9CEE8"/><circle cx="30" cy="576" r="1" fill="#C9CEE8"/><circle cx="30" cy="618" r="1" fill="#C9CEE8"/><circle cx="72" cy="30" r="1" fill="#C9CEE8"/><circle cx="72" cy="72" r="1" fill="#C9CEE8"/><circle cx="72" cy="114" r="1" fill="#C9CEE8"/><circle cx="72" cy="156" r="1" fill="#C9CEE8"/><circle cx="72" cy="198" r="1" fill="#C9CEE8"/><circle cx="72" cy="240" r="1" fill="#C9CEE8"/><circle cx="72" cy="282" r="1" fill="#C9CEE8"/><circle cx="72" cy="324" r="1" fill="#C9CEE8"/><circle cx="72" cy="366" r="1" fill="#C9CEE8"/><circle cx="72" cy="408" r="1" fill="#C9CEE8"/><circle cx="72" cy="450" r="1" fill="#C9CEE8"/><circle cx="72" cy="492" r="1" fill="#C9CEE8"/><circle cx="72" cy="534" r="1" fill="#C9CEE8"/><circle cx="72" cy="576" r="1" fill="#C9CEE8"/><circle cx="72" cy="618" r="1" fill="#C9CEE8"/><circle cx="114" cy="30" r="1" fill="#C9CEE8"/><circle cx="114" cy="72" r="1" fill="#C9CEE8"/><circle cx="114" cy="114" r="1" fill="#C9CEE8"/><circle cx="114" cy="156" r="1" fill="#C9CEE8"/><circle cx="114" cy="198" r="1" fill="#C9CEE8"/><circle cx="114" cy="240" r="1" fill="#C9CEE8"/><circle cx="114" cy="282" r="1" fill="#C9CEE8"/><circle cx="114" cy="324" r="1" fill="#C9CEE8"/><circle cx="114" cy="366" r="1" fill="#C9CEE8"/><circle cx="114" cy="408" r="1" fill="#C9CEE8"/><circle cx="114" cy="450" r="1" fill="#C9CEE8"/><circle cx="114" cy="492" r="1" fill="#C9CEE8"/><circle cx="114" cy="534" r="1" fill="#C9CEE8"/><circle cx="114" cy="576" r="1" fill="#C9CEE8"/><circle cx="114" cy="618" r="1" fill="#C9CEE8"/><circle cx="156" cy="30" r="1" fill="#C9CEE8"/><circle cx="156" cy="72" r="1" fill="#C9CEE8"/><circle cx="156" cy="114" r="1" fill="#C9CEE8"/><circle cx="156" cy="156" r="1" fill="#C9CEE8"/><circle cx="156" cy="198" r="1" fill="#C9CEE8"/><circle cx="156" cy="240" r="1" fill="#C9CEE8"/><circle cx="156" cy="282" r="1" fill="#C9CEE8"/><circle cx="156" cy="324" r="1" fill="#C9CEE8"/><circle cx="156" cy="366" r="1" fill="#C9CEE8"/><circle cx="156" cy="408" r="1" fill="#C9CEE8"/><circle cx="156" cy="450" r="1" fill="#C9CEE8"/><circle cx="156" cy="492" r="1" fill="#C9CEE8"/><circle cx="156" cy="534" r="1" fill="#C9CEE8"/><circle cx="156" cy="576" r="1" fill="#C9CEE8"/><circle cx="156" cy="618" r="1" fill="#C9CEE8"/><circle cx="198" cy="30" r="1" fill="#C9CEE8"/><circle cx="198" cy="72" r="1" fill="#C9CEE8"/><circle cx="198" cy="114" r="1" fill="#C9CEE8"/><circle cx="198" cy="156" r="1" fill="#C9CEE8"/><circle cx="198" cy="198" r="1" fill="#C9CEE8"/><circle cx="198" cy="240" r="1" fill="#C9CEE8"/><circle cx="198" cy="282" r="1" fill="#C9CEE8"/><circle cx="198" cy="324" r="1" fill="#C9CEE8"/><circle cx="198" cy="366" r="1" fill="#C9CEE8"/><circle cx="198" cy="408" r="1" fill="#C9CEE8"/><circle cx="198" cy="450" r="1" fill="#C9CEE8"/><circle cx="198" cy="492" r="1" fill="#C9CEE8"/><circle cx="198" cy="534" r="1" fill="#C9CEE8"/><circle cx="198" cy="576" r="1" fill="#C9CEE8"/><circle cx="198" cy="618" r="1" fill="#C9CEE8"/><circle cx="240" cy="30" r="1" fill="#C9CEE8"/><circle cx="240" cy="72" r="1" fill="#C9CEE8"/><circle cx="240" cy="114" r="1" fill="#C9CEE8"/><circle cx="240" cy="156" r="1" fill="#C9CEE8"/><circle cx="240" cy="198" r="1" fill="#C9CEE8"/><circle cx="240" cy="240" r="1" fill="#C9CEE8"/><circle cx="240" cy="282" r="1" fill="#C9CEE8"/><circle cx="240" cy="324" r="1" fill="#C9CEE8"/><circle cx="240" cy="366" r="1" fill="#C9CEE8"/><circle cx="240" cy="408" r="1" fill="#C9CEE8"/><circle cx="240" cy="450" r="1" fill="#C9CEE8"/><circle cx="240" cy="492" r="1" fill="#C9CEE8"/><circle cx="240" cy="534" r="1" fill="#C9CEE8"/><circle cx="240" cy="576" r="1" fill="#C9CEE8"/><circle cx="240" cy="618" r="1" fill="#C9CEE8"/><circle cx="282" cy="30" r="1" fill="#C9CEE8"/><circle cx="282" cy="72" r="1" fill="#C9CEE8"/><circle cx="282" cy="114" r="1" fill="#C9CEE8"/><circle cx="282" cy="156" r="1" fill="#C9CEE8"/><circle cx="282" cy="198" r="1" fill="#C9CEE8"/><circle cx="282" cy="240" r="1" fill="#C9CEE8"/><circle cx="282" cy="282" r="1" fill="#C9CEE8"/><circle cx="282" cy="324" r="1" fill="#C9CEE8"/><circle cx="282" cy="366" r="1" fill="#C9CEE8"/><circle cx="282" cy="408" r="1" fill="#C9CEE8"/><circle cx="282" cy="450" r="1" fill="#C9CEE8"/><circle cx="282" cy="492" r="1" fill="#C9CEE8"/><circle cx="282" cy="534" r="1" fill="#C9CEE8"/><circle cx="282" cy="576" r="1" fill="#C9CEE8"/><circle cx="282" cy="618" r="1" fill="#C9CEE8"/><circle cx="324" cy="30" r="1" fill="#C9CEE8"/><circle cx="324" cy="72" r="1" fill="#C9CEE8"/><circle cx="324" cy="114" r="1" fill="#C9CEE8"/><circle cx="324" cy="156" r="1" fill="#C9CEE8"/><circle cx="324" cy="198" r="1" fill="#C9CEE8"/><circle cx="324" cy="240" r="1" fill="#C9CEE8"/><circle cx="324" cy="282" r="1" fill="#C9CEE8"/><circle cx="324" cy="324" r="1" fill="#C9CEE8"/><circle cx="324" cy="366" r="1" fill="#C9CEE8"/><circle cx="324" cy="408" r="1" fill="#C9CEE8"/><circle cx="324" cy="450" r="1" fill="#C9CEE8"/><circle cx="324" cy="492" r="1" fill="#C9CEE8"/><circle cx="324" cy="534" r="1" fill="#C9CEE8"/><circle cx="324" cy="576" r="1" fill="#C9CEE8"/><circle cx="324" cy="618" r="1" fill="#C9CEE8"/><circle cx="366" cy="30" r="1" fill="#C9CEE8"/><circle cx="366" cy="72" r="1" fill="#C9CEE8"/><circle cx="366" cy="114" r="1" fill="#C9CEE8"/><circle cx="366" cy="156" r="1" fill="#C9CEE8"/><circle cx="366" cy="198" r="1" fill="#C9CEE8"/><circle cx="366" cy="240" r="1" fill="#C9CEE8"/><circle cx="366" cy="282" r="1" fill="#C9CEE8"/><circle cx="366" cy="324" r="1" fill="#C9CEE8"/><circle cx="366" cy="366" r="1" fill="#C9CEE8"/><circle cx="366" cy="408" r="1" fill="#C9CEE8"/><circle cx="366" cy="450" r="1" fill="#C9CEE8"/><circle cx="366" cy="492" r="1" fill="#C9CEE8"/><circle cx="366" cy="534" r="1" fill="#C9CEE8"/><circle cx="366" cy="576" r="1" fill="#C9CEE8"/><circle cx="366" cy="618" r="1" fill="#C9CEE8"/><circle cx="408" cy="30" r="1" fill="#C9CEE8"/><circle cx="408" cy="72" r="1" fill="#C9CEE8"/><circle cx="408" cy="114" r="1" fill="#C9CEE8"/><circle cx="408" cy="156" r="1" fill="#C9CEE8"/><circle cx="408" cy="198" r="1" fill="#C9CEE8"/><circle cx="408" cy="240" r="1" fill="#C9CEE8"/><circle cx="408" cy="282" r="1" fill="#C9CEE8"/><circle cx="408" cy="324" r="1" fill="#C9CEE8"/><circle cx="408" cy="366" r="1" fill="#C9CEE8"/><circle cx="408" cy="408" r="1" fill="#C9CEE8"/><circle cx="408" cy="450" r="1" fill="#C9CEE8"/><circle cx="408" cy="492" r="1" fill="#C9CEE8"/><circle cx="408" cy="534" r="1" fill="#C9CEE8"/><circle cx="408" cy="576" r="1" fill="#C9CEE8"/><circle cx="408" cy="618" r="1" fill="#C9CEE8"/><circle cx="450" cy="30" r="1" fill="#C9CEE8"/><circle cx="450" cy="72" r="1" fill="#C9CEE8"/><circle cx="450" cy="114" r="1" fill="#C9CEE8"/><circle cx="450" cy="156" r="1" fill="#C9CEE8"/><circle cx="450" cy="198" r="1" fill="#C9CEE8"/><circle cx="450" cy="240" r="1" fill="#C9CEE8"/><circle cx="450" cy="282" r="1" fill="#C9CEE8"/><circle cx="450" cy="324" r="1" fill="#C9CEE8"/><circle cx="450" cy="366" r="1" fill="#C9CEE8"/><circle cx="450" cy="408" r="1" fill="#C9CEE8"/><circle cx="450" cy="450" r="1" fill="#C9CEE8"/><circle cx="450" cy="492" r="1" fill="#C9CEE8"/><circle cx="450" cy="534" r="1" fill="#C9CEE8"/><circle cx="450" cy="576" r="1" fill="#C9CEE8"/><circle cx="450" cy="618" r="1" fill="#C9CEE8"/><circle cx="492" cy="30" r="1" fill="#C9CEE8"/><circle cx="492" cy="72" r="1" fill="#C9CEE8"/><circle cx="492" cy="114" r="1" fill="#C9CEE8"/><circle cx="492" cy="156" r="1" fill="#C9CEE8"/><circle cx="492" cy="198" r="1" fill="#C9CEE8"/><circle cx="492" cy="240" r="1" fill="#C9CEE8"/><circle cx="492" cy="282" r="1" fill="#C9CEE8"/><circle cx="492" cy="324" r="1" fill="#C9CEE8"/><circle cx="492" cy="366" r="1" fill="#C9CEE8"/><circle cx="492" cy="408" r="1" fill="#C9CEE8"/><circle cx="492" cy="450" r="1" fill="#C9CEE8"/><circle cx="492" cy="492" r="1" fill="#C9CEE8"/><circle cx="492" cy="534" r="1" fill="#C9CEE8"/><circle cx="492" cy="576" r="1" fill="#C9CEE8"/><circle cx="492" cy="618" r="1" fill="#C9CEE8"/><circle cx="534" cy="30" r="1" fill="#C9CEE8"/><circle cx="534" cy="72" r="1" fill="#C9CEE8"/><circle cx="534" cy="114" r="1" fill="#C9CEE8"/><circle cx="534" cy="156" r="1" fill="#C9CEE8"/><circle cx="534" cy="198" r="1" fill="#C9CEE8"/><circle cx="534" cy="240" r="1" fill="#C9CEE8"/><circle cx="534" cy="282" r="1" fill="#C9CEE8"/><circle cx="534" cy="324" r="1" fill="#C9CEE8"/><circle cx="534" cy="366" r="1" fill="#C9CEE8"/><circle cx="534" cy="408" r="1" fill="#C9CEE8"/><circle cx="534" cy="450" r="1" fill="#C9CEE8"/><circle cx="534" cy="492" r="1" fill="#C9CEE8"/><circle cx="534" cy="534" r="1" fill="#C9CEE8"/><circle cx="534" cy="576" r="1" fill="#C9CEE8"/><circle cx="534" cy="618" r="1" fill="#C9CEE8"/><circle cx="576" cy="30" r="1" fill="#C9CEE8"/><circle cx="576" cy="72" r="1" fill="#C9CEE8"/><circle cx="576" cy="114" r="1" fill="#C9CEE8"/><circle cx="576" cy="156" r="1" fill="#C9CEE8"/><circle cx="576" cy="198" r="1" fill="#C9CEE8"/><circle cx="576" cy="240" r="1" fill="#C9CEE8"/><circle cx="576" cy="282" r="1" fill="#C9CEE8"/><circle cx="576" cy="324" r="1" fill="#C9CEE8"/><circle cx="576" cy="366" r="1" fill="#C9CEE8"/><circle cx="576" cy="408" r="1" fill="#C9CEE8"/><circle cx="576" cy="450" r="1" fill="#C9CEE8"/><circle cx="576" cy="492" r="1" fill="#C9CEE8"/><circle cx="576" cy="534" r="1" fill="#C9CEE8"/><circle cx="576" cy="576" r="1" fill="#C9CEE8"/><circle cx="576" cy="618" r="1" fill="#C9CEE8"/></g><g id="wb-title" class="el"><text class="fade" x="44" y="62" font-size="25" font-weight="700" fill="#2B3674" font-family="Segoe Print,Bradley Hand,cursive" transform="rotate(-1.2 44 62)">MESI Cache Coherency</text><path pathLength="1" class="stroke" d="M42 74 C 158 82, 296 78, 396 72" fill="none" stroke="#3B50EC" stroke-width="2.4" opacity=".55" stroke-linecap="round"/></g><g id="wb-M" class="el"><ellipse pathLength="1" class="stroke" cx="162" cy="198" rx="46" ry="43" fill="none" stroke="#D6453C" stroke-width="3" transform="rotate(-2 162 198)" stroke-linecap="round"/><text class="fade" x="162" y="209" text-anchor="middle" font-size="33" font-weight="700" fill="#D6453C" font-family="Segoe Print,Bradley Hand,cursive">M</text></g><g id="wb-E" class="el"><ellipse pathLength="1" class="stroke" cx="424" cy="198" rx="46" ry="43" fill="none" stroke="#3B50EC" stroke-width="3" transform="rotate(-2 424 198)" stroke-linecap="round"/><text class="fade" x="424" y="209" text-anchor="middle" font-size="33" font-weight="700" fill="#3B50EC" font-family="Segoe Print,Bradley Hand,cursive">E</text></g><g id="wb-S" class="el"><ellipse pathLength="1" class="stroke" cx="424" cy="424" rx="46" ry="43" fill="none" stroke="#2E9E5B" stroke-width="3" transform="rotate(-2 424 424)" stroke-linecap="round"/><text class="fade" x="424" y="435" text-anchor="middle" font-size="33" font-weight="700" fill="#2E9E5B" font-family="Segoe Print,Bradley Hand,cursive">S</text></g><g id="wb-I" class="el"><ellipse pathLength="1" class="stroke" cx="162" cy="424" rx="46" ry="43" fill="none" stroke="#8A8FA8" stroke-width="3" transform="rotate(-2 162 424)" stroke-linecap="round"/><text class="fade" x="162" y="435" text-anchor="middle" font-size="33" font-weight="700" fill="#8A8FA8" font-family="Segoe Print,Bradley Hand,cursive">I</text></g><g id="wb-rread" class="el"><path pathLength="1" class="stroke" d="M378 216 C 326 254, 296 296, 402 384" fill="none" stroke="#2B3674" stroke-width="2.2" marker-end="url(#ar)" stroke-linecap="round"/><text class="fade" x="284" y="296" font-size="14" fill="#2B3674" font-family="Segoe Print,cursive" transform="rotate(-3 284 296)">remote read</text></g><g id="wb-lwrite" class="el"><path pathLength="1" class="stroke" d="M208 198 L 376 198" fill="none" stroke="#2B3674" stroke-width="2" marker-end="url(#ar)" opacity=".8"/><text class="fade" x="248" y="186" font-size="13" fill="#2B3674" font-family="Segoe Print,cursive">local write</text></g><g id="wb-inval" class="el"><rect class="fade" x="208" y="478" width="176" height="26" rx="4" fill="#FFE97A" opacity=".55"/><path pathLength="1" class="stroke" d="M378 424 L 212 424" fill="none" stroke="#D6453C" stroke-width="2.2" marker-end="url(#ar)" stroke-linecap="round"/><text class="fade" x="218" y="497" font-size="14" fill="#B03A31" font-family="Segoe Print,cursive">remote WRITE &#8594; invalidate</text></g><g id="wb-eq" class="el"><rect pathLength="1" class="stroke" x="42" y="528" width="236" height="52" rx="8" fill="none" stroke="#2B3674" stroke-width="2" transform="rotate(-.6 42 528)"/><text class="fade" x="56" y="560" font-size="15" fill="#2B3674" font-family="Segoe Print,cursive">M evict &#8658; write-back first!</text></g><g id="wb-moesi" class="el"><ellipse pathLength="1" class="stroke" cx="494" cy="532" rx="52" ry="30" fill="none" stroke="#7A5CC9" stroke-width="2.4" transform="rotate(3 494 532)"/><text class="fade" x="494" y="538" text-anchor="middle" font-size="16" fill="#7A5CC9" font-family="Segoe Print,cursive">MOESI?</text><path pathLength="1" class="stroke" d="M466 462 C 474 487, 480 497, 486 504" fill="none" stroke="#7A5CC9" stroke-width="2" stroke-dasharray="5 5"/></g></svg>
  <div class="sticky" id="stickyY" style="right:24px;top:96px;"><b>invalidate &#8800; update!</b><br>other copies just die</div>
  <div class="sticky pink" id="stickyP" style="left:22px;top:296px;">quiz: E &#8594; ? on a remote read</div>
  <div class="cursor" id="cursorWei"><svg width="17" height="20" viewBox="0 0 17 20"><path d="M1 1 L1 15 L5.4 11.4 L8.2 18 L11 16.8 L8.2 10.4 L14 10.2 Z" fill="#C9A33A" stroke="#fff" stroke-width="1.4"/></svg><span class="tag">Wei</span></div>
</div>

<div id="toolbar"><svg width="24" height="24" viewBox="0 0 24 24" fill="rgba(255,255,255,0.36)"><path d="M3 17.2V21h3.8L17.9 9.9l-3.8-3.8L3 17.2zM20.7 7.1c.4-.4.4-1 0-1.4l-2.4-2.4c-.4-.4-1-.4-1.4 0l-1.8 1.8 3.8 3.8 1.8-1.8z"/></svg><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.36)" stroke-width="2.4"><path d="M20 20H8L3 15l9.5-9.5a2 2 0 0 1 2.8 0L20 10.2a2 2 0 0 1 0 2.8L14.5 18.5"/></svg><svg width="23" height="24" viewBox="0 0 24 24" fill="rgba(255,255,255,0.36)"><path d="M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2z"/></svg><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.36)" stroke-width="2.4"><path d="M4 14h6v6M20 10h-6V4"/></svg></div>

<div class="vtile big" id="tYou" style="left:1253px;top:200px;width:297.71px;height:190px;"><div class="mono" style="background:linear-gradient(135deg,#6E7FF3,#3B50EC);width:64px;height:64px;font-size:24px;">Y</div><div class="tname" style="height:49.57px;"><span>You</span><span class="tic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><svg width="15" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2"><rect x="2" y="6" width="13" height="12" rx="3"/><path d="M15 10l7-4v12l-7-4z"/></svg><span class="tbars off"><i></i><i></i><i></i><i></i></span></span></div></div>
<div class="vtile big" id="tileWeiP" style="left:1253px;top:200px;width:297.71px;height:190px;opacity:0;transition:opacity 1s cubic-bezier(.22,1,.36,1);z-index:3;box-shadow:0 0 0 2.5px rgba(140,255,190,.8),0 24px 50px rgba(20,30,110,.3);">
  <div class="mono" style="background:linear-gradient(135deg,#F4CE63,#C9A33A);width:64px;height:64px;font-size:24px;">W</div>
  <div style="position:absolute;left:12px;top:10px;font-size:10px;font-weight:700;letter-spacing:.6px;color:#fff;background:rgba(23,23,23,.35);padding:4px 9px;border-radius:10px;">PRESENTING</div>
  <div class="tname" style="height:49.57px;"><span>Wei</span><span class="tic"><span class="tbars"><i></i><i></i><i></i><i></i></span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><svg width="15" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2"><rect x="2" y="6" width="13" height="12" rx="3"/><path d="M15 10l7-4v12l-7-4z"/></svg></span></div>
</div>
<div class="vtile" id="tEmma" style="left:1213px;top:403px;width:187.61px;height:186.17px;"><div class="mono" style="background:linear-gradient(135deg,#F4ABAB,#D97B7B);width:54px;height:54px;font-size:20px;">E</div><div class="tname" style="height:48.57px;"><span>Emma</span><span class="tic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><svg width="15" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2"><rect x="2" y="6" width="13" height="12" rx="3"/><path d="M15 10l7-4v12l-7-4z"/></svg><span class="tbars off"><i></i><i></i><i></i><i></i></span></span></div><div class="ghostlay"><div class="gring"></div>Connecting...</div></div>
<div class="vtile" id="tMarcus" style="left:1408px;top:402px;width:187.61px;height:186.17px;"><div class="mono" style="background:linear-gradient(135deg,#799FE7,#4A6FB8);width:54px;height:54px;font-size:20px;">M</div><div class="tname" style="height:48.57px;"><span>Marcus</span><span class="tic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><svg width="15" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2"><rect x="2" y="6" width="13" height="12" rx="3"/><path d="M15 10l7-4v12l-7-4z"/></svg><span class="tbars off"><i></i><i></i><i></i><i></i></span></span></div><div class="ghostlay"><div class="gring"></div>Connecting...</div></div>
<div class="vtile" id="tWei" style="left:1214.39px;top:608.83px;width:187.61px;height:186.17px;"><div class="mono" style="background:linear-gradient(135deg,#F4CE63,#C9A33A);width:54px;height:54px;font-size:20px;">W</div><div class="tname" style="height:48.57px;"><span>Wei</span><span class="tic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><svg width="15" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2"><rect x="2" y="6" width="13" height="12" rx="3"/><path d="M15 10l7-4v12l-7-4z"/></svg><span class="tbars off"><i></i><i></i><i></i><i></i></span></span></div><div class="ghostlay"><div class="gring"></div>Connecting...</div></div>
<div class="vtile" id="tSarah" style="left:1409.39px;top:607.83px;width:187.61px;height:186.17px;"><div class="mono" style="background:linear-gradient(135deg,#F17AC4,#C05295);width:54px;height:54px;font-size:20px;">S</div><div class="tname" style="height:48.57px;"><span>Sarah</span><span class="tic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><svg width="15" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2"><rect x="2" y="6" width="13" height="12" rx="3"/><path d="M15 10l7-4v12l-7-4z"/></svg><span class="tbars off"><i></i><i></i><i></i><i></i></span></span></div><div class="ghostlay"><div class="gring"></div>Connecting...</div></div>

<div id="callbtn"><span class="ph"><svg width="22" height="22" viewBox="0 0 24 24" fill="#19582C"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.4.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg></span>Call Reggie</div>
<div id="endbtn">End session</div>

<div id="notifs">
<div class="notif" id="nCanvas"><span style="font-size:15px;">&#9729;&#65039;</span>Canvas synced.</div>
<div class="notif" id="nLecture"><span style="font-size:15px;">&#127897;&#65039;</span>Lecture detected.</div>
<div class="notif" id="nWeak"><span style="font-size:15px;">&#10022;</span>Reggie found 4 weak concepts</div>
<div class="notif" id="nCards"><span style="font-size:15px;">&#127183;</span>Flashcards generating...</div>
<div class="notif" id="nQuiz"><span style="font-size:15px;">&#9201;&#65039;</span>Quiz starting in 10 seconds</div>
<div class="notif" id="nEmmaQ"><span style="font-size:15px;">&#9989;</span>Emma finished Quiz 2</div>
<div class="notif" id="nReady"><span style="font-size:15px;">&#127183;</span>Flashcards ready</div>
<div class="notif" id="nStreak"><span style="font-size:15px;">&#128293;</span>Study streak +1 &#8212; day 12</div>
<div class="notif" id="nBrain"><span style="font-size:15px;">&#129504;</span>Summary saved to your brain</div>
</div>
<span class="react" id="r1" style="left:1245px;top:585px;">&#10024;</span>
<span class="react" id="r2" style="left:1230px;top:590px;">&#128077;</span>
<span class="react" id="r3" style="left:1560px;top:440px;">&#128293;</span>
<span class="react" id="r4" style="left:1250px;top:585px;">&#128079;</span>
</div>
<div id="grade-vignette"></div><div id="grade-light"></div></div>
`;

const SFONT = '-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Arial,sans-serif';

export default function StudyRoomHeroAnimation() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // vpScale is driven by the stage container width, not the viewport
  const [vpScale, setVpScale] = useState<number>(() => {
    if (typeof window === 'undefined') return 0.82;
    const w = Math.min(window.innerWidth - 96, 1500);
    return w > 0 ? w / DESIGN_W : 0.82;
  });
  const [entered, setEntered] = useState(false);

  // Inject animation CSS into <head> — avoids React 18 concurrent-mode <style> warnings
  useEffect(() => {
    const el = document.createElement('style');
    el.setAttribute('data-srha', '1');
    el.textContent = ANIMATION_CSS;
    document.head.appendChild(el);
    return () => { document.head.removeChild(el); };
  }, []);

  // ResizeObserver — recompute scale whenever stage width changes
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setVpScale(w / DESIGN_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Entry animation — fires once when the stage scrolls into view
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setEntered(true); obs.disconnect(); } },
      { threshold: 0.04 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Self-playing RAF product film — runs automatically, no scroll interaction
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const $ = (id: string): HTMLElement | null => root.querySelector('#' + id);
    const T: [number, () => void][] = [];
    const at = (t: number, fn: () => void) => { T.push([t * 1000, fn]); };

    const msg = (i: number) => {
      const m = $('msg' + i);
      if (!m) return;
      m.classList.add('in');
      const f = $('tfeed');
      if (f) f.scrollTop = f.scrollHeight;
    };
    const wb = (id: string) => { const el = $(id); if (el) el.classList.add('on'); };
    const nf = (id: string, a: number, b: number) => {
      at(a, () => { const el = $(id); if (el) el.classList.add('in'); });
      at(b, () => { const el = $(id); if (el) { el.classList.remove('in'); el.classList.add('out'); } });
    };

    at(0.56, () => msg(0)); at(2.24, () => msg(1)); at(3.92, () => msg(2));
    at(4.26, () => { const el = $('typing'); if (el) el.classList.add('in'); });
    at(4.59, () => { const el = $('typing'); if (el) el.classList.remove('in'); msg(3); });
    at(6.16, () => msg(4)); at(6.58, () => msg(5)); at(8.4, () => msg(6));
    at(9.52, () => msg(7)); at(10.78, () => msg(8)); at(12.32, () => msg(9));

    at(1.82, () => wb('wb-title')); at(2.52, () => wb('wb-M')); at(2.94, () => wb('wb-E'));
    at(4.9, () => { wb('wb-S'); wb('wb-I'); });
    at(5.32, () => wb('wb-rread'));
    at(5.04, () => { const el = $('cursorWei'); if (el) el.classList.add('go'); });
    at(5.88, () => { const el = $('stickyY'); if (el) el.classList.add('in'); });
    at(7.56, () => wb('wb-lwrite'));
    at(7.98, () => wb('wb-inval'));
    at(9.66, () => { const el = $('stickyP'); if (el) el.classList.add('in'); });
    at(9.94, () => wb('wb-eq'));
    at(10.36, () => wb('wb-moesi'));

    at(0.84, () => {
      const em = $('tEmma');
      if (em) { em.classList.add('joined'); em.classList.add('speak'); }
    });
    at(3.36, () => { const el = $('tMarcus'); if (el) el.classList.add('joined'); });
    at(3.78, () => { const el = $('tWei'); if (el) el.classList.add('joined'); });
    at(6.3, () => { const el = $('tSarah'); if (el) el.classList.add('joined'); });
    at(8.68, () => { const el = $('tileWeiP'); if (el) el.style.opacity = '1'; });
    at(11.2, () => { const el = $('tileWeiP'); if (el) el.style.opacity = '0'; });
    at(11.48, () => { const el = $('tEmma'); if (el) el.classList.remove('speak'); });

    nf('nCanvas', 0.28, 1.54); nf('nLecture', 3.08, 4.2);
    nf('nWeak', 6.86, 8.26); nf('nCards', 7.14, 8.54);
    nf('nQuiz', 10.5, 11.48); nf('nEmmaQ', 11.62, 12.74);
    nf('nReady', 11.9, 12.88); nf('nStreak', 13.02, 15.0);
    nf('nBrain', 13.24, 15.0);

    at(7.28, () => { const el = $('aicard'); if (el) el.classList.add('in'); });
    at(11.2, () => { const el = $('aicard'); if (el) el.classList.add('q'); });
    at(13.02, () => { const el = $('aicard'); if (el) { el.classList.remove('q'); el.classList.add('done'); } });
    at(10.08, () => { const el = $('fmode'); if (el) el.classList.add('on'); });

    const pop = (id: string, t: number) => {
      at(t, () => { const el = $(id); if (el) el.classList.add('pop'); });
      at(t + 2.2, () => { const el = $(id); if (el) el.classList.add('gone'); });
    };
    pop('r1', 3.64); pop('r2', 8.96); pop('r3', 9.24); pop('r4', 11.7);

    const tick = (ms: number) => {
      const p = Math.min(ms / 14000, 1);
      const s = Math.round(12 + 2694 * p);
      const timerEl = $('timer');
      if (timerEl)
        timerEl.textContent =
          String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    };

    T.sort((a, b) => a[0] - b[0]);

    const CYCLE = 14700;
    let i0 = 0;
    let t0 = 0;
    let rafId = 0;
    let restartId = 0;
    let active = false;

    const startCycle = () => {
      // Re-inject BODY_HTML to reset ALL CSS animations (campath, etc.) and JS class state.
      // A simple class-scrub leaves CSS keyframe animations frozen at their final frame.
      root.innerHTML = '';
      void root.offsetWidth; // synchronous reflow clears CSS animation state
      root.innerHTML = BODY_HTML;
      i0 = 0;
      t0 = performance.now();
      rafId = requestAnimationFrame(loop);
    };

    const loop = () => {
      rafId = 0;
      if (!active) return;
      const elapsed = performance.now() - t0;
      while (i0 < T.length && T[i0][0] <= elapsed) { T[i0][1](); i0++; }
      tick(elapsed);
      if (elapsed < CYCLE) {
        rafId = requestAnimationFrame(loop);
      } else {
        // Cycle complete — 700ms pause, then restart
        restartId = window.setTimeout(() => {
          restartId = 0;
          if (active) startCycle();
        }, 700);
      }
    };

    // Pause when scrolled away, restart fresh when scrolled back in
    const vis = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (!active) { active = true; startCycle(); }
      } else {
        active = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        if (restartId) { clearTimeout(restartId); restartId = 0; }
      }
    }, { threshold: 0.05 });

    if (stageRef.current) vis.observe(stageRef.current);

    return () => {
      active = false;
      if (rafId) cancelAnimationFrame(rafId);
      if (restartId) clearTimeout(restartId);
      vis.disconnect();
    };
  }, []);

  const naturalH = Math.max(120, Math.round(DESIGN_H * vpScale));

  return (
    <section style={{
      background: '#ffffff',
      padding: 'clamp(56px,7vw,96px) clamp(16px,3vw,48px) clamp(64px,8vw,108px)',
      position: 'relative',
    }}>

      {/* Editorial heading */}
      <div style={{
        textAlign: 'center',
        marginBottom: 'clamp(28px,3.5vw,44px)',
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateY(0)' : 'translateY(16px)',
        transition: 'opacity 0.9s cubic-bezier(0.16,1,0.3,1), transform 0.9s cubic-bezier(0.16,1,0.3,1)',
      }}>
        <h2 style={{
          fontSize: 'clamp(26px,3.2vw,46px)', fontWeight: 600,
          letterSpacing: '-0.03em', lineHeight: 1.1,
          color: '#1d1d1f', margin: 0, fontFamily: SFONT,
        }}>
          Your study room.<br />Everyone&apos;s in sync.
        </h2>
        <p style={{
          fontSize: 'clamp(14px,1.4vw,17px)', color: '#6e6e73', lineHeight: 1.65,
          margin: 'clamp(10px,1.2vw,16px) auto 0', maxWidth: 460, fontFamily: SFONT,
        }}>
          AI-grounded notes, real-time collaboration, and a shared timer — one room, all moving together.
        </p>
      </div>

      {/* Floating premium stage */}
      <div
        ref={stageRef}
        style={{
          maxWidth: 1500, margin: '0 auto',
          height: naturalH, overflow: 'hidden',
          position: 'relative',
          borderRadius: 'clamp(20px,2.2vw,40px)',
          // Layered shadow: rim light + ambient depth
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.55),' +
            '0 0 0 1px rgba(0,0,0,0.055),' +
            '0 4px 16px rgba(0,0,0,0.05),' +
            '0 20px 60px rgba(8,12,70,0.09),' +
            '0 60px 130px rgba(8,12,70,0.12)',
          // Entry animation
          opacity: entered ? 1 : 0,
          transform: entered ? 'translateY(0) scale(1)' : 'translateY(36px) scale(0.97)',
          transition:
            'opacity 1.15s cubic-bezier(0.16,1,0.3,1),' +
            'transform 1.15s cubic-bezier(0.16,1,0.3,1)',
          transitionDelay: '0.08s',
          willChange: 'opacity,transform',
        }}
      >
        {/* Study room product film — scaled to stage width */}
        <div
          ref={containerRef}
          className="srha-inner"
          style={{
            width: DESIGN_W, height: DESIGN_H,
            transform: `scale(${vpScale})`, transformOrigin: '0 0',
            fontFamily: "'DM Sans', sans-serif",
            background: 'linear-gradient(160deg,#EDEFFB,#B9C2F5 55%,#8493EE)',
            WebkitFontSmoothing: 'antialiased',
          }}
          dangerouslySetInnerHTML={{ __html: BODY_HTML }}
        />

        {/* Edge vignette — subtle perimeter depth */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 200,
          borderRadius: 'inherit',
          background:
            'linear-gradient(90deg,rgba(8,12,70,0.06) 0%,transparent 12%,transparent 88%,rgba(8,12,70,0.06) 100%),' +
            'linear-gradient(180deg,rgba(8,12,70,0.025) 0%,transparent 9%,transparent 88%,rgba(8,12,70,0.07) 100%)',
        }} />
      </div>
    </section>
  );
}
