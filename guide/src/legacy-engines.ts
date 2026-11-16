// @ts-nocheck -- v1 engines kept verbatim as placeholder and reduced-motion/WebGL-failure fallback
/* Scroll-story engines. Each engine: mount(el), frame(u, t), destroy(). u runs 0..n-1 (lightest model first). */
function clamp(x,a,b){ return x<a?a:(x>b?b:x); }
function seg(u,a,b){ return clamp((u-a)/(b-a),0,1); }
function ease(x){ return x*x*(3-2*x); }
function rng(seed){ return function(){ seed|=0; seed=seed+0x6D2B79F5|0; var t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function f1(n){ return n.toFixed(1); }

/* ================= CLAUDE: 2D naturalist plates ================= */
var INK='#2b2620', PAPER='#efe5cf';
function hLines(x0,x1,y0,y1,step){ var d=''; for(var y=y0;y<=y1;y+=step){ d+='M'+f1(x0)+','+f1(y)+'H'+f1(x1); } return d; }
function dLines(x0,y0,x1,y1,step){ var d=''; for(var k=-(y1-y0);k<(x1-x0);k+=step){ d+='M'+f1(x0+k)+','+f1(y1)+'L'+f1(x0+k+(y1-y0))+','+f1(y0); } return d; }
function cloudPath(x0,cy,w,h){
  var pts=[[x0,cy],[x0+w*.18,cy-h*.34],[x0+w*.44,cy-h*.62],[x0+w*.72,cy-h*.4],[x0+w,cy]], d='M'+x0+','+cy;
  for(var i=1;i<pts.length;i++){ var a=pts[i-1],b=pts[i],r=Math.hypot(b[0]-a[0],b[1]-a[1])*0.62; d+=' A'+f1(r)+','+f1(r)+' 0 0 1 '+f1(b[0])+','+f1(b[1]); }
  return d+' Z';
}
var cid=0;
function cloud(x0,cy,w,h){
  var id='cc'+(++cid), d=cloudPath(x0,cy,w,h);
  return '<clipPath id="'+id+'"><path d="'+d+'"/></clipPath><path d="'+d+'" fill="#f8f2e4" stroke="'+INK+'" stroke-width="1.6"/>'
    +'<path clip-path="url(#'+id+')" d="'+hLines(x0,x0+w,cy-h*.22,cy,4.5)+'" stroke="'+INK+'" stroke-width=".9" opacity=".32"/>';
}
function swallow(cls, flap){
  var wc='w-flap'+(flap||'');
  return '<g class="'+(cls||'')+'">'
   +'<g class="'+wc+' far"><path d="M30,-16 C14,-80 -34,-150 -108,-196 C-58,-132 -18,-80 2,-12 Z" fill="#1d2430" stroke="'+INK+'" stroke-width="1.4"/></g>'
   +'<path d="M-58,-4 C-108,-12 -158,-34 -214,-70 C-172,-28 -128,-10 -86,4 C-130,22 -176,44 -220,78 C-162,56 -110,32 -58,14 Z" fill="#27303d" stroke="'+INK+'" stroke-width="1.4"/>'
   +'<path d="M-70,0 C-40,-26 40,-36 92,-24 C112,-19 126,-12 136,-6 C126,4 112,14 92,18 C40,30 -30,26 -70,10 Z" fill="#2c3644" stroke="'+INK+'" stroke-width="1.6"/>'
   +'<path d="M-40,9 C0,25 60,26 98,13 C82,26 30,33 -20,26 Z" fill="#f3e8d3"/>'
   +'<path d="M102,-13 C114,-7 122,-1 127,4 C118,13 104,15 95,12 C97,4 99,-4 102,-13Z" fill="#b5653f"/>'
   +'<path d="M-30,-2 C10,-14 50,-18 90,-14" stroke="#8c99a8" stroke-width="1" fill="none" opacity=".6"/>'
   +'<path d="M136,-6 L151,-2 L136,1 Z" fill="'+INK+'"/><circle cx="118" cy="-9" r="3.6" fill="#0e0f12"/><circle cx="119.2" cy="-10.2" r="1.1" fill="#fff"/>'
   +'<g class="'+wc+'"><path d="M40,-8 C70,-74 122,-142 206,-180 C156,-112 114,-50 72,4 Z" fill="#334055" stroke="'+INK+'" stroke-width="1.6"/>'
   +'<path d="M66,-24 L176,-160 M74,-14 L186,-138 M84,-6 L192,-112 M94,2 L180,-80" stroke="#9fb0c2" stroke-width="1" opacity=".55"/></g>'
   +'</g>';
}
function cursive(x0,x1,y,r){
  var d='M'+f1(x0)+','+f1(y), x=x0;
  while(x<x1-8){
    if(r()<0.13 && x>x0+30){ x+=12+r()*8; d+=' M'+f1(x)+','+f1(y); continue; }
    var w=6+r()*7, h=r()<0.18?20+r()*9:7+r()*9, xe=Math.min(x+w,x1);
    d+=' C'+f1(x+w*.1)+','+f1(y-h)+' '+f1(x+w*.95)+','+f1(y-h)+' '+f1(x+w*.55)+','+f1(y-2)+' S'+f1(xe+1)+','+f1(y+2)+' '+f1(xe)+','+f1(y);
    x=xe;
  }
  return d;
}
function stone(x,y,rx,ry,rot,fill,r){
  var s='<g transform="translate('+f1(x)+' '+f1(y)+') rotate('+f1(rot)+')"><ellipse rx="'+rx+'" ry="'+ry+'" fill="'+fill+'" stroke="'+INK+'" stroke-width="1.3"/>'
    +'<ellipse cx="'+f1(-rx*.25)+'" cy="'+f1(-ry*.35)+'" rx="'+f1(rx*.45)+'" ry="'+f1(ry*.28)+'" fill="#fff" opacity=".22"/>';
  var n=Math.round(rx*ry/45);
  for(var i=0;i<n;i++){ var a=r()*6.283, q=Math.sqrt(r())*0.86; s+='<circle cx="'+f1(Math.cos(a)*rx*q)+'" cy="'+f1(Math.sin(a)*ry*q)+'" r="'+f1(0.5+r()*1.7)+'" fill="#4a4036" opacity="'+f1(0.4+r()*0.5)+'"/>'; }
  return s+'</g>';
}
function lilyPad(x,y,rx,ry,rot){
  var notch=0.35;
  var a0=notch, a1=6.283-notch, p0=[Math.cos(a0)*rx,Math.sin(a0)*ry], p1=[Math.cos(a1)*rx,Math.sin(a1)*ry];
  var veins=''; for(var k=0;k<9;k++){ var a=notch+(6.283-2*notch)*(k+0.5)/9; veins+='M0,0L'+f1(Math.cos(a)*rx*.9)+','+f1(Math.sin(a)*ry*.9); }
  return '<g transform="translate('+x+' '+y+') rotate('+rot+')"><path d="M0,0 L'+f1(p0[0])+','+f1(p0[1])+' A'+rx+','+ry+' 0 1 1 '+f1(p1[0])+','+f1(p1[1])+' Z" fill="#7f9a5a" stroke="'+INK+'" stroke-width="1.4"/>'
    +'<path d="'+veins+'" stroke="#4f6236" stroke-width=".9" opacity=".7"/></g>';
}
function lily(x,y,s){
  var p='';
  for(var k=0;k<9;k++){ var a=-180+k*22.5; p+='<path transform="rotate('+a+')" d="M0,0 C8,-6 10,-26 0,-40 C-10,-26 -8,-6 0,0Z" fill="#ecbdb6" stroke="'+INK+'" stroke-width="1.1"/>'; }
  for(var k2=0;k2<6;k2++){ var a2=-150+k2*30; p+='<path transform="rotate('+a2+')" d="M0,0 C6,-5 7,-20 0,-30 C-7,-20 -6,-5 0,0Z" fill="#f6d7d1" stroke="'+INK+'" stroke-width="1"/>'; }
  return '<g transform="translate('+x+' '+y+') scale('+s+' '+(s*0.62)+')">'+p+'<circle r="7" fill="#e3b54a" stroke="'+INK+'" stroke-width="1"/></g>';
}
function frog(){
  return '<g id="c-frog">'
   +'<path d="M-30,6 C-46,8 -52,18 -40,22 L-18,20 Z M30,6 C46,8 52,18 40,22 L18,20 Z" fill="#7f9a5a" stroke="'+INK+'" stroke-width="1.3"/>'
   +'<path d="M-36,4 C-36,-24 -14,-38 4,-36 C26,-34 40,-20 38,4 C32,16 -28,16 -36,4Z" fill="#8fab62" stroke="'+INK+'" stroke-width="1.6"/>'
   +'<path d="M-18,8 C-8,14 10,14 20,8" fill="none" stroke="'+INK+'" stroke-width="1"/>'
   +'<ellipse cx="-2" cy="2" rx="16" ry="7" fill="#e8dfb8" opacity=".9"/>'
   +'<circle cx="-14" cy="-20" r="3.4" fill="#5d7340"/><circle cx="10" cy="-26" r="4" fill="#5d7340"/><circle cx="20" cy="-12" r="2.6" fill="#5d7340"/><circle cx="-24" cy="-6" r="2.8" fill="#5d7340"/>'
   +'<circle cx="-10" cy="-34" r="9" fill="#8fab62" stroke="'+INK+'" stroke-width="1.4"/><circle cx="14" cy="-34" r="9" fill="#8fab62" stroke="'+INK+'" stroke-width="1.4"/>'
   +'<circle cx="-10" cy="-34" r="4.6" fill="#1a1a14"/><circle cx="14" cy="-34" r="4.6" fill="#1a1a14"/><circle cx="-8.6" cy="-35.6" r="1.4" fill="#fff"/><circle cx="15.4" cy="-35.6" r="1.4" fill="#fff"/>'
   +'<path d="M-30,12 C-34,20 -40,24 -46,24 M30,12 C34,20 40,24 46,24" stroke="'+INK+'" stroke-width="1.6" fill="none"/>'
   +'</g>';
}
function butterfly(cls, c1, c2, c3, big){
  var fw='M-4,-6 C-30,-70 -110,-120 -170,-96 C-190,-60 -150,-18 -90,-2 C-50,6 -20,4 -4,-2 Z';
  var hw='M-4,2 C-40,10 -110,30 -128,70 C-134,96 -112,118 -90,110 L-80,150 C-68,128 -60,110 -52,96 C-30,70 -12,40 -4,8 Z';
  var veins = big ? '<path d="M-6,-4 L-160,-92 M-8,-2 L-176,-64 M-8,0 L-150,-26 M-10,2 L-104,-2 M-6,6 L-120,64 M-6,8 L-96,108 M-6,8 L-60,96" stroke="'+INK+'" stroke-width="1.1" opacity=".7"/>' : '';
  var margin = '<path d="M-170,-96 C-190,-60 -150,-18 -90,-2" fill="none" stroke="'+INK+'" stroke-width="'+(big?12:10)+'" opacity=".9"/>'
    +'<path d="M-128,70 C-134,96 -112,118 -90,110" fill="none" stroke="'+INK+'" stroke-width="'+(big?10:8)+'"/>';
  var spots = '<circle cx="-172" cy="-74" r="4" fill="#f4ead2"/><circle cx="-160" cy="-42" r="4" fill="#f4ead2"/><circle cx="-132" cy="-18" r="3.5" fill="#f4ead2"/>'
    +'<circle cx="-120" cy="86" r="5" fill="'+c2+'"/><circle cx="-104" cy="104" r="4.5" fill="'+c2+'"/>'
    +'<circle cx="-62" cy="88" r="9" fill="'+c3+'" stroke="'+INK+'" stroke-width="2.4"/><circle cx="-62" cy="88" r="3" fill="'+INK+'"/>';
  var side = '<path d="'+fw+'" fill="'+c1+'" stroke="'+INK+'" stroke-width="1.8"/><path d="'+hw+'" fill="'+c1+'" stroke="'+INK+'" stroke-width="1.8"/>'
    +'<path d="M-40,-40 C-70,-56 -100,-70 -130,-74" stroke="'+INK+'" stroke-width="'+(big?7:5)+'" fill="none" opacity=".75"/>'+margin+spots+veins;
  return '<g class="'+cls+'">'
    +'<g class="bw-l">'+side+'</g><g class="bw-r"><g transform="scale(-1,1)">'+side+'</g></g>'
    +'<ellipse cx="0" cy="8" rx="7" ry="40" fill="#2b2620"/><circle cx="0" cy="-34" r="8" fill="#2b2620"/>'
    +'<path d="M-3,-40 C-12,-70 -24,-90 -34,-96 M3,-40 C12,-70 24,-90 34,-96" stroke="'+INK+'" stroke-width="2" fill="none"/><circle cx="-34" cy="-96" r="3.5" fill="'+INK+'"/><circle cx="34" cy="-96" r="3.5" fill="'+INK+'"/>'
    +'</g>';
}
function grainURL(){
  try{
    var c=document.createElement('canvas'); c.width=c.height=220; var x=c.getContext('2d'), d=x.createImageData(220,220), r=rng(7);
    for(var i=0;i<d.data.length;i+=4){ var v=180+r()*75; d.data[i]=v; d.data[i+1]=v*0.96; d.data[i+2]=v*0.88; d.data[i+3]=r()<0.5?28:12; }
    x.putImageData(d,0,0); return c.toDataURL();
  }catch(e){ return ''; }
}

function Claude(){ this.el=null; }
Claude.prototype.mount=function(el){
  cid=0; var r=rng(11), i;
  var W={x:500,y:290}, P={x:500,y:800};
  this.W=W; this.P=P;
  var s='<svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">';
  s+='<rect x="-500" y="-500" width="2000" height="2000" fill="'+PAPER+'"/>';
  /* SKY */
  s+='<g id="c-sky"><ellipse cx="500" cy="400" rx="560" ry="330" fill="#9fb3c2" opacity=".2"/><ellipse cx="640" cy="260" rx="300" ry="160" fill="#d9a88f" opacity=".12"/>';
  s+='<g id="c-clouds">'+'<g>'+cloud(120,300,300,120)+'</g><g>'+cloud(600,190,260,100)+'</g><g>'+cloud(520,700,340,130)+'</g><g>'+cloud(-60,620,240,90)+'</g></g>';
  s+='<g id="c-flock">';
  var flock=[[700,250,.22,'a'],[760,300,.18,'b'],[640,320,.16,'b'],[820,230,.14,'a']];
  for(i=0;i<flock.length;i++){ s+='<g transform="translate('+flock[i][0]+' '+flock[i][1]+') scale('+flock[i][2]+')">'+swallow('', flock[i][3])+'</g>'; }
  s+='</g><g id="c-swallow">'+swallow('', '')+'</g></g>';
  /* ROOM */
  s+='<g id="c-room">';
  s+='<rect x="-900" y="-700" width="2800" height="1350" fill="#e7dbc1"/>';
  s+='<path d="'+(function(){var d='';for(var x=-900;x<1900;x+=44){d+='M'+x+',-700V650';}return d;})()+'" stroke="#c9b48f" stroke-width="10" opacity=".25"/>';
  s+='<path d="M334,500 L334,250 A166,166 0 0 1 666,250 L666,500 Z" fill="#7a5a3c" stroke="'+INK+'" stroke-width="2"/>';
  s+='<clipPath id="c-win"><path d="M360,474 L360,250 A140,140 0 0 1 640,250 L640,474 Z"/></clipPath>';
  s+='<g clip-path="url(#c-win)"><rect x="350" y="100" width="300" height="380" fill="#cfdbe0"/><ellipse cx="520" cy="300" rx="200" ry="120" fill="#e9d2c0" opacity=".45"/>'
    +'<g transform="translate(520 400) scale(.4) translate(-520 -400)">'+cloud(360,420,300,110)+cloud(520,300,220,80)+'</g>'
    +'<g class="c-away"><g transform="scale(.16)">'+swallow('', 'b')+'</g></g></g>';
  s+='<path d="M500,110 V474 M360,300 H640" stroke="#6b4c32" stroke-width="10"/><path d="M500,110 V474 M360,300 H640" stroke="'+INK+'" stroke-width="1" opacity=".5"/>';
  s+='<path d="M360,474 L360,250 A140,140 0 0 1 640,250 L640,474 Z" fill="none" stroke="'+INK+'" stroke-width="2"/>';
  s+='<rect x="314" y="496" width="372" height="22" fill="#8a6542" stroke="'+INK+'" stroke-width="1.6"/>';
  s+='<g transform="translate(600 496)"><path d="M-18,0 L-14,-30 L14,-30 L18,0 Z" fill="#b5653f" stroke="'+INK+'" stroke-width="1.4"/><path d="M0,-30 C-6,-60 -26,-70 -34,-64 C-26,-56 -10,-48 0,-30 M0,-30 C4,-62 22,-78 32,-70 C24,-60 10,-48 0,-30 M0,-30 C0,-56 -4,-80 4,-92" stroke="#5d7340" stroke-width="3" fill="#7f9a5a"/></g>';
  s+='<path d="M250,60 C300,60 330,90 340,140 C320,260 350,380 320,560 L240,560 C250,400 220,250 250,60Z" fill="#9a4f3f" stroke="'+INK+'" stroke-width="1.8"/><path d="M270,90 C290,220 280,380 270,550 M300,110 C310,250 300,400 296,555" stroke="'+INK+'" stroke-width="1" opacity=".5" fill="none"/>';
  s+='<path d="M750,60 C700,60 670,90 660,140 C680,260 650,380 680,560 L760,560 C750,400 780,250 750,60Z" fill="#9a4f3f" stroke="'+INK+'" stroke-width="1.8"/><path d="M730,90 C710,220 720,380 730,550 M700,110 C690,250 700,400 704,555" stroke="'+INK+'" stroke-width="1" opacity=".5" fill="none"/>';
  s+='<rect x="-900" y="620" width="2800" height="900" fill="#8a6542"/><path d="M-900,620 H1900" stroke="'+INK+'" stroke-width="2"/>';
  var grain=''; for(i=0;i<18;i++){ var gy=650+i*24+r()*10; grain+='M-900,'+f1(gy)+' C-300,'+f1(gy-6+r()*12)+' 300,'+f1(gy-6+r()*12)+' 1900,'+f1(gy); }
  s+='<path d="'+grain+'" stroke="#6b4c32" stroke-width="1.4" fill="none" opacity=".45"/>';
  s+='<g transform="translate(240 690)"><ellipse cx="0" cy="34" rx="34" ry="9" fill="#b08a3e" stroke="'+INK+'" stroke-width="1.4"/><rect x="-7" y="-50" width="14" height="84" fill="#f2ead6" stroke="'+INK+'" stroke-width="1.4"/><g class="c-flame"><path d="M0,-52 C8,-62 6,-78 0,-90 C-6,-78 -8,-62 0,-52Z" fill="#e8a33c" stroke="'+INK+'" stroke-width="1"/><path d="M0,-55 C3,-62 2,-70 0,-76 C-2,-70 -3,-62 0,-55Z" fill="#fff3c4"/></g><circle cx="0" cy="-72" r="40" fill="#f2c46a" opacity=".12"/></g>';
  s+='<g transform="translate(760 735)"><ellipse cx="0" cy="26" rx="34" ry="9" fill="#000" opacity=".15"/><path d="M-30,24 C-34,0 -26,-20 -12,-24 L-10,-38 L10,-38 L12,-24 C26,-20 34,0 30,24 Z" fill="#3a4250" stroke="'+INK+'" stroke-width="1.6"/><path d="M-22,4 C-20,-10 -12,-16 -6,-18" stroke="#fff" stroke-width="2" opacity=".35" fill="none"/><ellipse cx="0" cy="-38" rx="10" ry="3" fill="#1b1d24"/></g>';
  s+='<g id="c-paper" transform="rotate(-3 500 800)"><rect x="306" y="658" width="400" height="300" fill="#000" opacity=".14"/><rect x="300" y="650" width="400" height="300" fill="#f8f2e3" stroke="'+INK+'" stroke-width="1"/>';
  s+='<g id="c-writing" fill="none" stroke="#2a2a3a" stroke-width="2.2" stroke-linecap="round">';
  var rw=rng(42); for(i=0;i<6;i++){ var x1=i===5?520:665; s+='<path class="wl" d="'+cursive(338,x1,712+i*38,rw)+'"/>'; }
  s+='</g><g id="c-hand">'
    +'<path d="M72,40 C112,30 172,20 232,10 L292,150 C222,170 152,190 102,200 Z" fill="#4f6a85" stroke="'+INK+'" stroke-width="1.6"/>'
    +'<path d="M120,60 L250,30 M130,90 L262,60 M140,120 L274,90 M150,150 L284,120" stroke="'+INK+'" stroke-width="1" opacity=".35"/>'
    +'<path d="'+(function(){var d='M64,30';for(var k=0;k<7;k++){var y=30+k*25,x=64+k*6;d+=' Q'+(x-16)+','+(y+12)+' '+(x+6)+','+(y+25);}return d+' L112,200 L84,30 Z';})()+'" fill="#f4eee0" stroke="'+INK+'" stroke-width="1.3"/>'
    +'<path d="M6,-14 C10,-60 40,-140 120,-250 C128,-200 110,-120 60,-60 C40,-36 24,-22 6,-14 Z" fill="#c4d3e0" stroke="'+INK+'" stroke-width="1.3"/>'
    +'<path d="M3,-6 L122,-252" stroke="'+INK+'" stroke-width="1.5"/>'
    +(function(){var d='';for(var k=1;k<14;k++){var t=k/14,x=3+119*t,y=-6-246*t;d+='M'+f1(x)+','+f1(y)+' l'+f1(-10+t*4)+','+f1(-14)+' M'+f1(x)+','+f1(y)+' l'+f1(14-t*6)+','+f1(-4);}return '<path d="'+d+'" stroke="'+INK+'" stroke-width=".8" opacity=".5"/>';})()
    +'<path d="M0,0 L5,-15 L11,-11 Z" fill="'+INK+'"/>'
    +'<path d="M18,-30 C34,-48 70,-46 96,-22 C116,-4 124,24 112,50 C96,70 64,66 46,48 C28,30 10,0 18,-30 Z" fill="#e8c6a2" stroke="'+INK+'" stroke-width="1.6"/>'
    +'<path d="M22,-16 C14,-28 4,-42 -4,-41 C-10,-40 -9,-32 -2,-27 C5,-22 13,-17 22,-12 Z" fill="#e8c6a2" stroke="'+INK+'" stroke-width="1.5"/>'
    +'<path d="M34,-2 C20,-4 6,-12 3,-20 C1,-27 10,-29 18,-23 C26,-17 32,-9 38,-4 Z" fill="#ddb892" stroke="'+INK+'" stroke-width="1.5"/>'
    +'<path d="M50,-38 C58,-30 62,-22 62,-14 M74,-36 C80,-26 82,-18 80,-10" stroke="'+INK+'" stroke-width="1" fill="none" opacity=".6"/>'
    +'</g></g></g>';
  /* POND */
  s+='<g id="c-pond"><clipPath id="c-ink"><circle id="c-inkc" cx="500" cy="470" r="0"/></clipPath><g clip-path="url(#c-ink)">';
  s+='<ellipse cx="500" cy="490" rx="480" ry="260" fill="#d9caa6" opacity=".85"/>';
  var st=''; for(i=0;i<160;i++){ var a=r()*6.283, q=0.82+r()*0.18; st+='<circle cx="'+f1(500+Math.cos(a)*470*q)+'" cy="'+f1(490+Math.sin(a)*250*q)+'" r="'+f1(0.6+r()*1.3)+'"/>'; }
  s+='<g fill="#8a7a58" opacity=".6">'+st+'</g>';
  s+='<clipPath id="c-water"><ellipse cx="500" cy="490" rx="380" ry="176"/></clipPath><ellipse cx="500" cy="490" rx="380" ry="176" fill="#a3bcb6" stroke="'+INK+'" stroke-width="2"/>';
  s+='<g clip-path="url(#c-water)"><path d="'+hLines(100,900,320,670,7)+'" stroke="#4e7078" stroke-width="1" opacity=".35"/><ellipse cx="560" cy="420" rx="200" ry="40" fill="#e8f0ec" opacity=".35"/><ellipse cx="420" cy="560" rx="160" ry="26" fill="#6e8f92" opacity=".25"/></g>';
  s+='<g fill="none" stroke="#3f5f66" stroke-width="1.6"><ellipse class="c-rip" cx="420" cy="468" rx="40" ry="13"/><ellipse class="c-rip d2" cx="420" cy="468" rx="40" ry="13"/><ellipse class="c-rip d3" cx="640" cy="540" rx="34" ry="11"/></g>';
  s+=lilyPad(420,470,74,27,-6)+lilyPad(640,540,82,30,8)+lilyPad(715,430,50,18,-10)+lilyPad(330,560,44,16,14);
  s+=lily(700,425,1.15);
  s+='<g id="c-frogpos">'+frog()+'</g>';
  var stones=[[190,560,46,30,-12,'#b8ad97'],[150,600,30,22,20,'#8d8676'],[235,610,38,26,6,'#c9b48f'],[205,650,26,18,-20,'#9aa39a'],[275,655,30,20,12,'#b9a48a'],[140,650,22,16,0,'#cfc3a8'],[240,520,24,17,30,'#a7a08e'],[310,690,24,16,-8,'#8f8a7c'],[180,700,30,20,10,'#c2b49a'],[120,560,20,14,-30,'#9b927f'],[360,720,20,13,4,'#b8ad97'],[780,660,30,20,-10,'#a7a08e'],[820,620,22,15,18,'#c9b48f'],[750,700,20,13,0,'#8d8676']];
  for(i=0;i<stones.length;i++){ var o=stones[i]; s+=stone(o[0],o[1],o[2],o[3],o[4],o[5],r); }
  s+='<g class="c-reeds">';
  for(i=0;i<7;i++){ var rx=790+i*22+r()*10, top=150+r()*120; s+='<g class="c-reed" style="animation-delay:-'+f1(r()*3)+'s"><path d="M'+f1(rx)+',640 C'+f1(rx-8)+','+f1(top+200)+' '+f1(rx+6)+','+f1(top+80)+' '+f1(rx)+','+f1(top)+'" stroke="#6f7d4f" stroke-width="3.2" fill="none"/>'+(i%2?'<rect x="'+f1(rx-7)+'" y="'+f1(top-6)+'" width="14" height="56" rx="7" fill="#7a5236" stroke="'+INK+'" stroke-width="1.2"/>':'<path d="M'+f1(rx)+',600 C'+f1(rx-40)+',480 '+f1(rx-46)+',380 '+f1(rx-70)+',300" stroke="#7f9a5a" stroke-width="5" fill="none"/>')+'</g>'; }
  for(i=0;i<5;i++){ var lx=120+i*26+r()*8, lt=230+r()*140; s+='<g class="c-reed" style="animation-delay:-'+f1(r()*3)+'s"><path d="M'+f1(lx)+',560 C'+f1(lx+10)+','+f1(lt+160)+' '+f1(lx-6)+','+f1(lt+60)+' '+f1(lx+4)+','+f1(lt)+'" stroke="#6f7d4f" stroke-width="3" fill="none"/></g>'; }
  s+='</g><g transform="translate(760 330)"><g class="c-dfly"><path d="M0,0 L-46,4" stroke="#3f5f66" stroke-width="3"/><g class="c-dwing"><ellipse cx="-8" cy="-10" rx="5" ry="18" fill="#dfe9ec" stroke="'+INK+'" stroke-width=".8" opacity=".85"/><ellipse cx="-16" cy="-8" rx="4" ry="15" fill="#dfe9ec" stroke="'+INK+'" stroke-width=".8" opacity=".85"/></g><circle cx="2" cy="0" r="4" fill="#3f5f66"/></g></g>';
  s+='</g></g>';
  /* MEADOW + BUTTERFLIES */
  s+='<g id="c-meadow"><ellipse cx="500" cy="380" rx="520" ry="300" fill="#a9bccb" opacity=".16"/><ellipse cx="300" cy="300" rx="260" ry="140" fill="#e2b6a6" opacity=".14"/>';
  s+=cloud(80,240,240,90)+cloud(640,170,220,80);
  s+='<g id="c-bflies">';
  var bc=[['#d98a4a','#6a8fb3','#c8553d'],['#a9c2d6','#e3b54a','#b5653f'],['#efe7d6','#7d97a8','#b86e85'],['#c9a24a','#6f9a85','#c8553d'],['#b86e85','#e3b54a','#6a8fb3'],['#8fb3a0','#f0d98c','#b5653f']];
  for(i=0;i<6;i++){ s+='<g class="c-bf" data-i="'+i+'"><g transform="scale(.2)">'+butterfly('c-bfi f'+(i%3), bc[i][0], bc[i][1], bc[i][2], false)+'</g></g>'; }
  s+='</g><g id="c-hero" transform="translate(500 410)"><g transform="scale(1.05)">'+butterfly('c-bfi hero', '#f0d98c', '#6a8fb3', '#c8553d', true)+'</g></g>';
  s+='<g class="c-grass">';
  for(i=0;i<46;i++){ var gx=-40+i*24+r()*14, gh=150+r()*170; s+='<path class="c-blade" style="animation-delay:-'+f1(r()*4)+'s" d="M'+f1(gx)+',1010 C'+f1(gx+4)+','+f1(1010-gh*.6)+' '+f1(gx+18)+','+f1(1010-gh*.9)+' '+f1(gx+26+r()*10)+','+f1(1010-gh)+'" stroke="'+(i%3?'#6f7d4f':'#8a9a6b')+'" stroke-width="'+f1(2.4+r()*1.5)+'" fill="none"/>'; }
  var fl=[[120,820,'#f4ead2'],[260,860,'#c8553d'],[420,850,'#f4ead2'],[610,830,'#e3b54a'],[760,860,'#c8553d'],[880,820,'#f4ead2'],[340,800,'#b86e85'],[700,790,'#f4ead2']];
  for(i=0;i<fl.length;i++){ var f=fl[i], pe=''; for(var k=0;k<8;k++){ pe+='<ellipse transform="rotate('+(k*45)+')" cx="0" cy="-9" rx="4" ry="9" fill="'+f[2]+'" stroke="'+INK+'" stroke-width=".8"/>'; } s+='<g transform="translate('+f[0]+' '+f[1]+')"><path d="M0,0 C4,60 -2,120 2,220" stroke="#6f7d4f" stroke-width="2.4" fill="none"/>'+pe+'<circle r="4.5" fill="#e3b54a" stroke="'+INK+'" stroke-width=".8"/></g>'; }
  s+='</g></g>';
  /* NIGHT */
  s+='<g id="c-night"><defs><linearGradient id="c-ng" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#151a28"/><stop offset="1" stop-color="#2c2b3e"/></linearGradient><radialGradient id="c-glow"><stop offset="0" stop-color="#d97757" stop-opacity=".35"/><stop offset="1" stop-color="#d97757" stop-opacity="0"/></radialGradient></defs>';
  s+='<rect x="-500" y="-500" width="2000" height="2000" fill="url(#c-ng)"/><g fill="#f4ead2">';
  for(i=0;i<150;i++){ s+='<circle class="c-star" style="animation-delay:-'+f1(r()*4)+'s" cx="'+f1(r()*1000)+'" cy="'+f1(r()*1000)+'" r="'+f1(0.6+r()*1.6)+'" opacity="'+f1(0.4+r()*0.6)+'"/>'; }
  s+='</g>';
  var cons=[[250,180],[330,140],[410,170],[470,120],[560,150],[620,110],[700,160],[760,130]];
  var cd='M'+cons.map(function(p){return p.join(',');}).join(' L');
  s+='<path id="c-cons" d="'+cd+'" pathLength="1" stroke="#c9a24a" stroke-width="1.4" fill="none" stroke-dasharray="1" stroke-dashoffset="1" opacity=".8"/>';
  for(i=0;i<cons.length;i++){ s+='<circle cx="'+cons[i][0]+'" cy="'+cons[i][1]+'" r="3.4" fill="#f4ead2"/>'; }
  s+='<g id="c-tome"><circle cx="500" cy="440" r="220" fill="url(#c-glow)"/><g transform="translate(500 440)">'
    +'<rect x="-120" y="-150" width="240" height="300" rx="12" fill="#4a3226" stroke="#c9a24a" stroke-width="3"/>'
    +'<rect x="-104" y="-134" width="208" height="268" rx="6" fill="none" stroke="#c9a24a" stroke-width="1.4" opacity=".7"/>'
    +'<path d="M-120,-150 l30,0 l-30,30 Z M120,-150 l-30,0 l30,30 Z M-120,150 l30,0 l-30,-30 Z M120,150 l-30,0 l30,-30 Z" fill="#c9a24a"/>'
    +'<circle cx="0" cy="-40" r="34" fill="none" stroke="#c9a24a" stroke-width="1.6" opacity=".8"/><path d="M0,-74 L8,-48 L34,-40 L8,-32 L0,-6 L-8,-32 L-34,-40 L-8,-48 Z" fill="#c9a24a" opacity=".85"/>'
    +'<rect x="104" y="-20" width="40" height="60" rx="6" fill="#c9a24a" stroke="'+INK+'" stroke-width="1.4"/>'
    +'<path d="M114,0 v-14 a10,10 0 0 1 20,0 v14" fill="none" stroke="#e8d9a8" stroke-width="5"/><rect x="108" y="0" width="32" height="30" rx="5" fill="#d97757" stroke="'+INK+'" stroke-width="1.4"/><circle cx="124" cy="12" r="3.4" fill="'+INK+'"/><rect x="122.5" y="13" width="3" height="9" fill="'+INK+'"/>'
    +'</g></g></g>';
  s+='</svg>';
  el.innerHTML=s;
  this.el=el; var q=function(id){ return el.querySelector('#'+id); };
  this.sky=q('c-sky'); this.clouds=q('c-clouds'); this.sw=q('c-swallow'); this.flock=q('c-flock');
  this.room=q('c-room'); this.hand=q('c-hand'); this.writing=q('c-writing'); this.pond=q('c-pond'); this.inkc=q('c-inkc'); this.frog=q('c-frogpos');
  this.meadow=q('c-meadow'); this.hero=q('c-hero'); this.bf=[].slice.call(el.querySelectorAll('.c-bf')); this.night=q('c-night'); this.cons=q('c-cons'); this.tome=q('c-tome');
  this.lines=[].slice.call(el.querySelectorAll('.wl')).map(function(p){ var L=p.getTotalLength(); p.style.strokeDasharray=L; p.style.strokeDashoffset=L; return {p:p,L:L}; });
  this.total=this.lines.reduce(function(a,b){return a+b.L;},0);
};
function vis(e,on){ e.style.display=on?'':'none'; }
Claude.prototype.frame=function(u,t){
  var kA=ease(seg(u,0.45,0.85)), kB=ease(seg(u,0.8,1.05)), kC=ease(seg(u,1.55,1.95)), kD=ease(seg(u,1.72,2.1)), kE=ease(seg(u,2.5,3.0)), kF=ease(seg(u,3.45,3.95));
  /* sky */
  var skyOn=u<0.66; vis(this.sky,skyOn);
  if(skyOn){
    this.sky.style.opacity=1-seg(u,0.5,0.64);
    var g=seg(u,0,0.6);
    this.sw.setAttribute('transform','translate('+f1(470+90*g+Math.sin(t*1.3)*6)+' '+f1(440-50*g+Math.sin(t*2.1)*5)+') rotate('+f1(-6-6*g)+')');
    this.clouds.setAttribute('transform','translate('+f1(-120*g-t*4%60)+' 0)');
    this.flock.setAttribute('transform','translate('+f1(-160*g)+' '+f1(-40*g)+')');
  }
  /* room */
  var roomOn=u>0.4 && u<2.0; vis(this.room,roomOn);
  if(roomOn){
    var sc=(3.4+(1-3.4)*kA)*(1+3.4*kC);
    var cx=this.W.x+(this.P.x-this.W.x)*kB, cy=this.W.y+(this.P.y-this.W.y)*kB;
    this.room.setAttribute('transform','translate(500 430) scale('+sc.toFixed(4)+') translate('+f1(-cx)+' '+f1(-cy)+')');
    this.room.style.opacity=seg(u,0.42,0.56)*(1-seg(u,1.86,1.99));
    var w=seg(u,0.98,1.5)*this.total, acc=0, pen=null;
    for(var i=0;i<this.lines.length;i++){ var Ln=this.lines[i], part=clamp(w-acc,0,Ln.L); Ln.p.style.strokeDashoffset=Ln.L-part; if(part>0 && part<Ln.L) pen=Ln.p.getPointAtLength(part); acc+=Ln.L; }
    if(!pen){ var last=w<=0?this.lines[0]:this.lines[this.lines.length-1]; pen=last.p.getPointAtLength(w<=0?0:last.L); }
    this.hand.setAttribute('transform','translate('+f1(pen.x)+' '+f1(pen.y)+')');
    this.hand.style.opacity=1-seg(u,1.46,1.6);
    this.writing.style.opacity=1-seg(u,1.5,1.68);
  }
  /* pond */
  var pondOn=u>1.7 && u<3.05; vis(this.pond,pondOn);
  if(pondOn){
    this.inkc.setAttribute('r', f1(980*kD));
    this.pond.setAttribute('transform','translate(0 '+f1(1000*kE)+')');
    var h=ease(seg(u,2.12,2.42)), fx=420+(640-420)*h, fy=452+(522-452)*h-Math.sin(h*Math.PI)*120;
    this.frog.setAttribute('transform','translate('+f1(fx)+' '+f1(fy)+') scale('+(1+0.12*Math.sin(h*Math.PI))+')');
  }
  /* meadow */
  var meadowOn=u>2.5; vis(this.meadow,meadowOn);
  if(meadowOn){
    this.meadow.setAttribute('transform','translate(0 '+f1(-1000*(1-kE)+300*kF)+')'); this.meadow.style.opacity=1-kF*0.95; this.hero.style.opacity=1-seg(u,3.45,3.75);
    var hy=410-60*seg(u,3,3.4)-760*ease(seg(u,3.4,3.8)), hx=500+Math.sin(t*0.9)*14;
    this.hero.setAttribute('transform','translate('+f1(hx)+' '+f1(hy+Math.sin(t*1.7)*8)+') rotate('+f1(Math.sin(t*0.8)*5)+')');
    for(var b=0;b<this.bf.length;b++){
      var ph=b*1.7, rr=1+b*0.12;
      var bx=500+Math.sin(t*0.35*rr+ph)*330+Math.sin(t*0.9+ph)*40, by=420+Math.cos(t*0.27*rr+ph*1.3)*220-kF*700-b*20*kF;
      this.bf[b].setAttribute('transform','translate('+f1(bx)+' '+f1(by)+') rotate('+f1(Math.sin(t+ph)*20)+')');
    }
  }
  /* night */
  var nightOn=u>3.42; vis(this.night,nightOn);
  if(nightOn){
    this.night.style.opacity=kF;
    this.cons.style.strokeDashoffset=1-seg(u,3.62,3.98);
    this.tome.style.opacity=seg(u,3.6,3.92);
    this.tome.setAttribute('transform','translate(0 '+f1(30*(1-seg(u,3.6,3.95)))+')');
  }
};
Claude.prototype.destroy=function(){ if(this.el) this.el.innerHTML=''; };
Claude.grain=grainURL;

/* ================= OPENAI: shader space ================= */
var FS=[
'precision highp float;',
'uniform vec2 R; uniform float T; uniform float S;',
'float h1(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }',
'float h3(vec3 p){ p=fract(p*0.3183099+vec3(.1,.2,.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }',
'float vn(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);',
' return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),',
'            mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }',
'float fbm(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }',
'float fbm3(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<3;i++){ s+=a*vn(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }',
'vec3 rotY(vec3 p,float a){ float c=cos(a),s=sin(a); return vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z); }',
'vec3 rotX(vec3 p,float a){ float c=cos(a),s=sin(a); return vec3(p.x,c*p.y-s*p.z,s*p.y+c*p.z); }',
'float crater(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); float res=0.0;',
' for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){ vec3 g=vec3(float(x),float(y),float(z));',
'  vec3 o=vec3(h3(i+g),h3(i+g+11.1),h3(i+g+27.3)); float rad=0.12+0.3*h3(i+g+5.7); float d=length(g+o-f)/rad;',
'  if(d<1.2){ res+= -0.55*(1.0-smoothstep(0.0,0.95,d)) + 0.45*smoothstep(0.72,0.95,d)*(1.0-smoothstep(0.95,1.2,d)); } }',
' return res; }',
'vec3 moonCol(vec3 n,vec3 nw,vec3 L){',
' float maria=smoothstep(0.45,0.62,fbm(n*1.5+3.0));',
' float det=fbm3(n*9.0);',
' float cr=crater(n*3.2)+0.6*crater(n*7.5+7.0);',
' float alb=0.66-0.25*maria+0.14*(det-0.5)+0.22*cr;',
' float dif=max(dot(nw,L),0.0); dif=pow(dif,0.85);',
' return vec3(alb)*vec3(1.0,0.97,0.93)*dif+vec3(0.006); }',
'vec3 earthCol(vec3 n,vec3 nw,vec3 L){',
' float h=fbm(n*1.7+vec3(2.3,1.1,0.7));',
' float land=smoothstep(0.505,0.53,h); float lat=abs(n.y);',
' vec3 ocean=mix(vec3(0.01,0.06,0.18),vec3(0.03,0.17,0.35),smoothstep(0.3,0.5,h));',
' float dry=smoothstep(0.5,0.7,fbm3(n*3.0+9.0))*(1.0-smoothstep(0.15,0.4,abs(lat-0.32)));',
' vec3 green=mix(vec3(0.08,0.2,0.06),vec3(0.22,0.3,0.12),fbm3(n*6.0));',
' vec3 col=mix(ocean,mix(green,vec3(0.6,0.48,0.3),dry),land);',
' float ice=smoothstep(0.8,0.88,lat+0.08*(fbm3(n*5.0)-0.5)); col=mix(col,vec3(0.92,0.95,0.98),ice);',
' float cl=smoothstep(0.5,0.75,fbm(rotY(n,T*0.012)*2.4+vec3(0.0,0.0,T*0.004)));',
' float ndl=dot(nw,L); float dif=max(ndl,0.0); float day=smoothstep(-0.12,0.2,ndl);',
' vec3 H=normalize(L+vec3(0.0,0.0,1.0)); float spec=pow(max(dot(nw,H),0.0),70.0)*(1.0-land)*(1.0-cl)*0.7;',
' vec3 c=col*dif+spec*vec3(1.0,0.93,0.8);',
' c=mix(c,vec3(0.95)*(0.06+0.94*dif),cl*0.88);',
' float city=step(0.8,vn(n*70.0))*land*(1.0-ice)*(1.0-cl);',
' c+=(1.0-day)*city*vec3(1.0,0.66,0.3)*0.7;',
' float rim=pow(1.0-max(nw.z,0.0),2.6); c+=rim*vec3(0.25,0.5,1.0)*(0.08+0.9*day);',
' return c; }',
'vec3 sunCol(vec3 n,vec3 nw){',
' vec3 q=n*3.2; float w=fbm3(q+vec3(T*0.03));',
' float g=fbm(q*2.2+w*2.4+vec3(0.0,T*0.05,0.0));',
' float limb=pow(max(nw.z,0.0),0.45);',
' vec3 c=mix(vec3(0.85,0.25,0.02),vec3(1.0,0.78,0.32),g);',
' c=mix(c,vec3(1.0,0.96,0.82),smoothstep(0.62,0.9,g)*0.6);',
' return c*(0.62+0.62*limb)*1.5; }',
'vec3 galaxy(vec2 q,float sc){',
' vec2 g=q/sc; g.y/=0.48; float a=T*0.012; g=mat2(cos(a),-sin(a),sin(a),cos(a))*g;',
' float r=length(g); float th=atan(g.y,g.x);',
' float sp=th-log(r+0.002)*2.3;',
' float arms=pow(0.5+0.5*cos(2.0*sp),3.0);',
' float n=fbm(vec3(g*5.0,1.0));',
' float dust=smoothstep(0.5,0.8,pow(0.5+0.5*cos(2.0*sp+0.55),4.0)*n*1.7);',
' float disk=exp(-r*3.0); float core=exp(-r*r*55.0);',
' vec3 armC=mix(vec3(0.5,0.62,1.0),vec3(1.0,0.62,0.8),smoothstep(0.62,0.82,n));',
' vec3 c=armC*arms*disk*(0.5+0.9*n)*2.3;',
' c+=vec3(1.0,0.86,0.62)*(core*1.6+exp(-r*8.0)*0.55);',
' c*=1.0-dust*0.7*disk;',
' vec2 sq=q*240.0; vec2 cl=floor(sq); vec2 fq=fract(sq)-0.5; float rn=h1(cl+3.1); float st=step(0.93,rn)*smoothstep(0.22,0.0,length(fq))*(arms*0.85+0.15)*disk*4.0; c+=st*vec3(0.85,0.9,1.0);',
' return c; }',
'vec3 stars(vec2 uv){ vec3 c=vec3(0.0);',
' for(int i=0;i<3;i++){ float sc=55.0+float(i)*75.0; vec2 cell=floor(uv*sc); vec2 f=fract(uv*sc)-0.5; float rnd=h1(cell+float(i)*13.0);',
'  if(rnd>0.962){ vec2 off=vec2(h1(cell+1.3),h1(cell+7.7))-0.5; float d=length(f-off*0.6); float tw=0.6+0.4*sin(T*1.7+rnd*80.0);',
'   c+=vec3(0.82,0.86,1.0)*smoothstep(0.09,0.0,d)*tw*(rnd-0.962)*26.0; } }',
' return c; }',
'vec3 body(vec3 col,vec2 uv,vec2 c,float r,float kind,vec2 sunC,float fade){',
' vec2 d=(uv-c)/r; float l=length(d);',
' vec3 L=normalize(vec3(sunC-c,0.3*length(sunC-c)+0.02));',
' if(kind>0.5){ float halo=exp(-(max(l,1.0)-1.0)*12.0)*step(1.0,l); float lit=clamp(dot(normalize(vec3(d,0.001)),L)*0.9+0.35,0.0,1.0); col+=vec3(0.3,0.55,1.0)*halo*0.6*lit*fade; }',
' if(l>=1.0) return col;',
' vec3 nw=vec3(d,sqrt(1.0-l*l));',
' vec3 n=rotX(rotY(nw,T*(kind>0.5?0.04:0.012)+(kind>0.5?2.0:0.4)),0.35);',
' vec3 bc=kind>0.5?earthCol(n,nw,L):moonCol(n,nw,L);',
' float aa=smoothstep(1.0,1.0-2.5/(R.y*r),l);',
' return mix(col,bc,aa*fade); }',
'void main(){',
' vec2 uv=(gl_FragCoord.xy-0.5*R)/R.y; float asp=R.x/R.y; float un=min(asp,1.0);',
' float H=min(0.40*un,0.30); vec2 F=vec2(0.0,0.09); float s=S;',
' vec3 col=vec3(0.004,0.006,0.016)+stars(uv+vec2(s*0.035,0.0));',
' float gS=max(H*2.2,0.42);',
' float gA=smoothstep(2.05,2.75,s);',
' if(gA>0.001){ col+=galaxy(uv-F,mix(5.5,1.0,smoothstep(2.0,3.0,s))*gS)*gA; }',
' float a1=smoothstep(1.0,2.0,s), a2=smoothstep(2.0,2.9,s);',
' vec2 sunC=mix(vec2(-0.5*asp-0.42*un-0.06,0.2),F,a1);',
' sunC=mix(sunC,F+vec2(0.24,-0.05)*gS,a2);',
' float sunR=mix(mix(0.55*H,H,a1),0.0022,pow(a2,0.42));',
' vec2 dS=uv-sunC; float lS=length(dS)/sunR;',
' { float e=max(lS-1.0,0.0); float glow=exp(-e*3.2)*0.95+exp(-e*0.8)*0.3;',
'  if(glow>0.004){ float ang=atan(dS.y,dS.x); float rays=fbm3(vec3(ang*2.6,lS*0.7-T*0.05,1.3)); col+=vec3(1.0,0.6,0.24)*glow*(0.65+0.7*rays)*(1.0-a2*0.92); } }',
' col+=vec3(1.0,0.9,0.75)*a2*0.0016/(length(dS)+0.0016);',
' if(lS<1.0){ vec3 nw=vec3(dS/sunR,sqrt(max(1.0-lS*lS,0.0))); float aa=smoothstep(1.0,1.0-2.5/(R.y*sunR),lS); col=mix(col,sunCol(rotY(nw,T*0.02),nw),aa); }',
' float e1=smoothstep(0.0,1.0,s), e2=smoothstep(1.0,2.0,s);',
' vec2 eC=mix(F+vec2(-0.30*un,-0.25),F,e1); float eR=mix(0.2*H,H,e1);',
' eC=mix(eC,F+vec2(0.34*un,-0.21),e2); eR=mix(eR,0.07*H,e2);',
' float fd=1.0-smoothstep(2.1,2.45,s);',
' if(fd>0.0){ col=body(col,uv,eC,eR,1.0,sunC,fd);',
'  vec2 mC=mix(F,F+vec2(0.30*un,0.25),e1); float mR=mix(H,0.24*H,e1);',
'  mC=mix(mC,eC+vec2(0.06,0.035)*un,e2); mR=mix(mR,0.022*H,e2);',
'  col=body(col,uv,mC,mR,0.0,sunC,fd); }',
' col=1.0-exp(-col*1.35); col=pow(col,vec3(0.94));',
' float vg=1.0-0.35*dot(uv*vec2(0.8,1.0),uv*vec2(0.8,1.0)); col*=vg;',
' gl_FragColor=vec4(col,1.0); }'
].join('\n');
var VS='attribute vec2 p; void main(){ gl_Position=vec4(p,0.0,1.0); }';

function Space(){}
Space.prototype.mount=function(el){
  var c=document.createElement('canvas'); el.appendChild(c); this.c=c; this.el=el; this.ok=false;
  var gl=null; try{ gl=c.getContext('webgl',{antialias:false,alpha:false,powerPreference:'high-performance'}); }catch(e){}
  if(gl){
    var sh=function(type,src){ var s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){ console.error(gl.getShaderInfoLog(s)); return null; } return s; };
    var vs=sh(gl.VERTEX_SHADER,VS), fs=sh(gl.FRAGMENT_SHADER,FS);
    if(vs&&fs){ var pr=gl.createProgram(); gl.attachShader(pr,vs); gl.attachShader(pr,fs); gl.linkProgram(pr);
      if(gl.getProgramParameter(pr,gl.LINK_STATUS)){
        gl.useProgram(pr); var b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
        var loc=gl.getAttribLocation(pr,'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
        this.gl=gl; this.uR=gl.getUniformLocation(pr,'R'); this.uT=gl.getUniformLocation(pr,'T'); this.uS=gl.getUniformLocation(pr,'S'); this.ok=true;
      } }
  }
  if(!this.ok){ this.ctx=c.getContext('2d'); }
};
Space.prototype.size=function(){
  var r=this.el.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,1.6);
  var maxPx=1400000, w=Math.max(1,r.width*dpr), h=Math.max(1,r.height*dpr), k=Math.min(1,Math.sqrt(maxPx/(w*h)));
  w=Math.round(w*k); h=Math.round(h*k);
  if(this.c.width!==w||this.c.height!==h){ this.c.width=w; this.c.height=h; }
  return [w,h];
};
Space.prototype.frame=function(u,t){
  var wh=this.size();
  if(this.ok){ var gl=this.gl; gl.viewport(0,0,wh[0],wh[1]); gl.uniform2f(this.uR,wh[0],wh[1]); gl.uniform1f(this.uT,t); gl.uniform1f(this.uS,u); gl.drawArrays(gl.TRIANGLES,0,3); return; }
  var x=this.ctx, w=wh[0], h=wh[1]; x.fillStyle='#02030a'; x.fillRect(0,0,w,h);
  var cols=['#cfd4dc','#2f6fb3','#f5a524','#a78bfa'], i=Math.round(u), rr=Math.min(w,h)*0.28;
  var g=x.createRadialGradient(w/2-rr*.3,h*.42-rr*.3,rr*.1,w/2,h*.42,rr); g.addColorStop(0,'#fff'); g.addColorStop(.3,cols[i]); g.addColorStop(1,'#000');
  x.fillStyle=g; x.beginPath(); x.arc(w/2,h*.42,rr,0,6.283); x.fill();
};
Space.prototype.destroy=function(){ if(this.gl){ var e=this.gl.getExtension('WEBGL_lose_context'); if(e) e.loseContext(); } if(this.el) this.el.innerHTML=''; };

/* ================= GEMINI: particle atoms ================= */
function hex(c){ return [parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)]; }
function Atoms(){}
Atoms.prototype.mount=function(el){
  var c=document.createElement('canvas'); el.appendChild(c); this.c=c; this.el=el; this.x=c.getContext('2d');
  var small=Math.min(window.innerWidth,window.innerHeight)<700, N=small?1100:1600, r=rng(5), i;
  this.N=N;
  var bolt=[[0.08,-0.95],[-0.5,0.08],[-0.06,0.08],[-0.22,0.95],[0.5,-0.18],[0.06,-0.18],[0.3,-0.95]];
  function inPoly(px,py){ var ins=false; for(var a=0,b=bolt.length-1;a<bolt.length;b=a++){ var xi=bolt[a][0],yi=bolt[a][1],xj=bolt[b][0],yj=bolt[b][1]; if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi)) ins=!ins; } return ins; }
  var a0=0.16;
  var nodes=[], bonds=[];
  for(var gx=-7;gx<=7;gx++) for(var gy=-7;gy<=7;gy++){
    var bx=gx*a0*1.5, by=gy*a0*Math.sqrt(3)+(gx%2?a0*Math.sqrt(3)/2:0);
    [[bx-a0/2,by],[bx+a0/2,by]].forEach(function(pt){ if(Math.hypot(pt[0],pt[1])<0.86) nodes.push(pt); });
  }
  for(var p=0;p<nodes.length;p++) for(var q2=p+1;q2<nodes.length;q2++){ if(Math.abs(Math.hypot(nodes[p][0]-nodes[q2][0],nodes[p][1]-nodes[q2][1])-a0)<0.01) bonds.push([p,q2]); }
  this.nodes=nodes; this.bonds=bonds;
  var P=[];
  var shellPick=function(v){ return v<0.16?0:(v<0.5?1:2); };
  var C={fl:['#ffd54a','#fff3c4','#f4b400'], h:['#4285f4','#8ab4f8','#aecbfa'], ar:['#4285f4','#9b72cb','#d96570'], c:['#4285f4','#9b72cb','#d96570']};
  for(i=0;i<N;i++){
    var o={sz:0.6+r()*1.3, st:r(), ph:r()*6.283, sp:0.5+r()};
    var bxp,byp; do{ bxp=-0.6+r()*1.2; byp=-1+r()*2; }while(!inPoly(bxp,byp));
    o.b=[bxp*0.62,byp*0.62,(r()-0.5)*0.08];
    var th=r()*6.283, ct=r()*2-1, stt=Math.sqrt(1-ct*ct); o.dir=[stt*Math.cos(th),ct,stt*Math.sin(th)];
    o.hr=Math.min(0.85, -0.22*Math.log(1-r()*0.98)+0.05); o.hn=i<36;
    o.an=i<70; o.sh=shellPick(r()); o.ang=r()*6.283; o.jit=(r()-0.5)*0.03;
    var useNode=r()<0.55; o.cn=useNode; o.node=Math.floor(r()*nodes.length); o.bond=Math.floor(r()*bonds.length); o.bt=r(); o.nj=[(r()-0.5)*0.05,(r()-0.5)*0.05,(r()-0.5)*0.05];
    o.col=[hex(C.fl[i%3]), hex(o.hn?(i%2?'#ffffff':'#f28b82'):C.h[i%3]), hex(o.an?(i%2?'#f28b82':'#fbbc04'):C.ar[o.sh]), null];
    P.push(o);
  }
  var eCount=[2,8,8], k=0; this.el18=[];
  for(var s2=0;s2<3;s2++) for(var e=0;e<eCount[s2];e++){ this.el18.push({sh:s2,ang:e/eCount[s2]*6.283}); }
  this.P=P; this.shR=[0.3,0.55,0.8]; this.shT=[[0.3,0.2],[1.1,-0.4],[-0.6,0.9]];
};
function rot3(v,ax,ay){ var x=v[0],y=v[1],z=v[2]; var c=Math.cos(ay),s=Math.sin(ay); var x2=c*x+s*z, z2=-s*x+c*z; c=Math.cos(ax); s=Math.sin(ax); return [x2, c*y-s*z2, s*y+c*z2]; }
Atoms.prototype.target=function(sc,o,i,t){
  if(sc<=0){ var fl=0.85+0.15*Math.sin(t*9+o.ph); return [o.b[0]+Math.sin(t*2+o.ph)*0.006, o.b[1], o.b[2], fl]; }
  if(sc===1){
    if(o.hn){ var v=rot3([o.dir[0]*0.045,o.dir[1]*0.045,o.dir[2]*0.045],0,t); return [v[0],v[1],v[2],1.4]; }
    var br=1+0.04*Math.sin(t*1.3+o.ph), rr=o.hr*br*1.35; var w=rot3([o.dir[0]*rr,o.dir[1]*rr,o.dir[2]*rr],0.3,t*0.25); return [w[0],w[1],w[2],0.55+0.5*(1-o.hr)];
  }
  if(sc===2){
    if(o.an){ var nv=rot3([o.dir[0]*0.09,o.dir[1]*0.09,o.dir[2]*0.09],t*0.3,t*0.5); return [nv[0],nv[1],nv[2],1.3]; }
    var R=this.shR[o.sh]+o.jit, a=o.ang+t*(0.5-o.sh*0.12)*(o.sh%2?-1:1); var p=[Math.cos(a)*R,0,Math.sin(a)*R];
    var tt=this.shT[o.sh]; p=rot3(p,tt[0],tt[1]+t*0.15); return [p[0],p[1],p[2],0.75];
  }
  var pt;
  if(o.cn){ var nd=this.nodes[o.node]; pt=[nd[0]+o.nj[0],0+o.nj[1],nd[1]+o.nj[2]]; }
  else { var bd=this.bonds[o.bond], A=this.nodes[bd[0]], B=this.nodes[bd[1]]; pt=[A[0]+(B[0]-A[0])*o.bt, 0, A[1]+(B[1]-A[1])*o.bt]; }
  pt=rot3(pt,0.95+Math.sin(t*0.3)*0.12,t*0.22); return [pt[0],pt[1],pt[2],o.cn?1.05:0.6];
};
Atoms.prototype.cColor=function(px){ var k=clamp((px+0.9)/1.8,0,1); var a=k<0.5?[66,133,244]:[155,114,203], b=k<0.5?[155,114,203]:[217,101,112], m=k<0.5?k*2:(k-0.5)*2; return [a[0]+(b[0]-a[0])*m,a[1]+(b[1]-a[1])*m,a[2]+(b[2]-a[2])*m]; };
Atoms.prototype.frame=function(u,t){
  var r=this.el.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2), W=Math.round(r.width*dpr), H=Math.round(r.height*dpr);
  if(this.c.width!==W||this.c.height!==H){ this.c.width=W; this.c.height=H; }
  var x=this.x; x.clearRect(0,0,W,H); x.globalCompositeOperation='lighter';
  var i0=Math.floor(clamp(u,0,3)), f=clamp(u,0,3)-i0, i1=Math.min(3,i0+1), k=ease(seg(f,0.3,0.85));
  var cx=W/2, cy=H*0.42, S=Math.min(W,H*0.78)*0.42, fov=2.6;
  var P=this.P;
  for(var i=0;i<P.length;i++){
    var o=P[i], kk=ease(clamp(k*1.35-o.st*0.35,0,1));
    var A=this.target(i0,o,i,t), B=(i1===i0)?A:this.target(i1,o,i,t);
    var px=A[0]+(B[0]-A[0])*kk, py=A[1]+(B[1]-A[1])*kk, pz=A[2]+(B[2]-A[2])*kk, br=A[3]+(B[3]-A[3])*kk;
    var per=fov/(fov+pz), sx=cx+px*S*per, sy=cy+py*S*per;
    var ca=i0===3?this.cColor(A[0]):o.col[i0], cb=i1===3?this.cColor(B[0]):o.col[i1];
    var cr=ca[0]+(cb[0]-ca[0])*kk, cg=ca[1]+(cb[1]-ca[1])*kk, cbb=ca[2]+(cb[2]-ca[2])*kk;
    var sz=o.sz*dpr*per*(0.9+br*0.6), al=Math.min(1,0.32*br*per);
    x.fillStyle='rgba('+(cr|0)+','+(cg|0)+','+(cbb|0)+','+al.toFixed(3)+')';
    x.beginPath(); x.arc(sx,sy,sz,0,6.283); x.fill();
  }
  var shown=(i0===2&&f<0.6)||(i1===2&&f>0.6);
  var eA=(i0===2)?1-k:(i1===2?k:0);
  if(eA>0.02){
    for(var e=0;e<this.el18.length;e++){ var E=this.el18[e], R=this.shR[E.sh], a=E.ang+t*(0.5-E.sh*0.12)*(E.sh%2?-1:1), p=[Math.cos(a)*R,0,Math.sin(a)*R], tt=this.shT[E.sh]; p=rot3(p,tt[0],tt[1]+t*0.15);
      var per2=fov/(fov+p[2]), ex=cx+p[0]*S*per2, ey=cy+p[1]*S*per2, g=x.createRadialGradient(ex,ey,0,ex,ey,9*dpr*per2);
      g.addColorStop(0,'rgba(255,255,255,'+(0.95*eA).toFixed(3)+')'); g.addColorStop(1,'rgba(138,180,248,0)'); x.fillStyle=g; x.beginPath(); x.arc(ex,ey,9*dpr*per2,0,6.283); x.fill(); }
  }
  var hA=(i0===1)?1-k:(i1===1?k:0);
  if(hA>0.02){ var ea=t*1.1, ev=rot3([Math.cos(ea)*0.42,Math.sin(ea*1.7)*0.12,Math.sin(ea)*0.42],0.3,t*0.25), pe=fov/(fov+ev[2]), hx=cx+ev[0]*S*pe, hy=cy+ev[1]*S*pe, hg=x.createRadialGradient(hx,hy,0,hx,hy,10*dpr);
    hg.addColorStop(0,'rgba(255,255,255,'+(0.95*hA).toFixed(3)+')'); hg.addColorStop(1,'rgba(66,133,244,0)'); x.fillStyle=hg; x.beginPath(); x.arc(hx,hy,10*dpr,0,6.283); x.fill(); }
  x.globalCompositeOperation='source-over';
};
Atoms.prototype.destroy=function(){ if(this.el) this.el.innerHTML=''; };

export const ENGINES={claude:Claude, openai:Space, gemini:Atoms};

