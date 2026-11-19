// Runtime configuration, loaded from public/config/game.json.
// Nothing here names a particular species: bodies, categories, layout and
// interactions all come from data, so adding them never touches this module.
export const SPECIES = {};
export const SCALE_TIERS = [];
export const SCALE_LAYERS = {};
export const LAYOUT = {instances:[],scatter:[],regions:{}};
// Regions with a `water` block in anchors.json: enclosed bodies (flat surface inside the
// region's shape, optional terrain basin) and the one sea that follows the planet.
export const WATERS = [];
export const INTERACTIONS = [];
export const INPUT = {bindings:[]};
export const TUNING = {};
export const CAMERA_MODES = {};
// Weather status lines and the unbuilt-banks line, from game.json story
// statusHints and edgeHints.
export const STORY = {statusHints:{},edgeHints:{}};
export async function loadRuntimeConfig(){
  const response=await fetch('./public/config/game.json');
  if(!response.ok)throw new Error(`Game configuration unavailable (${response.status})`);
  const data=await response.json();
  Object.assign(SPECIES,data.species);Object.assign(LAYOUT,data.layout);SCALE_TIERS.push(...(data.scaleTiers||[]));Object.assign(SCALE_LAYERS,data.scaleLayers);Object.assign(CAMERA_MODES,data.cameraModes);WATERS.push(...Object.values(LAYOUT.regions).filter(r=>r.water));
  INTERACTIONS.push(...(data.interactions||[]));Object.assign(INPUT,data.input);Object.assign(TUNING,data.tuning);Object.assign(STORY,data.story||{});
  if(!LAYOUT.instances.some(i=>i.id===LAYOUT.initialInstance))throw new Error(`Missing initial body: ${LAYOUT.initialInstance}`);
  for(const item of [...LAYOUT.instances,...LAYOUT.scatter])if(!SPECIES[item.kind])throw new Error(`Unknown body kind: ${item.kind}`);
  return data.version;
}
// Camera, fog and light settings of a body's render layer (`stage`), from data.
export function layerOf(kind){return SCALE_LAYERS[SPECIES[kind].stage];}
export function actionForCode(code){return INPUT.bindings.find(b=>b.codes.includes(code))?.action||null;}
// Relations come from scale tiers. `lift` is the tier rank the current
// viewpoint reaches; it only widens the reach upwards, never downwards.
export function canEmbody(from,to,lift=-1){
  const a=SPECIES[from?.kind],b=SPECIES[to?.kind];if(!a||!b||from===to)return false;
  if(a.targets.includes(to.kind))return true;
  return b.tier>a.tier+1&&b.tier<=lift+1&&!a.deny.includes(to.kind);
}
// Regions are ellipses (optionally turned), or `path` strips: a polyline of points with a half width (a trail).
export function inRegion(id,x,z){
  const r=LAYOUT.regions?.[id];if(!r)return false;
  if(r.shape==='path')return pathDistance(r.points,x,z)<r.halfWidthM;
  if(r.shape!=='ellipse')return false;
  // An ellipse may be turned (rotationY, same sense as a decor placement): test in its own frame.
  let dx=x-r.center[0],dz=z-r.center[1];
  if(r.rotationY){const c=Math.cos(r.rotationY),s=Math.sin(r.rotationY);[dx,dz]=[c*dx-s*dz,s*dx+c*dz];}
  return (dx/r.radii[0])**2+(dz/r.radii[1])**2<1;
}
// Distance from a point to a polyline [[x,z],…].
export function pathDistance(points,x,z){
  let best=Infinity;
  for(let i=1;i<points.length;i++){
    const [ax,az]=points[i-1],[bx,bz]=points[i],dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz||1;
    const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l2));best=Math.min(best,Math.hypot(x-ax-t*dx,z-az-t*dz));
  }
  return best;
}
export function mulberry32(seed){return()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
