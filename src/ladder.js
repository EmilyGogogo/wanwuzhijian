import { SPECIES, SCALE_TIERS, TUNING, STORY, canEmbody } from './species.js';

// The scale ladder: a column on the left that lists every body by scale tier,
// from near-ground at the bottom to the archipelago at the top. It shows what the current body
// can become right now and, for tiers out of reach, how the scale rule lets one get there.
//  - States come from the same relation test as R (canEmbody with the current view lift), so the
//    ladder never disagrees with what can actually be selected.
//  - It is not a collection: every body is listed from the start, nothing is ticked or counted
//. Lines explain the rule, never a direction or a place.
//  - It slides out to the left while the body moves and returns once it stops.
//  - Hovering (or focusing) a name opens a card: an encyclopedia excerpt with its source and
//    licence, where the body lives in the game, and an art note where the game departs from fact.
//    With the pointer locked there is no cursor, so the ladder stays above the pause menu for this.
//  - After a possession the same perception line shows beside the body label for a few seconds.
// Text comes from data: guide per species, scaleGuide templates in dialogue.json.
const tune=(key,fallback)=>TUNING[key]?.value??fallback;
const fill=(text,values)=>String(text||'').replace(/\{(\w+)\}/g,(_,k)=>values[k]??'');

const CSS=`
.scale-ladder{position:absolute;left:42px;top:96px;z-index:3;width:240px;max-height:calc(100% - 200px);overflow:hidden;padding:8px 10px 9px;border:1px solid #edf0de40;border-radius:3px;
  background:#23392eea;color:#f5f5e6;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;pointer-events:none;box-shadow:0 2px 14px rgba(18,39,24,.35);
  transition:transform .35s ease,opacity .35s ease}
.scale-ladder.retracted{transform:translateX(calc(-100% - 36px));opacity:.85}
.scale-ladder::after{content:"";position:absolute;right:2px;top:14px;bottom:14px;width:2px;border-radius:1px;background:#f5f5e6aa;opacity:0;transition:opacity .35s}
.scale-ladder.retracted::after{opacity:1}
.scale-ladder .ladder-row{display:flex;gap:7px;align-items:baseline;padding:3px 0}
.scale-ladder .ladder-row+.ladder-row{border-top:1px dashed #edf0de26}
.scale-ladder .ladder-tier{flex:0 0 46px;font-size:11px;color:#f5f5e699;white-space:nowrap}
.scale-ladder .ladder-tier b{font-weight:600;margin-right:3px}
.scale-ladder .ladder-body{flex:1;min-width:0}
.scale-ladder .ladder-chips{display:flex;flex-wrap:wrap;gap:3px 4px}
.scale-ladder .ladder-chip{padding:0 6px;border:1px solid #f5f5e680;border-radius:9px;white-space:nowrap}
.scale-ladder .ladder-chip.far{color:#f5f5e670;border-color:#f5f5e626}
.scale-ladder .ladder-chip.current{background:#e9dca6;border-color:#e9dca6;color:#23392e;font-weight:600}
.scale-ladder .ladder-chip.aimed{box-shadow:0 0 0 1px #f3e2a4}
.scale-ladder .ladder-row.current .ladder-tier,.scale-ladder .ladder-row.reach .ladder-tier{color:#f5f5e6}
.scale-ladder .ladder-hint{margin-top:2px;font-size:11px;line-height:1.45;color:#e9d79c}
.scale-ladder.pulse .ladder-chip.current{animation:ladder-pulse 1s ease 2}
@keyframes ladder-pulse{0%{box-shadow:0 0 0 0 #e9dca6cc}100%{box-shadow:0 0 0 7px #e9dca600}}
.scale-ladder .ladder-chip{pointer-events:auto;cursor:help;outline:none}
.scale-ladder .ladder-chip:focus-visible,.scale-ladder .ladder-chip.open{border-color:#e9d79c}
.paused .scale-ladder{visibility:hidden}
@media(min-width:761px){.paused .scale-ladder{visibility:visible;z-index:11;transform:none;opacity:1}.paused .scale-ladder::after{opacity:0}
  .paused .pause-layer{padding-left:max(0px,calc(1040px - 100vw))}}
.ladder-card{position:absolute;z-index:12;width:min(320px,calc(100vw - 24px));padding:10px 13px 11px;border:1px solid #edf0de40;border-radius:3px;background:#1d3027f2;color:#f5f5e6;
  font:12.5px/1.65 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;box-shadow:0 6px 24px rgba(12,26,18,.45);pointer-events:none;opacity:0;transition:opacity .15s}
.ladder-card.visible{opacity:1}
.ladder-card .card-head{display:flex;align-items:baseline;gap:8px;margin-bottom:5px}
.ladder-card .card-head b{font-size:15px;letter-spacing:1px}
.ladder-card .card-head span{margin-left:auto;font-size:11px;color:#f5f5e699}
.ladder-card p{margin:0}
.ladder-card .card-source{margin-top:4px;font-size:10.5px;color:#f5f5e699}
.ladder-card .card-label{margin-top:8px;font-size:11px;color:#e9d79c;letter-spacing:1px}
.ladder-card .card-art{margin-top:7px;padding-top:6px;border-top:1px dashed #edf0de33;font-size:11.5px;color:#d7e2da}
.perception-line{display:block;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;letter-spacing:1px;color:#e9d79c;opacity:0;transition:opacity .6s}
.perception-line.visible{opacity:1}
@media(max-width:700px){.scale-ladder{left:16px;top:76px;width:200px;padding:6px 8px;font-size:11px}.scale-ladder.retracted{transform:translateX(calc(-100% - 10px))}
  .scale-ladder .ladder-tier{flex-basis:20px}.scale-ladder .ladder-tier span{display:none}.scale-ladder .ladder-row{padding:2px 0}.scale-ladder .ladder-chip{padding:0 5px}.scale-ladder .ladder-hint{font-size:10.5px}}
`;

export class ScaleLadder {
  constructor(game,parent=document.getElementById('experience')){
    this.game=game;this.moveTime=0;this.stillTime=0;this.retracted=false;this.signature='';this.pulsed=false;
    if(!document.getElementById('scale-ladder-style')){const style=document.createElement('style');style.id='scale-ladder-style';style.textContent=CSS;document.head.appendChild(style);}
    const el=this.el=document.createElement('aside');el.id='scale-ladder';el.className='scale-ladder';el.hidden=true;
    el.setAttribute('aria-label','尺度梯：现在能成为哪些存在');parent.appendChild(el);
    const card=this.card=document.createElement('div');card.id='ladder-card';card.className='ladder-card';card.setAttribute('role','tooltip');card.hidden=true;parent.appendChild(card);
    this.open=null;this.lineTimer=0;
    const chipOf=e=>e.target.closest?.('.ladder-chip');
    el.addEventListener('pointerover',e=>{const c=chipOf(e);if(c)this.show(c.dataset.kind);});
    el.addEventListener('pointerout',e=>{const c=chipOf(e);if(c&&!c.contains(e.relatedTarget))this.show(null);});
    el.addEventListener('focusin',e=>{const c=chipOf(e);if(c)this.show(c.dataset.kind);});
    el.addEventListener('focusout',()=>this.show(null));
    // The landing line lives in the body label (presence) at the lower left.
    const line=this.line=document.createElement('small');line.id='perception-line';line.className='perception-line';line.setAttribute('aria-live','polite');
    (document.querySelector('#presence>div')||parent).appendChild(line);
  }

  // Card for one body, beside the ladder at the height of its name; null closes it.
  show(kind){
    const card=this.card;this.el.querySelector('.ladder-chip.open')?.classList.remove('open');
    if(!kind||!SPECIES[kind]||this.el.hidden||this.retracted&&!this.pausedView()){this.open=null;card.classList.remove('visible');card.hidden=true;return;}
    const s=SPECIES[kind],g=s.guide||{},tier=SCALE_TIERS.find(t=>t.id===s.scaleTier);
    if(this.open!==kind){
      const add=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;n.textContent=text;return n;};
      const head=add('div','card-head','');head.append(add('b','',s.name),add('span','',`${tier?.id||''} ${tier?.name||''}档`));
      const parts=[head];
      for(const enc of g.encyclopedia||[])parts.push(add('p','card-excerpt',enc.excerpt),add('div','card-source',`来源：${enc.site}《${enc.title}》，${enc.use} · ${enc.license}`));
      if(g.location)parts.push(add('div','card-label','在游戏中的位置'),add('p','card-location',g.location));
      if(g.artNote)parts.push(add('p','card-art',g.artNote));
      card.replaceChildren(...parts);card.dataset.kind=kind;this.open=kind;
    }
    const chip=this.el.querySelector(`.ladder-chip[data-kind="${kind}"]`);if(chip){chip.classList.add('open');chip.setAttribute('aria-describedby','ladder-card');}
    card.hidden=false;this.openedPaused=this.pausedView();
    const box=this.el.getBoundingClientRect(),at=(chip||this.el).getBoundingClientRect(),host=card.offsetParent?.getBoundingClientRect()||{left:0,top:0,width:innerWidth,height:innerHeight};
    const left=Math.min(box.right+10,host.width-card.offsetWidth-12),top=Math.max(12,Math.min(host.height-card.offsetHeight-12,at.top-host.top-10));
    card.style.left=`${Math.max(12,left-host.left)}px`;card.style.top=`${top}px`;card.classList.add('visible');
  }

  // The pause menu is on screen (the ladder then stays above it, never slid away).
  pausedView(){return document.body.classList.contains('paused');}

  // After a possession, the perception line beside the body label.
  landed(kind){
    const text=SPECIES[kind]?.guide?.perceptionLine;if(!text)return;
    this.line.textContent=text;this.line.classList.add('visible');this.lineTimer=tune('perceptionLineDisplaySec',4);
  }

  // Tier rows top (largest) to bottom, each with its members and their state for the current body.
  state(){
    const g=this.game,player=g.player,own=SPECIES[player.kind],lift=g.liftRank(),from={kind:player.kind};
    const tiers=[...SCALE_TIERS].sort((a,b)=>a.rank-b.rank),byRank=r=>tiers.find(t=>t.rank===r);
    const top=Math.max(own.tier,lift)+1,bottom=own.tier-1;
    const rows=tiers.map(t=>{
      const members=Object.keys(SPECIES).filter(k=>SPECIES[k].scaleTier===t.id).map(kind=>({
        kind,name:SPECIES[kind].guide?.shortName||SPECIES[kind].name,
        current:kind===player.kind,reach:kind===player.kind||canEmbody(from,{kind},lift)}));
      const reach=members.some(m=>m.reach);let hint='';
      if(!reach&&t.rank>top){
        const step=byRank(t.rank-1),need=step?.liftEyeHeightM,flying=own.mode==='fly';
        const eye=flying?g.eyeHeight(player):0;
        hint=fill(flying&&need!=null&&eye<need?STORY.scaleGuide?.upFlying:STORY.scaleGuide?.up,{tier:step?.name,height:need,meters:Math.max(1,Math.ceil((need??0)-eye))});
        if(t.reachNote)hint+=fill(STORY.scaleGuide?.note,{note:t.reachNote});
      }else if(!reach&&t.rank<bottom){
        hint=fill(STORY.scaleGuide?.down,{tier:byRank(t.rank+1)?.name});
      }
      return {id:t.id,name:t.name,current:t.rank===own.tier,reach,hint,members};
    });
    return rows.reverse();
  }

  render(){
    const aimed=this.game.target?.kind,rows=this.state();
    const signature=JSON.stringify([rows,aimed]);if(signature===this.signature)return;this.signature=signature;
    this.el.replaceChildren(...rows.map(r=>{
      const row=document.createElement('div');row.className=`ladder-row ${r.current?'current':r.reach?'reach':'far'}`;row.dataset.tier=r.id;
      const tier=document.createElement('div');tier.className='ladder-tier';const b=document.createElement('b'),n=document.createElement('span');b.textContent=r.id;n.textContent=r.name;tier.append(b,n);
      const body=document.createElement('div');body.className='ladder-body';
      const chips=document.createElement('div');chips.className='ladder-chips';
      for(const m of r.members){
        const chip=document.createElement('span');chip.className='ladder-chip'+(m.current?' current':m.reach?'':' far')+(m.kind===aimed?' aimed':'')+(m.kind===this.open?' open':'');
        chip.dataset.kind=m.kind;chip.textContent=m.name;chip.tabIndex=0;chips.appendChild(chip);
      }
      body.appendChild(chips);
      if(r.hint){const hint=document.createElement('div');hint.className='ladder-hint';hint.textContent=r.hint;body.appendChild(hint);}
      row.append(tier,body);return row;
    }));
  }

  // Called every frame while the journey runs (Game.updateHints).
  update(dt){
    const g=this.game,show=g.started&&!g.transition?.opening;
    if(this.lineTimer>0){this.lineTimer-=dt;if(this.lineTimer<=0||g.transition)this.line.classList.remove('visible');}
    if(this.el.hidden===show)this.el.hidden=!show;
    if(!show){this.show(null);return;}
    if(!this.pulsed){this.pulsed=true;this.el.classList.add('pulse');setTimeout(()=>this.el.classList.remove('pulse'),2400);}
    // Slide out while moving, back once still (TUNABLE).
    if(g.player.moving&&!g.transition){this.moveTime+=dt;this.stillTime=0;}else{this.stillTime+=dt;this.moveTime=0;}
    if(!this.retracted&&this.moveTime>=tune('scaleLadderHideAfterMoveSec',.25))this.retracted=true;
    else if(this.retracted&&this.stillTime>=tune('scaleLadderReturnDelaySec',.6))this.retracted=false;
    this.el.classList.toggle('retracted',this.retracted);
    this.render();
    // No cursor while the pointer is locked; a card left open from the pause menu closes.
    if(this.open&&(this.retracted||this.openedPaused||document.pointerLockElement))this.show(null);
  }
}
