import * as THREE from 'three';
import { TUNING, STORY } from './species.js';
import { Atmosphere } from './sky.js';

// Weather that is felt coming. The rainforest turns through day, showers and a
// short night in about 20 minutes, and its seasons in about 80; the player is told it will change,
// in three layers:
//  1. signs in the world: clouds gather and the light dims before a shower (sky.js), the wind
//     rises and thunder rolls; insects start at dusk; birds sing before dawn;
//  2. a strip under the minimap that shows the next skyForecastWindowSec: day, dusk and night
//     as colour, showers as a band, and a short line on what comes next;
//  3. a short status line the first times (skyHintMaxPerKind) each kind of change is near.
// Status lines are original text from game.json story "statusHints": state hints, like the
// R prompt, not world responses and not directions.
const tune=(key,fallback)=>TUNING[key]?.value??fallback;
const smooth=(a,b,x)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const SAMPLES=110;
const COLOURS={day:new THREE.Color('#e4d9a6'),dusk:new THREE.Color('#d98c5f'),night:new THREE.Color('#2f416b'),rain:'rgba(150,176,196,'};

const CSS=`
.sky-strip{position:absolute;right:42px;top:246px;z-index:4;width:220px;padding:5px 6px 4px;border:1px solid #edf0de40;border-radius:4px;
  background:#23392eea;color:#f5f5e6;font:11px/1.45 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;pointer-events:none;box-shadow:0 2px 14px rgba(18,39,24,.35)}
.sky-strip canvas{display:block;width:100%;height:14px;border-radius:2px}
.sky-strip .sky-scale{display:flex;justify-content:space-between;color:#f5f5e6aa;font-size:10px;margin-top:1px}
.sky-strip .sky-now{margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sky-hint{position:absolute;right:42px;z-index:4;max-width:220px;padding:6px 9px;border:1px solid #edf0de40;border-radius:3px;background:#2d3f4aee;color:#f5f1dc;
  font:12px/1.5 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;letter-spacing:.4px;pointer-events:none;opacity:0;transition:opacity .6s}
.sky-hint.visible{opacity:1}
.paused .sky-hint{visibility:hidden}
@media(max-width:700px){.sky-strip{right:16px;width:160px}.sky-hint{right:16px;max-width:160px}}
`;

export class SkyGuide {
  constructor(game,parent=document.getElementById('experience')){
    this.game=game;this.atmosphere=game.atmosphere;this.wait=0;this.hintTimer=0;this.lastHint=-Infinity;this.armed={};
    this.thunderAt=8;this.birdAt=0;this.levels={storm:0,insects:0};this.next=null;this.lastShown=null;
    if(!document.getElementById('sky-guide-style')){const style=document.createElement('style');style.id='sky-guide-style';style.textContent=CSS;document.head.appendChild(style);}
    const el=this.el=document.createElement('div');el.id='sky-strip';el.className='sky-strip';el.hidden=true;el.setAttribute('role','img');
    el.innerHTML='<canvas></canvas><div class="sky-scale"><span>现在</span><span></span></div><div class="sky-now"></div>';
    parent.appendChild(el);this.canvas=el.querySelector('canvas');this.ctx=this.canvas.getContext('2d');
    el.querySelector('.sky-scale span:last-child').textContent=`${Math.round(tune('skyForecastWindowSec',600)/60)} 分钟后`;
    const hint=this.hint=document.createElement('div');hint.id='sky-hint';hint.className='sky-hint';hint.setAttribute('role','status');hint.setAttribute('aria-live','polite');parent.appendChild(hint);
  }
  get counts(){return this.game.hints.weather||(this.game.hints.weather={});}

  // Called every frame while the journey runs (Game.updateHints).
  update(dt){
    const g=this.game,A=this.atmosphere,show=g.started;
    if(this.el.hidden===show)this.el.hidden=!show;
    if(!show)return;
    this.place();
    // World signs: wind and thunder before rain, insects at dusk, birds before dawn.
    const sun=Atmosphere.sunHeight(A.timeOfDay);
    this.levels.storm=Math.max(A.gathering||0,A.rain);
    this.levels.insects=(1-smooth(-.02,.22,sun))*(1-A.rain*.7);
    if(this.levels.storm>.15&&g.elapsed>this.thunderAt){
      this.thunderAt=g.elapsed+9+Math.random()*12;
      g.audio.thunder(tune('skyThunderGain',.05)*(.5+this.levels.storm*.5)*(g.view?.hearing?.distantCueGain??1),Math.random()*1.6-.8);
    }
    const dawn=A.timeOfDay>.1&&A.timeOfDay<.5&&sun>-.25&&sun<.15;
    if(dawn&&g.elapsed>this.birdAt){this.birdAt=g.elapsed+1.5+Math.random()*3;g.audio.play('chirp',.012*(g.view?.hearing?.distantCueGain??1),Math.random()*1.6-.8);}
    // Status line on screen.
    if(this.hintTimer>0){this.hintTimer-=dt;if(this.hintTimer<=0)this.hint.classList.remove('visible');}
    this.wait-=dt;if(this.wait>0)return;this.wait=.5;
    this.forecastNow();this.draw();this.considerHints();
  }
  // Under the minimap, or in its place when the map is hidden (M, or as an island).
  place(){
    const map=this.game.minimap?.el,narrow=innerWidth<=700;
    const top=map&&!map.hidden&&map.offsetHeight?map.offsetTop+map.offsetHeight+8:(narrow?70:86);
    if(this.top!==top){this.top=top;this.el.style.top=top+'px';}
    const below=top+(this.el.offsetHeight||44)+6;
    if(this.hintTop!==below){this.hintTop=below;this.hint.style.top=below+'px';}
  }

  // ---- what is coming
  forecastNow(){
    const A=this.atmosphere,span=tune('skyForecastWindowSec',600);
    this.samples=[];for(let i=0;i<SAMPLES;i++){const t=i/(SAMPLES-1)*span,f=A.forecast(t);this.samples.push({t,...f,phase:phaseOf(f.sun)});}
    const now={...this.samples[0],rain:A.rain};this.now=now;
    // The first change ahead: a shower starting or ending, or the light turning.
    const raining=now.rain>.15;let next=null;
    for(const s of this.samples.slice(1)){
      if(!raining&&s.rain>.35){next={kind:'rain',t:s.t,time:s.time};break;}
      if(raining&&s.rain<.08){next={kind:'clear',t:s.t,time:s.time};break;}
      if(s.phase!==now.phase){next={kind:s.phase,t:s.t,time:s.time};break;}
    }
    this.next=next;
  }
  // Status line keys (game.json story statusHints) whose change is near right now.
  nearChanges(){
    const A=this.atmosphere,sun=Atmosphere.sunHeight(A.timeOfDay),out=[];
    const rainLead=tune('skyRainLeadSec',45);let ahead=0;for(const k of [1/3,2/3,1])ahead=Math.max(ahead,A.forecast(rainLead*k).rain);
    if(A.rain<.1&&ahead>.35)out.push('rain_soon');
    if(sun>-.02&&A.timeOfDay>.5&&A.forecast(tune('skyDuskLeadSec',60)).sun<-.02)out.push('dusk_soon');
    if(sun<-.1)out.push('night');
    if(sun<-.02&&A.timeOfDay<.5&&A.forecast(tune('skyDawnLeadSec',45)).sun>-.02)out.push('dawn_soon');
    const wet=Atmosphere.wetness(A.season),later=A.forecast(tune('skySeasonLeadSec',120)).wetness;
    if(wet>.5&&later<=.5)out.push('dry_soon');
    if(wet<.5&&later>=.5)out.push('wet_soon');
    return out;
  }
  considerHints(){
    const g=this.game,near=new Set(this.nearChanges());
    // A kind is armed again only once its change has passed, so one change gives one line.
    for(const kind of Object.keys(STORY.statusHints||{}))if(!near.has(kind))this.armed[kind]=true;
    if(g.paused||g.transition||g.elapsed-this.lastHint<tune('skyHintMinGapSec',20))return;
    for(const kind of near){
      const text=STORY.statusHints?.[kind];if(!text||this.armed[kind]===false)continue;
      if((this.counts[kind]||0)>=tune('skyHintMaxPerKind',2)){this.armed[kind]=false;continue;}
      this.armed[kind]=false;this.counts[kind]=(this.counts[kind]||0)+1;this.show(kind,text);return;
    }
  }
  show(kind,text){this.lastHint=this.game.elapsed;this.lastShown={kind,text,at:this.game.elapsed};this.hintTimer=tune('skyHintDisplaySec',5);this.hint.textContent=text;this.hint.classList.add('visible');}

  // ---- the strip
  draw(){
    const cv=this.canvas,w=cv.clientWidth||208,h=14,dpr=Math.min(2,devicePixelRatio||1),ctx=this.ctx;
    if(cv.width!==Math.round(w*dpr)){cv.width=Math.round(w*dpr);cv.height=h*dpr;}
    ctx.setTransform(dpr,0,0,dpr,0,0);const step=w/SAMPLES,c=new THREE.Color();
    this.samples.forEach((s,i)=>{
      c.copy(COLOURS.night).lerp(COLOURS.dusk,smooth(-.15,0,s.sun)).lerp(COLOURS.day,smooth(.06,.3,s.sun));
      ctx.fillStyle='#'+c.getHexString();ctx.fillRect(i*step,0,step+.6,h);
      if(s.rain>.05){ctx.fillStyle=COLOURS.rain+Math.min(.95,s.rain*1.2).toFixed(2)+')';ctx.fillRect(i*step,h*.45,step+.6,h*.55);}
    });
    // A tick every minute, and the present at the left edge.
    ctx.fillStyle='rgba(35,57,46,.45)';const span=tune('skyForecastWindowSec',600);for(let m=60;m<span;m+=60)ctx.fillRect(m/span*w-.5,h-3,1,3);
    ctx.fillStyle='#f5f5e6';ctx.fillRect(0,0,2,h);
    const text=this.summary();if(text!==this.text){this.text=text;this.el.querySelector('.sky-now').textContent=text;this.el.setAttribute('aria-label','天色：'+text);}
  }
  summary(){
    const n=this.now,names={day:'白天',dusk:'黄昏',night:'夜晚'},now=(n.phase==='dusk'&&this.atmosphere.timeOfDay<.5?'清晨':names[n.phase])+(n.rain>.15?' · 下着阵雨':'');
    if(!this.next)return now;
    const t=this.next.t,when=t<60?'不到 1 分钟':`约 ${Math.round(t/60)} 分钟`;
    const what={rain:'有阵雨',clear:'雨停',day:'天亮',dusk:this.next.time>.5?'黄昏':'清晨',night:'入夜'}[this.next.kind];
    return `${now} → ${when}后${what}`;
  }
}

// Day, dusk (or dawn) and night by the sun's height, as the strip shows them.
function phaseOf(sun){return sun>.12?'day':sun>-.1?'dusk':'night';}
