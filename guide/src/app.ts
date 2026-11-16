// @ts-nocheck -- v1 logic ported verbatim (BRIEF section 2); data now comes from data/models.json
import DATA from '../data/models.json';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { loadWorld } from './stage';
import * as audio from './audio';
import { buildStops, storyPosition, stopProgress, progressToStop, stopToProgress, storyScrollWeight } from './story';
import { EXAMPLES, effortPick, guideModelRole } from './choose';
gsap.registerPlugin(ScrollTrigger);
const EFF = DATA.effortLevels, MULT = DATA.effortCostMultipliersVsMedium, PRESETS = DATA.taskPresets, W = DATA.families, FIELDS = DATA.fields;
var motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
var motionPaused = false;
var reduced = motionQuery.matches;
var soundEnabled = false, soundStarted = false;
var stageControls = null;
var mapButton = null;
// Shell tuning: scroll interval fractions, idle seconds, and measured safe-area padding.
const STORY_SNAP_THRESHOLD = 0.15;
const STORY_SNAP_STOP_EPSILON = 0.01; // Absorb scroll-pixel rounding at an exact button/rail target.
const STORY_SNAP_DELAY = 0.4;
const CLAUDE_NIGHT_THEME_START = 0.15; // Fraction of the Fable → Mythos scene coordinate.
const STAGE_CLEAR_GAP = 8; // Pixels between the subject's clear area and shell overlays.

try{ soundEnabled = localStorage.getItem('mg-sound')==='on'; }catch(e){}
var ORDER = ['none','low','medium','high','xhigh','max','ultra'];
var RANK = {fast:1,balanced:2,daily:3,frontier:4};
var ROLE = {fast:'Fast tier',balanced:'Balanced tier',daily:'Everyday model',frontier:'Frontier tier'};

var CH = [
  {id:'models',label:'Models'},
  {id:'effort',label:'Effort'},
  {id:'examples',label:'Examples'},
  {id:'upgrade',label:'Model vs effort'},
  {id:'cost',label:'Cost'},
  {id:'choose',label:'Try Effort'}
];

var S = {world:'claude',ch:'models',field:'nutrition',exMode:'model',preset:'paper',costEff:'medium',later:false,
  effModel:{},effLevel:{},cmp:{},prompt:EXAMPLES[2]};
var MOBILE = Math.min(innerWidth, innerHeight) < 700 || matchMedia('(pointer:coarse)').matches;
var lenis = null;
function lenisTick(t){ lenis?.raf(t*1000); }
function syncMotion(){
  if(reduced && lenis){ gsap.ticker.remove(lenisTick); lenis.destroy(); lenis=null; }
  if(!reduced && !lenis){ lenis=new Lenis(); lenis.on('scroll',ScrollTrigger.update); gsap.ticker.add(lenisTick); gsap.ticker.lagSmoothing(0); }
}
syncMotion();
try{ var sf = localStorage.getItem('mg-field'); if(sf && FIELDS[sf]) S.field = sf; }catch(e){}

/* ---------- helpers ---------- */
var uidN = 0; function U(){ return 'u' + (++uidN); }
function plain(text){
  var out = String(text);
  Object.values(W).flatMap(function(f){ return f.models; }).sort(function(a,b){ return b.name.length-a.name.length; }).forEach(function(m){ out = out.split(m.name).join(m.short); });
  // Display aliases in the original copy also omit version numbers.
  return out.replace(/\b3\.8 Flash\b/g, 'Flash')
    .replace(/\bGPT-6 Sol\b/g, 'Sol').replace(/\bGPT-6 Pro\b/g, 'Pro')
    .replace('from the GPT-5.6 family', 'from the previous GPT generation')
    .replace('GPT-6 has no Terra.', 'Terra belongs to the previous generation.')
    .replace('Workflows already tuned on GPT-5.6', 'Workflows already tuned on Terra');
}
// Normalize each generated display string; preserve visitor input and price provenance.
function rawEsc(s){ return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function checkedDate(){ return new Date(DATA.checkedOn + 'T00:00:00Z').toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'}); }
function priceVersion(m){ return '<small class="price-version">Prices for ' + rawEsc(m.name) + ', checked ' + checkedDate() + '</small>'; }
function esc(s){ return rawEsc(plain(s)); }
function pnum(n){ return n < .01 && n > 0 ? n.toPrecision(2) : n.toFixed(2); }
function costMoney(n){ return '$' + pnum(n); }
function money(x){ if(x===0) return '$0'; if(x<0.01) return '$' + x.toPrecision(2); if(x<1) return '$' + x.toFixed(3); if(x<100) return '$' + x.toFixed(2); return '$' + Math.round(x).toLocaleString('en-US'); }
function world(){ return W[S.world]; }
function storyLevels(m){ return m.efforts.length ? m.efforts : (m.access||[]).map(function(a){ return a.id; }); }
function storyStops(models){ return buildStops(models.map(function(m){ return {id:m.id, efforts:storyLevels(m)}; })); }
function accessTier(m,k){ return !m.efforts.length ? m.access?.find(function(a){ return a.id===k; }) : null; }
function model(id){ var ms = world().models; for(var i=0;i<ms.length;i++) if(ms[i].id===id) return ms[i]; return null; }
function usable(){ return world().models.filter(function(m){ return m.status==='available'; }); }
function startModel(){ return model(world().start.model); }
function smallest(){ var u = usable(); return u[u.length-1]; }
function lvIndex(k){ return ORDER.indexOf(k); }
function mult(k){ var t = MULT[S.world]; return t[k]; }
function effRange(m){ if(!m.efforts.length) return ''; var a=m.efforts; return 'Effort: ' + EFF[a[0]].label + ' to ' + EFF[a[a.length-1]].label; }
function priceText(m){ if(m.status!=='available') return esc(m.price?.note || m.where || 'No price yet'); if(!m.price) return 'No price yet'; return '$' + pnum(m.price.inP) + ' in / $' + pnum(m.price.outP) + ' out'; }
function taskCost(m, e, p){
  var pr = (S.later && m.price.later) ? m.price.later : m.price;
  var pin = pr.inP, pout = pr.outP;
  if(m.id==='haiku' && p.inT>100000){ pin=0.5; pout=2.5; }
  return (p.inT*pin + p.outT*mult(e)*pout)/1e6;
}
function apiNote(k){ var w=world(); if(w.api) return w.api[k]; return 'API: ' + k; }
function trackGradient(){
  var ms = world().models.slice().reverse();
  var stops = ms.map(function(m,i){ return m.color + ' ' + Math.round(i/(ms.length-1)*100) + '%'; });
  return 'linear-gradient(to top,' + stops.join(',') + ')';
}
function bars5(k){
  var n = Math.max(1, Math.min(5, lvIndex(k)));
  if(k==='none') n = 0;
  var h=''; for(var i=1;i<=5;i++){ h += '<i class="' + (i<=n?'on':'') + '" style="height:' + (4+i*2.4) + 'px"></i>'; }
  return '<span class="bars5" aria-hidden="true">' + h + '</span>';
}

/* ---------- icons ---------- */
var IC = {
  claude:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 14c1-5 4-9 10-12-1 6-5 9-10 12z" fill="currentColor"/></svg>',
  openai:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2.4" fill="currentColor"/></svg>',
  gemini:'<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3"><ellipse cx="8" cy="8" rx="7" ry="2.8"/><ellipse cx="8" cy="8" rx="7" ry="2.8" transform="rotate(60 8 8)"/><ellipse cx="8" cy="8" rx="7" ry="2.8" transform="rotate(120 8 8)"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/></svg>',
  chev:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  left:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pin:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.4 4.5 8.5 4.5 8.5s4.5-5.1 4.5-8.5A4.5 4.5 0 0 0 8 1.5zm0 6.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z" fill="currentColor"/></svg>',
  up:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M4 9l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  split:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v4M8 6L3 12M8 6l5 6M8 6v7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  check:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  model:'<svg viewBox="0 0 28 28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="16" width="18" height="6" rx="2"/><rect x="7" y="9" width="14" height="6" rx="2"/><rect x="9" y="3" width="10" height="5" rx="2"/></svg>',
  dial:'<svg viewBox="0 0 28 28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20a10 10 0 1 1 18 0"/><path d="M14 16l5-6"/><circle cx="14" cy="16" r="1.6" fill="currentColor"/></svg>'
};

/* ---------- illustrations ---------- */
var ILL = {
  haiku:function(c){ return '<svg viewBox="0 0 120 120" aria-hidden="true">'
    + '<g class="a-speed" stroke="' + c + '" stroke-width="3" stroke-linecap="round" opacity=".6"><line x1="6" y1="50" x2="30" y2="50"/><line x1="14" y1="63" x2="34" y2="63"/><line x1="4" y1="76" x2="24" y2="76"/></g>'
    + '<g class="a-glide"><path d="M48 66 L22 53 L37 67 L20 81 Z" fill="#2a2a33"/>'
    + '<path d="M40 66 C54 56 74 54 90 58 C97 60 102 61 107 59 C102 66 94 71 84 72 C70 73 54 71 40 66 Z" fill="#2a2a33"/>'
    + '<path d="M60 68 C72 70 84 70 94 65 C88 72 76 74 64 72 Z" fill="' + c + '"/>'
    + '<circle cx="99" cy="61" r="1.7" fill="#faf9f5"/>'
    + '<g class="a-wing"><path d="M62 61 C66 40 80 27 99 21 C91 37 83 50 77 61 Z" fill="#2a2a33"/></g></g></svg>'; },
  sonnet:function(c){ return '<svg viewBox="0 0 120 120" aria-hidden="true">'
    + '<path d="M10 106 H110" stroke="#141413" stroke-opacity=".12" stroke-width="1.5"/>'
    + '<path class="a-write" pathLength="1" d="M12 98 q7 -9 14 0 t14 0 t14 0 t14 0" fill="none" stroke="#141413" stroke-width="2.6" stroke-linecap="round"/>'
    + '<g class="a-quill"><path d="M66 96 C59 74 70 43 105 11 C107 40 97 70 72 92 Z" fill="' + c + '"/>'
    + '<path d="M68 96 L103 17" stroke="#141413" stroke-width="1.6" opacity=".5"/>'
    + '<path d="M78 70 l12 -6 M82 60 l13 -7 M87 50 l11 -8 M75 79 l-8 -6 M80 67 l-9 -6 M85 55 l-8 -7" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity=".75"/>'
    + '<path d="M66 96 L63 106 L70 98 Z" fill="#141413"/></g></svg>'; },
  opus:function(c){ return '<svg viewBox="0 0 120 120" aria-hidden="true">'
    + '<ellipse cx="60" cy="90" rx="55" ry="17" fill="' + c + '" opacity=".15"/>'
    + '<g fill="none" stroke="' + c + '" stroke-width="1.6"><ellipse class="a-rip" cx="42" cy="90" rx="12" ry="4"/><ellipse class="a-rip d2" cx="42" cy="90" rx="12" ry="4"/><ellipse class="a-rip d3" cx="42" cy="90" rx="12" ry="4"/></g>'
    + '<ellipse cx="42" cy="84" rx="17" ry="8" fill="#8a857a"/><ellipse cx="43" cy="72" rx="13" ry="6.5" fill="#b0aea5"/><ellipse cx="42" cy="62" rx="8.5" ry="4.8" fill="' + c + '"/>'
    + '<ellipse cx="89" cy="93" rx="15" ry="5.5" fill="#788c5d"/><path d="M89 93 L104 91 L101 96 Z" fill="#faf9f5" opacity=".9"/>'
    + '<g class="a-frog"><ellipse cx="88" cy="87" rx="7.5" ry="5.2" fill="#8aa36b"/><circle cx="84.3" cy="82.2" r="2.6" fill="#8aa36b"/><circle cx="91.7" cy="82.2" r="2.6" fill="#8aa36b"/><circle cx="84.3" cy="82" r="1.1" fill="#141413"/><circle cx="91.7" cy="82" r="1.1" fill="#141413"/><path d="M85 89 q3 1.6 6 0" stroke="#141413" stroke-width=".8" fill="none"/></g>'
    + '<circle cx="104" cy="83" r="3.2" fill="#f2c4cf"/><circle cx="104" cy="83" r="1.2" fill="#f5d48a"/></svg>'; },
  fable:function(c){ return '<svg viewBox="0 0 120 120" aria-hidden="true">'
    + '<path d="M6 106 C24 92 30 112 46 98 S62 86 66 74" fill="none" stroke="' + c + '" stroke-width="2" stroke-dasharray="1 6" stroke-linecap="round"/>'
    + '<g class="a-float"><g transform="translate(76 52) rotate(-12)">'
    + '<g class="a-wl"><path d="M0 -2 C-8 -26 -34 -30 -32 -10 C-31 0 -14 4 0 0 Z" fill="' + c + '"/><path d="M0 2 C-14 6 -26 22 -12 26 C-5 27 -1 14 0 2 Z" fill="' + c + '" opacity=".72"/><circle cx="-20" cy="-12" r="3.2" fill="#faf9f5" opacity=".85"/></g>'
    + '<g class="a-wr"><path d="M0 -2 C8 -26 34 -30 32 -10 C31 0 14 4 0 0 Z" fill="' + c + '"/><path d="M0 2 C14 6 26 22 12 26 C5 27 1 14 0 2 Z" fill="' + c + '" opacity=".72"/><circle cx="20" cy="-12" r="3.2" fill="#faf9f5" opacity=".85"/></g>'
    + '<rect x="-2" y="-12" width="4" height="26" rx="2" fill="#141413"/><path d="M-1 -12 C-4 -20 -8 -24 -11 -25 M1 -12 C4 -20 8 -24 11 -25" stroke="#141413" stroke-width="1.3" fill="none" stroke-linecap="round"/>'
    + '</g></g></svg>'; },
  mythos:function(c){ return '<svg viewBox="0 0 120 120" aria-hidden="true">'
    + '<g fill="' + c + '"><circle class="a-tw" cx="18" cy="24" r="1.8"/><circle class="a-tw d2" cx="101" cy="18" r="1.6"/><circle class="a-tw d3" cx="107" cy="72" r="1.8"/><circle class="a-tw d2" cx="13" cy="82" r="1.4"/></g>'
    + '<path d="M18 24 L34 36 M101 18 L86 32 M107 72 L90 70" stroke="' + c + '" stroke-width=".8" opacity=".45"/>'
    + '<rect x="30" y="28" width="60" height="72" rx="6" fill="#2b2a27"/><rect x="35" y="33" width="50" height="62" rx="4" fill="none" stroke="#b0aea5" stroke-width="1" opacity=".55"/>'
    + '<path d="M52 66 v-7 a8 8 0 0 1 16 0 v7" fill="none" stroke="#faf9f5" stroke-width="3"/><rect x="47" y="64" width="26" height="20" rx="4" fill="#d97757"/>'
    + '<circle cx="60" cy="72" r="2.6" fill="#2b2a27"/><rect x="59" y="73" width="2" height="6" fill="#2b2a27"/></svg>'; },
  luna:function(c,u){ return '<svg viewBox="0 0 120 120" aria-hidden="true"><defs><clipPath id="m' + u + '"><circle cx="60" cy="60" r="34"/></clipPath></defs>'
    + '<circle cx="60" cy="60" r="46" fill="' + c + '" opacity=".07"/><circle cx="60" cy="60" r="34" fill="#e7eaf0"/>'
    + '<g fill="#c5cbd6"><circle cx="48" cy="48" r="7"/><circle cx="70" cy="70" r="9"/><circle cx="72" cy="44" r="4"/><circle cx="46" cy="74" r="3.5"/><circle cx="58" cy="60" r="2.4"/></g>'
    + '<g clip-path="url(#m' + u + ')"><circle class="a-phase" cx="40" cy="60" r="36" fill="#000" opacity=".84"/></g></svg>'; },
  terra:function(c,u){
    var land = '<path d="M30 40 c8 -6 18 -4 22 4 c3 6 -2 10 -8 12 c-6 2 -6 8 -12 8 c-6 0 -8 -8 -6 -14 c1 -4 1 -7 4 -10z"/><path d="M62 64 c6 -4 14 -2 16 4 c2 6 -4 12 -10 16 c-4 3 -10 2 -11 -4 c-1 -6 1 -12 5 -16z"/><path d="M90 34 c5 -3 12 0 12 6 c0 5 -6 7 -10 6 c-4 -1 -6 -8 -2 -12z"/><path d="M112 58 c6 -2 12 2 11 8 c-1 5 -8 6 -11 3 c-3 -3 -4 -9 0 -11z"/>';
    return '<svg viewBox="0 0 120 120" aria-hidden="true"><defs><clipPath id="t' + u + '"><circle cx="60" cy="60" r="34"/></clipPath>'
    + '<radialGradient id="tg' + u + '" cx="38%" cy="34%"><stop offset="0" stop-color="#4aa3ea"/><stop offset="1" stop-color="#0f3566"/></radialGradient></defs>'
    + '<circle cx="60" cy="60" r="41" fill="none" stroke="#7cc7ff" stroke-width="3" opacity=".28"/><circle cx="60" cy="60" r="34" fill="url(#tg' + u + ')"/>'
    + '<g clip-path="url(#t' + u + ')"><g class="a-earth" fill="' + c + '"><g>' + land + '</g><g transform="translate(-136 0)">' + land + '</g></g>'
    + '<g class="a-cloud" fill="#ffffff" opacity=".5"><g><rect x="20" y="52" width="26" height="4" rx="2"/><rect x="66" y="40" width="20" height="3.5" rx="1.75"/><rect x="88" y="78" width="24" height="4" rx="2"/></g><g transform="translate(-136 0)"><rect x="20" y="52" width="26" height="4" rx="2"/><rect x="66" y="40" width="20" height="3.5" rx="1.75"/><rect x="88" y="78" width="24" height="4" rx="2"/></g></g>'
    + '<circle cx="60" cy="60" r="34" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="10" transform="translate(5 4)"/></g></svg>'; },
  sol:function(c,u){
    var rays=''; for(var i=0;i<12;i++){ var a=i/12*Math.PI*2, r1=33, r2=(i%2?43:48); rays += '<line x1="' + (60+Math.cos(a)*r1).toFixed(1) + '" y1="' + (60+Math.sin(a)*r1).toFixed(1) + '" x2="' + (60+Math.cos(a)*r2).toFixed(1) + '" y2="' + (60+Math.sin(a)*r2).toFixed(1) + '"/>'; }
    return '<svg viewBox="0 0 120 120" aria-hidden="true"><defs><radialGradient id="s' + u + '"><stop offset="0" stop-color="#fff4cc"/><stop offset=".55" stop-color="' + c + '"/><stop offset="1" stop-color="#e2711d"/></radialGradient></defs>'
    + '<circle class="a-pulse" cx="60" cy="60" r="36" fill="' + c + '" opacity=".2"/>'
    + '<g class="a-rot" style="transform-origin:60px 60px" stroke="' + c + '" stroke-width="3.5" stroke-linecap="round">' + rays + '</g>'
    + '<circle cx="60" cy="60" r="25" fill="url(#s' + u + ')"/></svg>'; },
  astra:function(c,u){
    var dots='';
    for(var arm=0; arm<2; arm++){ for(var k=0;k<46;k++){ var t=k/45, ang=arm*Math.PI + t*3.4*Math.PI, r=5 + t*46;
      var x=60+Math.cos(ang)*r, y=60+Math.sin(ang)*r, s=(2.3*(1-t)+0.6).toFixed(2), o=(1-t*0.65).toFixed(2);
      var col = t<0.25 ? '#ffffff' : (t<0.7 ? c : '#7dd3fc');
      dots += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + s + '" fill="' + col + '" opacity="' + o + '"/>'; } }
    return '<svg viewBox="0 0 120 120" aria-hidden="true"><defs><radialGradient id="g' + u + '"><stop offset="0" stop-color="#fff"/><stop offset=".4" stop-color="' + c + '" stop-opacity=".7"/><stop offset="1" stop-color="' + c + '" stop-opacity="0"/></radialGradient></defs>'
    + '<g fill="#fff"><circle class="a-tw" cx="12" cy="20" r="1.2"/><circle class="a-tw d2" cx="108" cy="16" r="1.4"/><circle class="a-tw d3" cx="104" cy="104" r="1.2"/><circle class="a-tw" cx="16" cy="98" r="1"/></g>'
    + '<g transform="translate(0 21) scale(1 .65)"><g class="a-rot" style="transform-origin:60px 60px;animation-duration:40s">' + dots + '</g></g>'
    + '<circle cx="60" cy="60" r="15" fill="url(#g' + u + ')"/></svg>'; },
  tile:function(m,u){
    var e = m.el, c = m.color, atom = '', i;
    var radii = e.shells.length===1 ? [26] : (e.shells.length===2 ? [20,33] : [16,27,38]);
    for(i=0;i<e.shells.length;i++){
      var r = radii[i], n = e.shells[i], dots='';
      for(var j=0;j<n;j++){ var a=j/n*Math.PI*2; dots += '<circle cx="' + (60+Math.cos(a)*r).toFixed(1) + '" cy="' + (60+Math.sin(a)*r).toFixed(1) + '" r="2.6" fill="' + c + '"/>'; }
      atom += '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="' + c + '" stroke-opacity=".32" stroke-width="1.2"/>'
        + '<g class="a-rot" style="transform-origin:60px 60px;animation-duration:' + (5+i*4) + 's' + (i%2?';animation-direction:reverse':'') + '">' + dots + '</g>';
    }
    var hex = '';
    if(e.sym==='C'){ for(i=0;i<3;i++){ var hx=36+i*24, hy= i%2?44:50; hex += '<path d="M' + hx + ' ' + (hy-9) + ' l8 4.6 v9.2 l-8 4.6 l-8 -4.6 v-9.2 z" fill="none" stroke="' + c + '" stroke-opacity=".18" stroke-width="1.2"/>'; } }
    return '<svg viewBox="0 0 120 120" aria-hidden="true">'
    + '<rect x="6" y="6" width="108" height="108" rx="16" fill="#ffffff" stroke="' + c + '" stroke-width="2"' + (m.status==='testing'?' stroke-dasharray="6 5"':'') + '/>'
    + hex + atom
    + '<circle cx="60" cy="60" r="12.5" fill="#ffffff" opacity=".92"/>'
    + '<text class="svgt" x="60" y="68" text-anchor="middle" font-size="' + (e.sym.length>1?20:23) + '" font-weight="600" fill="#1f1f1f">' + e.sym + '</text>'
    + '<text class="svgt" x="16" y="24" font-size="12" font-weight="600" fill="#5f6368">' + e.num + '</text>'
    + '<text class="svgt" x="104" y="24" font-size="9.5" text-anchor="end" fill="#5f6368">' + e.mass + '</text>'
    + '<text class="svgt" x="60" y="106" font-size="10.5" text-anchor="middle" fill="#5f6368">' + e.name + '</text></svg>'; },
  flash:function(c,u){ return '<svg viewBox="0 0 120 120" aria-hidden="true"><defs><filter id="f' + u + '" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs>'
    + '<rect x="6" y="6" width="108" height="108" rx="16" fill="#ffffff" stroke="' + c + '" stroke-width="2"/>'
    + '<path class="a-glow" d="M67 20 L40 64 H58 L50 98 L82 50 H63 Z" fill="' + c + '" filter="url(#f' + u + ')" opacity=".55"/>'
    + '<path class="a-flick" d="M67 20 L40 64 H58 L50 98 L82 50 H63 Z" fill="' + c + '" stroke="#e8a200" stroke-width="1.5" stroke-linejoin="round"/>'
    + ''
    + '<text class="svgt" x="60" y="108" font-size="10.5" text-anchor="middle" fill="#5f6368">Flash</text></svg>'; }
};
function ill(m){ var u=U(); if(m.el) return ILL.tile(m,u); return ILL[m.id](m.color,u); }

/* ---------- chapters ---------- */
function exampleFor(m){
  var f = FIELDS[S.field];
  if(m.status!=='available') return '';
  return '<div class="field-ex" style="--c:' + m.color + '"><p class="field-label">In ' + esc(f.label) + '</p><p>' + esc(f.role[m.role]) + '</p></div>';
}
function badges(m){
  var b = '';
  if(m.startHere) b += '<span class="badge">' + IC.pin + 'Start here</span>';
  if(m.status==='restricted') b += '<span class="badge soft">Limited access</span>';
  if(m.status==='testing') b += '<span class="badge dash">In testing</span>';
  if(m.legacy) b += '<span class="badge soft">Previous generation</span>';
  return b;
}
function detailHTML(m){
  var det = '<p>' + esc(m.note) + '</p>';
  if(m.best){ det += '<p class="detail-label">Best for</p><ul>' + m.best.map(function(x){return '<li>' + esc(x) + '</li>';}).join('') + '</ul><p class="detail-label">Skip it when</p><p>' + esc(m.skip) + '</p>'; }
  if(m.start){ det += '<p class="where">Start at ' + EFF[m.start].label + ' effort. ' + esc(m.where) + '</p>'; } else { det += '<p class="where">' + esc(m.where) + '</p>'; }
  if(priceExplanation(m)) det += '<p class="where">Price note: ' + esc(priceExplanation(m)) + '</p>';
  return det + exampleFor(m) + priceVersion(m);
}
var SCENES = {
 haiku:'Swallows in an open sky; more effort, more birds.', sonnet:'A quill writes at a desk; more effort adds detail to the page.',
 opus:'A pond with stones and lily pads; more effort brings the scene to life.', fable:'Butterflies in a meadow; more effort adds colour and companions.', mythos:'A locked book beneath a constellation; access is limited.',
 luna:'The Moon; more effort reveals more of its surface.', terra:'The Earth; more effort reveals clouds and city lights.', sol:'The Sun; more effort strengthens its light and corona.', astra:'A spiral galaxy; more effort reveals more stars.',
 flash:'A lightning tile; more effort brightens its glow.', hydrogen:'A hydrogen atom; this model is in testing.', argon:'An argon atom; more effort lights up its electron shells.', carbon:'A carbon atom; access is limited.'
};
function priceExplanation(m){
 if(m.id==='mythos') return m.price?.note || 'Same rates as Fable, invitation only';
 if(m.id==='carbon') return m.price?.note || 'Announced intro price; no public API';
 if(m.id==='terra') return m.note || 'Previous generation, so it costs more than the newer Sol.';
 return m.price?.note || '';
}
function chModels(){
  var w = world(), ms = w.models, n = ms.length, jm = ms.slice().reverse();
  var items = ms.map(function(m, idx){
    var nx = ms[idx+1];
    return '<li class="stop' + (m.startHere?' is-start':'') + (m.status!=='available'?' is-off':'') + '" style="--c:' + m.color + (nx?';--c2:' + nx.color:'') + ';--i:' + (n-1-idx) + '">'
      + '<div class="stop-body"><div class="stop-head"><h3>' + esc(m.name) + '</h3>' + badges(m) + '</div>'
      + '<p class="tag">' + esc(m.tagline) + '</p>'
      + '<p class="meta"><span class="price">' + priceText(m) + '</span>' + (m.price && m.status==='available'?'<span>per 1M tokens</span>':'') + (m.efforts.length?'<span>' + effRange(m) + '</span>':'') + '</p>'
      + '<button class="more" type="button" data-act="open" aria-expanded="false" aria-label="What it is for: ' + esc(m.short) + '" aria-controls="d-' + m.id + '">What it is for ' + IC.chev + '</button>'
      + '<div class="detail" id="d-' + m.id + '"><div class="detail-in">' + detailHTML(m) + '</div></div></div></li>';
  }).join('');
  var rail = jm.map(function(m,i){ return '<button type="button" data-act="jump" data-i="' + storyStops(jm).findIndex(function(s){ return s.model===i; }) + '" aria-label="Go to ' + esc(m.name) + '"><span class="rail-bar" aria-hidden="true"></span><span class="rail-initial" aria-hidden="true">' + esc(m.short[0]) + '</span><span class="rail-label">' + esc(m.short) + '</span></button>'; }).join('');
  return '<section class="ch" aria-labelledby="h-models"><div class="intro"><h1 tabindex="-1" id="h-models">' + esc(w.h1) + '</h1>'
    + '<p class="lede">' + esc(w.lede) + '</p>'
    + '<div class="dials"><div class="dial">' + IC.model + '<div><b>Model</b>Which brain does the work. Bigger knows more and judges better.</div></div>'
    + '<div class="dial">' + IC.dial + '<div><b>Effort</b>How long it thinks first. Higher is slower and uses more.</div></div></div>'
    + '<p class="scrollcue">' + (reduced?'Use Previous and Next to explore each model.':IC.down + 'Scroll to travel from the lightest model to the most capable.') + '</p><a class="skip-models" data-act="skip-story" href="#all-models">Skip to all models</a></div>'
    + '<div class="journey' + (reduced?' reduced':'') + '" id="journey" style="--scroll-weight:' + storyScrollWeight(storyStops(jm)) + '"><div class="stage" id="stage" data-w="' + S.world + '">'
    + (S.world==='gemini' ? '<div class="aurora" aria-hidden="true"></div>' : '')
    + '<div class="stage-art" id="stageArt" aria-hidden="true"></div>'
    + (S.world==='claude' ? '<div class="grain" id="grain" aria-hidden="true"></div>' : '')
    + ('<div class="rail" id="rail" role="group" aria-label="Jump to a model">' + rail + '</div>')
    + '<div class="cap" id="cap"></div></div></div>'
    + '<h2 class="glance-h" id="all-models" tabindex="-1">All ' + esc(w.label) + ' models at a glance</h2>'
    + '<ol class="ladder compact" aria-label="Models, most capable first">' + items + '</ol>'
    + jm.map(function(m){return '<p class="sr-only">' + esc(m.short) + ': ' + esc(SCENES[m.id]) + '</p>';}).join('')
    + '<p class="naming">' + esc(w.naming) + '</p></section>';
}

/* ---------- scroll story controller ---------- */
var JR = {skipped:false, eng:null, raf:0, idx:-1, n:0, models:null, stops:[], pending:null, t0:0, hdr:128, token:0, st:null, progress:0, u:0, displayU:0, fadeTimer:0, seen:false, io:null, bed:null, layoutObserver:null, layoutRaf:0};
function setHdr(){
 var t=document.querySelector('.top'); if(!t) return;
 JR.hdr=document.body.classList.contains('presenting')?0:t.offsetHeight;
 if(!document.body.classList.contains('story-pinned') && !document.body.classList.contains('presenting')) JR.fullHdr=JR.hdr;
 if(!document.body.classList.contains('presenting') && innerWidth>=1024 && document.body.classList.contains('story-pinned')){ document.body.style.setProperty('--story-header',JR.hdr+'px'); }
 else if(innerWidth<1024) document.body.style.removeProperty('--story-header');
 document.documentElement.style.setProperty('--hdr',JR.hdr+'px'); document.body.style.setProperty('--hdr',JR.hdr+'px');
}
function syncPinned(){
 var j=document.getElementById('journey'), body=document.body;
 var r=j?.getBoundingClientRect(), pinned=!!r && r.top<=(JR.fullHdr||JR.hdr)+1 && (reduced?r.bottom>JR.hdr+80:r.bottom>=innerHeight-24); // tolerance: the last stop rests a few sub-pixels short of the journey's end and must stay pinned
 if(pinned===body.classList.contains('story-pinned')) return;
 body.classList.toggle('story-pinned',pinned); if(!pinned) body.classList.remove('header-expanded');
 setHdr(); requestAnimationFrame(function(){ ScrollTrigger.refresh(); updateTabEdges(); });
}

// Insets are stage-local pixels. World workers can read these without changing WorldOpts.
function updateStageClearArea(){
 var stage=document.getElementById('stage'); if(!stage) return;
 var bounds=stage.getBoundingClientRect();
 var rect=function(el){ if(!el || el.hidden) return null; var bounds=el.getBoundingClientRect(); return bounds.width>0?bounds:null; };
 var controls=rect(stage.querySelector('.stage-controls')), cap=rect(document.getElementById('cap')), rail=rect(document.getElementById('rail'));
 var insets={
  top:controls?Math.max(0,controls.bottom-bounds.top)+STAGE_CLEAR_GAP:0,
  bottom:cap?Math.max(0,bounds.bottom-cap.top)+STAGE_CLEAR_GAP:0,
  right:rail?Math.max(0,bounds.right-rail.left)+STAGE_CLEAR_GAP:0
 };
 Object.entries(insets).forEach(function([edge,value]){
  var px=Math.ceil(Math.min(edge==='right'?bounds.width:bounds.height,value))+'px';
  if(stage.style.getPropertyValue('--clear-'+edge)!==px) stage.style.setProperty('--clear-'+edge,px);
 });
}
function queueStageClearArea(){
 if(JR.layoutRaf) return;
 JR.layoutRaf=requestAnimationFrame(function(){ JR.layoutRaf=0; updateStageClearArea(); });
}
function observeStageLayout(){
 JR.layoutObserver?.disconnect();
 if(typeof ResizeObserver!=='undefined'){
  JR.layoutObserver=new ResizeObserver(queueStageClearArea);
  [document.getElementById('stage'),document.getElementById('cap'),document.getElementById('rail'),stageControls].forEach(function(el){ if(el) JR.layoutObserver.observe(el); });
 }
 updateStageClearArea();
}
function attachStageControls(){
 if(!stageControls) return;
 if(mapButton) mapButton.hidden=S.world!=='claude'; // only the Claude world is one painted place
 var stage=document.getElementById('stage');
 if(stage) stage.prepend(stageControls);
 else document.body.append(stageControls);
 syncStageControls();
}
function syncStageControls(){
 if(!stageControls) return;
 var rect=document.getElementById('stage')?.getBoundingClientRect();
 var hidden=S.ch!=='models' || JR.skipped || !rect || rect.bottom<=JR.hdr || rect.top>=innerHeight;
 if(stageControls.hidden!==hidden){ stageControls.hidden=hidden; queueStageClearArea(); }
}
function syncStageTheme(pos){
 var stage=document.getElementById('stage'); if(!stage || S.world!=='claude') return;
 var nightIndex=JR.models.findIndex(function(m){ return m.id==='mythos'; });
 stage.classList.toggle('night',nightIndex>0 && pos.model>=nightIndex-1+CLAUDE_NIGHT_THEME_START);
}
function snapStoryProgress(progress,trigger){
 var u=progressToStop(JR.stops,progress), nearest=Math.round(u), lower=Math.floor(u), fraction=u-lower;
 // ScrollTrigger retains its previous direction across immediate jumps. Near a stop,
 // honor that exact stop rather than letting stale direction choose its neighbour.
 if(Math.abs(u-nearest)<=STORY_SNAP_STOP_EPSILON) return stopToProgress(JR.stops,nearest);
 var direction=trigger?.direction || 0;
 var index=direction>0?(fraction>=STORY_SNAP_THRESHOLD?lower+1:lower)
  :direction<0?(1-fraction>=STORY_SNAP_THRESHOLD?lower:lower+1):nearest;
 return stopToProgress(JR.stops,index);
}

function journeyU(){
  if(reduced) return JR.u;
  if(JR.st) return progressToStop(JR.stops, JR.progress);
  var j=document.getElementById('journey'), st=document.getElementById('stage'); if(!j || !st) return 0;
  var r=j.getBoundingClientRect(), span=r.height-st.offsetHeight;
  return progressToStop(JR.stops, span>0?(JR.hdr-r.top)/span:0);
}
function levelPips(m,k){
  var offered=m.efforts, selected=world().efforts.indexOf(k);
  return '<div class="level-pips"><span class="pip-dots" role="img" aria-label="' + esc(world().efforts.map(function(key){ return EFF[key].label+(!offered.includes(key)?': unavailable':(key===k?': selected':'')); }).join(', ')) + '">' + world().efforts.map(function(key,i){
    return '<i data-level="' + key + '" class="' + (!offered.includes(key)?'unavailable':(selected>=i?'on':'')) + '"></i>';
  }).join('') + '</span>' + (EFF[k]?'<span class="ro-name">' + EFF[k].label + '</span>':'') + (world().efforts.some(function(key){return !offered.includes(key);})?'<span class="pip-key"><i class="unavailable" aria-hidden="true"></i>Unavailable</span>':'') + '</div>';
}
function costMeter(k){
  var mu=mult(k), known=Number.isFinite(mu), pct=known?Math.min(100,mu/4*100):0;
  var value=known?(mu===0?'0×':(mu<0.1?String(mu):String(Number(mu.toFixed(1))))+'×'):'Not estimated';
  return '<div class="cost-scale' + (!known?' cost-unknown':'') + '" role="img" aria-label="Thinking cost relative to Medium: ' + value + '"><span class="meter-title">Cost vs Medium</span><div class="meter"><i style="width:' + pct + '%"></i><b class="cost-one" aria-hidden="true"></b><span class="cost-value" style="--value-pos:' + pct + '%">' + value + '</span></div><div class="meter-range" aria-hidden="true"><span>0×</span><span>1×</span><span>4×</span></div></div>';
}
function stopLabel(i){
  var stop=JR.stops[i], m=JR.models[stop.model], key=storyLevels(m)[stop.level], tier=accessTier(m,key);
  return m.short + (stop.active?', '+(tier?'access level '+(stop.level+1)+' of '+m.access.length+', '+tier.label:(EFF[key]?.label || key)):', model introduction');
}
function capHTML(m,i){
  var stop=JR.stops[i], levels=storyLevels(m), lv=levels[stop.level], tier=accessTier(m,lv);
  var counter=m.short+' · '+(stop.active?(tier?'access level ':'level ')+(stop.level+1)+' of '+levels.length:'model '+(stop.model+1)+' of '+JR.models.length);
  return '<div class="cap-in"><div class="cap-txt"><div class="cap-top"><p class="cap-step"><span class="cap-counter-model">' + esc(m.short) + ' · </span>' + esc(counter.slice(m.short.length+3)) + '</p><div class="cap-badges">' + badges(m) + '</div></div>'
    + '<p class="cap-name">' + esc(m.short) + (stop.active && lv===m.start?'<span class="badge">Default effort</span>':'') + '</p>'
    + (stop.active ? (tier?'<p class="ro-name">'+esc(tier.label)+'</p><p class="cap-tag">'+esc(tier.desc)+'</p>':levelPips(m,lv) + '<div class="story-readout"><div class="field-ex"><p>' + esc(FIELDS[S.field].eff[lv]) + '</p></div>' + costMeter(lv) + '</div>')
      : '<p class="cap-tag">' + esc(m.tagline) + '</p><p class="cap-meta">' + priceText(m) + (m.price && m.status==='available'?' per 1M tokens':'') + '</p><p class="cap-helper">' + (levels.length?levels.length+(m.efforts.length?' effort levels: ':' access levels: ')+(reduced?'use Next':'keep scrolling'):'No effort setting for this model.') + '</p>')
    + '</div><div class="cap-footer"><div class="cap-actions"><button type="button" data-act="story-prev" aria-label="' + (i>0?'Previous: '+esc(stopLabel(i-1)):'Previous stop') + '"' + (i===0?' disabled':'') + '>' + IC.left + '</button><button type="button" data-act="story-next" aria-label="' + (i<JR.n-1?'Next: '+esc(stopLabel(i+1)):'Next stop') + '"' + (i===JR.n-1?' disabled':'') + '>' + IC.right + '</button></div><div class="cap-tools"><button type="button" class="cap-more" data-act="sheet" aria-haspopup="dialog" data-id="' + m.id + '" aria-label="What it is for: ' + esc(m.short) + '">What it is for ' + IC.chev + '</button><button type="button" data-act="skip-story">Skip story</button></div></div></div>';
}
function announceStop(){ var status=document.getElementById('storyStatus'); if(status && JR.idx>=0) status.textContent=stopLabel(JR.idx); }
function updateCap(u,buttonDriven=false){
  var i=Math.max(0,Math.min(JR.n-1,Math.round(u))), stop=JR.stops[i], previous=JR.stops[JR.idx];
  if(i===JR.idx){ if(buttonDriven) announceStop(); return; }
  JR.idx=i;
  var cap=document.getElementById('cap');
  if(cap){ var focus=saveFocus(cap); if(buttonDriven && focus?.act==='sheet') focus={act:'story-next',v:null,i:null}; cap.innerHTML=capHTML(JR.models[stop.model],i); updatePresentationButtons(); restoreFocus(focus,cap); queueStageClearArea(); }
  document.querySelectorAll('#rail button').forEach(function(b){ b.setAttribute('aria-current',JR.stops[+b.dataset.i].model===stop.model?'true':'false'); });
  if(buttonDriven || !previous || previous.model!==stop.model) announceStop();
}
function stopJourney(){
  if(stageControls){ stageControls.hidden=true; document.body.append(stageControls); }
  JR.layoutObserver?.disconnect(); JR.layoutObserver=null;
  if(JR.layoutRaf) cancelAnimationFrame(JR.layoutRaf); JR.layoutRaf=0;
  audio.setSuspended(true); audio.scene(null); JR.bed=null; JR.seen=false;
  delete window.__story; clearTimeout(JR.fadeTimer);
  if(JR.raf) cancelAnimationFrame(JR.raf); JR.raf = 0; JR.token++;
  if(JR.st){ JR.st.animation?.kill(); JR.st.kill(); JR.st = null; } if(JR.io){ JR.io.disconnect(); JR.io = null; }
  if(JR.eng){ try{ JR.eng.destroy(); }catch(e){} } JR.eng = null; JR.idx = -1;
}
function startJourney(){
  stopJourney(); JR.skipped=false;
  var art = document.getElementById('stageArt'); if(!art) return;
  setHdr();
  JR.models = world().models.slice().reverse(); JR.stops = storyStops(JR.models); JR.n = JR.stops.length; JR.u = 0; JR.displayU=0; JR.progress=0;
  updateCap(journeyU()); attachStageControls(); observeStageLayout();
  if(document.body.classList.contains('presenting')) focusPresentationControl();
  if(!reduced){ JR.u = 0; JR.st = ScrollTrigger.create({trigger:'#journey', start:function(){ return 'top ' + JR.hdr + 'px'; }, end:function(){return 'bottom ' + (JR.hdr + document.getElementById('stage').offsetHeight) + 'px';}, scrub:0.5, snap:{snapTo:snapStoryProgress, duration:{min:0.2,max:0.5}, delay:STORY_SNAP_DELAY, ease:'power1.inOut', inertia:false, directional:false},
    animation: gsap.fromTo(JR, {progress:0}, {progress:1, ease:'none', paused:true})}); }
  runEngine(art, journeyU, updateCap);
  window.__story = {ready:false, positions:stopProgress(JR.stops), stops:JR.stops.map(function(s){ return {...s, id:JR.models[s.model].id, effort:s.active?storyLevels(JR.models[s.model])[s.level]:null}; }), goTo:function(i){ jumpTo(i, true); }};
  if(JR.pending){ var target=JR.pending; JR.pending=null;
    jumpTo(target.index ?? JR.stops.findIndex(function(s){ return JR.models[s.model].id===target.id && s.active && storyLevels(JR.models[s.model])[s.level]===target.lv; }),true);
  }

}
/* Load one world and draw its story while it is on screen. */
function runEngine(el, getU, after){
  var token = JR.token, world = S.world;
  var opts = {mobile:MOBILE, reduced:reduced, models:W[world].models.slice().reverse().map(function(m){ return {id:m.id, efforts:storyLevels(m)}; })};
  loadWorld(world, el, opts, true).then(function(eng){
    if(!eng) return;
    if(token !== JR.token){ try{ eng.destroy(); }catch(e){} return; }
    JR.eng = eng;
    if(window.__story) window.__story.ready = true;
    if(world==='claude' && eng.constructor.grain){ var g = document.getElementById('grain'), url = eng.constructor.grain(); if(g && url) g.style.backgroundImage = 'url(' + url + ')'; }
    JR.seen = true;
    if('IntersectionObserver' in window){ JR.io = new IntersectionObserver(function(en){ JR.seen = en[0].isIntersecting; syncAudio(); }); JR.io.observe(el); }
    JR.t0 = performance.now();
    var tick = function(now){
      if(JR.eng !== eng) return;
      JR.raf = requestAnimationFrame(tick);
      syncAudio();
      if(!JR.seen || document.hidden) return;
      var still=reduced || motionPaused, u=reduced?JR.displayU:getU();
      try{ drawStoryFrame(eng,storyPosition(JR.stops, u, still),still ? 0 : (now - JR.t0)/1000); }catch(err){ console.error(err); }
      if(after) after(reduced?JR.u:u);
      syncPinned();
    };
    JR.raf = requestAnimationFrame(tick);
  });
}
function jumpTo(i, immediate=true){
  JR.skipped=false;
  i=Math.max(0,Math.min(JR.n-1,i));
  var j=document.getElementById('journey'), st=document.getElementById('stage'); if(!j || !st) return;
  if(reduced){
    JR.u=i; updateCap(i,true);
    var art=document.getElementById('stageArt'); clearTimeout(JR.fadeTimer); art.style.opacity='0';
    JR.fadeTimer=setTimeout(function(){ JR.displayU=i; if(JR.eng) drawStoryFrame(JR.eng,storyPosition(JR.stops,i,true),0); art.style.opacity='1'; },125);
    return;
  }
  if(!document.body.classList.contains('story-pinned')){document.body.classList.add('story-pinned'); setHdr(); ScrollTrigger.refresh();}
  JR.st?.getTween(true)?.kill?.(); // Cancel an in-flight scroll snap before an explicit stop jump; getTween can return a value without kill().
  var r=j.getBoundingClientRect(), span=r.height-st.offsetHeight, progress=stopToProgress(JR.stops,i);
  var top=window.scrollY+r.top-JR.hdr+span*progress;
  if(lenis){ lenis.resize(); lenis.scrollTo(top,{immediate:true,force:true}); } else window.scrollTo({top:top,behavior:'auto'});
  ScrollTrigger.update(); JR.st?.getTween()?.progress(1); JR.st?.animation?.progress(progress); JR.progress=progress; JR.u=i;
  updateCap(i,true); if(JR.eng) drawStoryFrame(JR.eng,storyPosition(JR.stops,i,reduced || motionPaused), reduced || motionPaused ? 0 : (performance.now()-JR.t0)/1000);
  syncPinned();
}
function skipStory(){ JR.skipped=true; syncAudio(); if(document.body.classList.contains('presenting')) leavePresentation(); var target=document.getElementById('all-models'); if(!target) return; lenis?.stop(); target.scrollIntoView({block:'start',behavior:'instant'}); target.focus({preventScroll:true}); lenis?.start(); syncPinned(); }

function showStory(id, lv){ JR.pending = {id:id, lv:lv}; go('models'); }
var lastFocus = null;
function openSheet(id){
  var m = model(id); if(!m) return;
  lastFocus = document.activeElement;
  document.getElementById('sheetBody').innerHTML = '<h2 id="sheetTitle">' + esc(m.name) + '</h2><div class="stop-head" style="margin-bottom:8px">' + badges(m) + '</div><p class="tag">' + esc(m.tagline) + '</p><div class="detail-in" style="--c:' + m.color + '">' + detailHTML(m) + '</div>';
  var body = document.getElementById('sheetBody'), stop = JR.stops[JR.idx];
  if(S.ch==='models' && stop?.active && JR.models[stop.model].id===id){
    var key=storyLevels(m)[stop.level], tier=accessTier(m,key);
    body.innerHTML += '<div class="readout">' + (tier?'<p class="ro-name">'+esc(tier.label)+'</p><p>'+esc(tier.desc)+'</p>':readout(m,key)+(EFF[key]?'<p class="ro-api">'+esc(apiNote(key))+'</p>':'')) + '</div>';
  }

  showSheet(false);
}
function showSheet(wide){
  var sh = document.getElementById('sheet'); sh.className = wide ? 'sheet sheet-wide' : 'sheet'; sh.hidden = false; lenis?.stop(); document.getElementById('main').inert=true; document.querySelector('.top').inert=true;
  var x = sh.querySelector('.sheet-x'); if(x) x.focus();
}
// Where each Claude model lives, in percent of valley/plate_wide.webp (the painting the world's camera travels over).
var VALLEY = {haiku:[29.9,25], sonnet:[67.2,34.6], opus:[26,76], fable:[75,74], mythos:[91,60]}; // kept above 76% so the name under a dot stays on the picture at phone width
function openMap(){
  var here = JR.models[JR.stops[JR.idx]?.model]?.id;
  var dots = JR.models.map(function(m,i){ var p = VALLEY[m.id]; if(!p) return '';
    return '<button type="button" class="map-dot" data-act="jump" data-i="' + JR.stops.findIndex(function(s){ return s.model===i; }) + '" style="left:' + p[0] + '%;top:' + p[1] + '%;--c:' + m.color + '"' + (m.id===here?' aria-current="location"':'') + ' aria-label="Go to ' + esc(m.name) + (m.id===here?' (you are here)':'') + '"><span class="map-name" aria-hidden="true">' + esc(m.short) + '</span></button>'; }).join('');
  lastFocus = document.activeElement;
  document.getElementById('sheetBody').innerHTML = '<h2 id="sheetTitle">The valley</h2><p class="fine">Each model lives in one part of the valley. Pick a dot to travel there.</p>'
    + '<div class="valley-map"><img src="/assets/claude/valley/plate_wide.webp" alt="" width="1672" height="941">' + dots + '</div>';
  showSheet(true);
}
function closeSheet(){
  var sh=document.getElementById('sheet'); if(!sh || sh.hidden) return;
  sh.hidden=true; document.getElementById('main').inert=false; document.querySelector('.top').inert=false; lenis?.start();
  if(lastFocus?.isConnected) lastFocus.focus({preventScroll:true}); else document.querySelector('#cap button:not(:disabled)')?.focus({preventScroll:true});
}

function effState(){
  var u = usable(), id = S.effModel[S.world], m = id ? model(id) : null;
  if(!m || m.status!=='available') m = startModel();
  var lv = S.effLevel[S.world];
  if(!lv || m.efforts.indexOf(lv)<0) lv = m.start;
  return {m:m, lv:lv, list:u};
}
function readout(m,lv){
  if(!EFF[lv]) return '';
  var f=FIELDS[S.field];
  return '<div class="ro-head">' + levelPips(m,lv) + (lv===m.start?'<span class="badge">Default effort</span>':'') + '</div>'
    + '<p>' + esc(EFF[lv].desc) + '</p>' + costMeter(lv)
    + '<div class="field-ex" style="--c:' + m.color + '"><p class="field-label">In ' + esc(f.label) + ' on ' + esc(m.short) + '</p><p>' + esc(f.eff[lv]) + '</p></div>';
}

function chEffort(){
  var w = world(), st = effState(), m = st.m, lv = st.lv;
  var chips = st.list.map(function(x){ return '<button class="chip" type="button" data-act="effmodel" data-v="' + x.id + '" aria-pressed="' + (x.id===m.id) + '" style="--c:' + x.color + '"><span class="dot"></span>' + esc(x.name) + '</button>'; }).join('');
  var lvls = w.efforts.map(function(k){ var ok = m.efforts.indexOf(k)>=0;
    return '<button type="button" role="radio" data-act="efflevel" data-v="' + k + '" aria-checked="' + (k===lv) + '" tabindex="' + (k===lv?0:-1) + '"' + (ok?'':' disabled title="' + esc(m.name) + ' does not offer this level"') + '>' + EFF[k].label + '</button>'; }).join('');
  return '<section class="ch" aria-labelledby="h-effort"><h1 tabindex="-1" id="h-effort">Effort: how long it thinks</h1>'
    + '<p class="lede">Same model, more or less thinking before it answers. Higher effort helps on hard problems, but it takes longer and uses more of your limit.</p>'
    + '<div class="chips" role="group" aria-label="Model">' + chips + '</div>'
    + '<div class="levels" id="levels" role="radiogroup" aria-label="Effort level"><span class="lv-ind" id="lvInd"></span>' + lvls + '</div>'
    + (w.efforts.filter(function(k){return !m.efforts.includes(k);}).length?'<p class="unavailable-reason">' + esc(m.short) + ' does not offer ' + w.efforts.filter(function(k){return !m.efforts.includes(k);}).map(function(k){return EFF[k].label;}).join(', ') + '.</p>':'')
    + '<div class="readout" id="readout" aria-live="polite">' + readout(m, lv) + '</div>'
    + '<button type="button" class="story-show" data-act="show-story">Show this in the story</button>'
    + '<p class="after">' + esc(w.effortNote) + '</p></section>';
}
function placeInd(){
  var box = document.getElementById('levels'), ind = document.getElementById('lvInd'); if(!box||!ind) return;
  var b = box.querySelector('[aria-checked="true"]'); if(!b) return;
  ind.style.left = b.offsetLeft + 'px'; ind.style.width = b.offsetWidth + 'px';
  var l = b.offsetLeft - 8, r = b.offsetLeft + b.offsetWidth + 8;
  if(l < box.scrollLeft || r > box.scrollLeft + box.clientWidth){ box.scrollTo({left: Math.max(0, l - 20), behavior: reduced?'auto':'smooth'}); }
}

function chExamples(){
  var w = world(), f = FIELDS[S.field], list = '';
  var fchips = Object.keys(FIELDS).map(function(k){ return '<button class="chip" type="button" data-act="field" data-v="' + k + '" aria-pressed="' + (k===S.field) + '">' + esc(FIELDS[k].label) + '</button>'; }).join('');
  if(S.exMode==='model'){
    list = w.models.map(function(m){
      var off = m.status!=='available';
      var txt = off ? (m.status==='testing' ? 'Not released yet. Expected in the fast tier.' : 'Not open to the public yet.') : f.role[m.role];
      return '<li class="ex' + (off?' off':'') + '"><div class="mini">' + ill(m) + '</div><div><b>' + esc(m.name) + ' <span class="who">' + (off?'':ROLE[m.role]) + '</span></b><p>' + esc(txt) + '</p></div></li>';
    }).join('');
  } else {
    var sm = startModel();
    list = w.efforts.map(function(k){
      var on = k==='ultra' ? 'GPT-6 Astra in ChatGPT Work or Codex' : (k==='none' ? 'GPT-6.1 Sol or Luna' : sm.name);
      return '<li class="ex"><div class="lv">' + bars5(k) + '<span>' + EFF[k].label + '</span></div><div><b>' + esc(f.eff[k]) + '</b><p class="who">Try it on ' + esc(on) + (k===sm.start?', the starting level':'') + '</p></div></li>';
    }).join('');
  }
  var caution = (S.field==='nutrition'||S.field==='clinical') ? '<p class="caution">Any model can be confidently wrong about doses, nutrient values and guidelines. Check them against your references, at every model and effort level.</p>' : '';
  return '<section class="ch" aria-labelledby="h-ex"><h1 tabindex="-1" id="h-ex">Examples for your field</h1>'
    + '<p class="lede">Pick your field, then see what each ' + (S.exMode==='model'?'model':'effort level') + ' is good for.</p>'
    + '<div class="chips" role="group" aria-label="Field">' + fchips + '</div>'
    + '<div class="seg" role="group" aria-label="Group examples"><button type="button" data-act="exmode" data-v="model" aria-pressed="' + (S.exMode==='model') + '">By model</button><button type="button" data-act="exmode" data-v="effort" aria-pressed="' + (S.exMode==='effort') + '">By effort</button></div>'
    + '<ul class="ex-list">' + list + '</ul>' + caution + '</section>';
}

function cmpState(){
  var w = world(), c = S.cmp[S.world];
  if(!c){ c = {a:{m:w.cmp[0][0],e:w.cmp[0][1]}, b:{m:w.cmp[1][0],e:w.cmp[1][1]}}; S.cmp[S.world] = c; }
  return c;
}
function priceEfforts(m){ return m.efforts.filter(function(k){ return k!=='none' && k!=='ultra'; }); }
function cmpCol(key, side){
  var u = usable(), sel = side.m, m = model(sel), effs = priceEfforts(m);
  if(effs.indexOf(side.e)<0) side.e = effs.indexOf('medium')>=0 ? 'medium' : effs[0];
  var mo = u.map(function(x){ return '<option value="' + x.id + '"' + (x.id===sel?' selected':'') + '>' + esc(x.name) + '</option>'; }).join('');
  var eo = effs.map(function(k){ return '<option value="' + k + '"' + (k===side.e?' selected':'') + '>' + EFF[k].label + '</option>'; }).join('');
  return '<div class="cmp-col" style="--c:' + m.color + '"><span class="tagab">Option ' + key.toUpperCase() + '</span>'
    + '<label class="sr" for="cm-' + key + '">Model for option ' + key.toUpperCase() + '</label><select id="cm-' + key + '" data-cmp="' + key + '" data-k="m">' + mo + '</select>'
    + '<label class="sr" for="ce-' + key + '">Effort for option ' + key.toUpperCase() + '</label><select id="ce-' + key + '" data-cmp="' + key + '" data-k="e">' + eo + '</select>'
    + '<div class="cmp-cost" id="cc-' + key + '"></div><p class="cmp-sub">per paper summary</p><div class="track2"><i id="cb-' + key + '" style="width:0"></i></div></div>';
}
function verdict(A, B){
  var ra = RANK[A.m.role], rb = RANK[B.m.role], r = A.cost/B.cost, cl, adv;
  if(r > 0.85 && r < 1.18) cl = 'They cost about the same per task.';
  else if(r >= 1.18) cl = 'A costs about ' + r.toFixed(1) + '× as much as B.';
  else cl = 'B costs about ' + (1/r).toFixed(1) + '× as much as A.';
  if(A.m.id===B.m.id){ adv = 'Same model, different thinking time. Raise effort only when answers skip steps or slip on details.'; }
  else if(ra===rb){ adv = 'Both sit in the same tier, so pick the newer or cheaper one and tune its effort.'; }
  else {
    var big = ra>rb ? A : B, small = big===A ? B : A;
    if(lvIndex(big.e) < lvIndex(small.e)){
      adv = big.m.name + ' on ' + EFF[big.e].label + ' brings more knowledge and judgment. ' + small.m.name + ' on ' + EFF[small.e].label + ' spends longer checking its own work. Choose ' + big.m.short + ' when the task needs expertise or nuance, and ' + small.m.short + ' when it is well defined but has many steps to verify.';
    } else {
      adv = big.m.name + ' is the stronger model and thinks at least as long, so expect a better answer at a higher cost.';
    }
  }
  return '<p>' + cl + '</p><p>' + esc(adv) + '</p>';
}
function updateCmp(){
  var c = cmpState(), p = PRESETS.paper;
  var A = {m:model(c.a.m), e:c.a.e}, B = {m:model(c.b.m), e:c.b.e};
  A.cost = taskCost(A.m, A.e, p); B.cost = taskCost(B.m, B.e, p);
  var mx = Math.max(A.cost, B.cost);
  var ca = document.getElementById('cc-a'); if(!ca) return;
  ca.textContent = money(A.cost); document.getElementById('cc-b').textContent = money(B.cost);
  document.getElementById('cb-a').style.width = (A.cost/mx*100) + '%';
  document.getElementById('cb-b').style.width = (B.cost/mx*100) + '%';
  document.getElementById('verdict').innerHTML = verdict(A, B); 
}
function chUpgrade(){
  var w = world(), sm = startModel(), fast = smallest();
  var gem = S.world==='gemini';
  var steps = [
    ['Start at ' + sm.name + ' on ' + EFF[w.start.effort].label + '.', 'It is the recommended starting point and handles most work.'],
    ['Shallow answer or a skipped step? Raise effort one notch.', 'Same model, more thinking time. It is the cheapest fix to try first.'],
    [gem ? 'Still weak on High? Move up a model.' : 'Still weak on High? Move up a model before you reach for Max.', gem ? 'Gemini stops at High, so the next step is a bigger model.' : 'Past High, one more effort step can cost about as much as a bigger model.'],
    ['Good answer, but slow? Lower the effort.', 'If Low still works, try a smaller model too.'],
    ['Same small job, over and over? Use the smallest model on Low.', fast.name + ' handles volume work for a fraction of the cost.']
  ].map(function(s){ return '<li><div><b>' + esc(s[0]) + '</b><p>' + esc(s[1]) + '</p></div></li>'; }).join('');
  var sym = [
    ['It misses steps or makes arithmetic slips','Raise effort',IC.up,true],
    ['It lacks knowledge or judgment, even on High','Bigger model',IC.up,true],
    ['The answer is right, but it takes too long','Lower effort',IC.down,false],
    ['You keep hitting your usage limit','Smaller model',IC.down,false],
    ['A big job with separate parts','Split into smaller tasks',IC.split,false],
    ['Doses, guidelines or nutrient values','Check the source',IC.check,false]
  ].map(function(r){ return '<div class="sym-row"><span>' + esc(r[0]) + '</span><span class="fix' + (r[3]?' strong':'') + '">' + r[2] + esc(r[1]) + '</span></div>'; }).join('');
  var c = cmpState();
  return '<section class="ch" aria-labelledby="h-up"><h1 tabindex="-1" id="h-up">Upgrade the model or the effort?</h1>'
    + '<p class="lede">Turn up effort when the model rushes. Move up a model when it does not know enough.</p>'
    + '<div class="chapter-grid upgrade-grid"><ol class="steps upgrade-steps">' + steps + '</ol><div class="upgrade-tools">'
    + '<div class="upgrade-symptoms"><h2>Match the symptom to the fix</h2><div class="sym">' + sym + '</div></div>'
    + '<div class="upgrade-comparator"><h2>A bigger model on Low, or a smaller one on Extra high?</h2>'
    + '<p class="fine">Pick two setups. Costs are estimates for summarizing one 10-page paper through the API.</p>'
    + '<div class="cmp">' + cmpCol('a', c.a) + cmpCol('b', c.b) + '</div>'
    + '<div class="verdict" id="verdict" aria-live="polite"></div>'
    + '<p class="fine" style="margin-top:14px">Anthropic’s 9 Nov 2026 model guide says to try effort before switching models, and that past High one more effort level can cost as much as a bigger model. In its test, Fable on High scored about the same as Opus on Max, at roughly half the cost per task.</p></div></div></div></section>';
}

function chCost(){
  var w = world(), u = usable();
  var rows = w.models.map(function(m){
    var sub = priceExplanation(m) ? '<span class="sub">' + esc(priceExplanation(m)) + '</span>' : (m.status==='testing' ? '<span class="sub">Not released</span>' : '');
    return '<tr style="--c:' + m.color + '"><td><span class="nm"><span class="dot"></span>' + esc(m.name) + '</span>' + sub + priceVersion(m) + '</td>'
      + '<td class="num">' + (m.price ? '$' + pnum(m.price.inP) : '–') + '</td><td class="num">' + (m.price ? '$' + pnum(m.price.outP) : '–') + '</td></tr>';
  }).join('');
  var effs = w.efforts.filter(function(k){ return k!=='none' && k!=='ultra'; });
  if(effs.indexOf(S.costEff)<0) S.costEff = 'medium';
  var pchips = Object.keys(PRESETS).map(function(k){ return '<button class="chip" type="button" data-act="preset" data-v="' + k + '" aria-pressed="' + (k===S.preset) + '">' + PRESETS[k].label + '</button>'; }).join('');
  var echips = effs.map(function(k){ return '<button class="chip" type="button" data-act="costeff" data-v="' + k + '" aria-pressed="' + (k===S.costEff) + '">' + EFF[k].label + '</button>'; }).join('');
  var hasLater = u.some(function(m){ return m.price && m.price.later; });
  var p = PRESETS[S.preset];
  var costs = u.map(function(m){ return {m:m, c: taskCost(m, S.costEff, p)}; });
  var mx = Math.max.apply(null, costs.map(function(x){ return x.c; }));
  var bars = costs.map(function(x){ return '<div class="bar-row" style="--c:' + x.m.color + '"><span class="nm">' + esc(x.m.name) + '</span><span class="bar"><i style="width:' + (x.c/mx*100).toFixed(1) + '%"></i></span><span class="bar-val">' + costMoney(x.c) + '<small>' + costMoney(x.c*100) + ' per 100</small></span></div>'; }).join('');
  return '<section class="ch" aria-labelledby="h-cost"><h1 tabindex="-1" id="h-cost">What it costs</h1>'
    + '<p class="lede">API list prices in US dollars per million tokens. A million tokens is about 750,000 words. Reasoning tokens bill as output, so higher effort raises the output side.</p>'
    + '<div class="chapter-grid cost-grid"><div class="cost-prices"><div class="tbl"><table><thead><tr><th scope="col">Model</th><th scope="col" class="num">Input</th><th scope="col" class="num">Output</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '</div><div class="cost-estimate"><h2>Estimate one task</h2>'
    + '<div class="chips" role="group" aria-label="Task size">' + pchips + '</div>'
    + '<div class="chips cost-efforts" role="group" aria-label="Effort">' + echips + '</div>'
    + (hasLater ? '<label class="toggle"><input type="checkbox" data-act="later"' + (S.later?' checked':'') + '> Use prices after the intro period ends</label>' : '')
    + '<p class="fine">' + esc(p.label) + ': ' + esc(p.desc) + '.</p>'
    + '<div class="bars">' + bars + '</div>'
    + '<p class="fine" style="margin-top:14px">Effort multipliers are rough. Claude and OpenAI use Low 0.6×, High 1.3×, Extra high 2.2× and Max 3.7× the Medium cost, from one published benchmark of Opus. Gemini uses 0.6× and 1.4×, from Artificial Analysis runs of Flash. Real tasks vary.</p>'
    + '<div class="plan"><h2>On a subscription?</h2><p>Claude Pro, ChatGPT Plus and Google AI Pro do not bill per task. Bigger models and higher effort use up your limit faster, in roughly these ratios.</p></div></div></div></section>';
}

/* ---------- chapter 6: Let Effort choose ---------- */
function chChoose(){
 var ex=EXAMPLES.map(function(p,i){return '<button class="chip" type="button" data-act="example" data-i="' + i + '">' + rawEsc(p) + '</button>';}).join('');
 return '<section class="ch choose" aria-labelledby="h-choose"><h1 tabindex="-1" id="h-choose">Let Effort choose (for coding agents)</h1>'
 + '<p class="lede">This chapter is for people who use coding agents. Everyone else can stop at chapter 5.</p>'
 + '<div class="chapter-grid choose-grid"><div class="choose-input"><label class="choose-lab" for="choosePrompt">Type a coding task, or try an example</label><textarea id="choosePrompt" class="choose-in" rows="3" maxlength="2000" spellcheck="false">' + rawEsc(S.prompt) + '</textarea>'
 + '<div class="chips" role="group" aria-label="Example prompts">' + ex + '</div></div><div class="choose-out" id="chooseOut"></div></div><p class="sr-only" id="chooseStatus" role="status"></p>'
 + '<details class="note"><summary>How this demo works</summary><p>These are Effort’s real rules, running in your browser. Nothing you type leaves this page. The rules look for coding words such as “race condition”, “migration” or “typo”. A nutrition or study question gets “Medium, difficulty uncertain”. Effort never suggests more than High and never changes your model.</p><p>The model suggestion is this guide’s own rule. The rest of the guide does not depend on Effort.</p></details>'
 + '<a class="primary-link" href="https://github.com/AntyLab/effort-project">Get Effort on GitHub</a><div class="install-code"><pre><code id="installCommand">npm install --global github:AntyLab/effort-project</code></pre><button type="button" data-act="copy-install">Copy install command</button><span id="copyStatus" role="status"></span></div></section>';
}
var chooseTimer=0;
function announceChoose(text){ clearTimeout(chooseTimer); chooseTimer=setTimeout(function(){ var status=document.getElementById('chooseStatus'); if(status) status.textContent=text; },600); }

function updateChoose(){
  var out = document.getElementById('chooseOut'); if(!out) return;
  var r = effortPick(S.prompt);
  if(!r){ out.innerHTML = '<p class="choose-empty">Type a task above to see Effort’s pick.</p>'; announceChoose('Type a task above to see Effort’s pick.'); return; }
  var g = guideModelRole(r.features), w = world(), u = usable();
  var m = g.role==='fast' ? smallest() : (g.role==='frontier' ? u[0] : startModel());
  var lv = m.efforts.indexOf(r.effort)>=0 ? r.effort : m.start;
  out.innerHTML = '<div class="pick"><div class="pick-col"><p class="pick-who">Effort picks the effort</p><div class="pick-big">' + levelPips({efforts:w.efforts},r.effort) + '</div>'
    + '<ul class="pick-why">' + r.reasons.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
    + '<p class="pick-fine">' + esc(r.caveat) + ' Rules version ' + esc(r.policyVersion) + '.</p></div>'
    + '<div class="pick-col" style="--c:' + m.color + '"><p class="pick-who">This guide suggests the model</p><p class="pick-big"><span class="dot"></span>' + esc(m.name) + '</p>'
    + '<ul class="pick-why"><li>' + esc(g.why) + '</li></ul>'
    + '<p class="pick-fine">From the ' + esc(w.label) + ' family (change it at the top). ' + priceText(m) + ' per 1M tokens.</p>'
    + '<button type="button" class="cap-more" data-act="see-effort" data-m="' + m.id + '" data-v="' + lv + '">See ' + esc(m.short) + ' on ' + EFF[lv].label + '</button></div></div>';
  announceChoose('Effort: ' + EFF[r.effort].label + '. Suggested model: ' + m.short + '.');
}

/* ---------- shell ---------- */
function saveFocus(root){
 var el=document.activeElement; if(!el || !root?.contains(el)) return null;
 return {id:el.id, act:el.getAttribute('data-act'), v:el.getAttribute('data-v'), i:el.getAttribute('data-i'), model:el.getAttribute('data-id'), start:el.selectionStart, end:el.selectionEnd};
}
function restoreFocus(saved,root){
 if(!saved) return;
 var el=saved.id?document.getElementById(saved.id):Array.from(root.querySelectorAll('[data-act]')).find(function(node){
  return node.getAttribute('data-act')===saved.act && node.getAttribute('data-v')===saved.v && node.getAttribute('data-i')===saved.i;
 });
 if(el?.disabled) el=root.querySelector('button:not(:disabled)');
 el?.focus({preventScroll:true});
 if(el?.setSelectionRange && typeof saved.start==='number') el.setSelectionRange(saved.start,saved.end);
}
function updateTabEdges(){
 var nav=document.getElementById('chapters'); if(!nav) return;
 nav.dataset.moreLeft=String(nav.scrollLeft>2); nav.dataset.moreRight=String(nav.scrollLeft+nav.clientWidth<nav.scrollWidth-2);
}
function renderHeader(){
 var header=document.querySelector('.top'), focus=saveFocus(header);
 document.getElementById('worlds').innerHTML=Object.keys(W).map(function(k){return '<button type="button" data-act="world" data-v="'+k+'" aria-pressed="'+(k===S.world)+'">'+IC[k]+W[k].label+'</button>';}).join('');
 var nav=document.getElementById('chapters');
 nav.innerHTML=CH.map(function(c,i){return '<a class="tab" href="#'+S.world+'-'+c.id+'" data-act="ch" data-v="'+c.id+'"'+(c.id===S.ch?' aria-current="step"':'')+'><span class="n">'+(i+1)+'</span>'+c.label+'</a>';}).join('');
 var fs=document.getElementById('fieldSel');
 fs.innerHTML=Object.keys(FIELDS).map(function(k){return '<option value="'+k+'"'+(k===S.field?' selected':'')+'>'+esc(FIELDS[k].label)+'</option>';}).join('');
 fs.closest('.field-pick').hidden=S.ch==='choose';
 document.querySelectorAll('.by-effort').forEach(function(link){link.href='#'+S.world+'-choose';});
 document.getElementById('compactFamily').textContent=world().label;
 var menu=document.getElementById('headerMenu'); menu.innerHTML=CH.find(function(c){return c.id===S.ch;}).label+' '+IC.chev;
 menu.setAttribute('aria-label','Chapter menu: '+CH.find(function(c){return c.id===S.ch;}).label); menu.setAttribute('aria-expanded',String(document.body.classList.contains('header-expanded')));
 nav.onscroll=updateTabEdges;
 restoreFocus(focus,header); updatePresentationButtons(); setHdr();
 requestAnimationFrame(function(){
  var cur=nav.querySelector('[aria-current="step"]');
  if(cur) nav.scrollTo({left:Math.max(0,cur.offsetLeft-nav.offsetLeft-(nav.clientWidth-cur.offsetWidth)/2),behavior:'instant'});
  updateTabEdges();
 });
}

function pager(){
  var i = CH.findIndex(function(c){ return c.id===S.ch; }), h = '';
  if(i>0) h += '<button type="button" data-act="ch" data-v="' + CH[i-1].id + '">' + IC.left + 'Back</button>';
  if(i<CH.length-1) h += '<button type="button" class="next" data-act="ch" data-v="' + CH[i+1].id + '">Next: ' + CH[i+1].label + IC.right + '</button>';
  else h += '<button type="button" class="next" data-act="ch" data-v="models">Back to models</button>';
  return '<div class="pager">' + h + '</div>';
}
function renderMain(dir){
 var main=document.getElementById('main'), focus=saveFocus(main);
 var preserve=S.ch==='models' && !dir && JR.idx>=0?{index:JR.idx}:null;
 stopJourney(); if(preserve && !JR.pending) JR.pending=preserve;
 clearTimeout(chooseTimer);
 main.setAttribute('data-dir',dir||'none');
 var fn={models:chModels,effort:chEffort,examples:chExamples,upgrade:chUpgrade,cost:chCost,choose:chChoose}[S.ch];
 main.innerHTML=fn()+pager(); attachStageControls(); restoreFocus(focus,main);
 if(S.ch==='effort') requestAnimationFrame(placeInd);
 if(S.ch==='choose') updateChoose();
 if(S.ch==='upgrade') updateCmp();
 if(S.ch==='models') requestAnimationFrame(startJourney);
 renderFooter(); setHdr(); ScrollTrigger.refresh();
}
function render(dir){
 closeSheet();
 loadDisplayFont();
 document.body.setAttribute('data-world',S.world);
 if(S.ch!=='models'){document.body.classList.remove('story-pinned','header-expanded');}
 var tc=document.querySelector('meta[name="theme-color"]'); if(tc) tc.setAttribute('content',world().theme);
 document.title=CH.find(function(c){return c.id===S.ch;}).label+' · '+world().label+' · Model guide';
 renderHeader(); renderMain(dir);
}
function setHash(replace=false){
 var h='#'+S.world+'-'+S.ch;
 if(location.hash!==h) history[replace?'replaceState':'pushState'](null,'',h);
}
function readHash(){
 var m=/^#(claude|openai|gemini)-(models|effort|examples|upgrade|cost|choose)$/.exec(location.hash||'');
 if(!m) return false;
 var changed=m[1]!==S.world || m[2]!==S.ch; S.world=m[1]; S.ch=m[2]; return changed;
}
function chapterFocus(){ document.querySelector('main h1')?.focus({preventScroll:true}); }
function go(ch){
 var old=S.ch, a=CH.findIndex(function(c){return c.id===old;}), b=CH.findIndex(function(c){return c.id===ch;});
 S.ch=ch; setHash(); render(ch===old?null:(b<a?'back':'fwd'));
 if(lenis) lenis.scrollTo(0,{immediate:true}); else window.scrollTo(0,0);
 if(ch!==old) chapterFocus();
}
function switchWorld(k){
 if(k===S.world) return;
 S.world=k; JR.pending=null; setHash(); render();
}
function setField(k){
 S.field=k; try{localStorage.setItem('mg-field',k);}catch(e){}
 var fs=document.getElementById('fieldSel'); if(fs) fs.value=k;
 // In the story, update in place: a full re-render restarts the story and collapses the header the visitor just opened.
 if(S.ch==='models' && JR.stops){
  JR.idx=-1; updateCap(JR.u);
  world().models.forEach(function(m){ var d=document.querySelector('#d-'+m.id+' .detail-in'); if(d) d.innerHTML=detailHTML(m); });
  return;
 }
 renderMain();
}
async function copyInstall(){
 var code=document.getElementById('installCommand'), status=document.getElementById('copyStatus');
 try{await navigator.clipboard.writeText(code.textContent); status.textContent='Copied';}
 catch(e){var range=document.createRange(); range.selectNodeContents(code); var selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range); status.textContent='Select and copy the command above.';}
}

function loadDisplayFont(){
 var fonts={openai:'Urbanist:wght@400;500;600;700;800',gemini:'Google+Sans+Flex:wght@400..700&family=Outfit:wght@400;500;600;700'};
 if(!fonts[S.world] || document.getElementById('font-'+S.world)) return;
 var link=document.createElement('link'); link.id='font-'+S.world; link.rel='stylesheet';
 link.href='https://fonts.googleapis.com/css2?family='+fonts[S.world]+'&display=swap'; document.head.append(link);
}
function focusPresentationControl(){
 requestAnimationFrame(function(){
  if(!document.body.classList.contains('presenting')) return;
  document.querySelector(S.ch==='models'?'#cap [data-act="story-next"]':'.top [data-act="present"]')?.focus({preventScroll:true});
 });
}
function toggleMotion(){
 motionPaused=!motionPaused;
 document.body.classList.toggle('motion-paused',motionPaused);
 var button=document.querySelector('[data-act="motion"]');
 button.textContent=motionPaused?'Play motion':'Pause motion'; button.setAttribute('aria-pressed',String(motionPaused));
 // Freeze the current plate without changing the story's scroll geometry or focus.
 syncAudio();
 if(motionPaused && JR.eng) drawStoryFrame(JR.eng,storyPosition(JR.stops,journeyU(),true),0);
}
/* ---------- optional story sound ---------- */
function syncAudio(){
 syncStageControls();
 var rect=document.getElementById('stage')?.getBoundingClientRect?.();
 audio.setSuspended(document.hidden || motionPaused || S.ch!=='models' || !JR.eng || !JR.seen || JR.skipped || !rect || rect.bottom<=JR.hdr || rect.top>=innerHeight);
}
function drawStoryFrame(eng,pos,time){
 var m=JR.models[Math.round(pos.model)];
 var bed=S.world==='openai'?'space':(S.world==='gemini'?'hum':({haiku:'sky',sonnet:'tower',opus:'pond',fable:'meadow',mythos:'night'})[m?.id]);
 if(JR.bed!==bed){ JR.bed=bed; audio.scene(bed || null); }
 syncStageTheme(pos);
 eng.frame(pos,time);
 var art=document.getElementById('stageArt'); if(art) art.dataset.drawn='true';
 var cues=eng.cues?.() || [];
 // Drain queues on every plate, but never play events from static/reduced-motion frames.
 if(time!==0 && !reduced && !motionPaused) cues.forEach(function(name){ audio.cue(name); });
}
function startSound(){
 if(!soundEnabled || soundStarted) return;
 syncAudio(); audio.setEnabled(true); soundStarted=true;
 document.removeEventListener('pointerdown',soundGesture,true); document.removeEventListener('keydown',soundGesture,true);
}
function soundGesture(e){
 if(e.target?.closest?.('[data-act="sound"]')) return;
 startSound();
}
function updateSoundButton(){
 var button=document.querySelector('[data-act="sound"]'); if(!button) return;
 button.textContent=soundEnabled?'Mute sound':'Play sound'; button.setAttribute('aria-pressed',String(soundEnabled));
}
function toggleSound(){
 soundEnabled=!soundEnabled;
 try{ localStorage.setItem('mg-sound',soundEnabled?'on':'off'); }catch(e){}
 if(soundEnabled) startSound();
 else { audio.setEnabled(false); soundStarted=false; }
 updateSoundButton();
}
function initializeSound(){
 var motion=document.querySelector('[data-act="motion"]'), controls=document.createElement('div');
 controls.className='stage-controls'; controls.hidden=true; stageControls=controls; motion.before(controls); controls.append(motion);
 // A press must not let the browser scroll the pinned stage to reveal the focused button under the header; that nudge then snapped the story back one stop.
 controls.addEventListener?.('pointerdown',function(e){ var b=e.target.closest('button'); if(!b) return; e.preventDefault(); b.focus({preventScroll:true}); });
 var button=document.createElement('button'); button.type='button'; button.className='motion-toggle'; button.dataset.act='sound';
 controls.append(button);
 var map=document.createElement('button'); map.type='button'; map.className='motion-toggle'; map.dataset.act='map'; map.textContent='Map'; map.setAttribute('aria-haspopup','dialog'); controls.append(map); mapButton=map;
 attachStageControls(); updateSoundButton();
 document.addEventListener('pointerdown',soundGesture,true); document.addEventListener('keydown',soundGesture,true);
 document.addEventListener('visibilitychange',syncAudio);
}
/* ---------- keyboard and presentation ---------- */
var PRESENT = {cursorTimer:0, token:0, focus:null};
function updatePresentationButtons(){
 var active=document.body.classList.contains('presenting');
 document.querySelectorAll('[data-act="present"]').forEach(function(button){
  button.textContent=active?'Exit':'Present'; button.setAttribute('aria-pressed',String(active));
  button.setAttribute('aria-label',active?'Exit presentation':'Present story fullscreen');
 });
}
function handleStoryKey(e){
 if(e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || S.ch!=='models' || JR.skipped || JR.idx<0 || !JR.n) return false;
 var sheet=document.getElementById('sheet'); if(sheet && !sheet.hidden) return false;
 var editing=function(node){return node?.isContentEditable || node?.closest?.('input, select, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]');};
 if(editing(e.target) || editing(document.activeElement)) return false;
 if([' ','Spacebar'].includes(e.key) && e.target?.closest?.('button,a,summary,[role=radio],[role=tab]')) return false;
 var stage=document.getElementById('stage'), rect=stage?.getBoundingClientRect();
 if(!rect || rect.bottom<=JR.hdr || rect.top>=innerHeight) return false;
 var next=['ArrowRight','ArrowDown','PageDown',' ','Spacebar'].includes(e.key), prev=['ArrowLeft','ArrowUp','PageUp'].includes(e.key), index;
 if(next) index=Math.min(JR.n-1,JR.idx+1);
 else if(prev) index=Math.max(0,JR.idx-1);
 else if(e.key==='Home') index=0;
 else if(e.key==='End') index=JR.n-1;
 else return false;
 if(index===JR.idx) return false;
 e.preventDefault(); jumpTo(index,true); return true;
}
function resetPresentationCursor(){
 clearTimeout(PRESENT.cursorTimer); document.body.classList.remove('cursor-idle');
 if(document.body.classList.contains('presenting')) PRESENT.cursorTimer=setTimeout(function(){
  if(document.body.classList.contains('presenting')) document.body.classList.add('cursor-idle');
 },3000);
}
function refreshPresentationLayout(index){
 setHdr(); lenis?.resize(); ScrollTrigger.refresh();
 if(S.ch!=='models' || JR.idx<0) return;
 jumpTo(Math.min(JR.n-1,Math.max(0,index)),true);
 // Reduced-motion jumps change the plate only; entering/leaving the viewport still needs an explicit alignment.
 if(reduced){
  var journey=document.getElementById('journey'); if(!journey) return;
  window.scrollTo({top:window.scrollY+journey.getBoundingClientRect().top-JR.hdr,behavior:'auto'}); syncPinned();
 }
}
function queuePresentationLayout(index){
 var active=document.body.classList.contains('presenting');
 requestAnimationFrame(function(){
  if(active!==document.body.classList.contains('presenting')) return;
  refreshPresentationLayout(index);
 });
}
function enterPresentation(requestFullscreen=true){
 if(document.body.classList.contains('presenting')) return;
 var token=++PRESENT.token, index=S.ch==='models' && JR.idx>=0?JR.idx:0;
 PRESENT.focus=document.activeElement;
 document.body.classList.add('presenting'); document.body.classList.remove('header-expanded');
 // Request within the initiating click; URL entry deliberately bypasses the browser fullscreen API.
 if(requestFullscreen && document.documentElement.requestFullscreen){
  try{ Promise.resolve(document.documentElement.requestFullscreen()).then(function(){
   if(token!==PRESENT.token && document.fullscreenElement===document.documentElement) document.exitFullscreen?.()?.catch?.(function(){});
  }).catch(function(){ /* The window-sized presentation remains usable when fullscreen is unavailable. */ }); }catch(e){}
 }
 if(S.ch==='models' && JR.idx<0) JR.pending={index:index};
 updatePresentationButtons(); setHdr(); resetPresentationCursor(); queuePresentationLayout(index);
 focusPresentationControl();
}
function leavePresentation(exitFullscreen=true){
 if(!document.body.classList.contains('presenting')) return;
 var index=Math.max(0,JR.idx); ++PRESENT.token;
 document.body.classList.remove('presenting','cursor-idle'); clearTimeout(PRESENT.cursorTimer);
 if(exitFullscreen && document.fullscreenElement===document.documentElement){
  try{document.exitFullscreen?.()?.catch?.(function(){});}catch(e){}
 }
 updatePresentationButtons(); setHdr(); queuePresentationLayout(index);
 if(PRESENT.focus?.isConnected) PRESENT.focus.focus({preventScroll:true});
}
function syncFullscreen(){
 if(document.body.classList.contains('presenting') && document.fullscreenElement!==document.documentElement) leavePresentation(false);
}
function initializePresentation(){
 if(new URLSearchParams(location.search).get('present')==='1') enterPresentation(false);
}

document.addEventListener('click', function(e){
  var b = e.target.closest('[data-act]'); if(!b || b.disabled) return;
  var a = b.getAttribute('data-act'), v = b.getAttribute('data-v');
  if(b.tagName==='A'){ if(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button>0) return; e.preventDefault(); }
  if(a==='motion'){ toggleMotion(); }
  else if(a==='sound'){ toggleSound(); }
  else if(a==='present'){ if(document.body.classList.contains('presenting')) leavePresentation(); else enterPresentation(); }
  else if(a==='header-menu'){ document.body.classList.toggle('header-expanded'); b.setAttribute('aria-expanded',String(document.body.classList.contains('header-expanded'))); setHdr(); ScrollTrigger.refresh(); }
  else if(a==='story-prev'){ jumpTo(JR.idx-1,true); }
  else if(a==='story-next'){ jumpTo(JR.idx+1,true); }
  else if(a==='skip-story'){ skipStory(); }
  else if(a==='copy-install'){ copyInstall(); }
  else if(a==='credits'){ go('models'); requestAnimationFrame(function(){document.getElementById('credits-sources').scrollIntoView({block:'start'}); document.getElementById('credits-sources').focus({preventScroll:true});}); }
  else if(a==='world'){ switchWorld(v, b); }
  else if(a==='ch'){ go(v); }
  else if(a==='jump'){ closeSheet(); jumpTo(+b.getAttribute('data-i')); }
  else if(a==='map'){ openMap(); }
  else if(a==='sheet'){ openSheet(b.getAttribute('data-id')); }
  else if(a==='sheet-close'){ closeSheet(); }
  else if(a==='open'){ var li = b.closest('.stop'); var o = !li.classList.contains('open'); li.classList.toggle('open', o); b.setAttribute('aria-expanded', o); }
  else if(a==='effmodel'){ S.effModel[S.world] = v; renderMain(); }
  else if(a==='efflevel'){
    S.effLevel[S.world] = v; var st = effState();
    document.getElementById('readout').innerHTML = readout(st.m, st.lv);
    Array.prototype.forEach.call(document.querySelectorAll('#levels [role="radio"]'), function(x){ var checked=x.getAttribute('data-v')===st.lv; x.setAttribute('aria-checked',checked); x.tabIndex=checked?0:-1; });
    placeInd();
  }
  else if(a==='field'){ setField(v); }
  else if(a==='example'){ S.prompt = EXAMPLES[+b.getAttribute('data-i')]; var ta = document.getElementById('choosePrompt'); if(ta) ta.value = S.prompt; updateChoose(); }
  else if(a==='see-effort'){ showStory(b.getAttribute('data-m'), v); }
  else if(a==='show-story'){ var pick = effState(); showStory(pick.m.id, pick.lv); }
  else if(a==='exmode'){ S.exMode = v; renderMain(); }
  else if(a==='preset'){ S.preset = v; renderMain(); }
  else if(a==='costeff'){ S.costEff = v; renderMain(); }
});
document.addEventListener('input', function(e){ if(e.target.id==='choosePrompt'){ S.prompt = e.target.value; updateChoose(); } });
document.addEventListener('change', function(e){
  var t = e.target;
  if(t.id==='fieldSel'){ setField(t.value); return; }
  if(t.getAttribute('data-act')==='later'){ S.later = t.checked; renderMain(); return; }
  var k = t.getAttribute('data-cmp');
  if(k){ var c = cmpState(); c[k][t.getAttribute('data-k')] = t.value; renderMain(); }
});
document.addEventListener('keydown', function(e){
  if(e.key==='Escape'){
    var openSheet=document.getElementById('sheet');
    if(openSheet && !openSheet.hidden){ e.preventDefault(); closeSheet(); return; }
    if(document.body.classList.contains('header-expanded')){
      e.preventDefault(); document.body.classList.remove('header-expanded');
      var menu=document.getElementById('headerMenu'); menu?.setAttribute('aria-expanded','false'); menu?.focus({preventScroll:true}); return;
    }
    if(document.body.classList.contains('presenting')){e.preventDefault();leavePresentation();return;}
  }
  if(handleStoryKey(e)) return;
  var sheet = document.getElementById('sheet');
  if(e.key==='Tab' && !sheet.hidden){
    var focusable = Array.from(sheet.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')), first = focusable[0], last = focusable[focusable.length-1];
    if(e.shiftKey && document.activeElement===first){ last.focus(); e.preventDefault(); }
    else if(!e.shiftKey && document.activeElement===last){ first.focus(); e.preventDefault(); }
  }
  var t = e.target; if(!t || t.getAttribute('role')!=='radio') return;
  if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(e.key)) return;
  var all = Array.prototype.filter.call(document.querySelectorAll('#levels [role="radio"]'), function(x){ return !x.disabled; });
  var i = all.indexOf(t); if(i<0) return;
  var n = all[(i + (['ArrowRight','ArrowDown'].includes(e.key)?1:-1) + all.length) % all.length]; n.focus(); n.click(); e.preventDefault();
});
function historyRoute(){ if(readHash()){ render('fwd'); chapterFocus(); } }
window.addEventListener('hashchange',historyRoute);
window.addEventListener('popstate',historyRoute);
window.addEventListener('scroll',function(){ syncPinned(); syncStageControls(); },{passive:true});
motionQuery.addEventListener('change',function(e){ reduced=e.matches; syncMotion(); renderMain(); syncPinned(); });
window.addEventListener('resize', function(){ var index=JR.idx; if(S.ch==='effort') placeInd(); setHdr(); updateTabEdges(); syncPinned(); queueStageClearArea(); if(document.body.classList.contains('presenting')) queuePresentationLayout(index); });
document.addEventListener('fullscreenchange',syncFullscreen);
document.addEventListener('pointermove',resetPresentationCursor,{passive:true});
document.addEventListener('pointerdown',resetPresentationCursor,{passive:true});

function renderFooter(){
 document.getElementById('foot').innerHTML = S.ch!=='models' && S.ch!=='choose' ? '<p>Unofficial guide. Not made by or affiliated with Anthropic, OpenAI or Google. <a href="#' + S.world + '-models" data-act="credits">Credits and sources</a></p>' : '<div id="credits-sources" tabindex="-1">' +
  '<p>Unofficial guide. Not made by or affiliated with Anthropic, OpenAI or Google. Model names belong to their owners.</p>'
  + '<p>A guide by <a href="https://github.com/AntyLab/effort-project">The Effort Project</a>.</p>'
  + '<p>Moon: NASA’s Scientific Visualization Studio, CGI Moon Kit. Earth: NASA Blue Marble and Black Marble.</p>'
  + '<p>Prices are API list prices in US dollars per million tokens, checked ' + checkedDate() + '. App plans bill differently, and these models change fast, so check a source before you rely on a number.</p>'
  + '<details><summary>Sources</summary><ul>'
  + '<li>Claude: the claudeai Instagram carousel “Which Claude model should you use?”; <a href="https://fourweekmba.com/ai-claude-guide-fable-5-2-costs-80x-haiku-5-5-on-short-prompts/">summary of Anthropic’s 9 Nov 2026 model guide</a>; <a href="https://platform.claude.com/docs/build-with-claude/effort">Claude effort docs</a>; <a href="https://www.ayautomate.com/resources/claude-fable-5-2-pricing">Fable 5.2 and Haiku 5.5 prices</a></li>'
  + '<li>OpenAI: <a href="https://openai.com/index/introducing-gpt-6-1-sol/">Introducing GPT-6.1 Sol</a>; <a href="https://techcrunch.com/2026/09/22/openai-launches-gpt-6-sol-and-luna/">GPT-6 Sol and Luna launch</a>; <a href="https://apidog.com/blog/gpt-6-astra-api/">GPT-6 Astra API and effort levels</a>; <a href="https://www.buildmvpfast.com/blog/gpt-6-pro-parallel-agents-chatgpt-2026">ChatGPT effort settings and GPT-6 Pro</a>; <a href="https://www.cloudzero.com/blog/gpt-6-pricing/">GPT-5.6 Terra price</a></li>'
  + '<li>Gemini: <a href="https://ai.google.dev/gemini-api/docs/latest-model">Gemini 4 Argon docs</a>; <a href="https://deepmind.google/models/model-cards/gemini-4-carbon/">Gemini 4 Carbon model card</a>; <a href="https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.8">Gemini 3.8 Flash docs</a>; <a href="https://www.buildmvpfast.com/blog/gemini-4-argon-pricing-intro-rates-2026">Gemini price changes</a>; <a href="https://officechai.com/ai/gemini-4-hydrogen/">Hydrogen reports</a></li>'
  + '<li>Effort cost data: <a href="https://aiagentstore.ai/ai-models/reasoning-effort/claude-opus-5-5">Opus 5.5 at each effort level</a>; <a href="https://apidog.com/blog/gemini-3-8-flash-thinking-levels/">Gemini 3.8 Flash thinking levels</a></li>'
  + '</ul></details></div>';
}

readHash();
setHash(true);
render('fwd');
initializeSound();
initializePresentation();
window.__guideCost=function(id,level,preset){return money(taskCost(model(id),level,PRESETS[preset]));};
