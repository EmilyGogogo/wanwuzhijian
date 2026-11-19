import { SPECIES, STORY, TUNING } from './species.js';
import { bankShore } from './banks.js';

// The forest on both banks and the river beyond its mapped length are scenery, not places to
// go: nothing there is built for bodies, so they pass through trees and ground.
// While the body is there, or close to the bank, a quiet line stays on screen saying so. It is a
// state hint like the weather lines, not a wall, a penalty or a death zone: the body
// still moves as before. Text from game.json story "edgeHints"; distances in game.json tuning.
const tune=(key,fallback)=>TUNING[key]?.value??fallback;

const CSS=`
.wild-edge{position:absolute;top:92px;left:50%;transform:translateX(-50%);z-index:4;width:max-content;max-width:min(460px,80vw);padding:9px 16px 10px;text-align:center;
  border:1px solid #edf0de40;border-radius:3px;background:#2b2f26e6;color:#f5f1dc;box-shadow:0 2px 18px rgba(18,30,20,.35);
  font:13px/1.6 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;letter-spacing:1px;pointer-events:none;opacity:0;transition:opacity .9s}
.wild-edge small{display:block;margin-top:2px;font-size:11px;letter-spacing:.5px;color:#f5f1dcb0}
.wild-edge.visible{opacity:1}
.paused .wild-edge{visibility:hidden}
@media(max-width:700px){.wild-edge{top:70px;font-size:12px}}
`;

export class WildEdge {
  constructor(game,parent=document.getElementById('experience')){
    this.game=game;this.inside=false;this.wait=0;this.state=null;this.at=null;
    if(!document.getElementById('wild-edge-style')){const style=document.createElement('style');style.id='wild-edge-style';style.textContent=CSS;document.head.appendChild(style);}
    const el=this.el=document.createElement('div');el.id='wild-edge';el.className='wild-edge';el.setAttribute('role','status');el.setAttribute('aria-live','polite');
    el.innerHTML='<span></span><small></small>';parent.appendChild(el);
  }
  // Where the body is in the river's own flat coordinates, and how far past the edge of the
  // built world (positive: inside the wild; negative: still that far from it).
  measure(entity){
    const W=this.game.world,at=W.planetRoot.worldToLocal(W.position(entity)),corridor=W.river?.corridor||{};
    const half=corridor.halfWidthM??640,length=corridor.lengthM??12000;
    const side=at.z<0?-1:1,bank=Math.abs(at.z)-bankShore(half,at.x,side),end=Math.abs(at.x)-length/2;
    return {x:at.x,z:at.z,bank,end,past:Math.max(bank,end)};
  }
  // Called every frame while the journey runs (Game.updateHints).
  update(dt){
    const g=this.game,p=g.player;
    this.wait-=dt;if(this.wait>0)return;this.wait=.25;
    // Islands are kept inside the river's corridor; they never reach the banks.
    let inside=false;this.state=null;
    if(g.started&&p&&SPECIES[p.kind]?.mode!=='island'){
      // Hysteresis so the line does not flicker on the shore line.
      const m=this.state=this.measure(p),margin=tune('wildEdgeWarnMarginM',25);
      inside=m.past>-(this.inside?margin+tune('wildEdgeClearExtraM',10):margin);
    }
    if(inside)this.place();
    if(inside===this.inside)return;
    this.inside=inside;
    if(inside){
      const h=STORY.edgeHints||{};this.el.querySelector('span').textContent=h.wild_bank||'';this.el.querySelector('small').textContent=h.wild_bank_detail||'';
      this.el.classList.add('visible');
    }else this.el.classList.remove('visible');
  }
  // Centred at the top, unless the map column on the right would cover it: then centred in the
  // room left of the map.
  place(){
    const g=this.game,pad=16,cols=[g.minimap?.el,g.skyGuide?.el].filter(e=>e&&!e.hidden&&e.offsetWidth).map(e=>e.getBoundingClientRect().left);
    const edge=Math.min(innerWidth,...cols),width=Math.min(460,innerWidth*.8),fits=(innerWidth+width)/2+pad<=edge;
    const left=fits?innerWidth/2:edge/2,max=fits?width:edge-2*pad,key=Math.round(left)+':'+Math.round(max);
    if(this.at===key)return;this.at=key;this.el.style.left=left+'px';this.el.style.maxWidth=max+'px';
  }
}
