import * as THREE from 'three';
import { SPECIES, TUNING, LAYOUT, WATERS, inRegion, mulberry32, layerOf } from './species.js';
import { TerrainChunks, groundMaterial, loadHeightfield } from './terrain.js';
import { waterMaterial, heightTexture } from './water.js';
import { createBanks } from './banks.js';
import { LodField, WIND } from './vegetation.js';
import { fireflies } from './sky.js';
import { underwaterLook, waterShading, createWaterweeds, createPebbles, UnderwaterFx } from './underwater.js';
import { AmbientMotion } from './ambient.js';
import { RiverTraffic } from './rivercraft.js';
import { RiverJourney } from './riverjourney.js';
import { createLanding } from './homestead.js';

// The river follows a very large sphere: a drifting island tilts a little, while the
// curvature stays below the haze of the far banks.
export const PLANET_RADIUS=100000;
const UP=new THREE.Vector3(0,1,0);
const REDUCED_MOTION=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
const smooth=(a,b,x)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
function hash(x,z){return (Math.sin(x*127.1+z*311.7)*43758.5453123)%1;}
function noise(x,z){const a=Math.floor(x),b=Math.floor(z),u=smooth(0,1,x-a),v=smooth(0,1,z-b);return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(a,b),hash(a+1,b),u),THREE.MathUtils.lerp(hash(a,b+1),hash(a+1,b+1),u),v);}
// Main island heightfield (manifest environment.heightfield).
let FIELD=null;
export async function loadTerrainField(entry){FIELD=await loadHeightfield(entry.heightfield);}
export function terrainHeight(x,z){return FIELD.height(x,z)-(x*x+z*z)/(2*PLANET_RADIUS);}

// Seeds come from ids, so each individual keeps its model variant when others are added or removed.
function seedOf(id){let seed=2166136261;for(const c of id)seed=Math.imul(seed^c.charCodeAt(0),16777619);return seed>>>0;}
// Whether a scatter group may place something at a point (surface band and regions).
function scatterAllows(group,x,y,z){
  return (group.surfaceMin==null||y>=group.surfaceMin)&&(group.surfaceMax==null||y<=group.surfaceMax)
    &&!(group.avoidRegions||[]).some(id=>inRegion(id,x,z))&&(!group.insideRegion||inRegion(group.insideRegion,x,z));
}
// Blade decoration (env.meadow, env.reeds): wind-bent blades scattered over the scatter areas,
// thinned by the ground layer they belong to, and split into cells that are culled by
// distance so dense ground cover stays cheap.
const BLADE_STYLES={
  meadow:{height:[.08,.24],width:[.006,.016],bend:[.02,.08],hue:[.22,.29],sat:[.42,.6],light:[.3,.43],layer:2},
  reeds:{height:[.9,2.3],width:[.02,.05],bend:[.15,.5],hue:[.17,.24],sat:[.3,.46],light:[.25,.38],layer:1},
};
// Ground layer weight at a point: an index into the weight map, or 'litter' (the remainder).
function layerWeight(layer,x,z,w){
  if(layer==null)return 1;FIELD.weights(x,z,w);
  return layer==='litter'?Math.max(0,1-w[0]-w[1]-w[2]-w[3]):w[layer];
}
// Background rainforest (env.forest): layered scenery trees placed like a real forest rather
// than evenly. A slow noise field gathers trees into stands and opens clearings; each layer
// keeps its own spacing (crowns of one layer touch but rarely overlap, smaller layers grow
// beneath), sizes skew toward young trees, and every tree leans, stretches and tints a little.
// Scenery, not bodies: it keeps clear of the bodies on the island; its trunks block small
// bodies only (see WorldCollision.hitsScenery). Each model is drawn by distance (LodField):
// the Aholo model's mesh levels near, its impostor beyond and at large scales.
// Value noise here spans −1…1; fbm returns 0…1.
function fbm(x,z){return .5+.5*(noise(x,z)*.55+noise(x*2.13+17,z*2.13-9)*.3+noise(x*4.7-31,z*4.7+5)*.15);}
function createForest(slot,surface,obstacles,bodies,veg){
  const sc=slot.scatter,r=mulberry32(sc.seed??61),w=[0,0,0,0];
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),sv=new THREE.Vector3(),tilt=new THREE.Quaternion(),e=new THREE.Euler();
  const clump=sc.clumping||{},clumpScale=clump.scaleM??70,clearing=clump.clearingBelow??.3,strength=clump.strength??1;
  const placed=new Map(),hashCell=12,byModel=new Map();
  const near=(x,z,radius,test)=>{const k0=Math.floor((x-radius)/hashCell),k1=Math.floor((x+radius)/hashCell),j0=Math.floor((z-radius)/hashCell),j1=Math.floor((z+radius)/hashCell);
    for(let i=k0;i<=k1;i++)for(let j=j0;j<=j1;j++)for(const t of placed.get(`${i},${j}`)||[])if(test(t))return true;return false;};
  for(const L of sc.layers){
    const models=L.models.map(n=>veg.models[n]);
    const [h0,h1]=L.heightM||[10,20],[w0,w1]=L.widthScale||[.85,1.15],spacing=L.spacingM??8;
    for(const area of sc.areas){
      const attempts=Math.round((L.attempts??1000)*(area.share??1));
      for(let i=0;i<attempts;i++){
        const x=area.center[0]+(r()-.5)*area.size[0],z=area.center[1]+(r()-.5)*area.size[1],roll=r(),age=r(),variant=r(),turn=r()*6.28,lean=r(),wide=r(),hue=r();
        const y=surface(x,z);
        if(!scatterAllows(sc,x,y,z)||(L.surfaceMin!=null&&y<L.surfaceMin)||(L.surfaceMax!=null&&y>L.surfaceMax))continue;
        // Stands and clearings: the density field decides first, the ground layer second.
        const density=smooth(clearing,clearing+.3,fbm(x/clumpScale+(L.clumpOffset??0),z/clumpScale))**strength;
        if(roll>density*Math.min(1,layerWeight(sc.groundLayer,x,z,w)*2))continue;
        if((bodies.get(`${Math.floor(x/16)},${Math.floor(z/16)}`)||[]).some(b=>Math.hypot(b.x-x,b.z-z)<b.r))continue;
        // Many young trees, few old giants.
        const height=h0+(h1-h0)*age**(L.ageSkew??1.6),t=models[Math.floor(variant*models.length)];
        const sy=height/t.height,sxz=sy*(L.slender??1)*(w0+(w1-w0)*wide),crown=t.crownRadius*sxz,gap=spacing*(.55+.45*height/h1),trunk=(L.trunk??.3)*sxz;
        if(near(x,z,gap+40,o=>{const d=Math.hypot(o.x-x,o.z-z);return d<(o.trunk+trunk)*1.6||(o.layer===L&&d<Math.max(gap,(o.crown+crown)*.5*(L.overlap??.8)));}))continue;
        const hk=`${Math.floor(x/hashCell)},${Math.floor(z/hashCell)}`;
        (placed.get(hk)||placed.set(hk,[]).get(hk)).push({x,z,crown,trunk,layer:L});
        const maxLean=(L.leanDeg??3)*Math.PI/180;
        tilt.setFromEuler(e.set((lean-.5)*2*maxLean,0,(r()-.5)*2*maxLean));
        q.setFromAxisAngle(UP,turn).premultiply(tilt);
        m.compose(v.set(x,y-.15,z),q,sv.set(sxz,sy,sxz));
        // Individuals differ a little in brightness and, unless the layer is in blossom
        // (`colourVariation: 0`), in warmth.
        const cv=L.colourVariation??1,tint=new THREE.Color(1-.08*r()*cv,1,1-.1*r()*cv).multiplyScalar(.86+.2*r());
        if(cv&&hue>.92)tint.multiply(new THREE.Color(1.06,1.02,.9));else if(cv&&hue<.2)tint.multiply(new THREE.Color(.92,.97,.95));
        (byModel.get(t)||byModel.set(t,[]).get(t)).push({x,y:y+height*.4,z,matrix:m.clone(),tint});
        obstacles.push({x,z,r:trunk,top:y+t.crownBase*sy});
      }
    }
  }
  const group=new THREE.Group(),ranges=sc.lodRangesM||[170],fields=[];
  for(const [model,items] of byModel){
    const field=new LodField(model,items,{ranges:model.impostor?ranges:[ranges[ranges.length-1]],shadowLevels:2,shadowM:sc.shadowDistanceM??0});
    group.add(field);fields.push(field);
  }
  group.userData.updateLod=(eye,force)=>{for(const f of fields)f.update(eye,force);};
  group.userData.count=[...byModel.values()].reduce((a,l)=>a+l.length,0);
  group.userData.forest=true;
  return group;
}
// Both low grass and larger plants share irregular clump centres, so roots blend into
// a low skirt of grass. Calls without clumping retain their original placement.
function clumpPoint(x,z,clumps,angle,spread){
  const cell=clumps.cellM,ix=Math.floor(x/cell),iz=Math.floor(z/cell);
  const cx=(ix+.2+.6*Math.abs(hash(ix+17.3,iz-9.1)))*cell;
  const cz=(iz+.2+.6*Math.abs(hash(ix-31.7,iz+6.2)))*cell;
  const radius=clumps.radiusM*Math.sqrt(spread);
  return [cx+Math.cos(angle)*radius,cz+Math.sin(angle)*radius];
}
// Small plants (env.understory, env.lilies): Aholo flowers gathered in patches, each kind on its
// own ground layer, drawn by distance like the forest.
// With `scatter.float` the plants float instead: on still water deep enough, apart from each other.
function createUnderstory(slot,surface,veg,water,grass=[]){
  const sc=slot.scatter,r=mulberry32(sc.seed??91),w=[0,0,0,0],[lo,hi]=slot.scaleRange||[1,1];
  // Clumped plants take their heading from a separate stream: `turn` already places them around the
  // clump centre, and reusing it would turn every plant away from the centre. A separate stream
  // leaves the placement sequence (and so the layout) unchanged.
  const headings=sc.clumps?mulberry32((sc.seed??91)+7919):null;
  const kinds=sc.plants.map(p=>({model:veg.models[p.model],weight:p.weight,heightM:p.heightM,widthM:p.widthM,patch:p.patchM,ground:p.groundLayer,spacing:p.spacingM}));
  const total=kinds.reduce((a,b)=>a+b.weight,0),lists=kinds.map(()=>[]);
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),sv=new THREE.Vector3();
  for(const area of sc.areas)for(let i=0;i<area.count;i++){
    let x=area.center[0]+(r()-.5)*area.size[0],z=area.center[1]+(r()-.5)*area.size[1];
    const roll=r(),pick=r()*total,grow=r(),turn=r()*6.28,wide=r(),shade=r();
    let k=0,acc=kinds[0].weight;while(pick>acc&&k<kinds.length-1)acc+=kinds[++k].weight;
    const K=kinds[k];
    if(sc.clumps)[x,z]=clumpPoint(x,z,sc.clumps,turn,wide);
    let y=surface(x,z);
    if(sc.float){
      const pool=water(x,z);
      if(!pool||pool.type==='river'||pool.surface-pool.floor<(sc.float.minDepthM??.4)||(sc.avoidRegions||[]).some(id=>inRegion(id,x,z)))continue;
      y=pool.surface;
    }else if(!scatterAllows(sc,x,y,z)||roll>layerWeight(K.ground??sc.groundLayer,x,z,w)*1.3)continue;
    // Each kind grows in its own patches.
    if(K.patch&&fbm(x/K.patch+k*13.1,z/K.patch-k*7.7)<.42)continue;
    if(K.spacing&&lists[k].some(o=>Math.hypot(o.x-x,o.z-z)<K.spacing))continue;
    const growth=grow*(sc.clumps?1-.55*Math.sqrt(wide):1);
    const size=K.widthM?(K.widthM[0]+(K.widthM[1]-K.widthM[0])*growth)/(2*K.model.crownRadius):K.heightM?(K.heightM[0]+(K.heightM[1]-K.heightM[0])*growth)/K.model.height:lo+(hi-lo)*grow,spread=size*(sc.float?1:.85+.35*wide);
    const keepClear=(sc.keepClearGrassM??0)+(K.model.crownRadius??0)*spread;
    if(sc.keepClearGrassM&&grass.some(e=>(e.root.position.x-x)**2+(e.root.position.z-z)**2<keepClear**2))continue;
    const heading=headings?headings()*Math.PI*2:turn;
    lists[k].push({x,y,z,matrix:m.compose(v.set(x,y-.03,z),q.setFromAxisAngle(UP,heading),sv.set(spread,size,spread)).clone(),tint:new THREE.Color().setScalar(.8+.3*shade)});
  }
  const group=new THREE.Group(),ranges=sc.lodRangesM||[12],fields=[];
  kinds.forEach((K,k)=>{if(!lists[k].length)return;const f=new LodField(K.model,lists[k],{ranges:ranges.slice(0,K.model.levels.length),farM:sc.drawDistanceM??45,shadowLevels:1});group.add(f);fields.push(f);});
  group.userData.updateLod=(eye,force)=>{for(const f of fields)f.update(eye,force);};
  group.userData.count=lists.reduce((a,l)=>a+l.length,0);
  return group;
}
function createBlades(scatter,style,surface){
  const st=BLADE_STYLES[style]||BLADE_STYLES.meadow,r=mulberry32(scatter.seed??7),cell=scatter.cellM??48,cells=new Map(),a=new THREE.Color(),w=[0,0,0,0];
  const range=([lo,hi])=>lo+(hi-lo)*r();
  for(const area of scatter.areas)for(let i=0;i<area.count;i++){
    let x=area.center[0]+(r()-.5)*area.size[0],z=area.center[1]+(r()-.5)*area.size[1];
    const roll=r();
    if(scatter.clumps&&roll<(scatter.clumps.fraction??1))[x,z]=clumpPoint(x,z,scatter.clumps,r()*Math.PI*2,r());
    const y=surface(x,z);
    if(!scatterAllows(scatter,x,y,z))continue;
    // Keep a blade with the probability of its ground layer (grass for meadows, mud for reeds).
    if(roll>layerWeight(scatter.groundLayer,x,z,w)*1.6)continue;
    const key=`${Math.floor(x/cell)},${Math.floor(z/cell)}`;
    if(!cells.has(key))cells.set(key,{positions:[],colors:[],indices:[],center:new THREE.Vector3(Math.floor(x/cell)*cell+cell/2,y,Math.floor(z/cell)*cell+cell/2)});
    const c=cells.get(key),h=range(st.height),wd=range(st.width),angle=r()*6.28,dx=Math.cos(angle)*wd,dz=Math.sin(angle)*wd,bend=range(st.bend)*(r()<.5?-1:1);
    const n=c.positions.length/3;
    c.positions.push(x-dx,y,z-dz,x+dx,y,z+dz,x+dx*.5+bend*.4,y+h*.6,z+dz*.5,x-dx*.5+bend*.4,y+h*.6,z-dz*.5,x+bend,y+h,z);
    a.setHSL(range(st.hue),range(st.sat),range(st.light));
    for(let j=0;j<5;j++){const light=j<2?.66:j<4?.92:1.14;c.colors.push(a.r*light,a.g*light,a.b*light);}
    c.indices.push(n,n+1,n+2,n,n+2,n+3,n+3,n+2,n+4);
  }
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.9});
  const wind={value:0};mat.onBeforeCompile=shader=>{shader.uniforms.windTime=wind;shader.vertexShader='uniform float windTime;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
float breeze=sin(position.x*.15+position.z*.21+windTime*.85)*.11+sin(position.x*.9+windTime*2.3)*.03;transformed.x+=breeze*pow(mod(float(gl_VertexID),5.)/4.,2.);`);};
  const group=new THREE.Group();group.userData.wind=wind;group.userData.cells=[];
  for(const c of cells.values()){
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(c.positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(c.colors,3));geo.setIndex(c.indices);geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,mat);mesh.receiveShadow=true;mesh.userData.center=c.center;group.add(mesh);group.userData.cells.push(mesh);
  }
  group.userData.drawDistance=scatter.drawDistanceM??220;
  return group;
}

export class World {
  constructor(scene,assets,atmosphere){
    this.scene=scene;this.assets=assets;this.atmosphere=atmosphere;this.entities=[];this.byId=new Map();this.byRoot=new Map();this.decor=[];this.obstacles=[];this.obstacleBodyHeight=0;this.time=0;this.surfaceRay=new THREE.Raycaster();
    this.field=FIELD;this.shared=atmosphere.shared;
    this.journeyRadius=PLANET_RADIUS;
    this.planetRoot=new THREE.Group();this.planetRoot.position.y=-PLANET_RADIUS;scene.add(this.planetRoot);
    // The river's coordinate frame; islands drift on it. No playable planets in this version.
    this.islandRoot=new THREE.Group();this.islandRoot.position.y=PLANET_RADIUS;this.planetRoot.add(this.islandRoot);
    this.terrain=new TerrainChunks(FIELD,terrainHeight,groundMaterial(FIELD,FIELD.desc.layers,this.shared,waterShading(PLANET_RADIUS)));this.islandRoot.add(this.terrain);
    this.islandRoot.updateWorldMatrix(true,true);
    const river=WATERS.find(r=>r.water.type==='river');this.river=river;this.seaLevel=river.water.levelM;this.shared.waterLevel.value=this.seaLevel;
    const heights=heightTexture(FIELD),enclosed=WATERS.filter(r=>r.water.type==='enclosed');
    this.waterMat=waterMaterial({...river.water.look,level:this.seaLevel,holes:enclosed.map(r=>[...r.center,...r.radii]),uwColor:'#'+underwaterLook(river.id).fogColor.getHexString()},this.shared,FIELD,heights);
    const corridor=river.corridor||{lengthM:12000,halfWidthM:1200};
    const waterGeo=new THREE.PlaneGeometry(corridor.lengthM+3000,2*corridor.halfWidthM+1400,Math.round((corridor.lengthM+3000)/60),Math.round((2*corridor.halfWidthM+1400)/60));waterGeo.rotateX(-Math.PI/2);
    const p=waterGeo.attributes.position;for(let i=0;i<p.count;i++){const r2=p.getX(i)**2+p.getZ(i)**2;p.setY(i,Math.sqrt(Math.max(0,PLANET_RADIUS**2-r2))-PLANET_RADIUS+this.seaLevel);}waterGeo.computeVertexNormals();
    this.sea=new THREE.Mesh(waterGeo,this.waterMat);this.sea.position.y=PLANET_RADIUS;this.sea.renderOrder=2;this.planetRoot.add(this.sea);
    this.waterBodyIds=enclosed.map(r=>r.id);
    this.waterBodies=enclosed.map(r=>{
      const mesh=new THREE.Mesh(new THREE.CircleGeometry(1,96),waterMaterial({...r.water.look,stillWater:true,level:r.water.surfaceY,uwColor:'#'+underwaterLook(r.id).fogColor.getHexString()},this.shared,FIELD,heights));mesh.rotation.x=-Math.PI/2;
      mesh.scale.set(r.radii[0],r.radii[1],1);mesh.position.set(r.center[0],r.water.surfaceY,r.center[1]);mesh.renderOrder=2;this.islandRoot.add(mesh);return mesh;
    });
    // Rainforest walls along both banks, in the river's curved frame.
    this.banks=createBanks({halfWidth:corridor.halfWidthM,length:corridor.lengthM,reaches:LAYOUT.riverJourney?.reaches||[]},(x,z,h)=>new THREE.Vector3(x,Math.sqrt(Math.max(0,PLANET_RADIUS**2-x*x-z*z))+this.seaLevel+h,z),assets.vegetation);
    this.planetRoot.add(this.banks);
    // Under water: light shafts and drifting motes around the eye; the sky takes the water's colour.
    this.underwaterFx=new UnderwaterFx(this.shared,underwaterLook(river.id));scene.add(this.underwaterFx);
    atmosphere.skyUniforms?.underwaterColor?.value.copy(underwaterLook(river.id).skyColor);
    this.riverTraffic=new RiverTraffic(LAYOUT.riverTraffic||[],{radius:PLANET_RADIUS,level:this.seaLevel,corridor,rules:LAYOUT.riverJourney?.traffic});this.planetRoot.add(this.riverTraffic);
    this.populate();
    if(LAYOUT.riverJourney){this.journey=new RiverJourney(this,LAYOUT.riverJourney);this.planetRoot.add(this.journey);}
    this.createDecor();this.createRipples();
    scene.updateMatrixWorld(true);
  }
  addBody(id,kind,root,visual){
    if(this.byId.has(id))throw new Error(`Duplicate body id: ${id}`);
    const entity={id,kind,root,visual,heading:0,moving:false,baseY:root.position.y,groundOffset:root.position.y-terrainHeight(root.position.x,root.position.z),seed:this.entities.length,home:root.position.clone(),homeRotation:[root.rotation.x,root.rotation.y,root.rotation.z],homeBaseY:root.position.y};
    this.entities.push(entity);this.byId.set(id,entity);this.byRoot.set(root,entity);return entity;
  }
  spawn(kind,x,y,z,id,parent,random=false){
    const root=new THREE.Group();root.position.set(x,y,z);parent.add(root);
    const visual=this.assets.make(kind,seedOf(id));root.add(visual);
    const entity=this.addBody(id,kind,root,visual);entity.random=random;return entity;
  }
  // World layout comes from the layout in game.json: named instances, then scatter groups.
  populate(){
    for(const item of LAYOUT.instances)this.place(item,item.id,item.position);
    for(const group of LAYOUT.scatter)this.scatter(group);
  }
  place(item,id,position,random=false){
    if(item.placement==='main')return this.addBody(id,item.kind,this.islandRoot,this.terrain);
    const [x,dy,z]=position;
    if(item.carrier==='river'){
      const root=new THREE.Group(),y=Math.sqrt(Math.max(0,PLANET_RADIUS**2-x*x-z*z));
      root.position.set(x,y,z);root.quaternion.setFromUnitVectors(UP,root.position.clone().normalize());this.planetRoot.add(root);
      const visual=this.assets.make(item.kind,seedOf(id));root.add(visual);
      const e=this.addBody(id,item.kind,root,visual);e.random=random;return e;
    }
    const carrier=this.byId.get(item.carrier);if(!carrier)throw new Error(`Unknown carrier ${item.carrier} for ${id}`);
    const surface=item.placement==='surface';
    const e=this.spawn(item.kind,x,surface?this.surfaceOf(carrier,x,z)+dy:dy,z,id,carrier.root,random);
    if(surface)e.surfaceOffset=dy;return e;
  }
  scatter(group){
    const r=mulberry32(group.seed??1),carrier=this.byId.get(group.carrier);let n=0;
    const points=group.points||[];
    if(group.area)for(let tries=0;n+points.length<group.count&&tries<group.count*8;tries++){
      const x=group.area.center[0]+(r()-.5)*group.area.size[0],z=group.area.center[1]+(r()-.5)*group.area.size[1];
      if(!scatterAllows(group,x,this.surfaceOf(carrier,x,z),z))continue;
      this.place(group,`${group.id}-${n++}`,[x,0,z],true);
    }
    // Points are [x,z] on the surface, or [x,y,z] with y as the height offset or fixed height.
    for(const pt of points)this.place(group,`${group.id}-${n++}`,pt.length===3?pt:[pt[0],0,pt[1]],true);
  }
  // Height of a carrier's surface at a point in its own frame.
  surfaceOf(carrier,x,z){
    if(!carrier||carrier.root===this.islandRoot)return this.height(x,z);
    if(carrier.visual?.userData.external){
      carrier.root.updateMatrixWorld(true);
      this.surfaceRay.set(carrier.root.localToWorld(new THREE.Vector3(x,5000,z)),new THREE.Vector3(0,-1,0).transformDirection(carrier.root.matrixWorld));
      const hit=this.surfaceRay.intersectObject(carrier.visual,true)[0];
      return hit?carrier.root.worldToLocal(hit.point.clone()).y:0;
    }
    const d=SPECIES[carrier.kind].surface;
    if(d?.type==='dome'){const [rx,h,rz]=d.radii;return h*Math.sqrt(Math.max(0,1-(x/rx)**2-(z/rz)**2));}
    return 0;
  }
  // Decoration slots (env.meadow, env.pebbles…): instanced models when the slot names a file, otherwise drawn by code.
  createDecor(){
    for(const slot of this.assets.manifest.decor||[]){
      const carrier=this.byId.get(slot.scatter.carrier);if(!carrier)continue;
      let object=null;
      if(this.assets.hasDecor(slot.slotId)){
        const r=mulberry32(slot.scatter.seed??1),placements=[],[lo,hi]=slot.scaleRange||[1,1];
        for(const point of slot.scatter.points||[]){
          const [x,offset,z]=point.position;
          placements.push({...point,position:[x,this.surfaceOf(carrier,x,z)+offset,z]});
        }
        for(const area of slot.scatter.areas)for(let i=0;i<area.count;i++){
          const x=area.center[0]+(r()-.5)*area.size[0],z=area.center[1]+(r()-.5)*area.size[1],y=this.surfaceOf(carrier,x,z);
          if(scatterAllows(slot.scatter,x,y,z))placements.push({position:[x,y,z],rotationY:r()*Math.PI*2,scale:lo+(hi-lo)*r()});
        }
        object=this.assets.makeDecor(slot,placements);
        // A building's footprint (circles in the model's frame) keeps small bodies out of it.
        for(const p of placements)for(const [fx,fz,fr] of slot.scatter.footprint||[]){
          const c=Math.cos(p.rotationY??0),s=Math.sin(p.rotationY??0),k=p.scale??1;
          this.obstacles.push({x:p.position[0]+(fx*c+fz*s)*k,z:p.position[2]+(-fx*s+fz*c)*k,r:fr*k,top:p.position[1]+(slot.scatter.footprintTopM??slot.height)*k});
        }
      }else if(slot.type==='landing'){
        object=createLanding(slot,(x,z)=>this.surfaceOf(carrier,x,z),LAYOUT.regions[slot.scatter.trail.region].points);
      }else if(slot.type==='fireflies'){
        const r=mulberry32(slot.scatter.seed??11),points=[];
        for(const area of slot.scatter.areas)for(let i=0;i<area.count;i++){
          const x=area.center[0]+(r()-.5)*area.size[0],z=area.center[1]+(r()-.5)*area.size[1],y=this.surfaceOf(carrier,x,z);
          if(scatterAllows(slot.scatter,x,y,z))points.push([x,y+.5+r()*2.2,z]);
        }
        object=fireflies(this.shared,points);
      }else if(slot.type==='forest'){object=createForest(slot,(x,z)=>this.surfaceOf(carrier,x,z),this.obstacles,this.bodyGrid(carrier,16),this.assets.vegetation);this.obstacleBodyHeight=slot.scatter.blocksBodiesUpToM??0;
      }else if(slot.type==='understory'){object=createUnderstory(slot,(x,z)=>this.surfaceOf(carrier,x,z),this.assets.vegetation,(x,z)=>this.water(x,z),this.entities.filter(e=>e.kind==='grass'&&e.root.parent===carrier.root));
      }else if(slot.type==='blades'){object=createBlades(slot.scatter,slot.style,(x,z)=>this.surfaceOf(carrier,x,z));}
      else if(slot.type==='pebble'){object=createPebbles(slot,this);}
      else if(slot.type==='waterweed'){object=createWaterweeds(slot,this);}
      if(object){carrier.root.add(object);this.decor.push({slot,object});}
    }
  }
  // Solid bodies on a carrier, bucketed by cell, with a keep-clear radius (crown or body plus margin).
  bodyGrid(carrier,cell){
    const grid=new Map();
    for(const e of this.entities){
      const s=SPECIES[e.kind];if(e.root.parent!==carrier.root||!s.collision.solid)continue;
      // Boxes are axis-aligned, so the keep-clear circle reaches their corners.
      const p=e.root.position,r=Math.max(s.radius,...s.collision.boxes.map(b=>Math.hypot(Math.max(-b[0],b[3]),Math.max(-b[2],b[5]))))+3;
      for(let i=Math.floor((p.x-r)/cell);i<=Math.floor((p.x+r)/cell);i++)for(let j=Math.floor((p.z-r)/cell);j<=Math.floor((p.z+r)/cell);j++){
        const k=`${i},${j}`;if(!grid.has(k))grid.set(k,[]);grid.get(k).push({x:p.x,z:p.z,r});
      }
    }
    return grid;
  }
  // Random scenery must not start inside another solid body; named bodies stay.
  prune(collision){
    for(let pass=0;pass<4;pass++){
      collision.refresh();
      const e=this.entities.find(e=>e.random&&SPECIES[e.kind].collision.solid&&collision.collides(e,this.position(e)));
      if(!e)return;
      e.root.removeFromParent();this.entities.splice(this.entities.indexOf(e),1);this.byId.delete(e.id);this.byRoot.delete(e.root);pass=-1;
    }
  }
  carrierOf(entity){return this.byRoot.get(entity.root.parent)||null;}
  // Water body under a point of the main island, in island-local metres: an enclosed body
  // whose shape contains the point, else the sea where it is deep enough.
  // Still water stands only where its region dips below its surface (an oxbow keeps its
  // inner bank dry); the river fills everything deep enough below its level.
  water(x,z){
    const floor=this.height(x,z);let river=null;
    for(const r of WATERS){
      if(r.water.type==='river')river=r;
      else if(inRegion(r.id,x,z)&&floor<r.water.surfaceY)return {id:r.id,type:r.water.type,surface:r.water.surfaceY,floor};
    }
    if(!river)return null;
    const surface=-(x*x+z*z)/(2*PLANET_RADIUS)+river.water.levelM;
    return floor<surface-river.water.minDepthM?{id:river.id,type:'river',surface,floor}:null;
  }
  // Colour the underside of the water mirrors when seen from below (the water the eye is in).
  setUnderwaterColor(color){this.waterMat.uniforms.uwColor.value.copy(color);for(const m of this.waterBodies)m.material.uniforms.uwColor.value.copy(color);}
  // How the water looks from inside, for the body of water the eye is in (river by default).
  underwaterLook(id=null){return underwaterLook(id);}
  // Depth of the water drawn over a point (0 on dry ground). Unlike water(), the shallow river
  // margin counts too, so wading limits match the water the player sees.
  waterDepth(x,z){
    const floor=this.height(x,z);let river=null;
    for(const r of WATERS){
      if(r.water.type==='river')river=r;
      else if(inRegion(r.id,x,z)&&floor<r.water.surfaceY)return r.water.surfaceY-floor;
    }
    return river?Math.max(0,-(x*x+z*z)/(2*PLANET_RADIUS)+river.water.levelM-floor):0;
  }
  height(x,z){return terrainHeight(x,z);}
  occludes(eye,point,clearance){
    const length=eye.distanceTo(point),limit=Math.max(0,(length-clearance)/length);
    // Analytic heightfield queries avoid raycasting tens of thousands of
    // triangles for every candidate on every frame.
    const a=this.islandRoot.worldToLocal(eye.clone()),b=this.islandRoot.worldToLocal(point.clone());
    for(let i=1;i<=12;i++){
      const t=limit*i/12,x=THREE.MathUtils.lerp(a.x,b.x,t),z=THREE.MathUtils.lerp(a.z,b.z,t),y=THREE.MathUtils.lerp(a.y,b.y,t);
      if(y<this.height(x,z)-.2)return true;
    }
    return false;
  }

  createRipples(){
    this.ripple=new THREE.Group();this.scene.add(this.ripple);
    this.rings=[];
    for(let i=0;i<3;i++){
      const mat=new THREE.MeshBasicMaterial({color:'#e6e9bd',transparent:true,opacity:.6,side:THREE.DoubleSide,depthWrite:false});
      const ring=new THREE.Mesh(new THREE.RingGeometry(.94,1,80),mat);ring.rotation.x=-Math.PI/2;this.ripple.add(ring);this.rings.push(ring);
    }
    this.ripple.visible=false;
  }
  position(entity,target=new THREE.Vector3()){return entity.root.getWorldPosition(target);}
  riverHeight(x,z,height=0){return Math.sqrt(Math.max(0,PLANET_RADIUS**2-x*x-z*z))-PLANET_RADIUS+this.seaLevel+height;}
  focus(entity,target=new THREE.Vector3()){
    this.position(entity,target);const s=SPECIES[entity.kind];
    target.y+=s.height*layerOf(entity.kind).focusHeightRatio;
    return target;
  }
  update(dt,player,target,targetPoint=null,targetSize=1,transition=null){
    this.time+=dt;const t=this.time,stage=SPECIES[player.kind].stage;
    this.riverTraffic?.update(dt,this.islandRoot.position);
    this.journey?.update(dt,SPECIES[player.kind].mode==='island',this.ambientHold||transition);
    if(!this.ambient)this.ambient=new AmbientMotion(this,LAYOUT.ambient||[]);
    this.ambient.update(dt,player,this.ambientHold||transition);
    this.islandRoot.updateMatrixWorld();this.shared.toIsland.value.copy(this.islandRoot.matrixWorld).invert();
    const eye=this.scene.userData.cameraPosition,localEye=eye?this.islandRoot.worldToLocal(eye.clone()):null;
    if(this.terrain.material?.userData.uwEyeUnderwater)this.terrain.material.userData.uwEyeUnderwater.value=this.scene.userData.underwater?1:0;
    if(localEye&&this.terrain.update)this.terrain.update(localEye);
    // Bank tree segments beyond the haze are not drawn.
    if(eye&&this.banks.userData.segments.length){const local=this.planetRoot.worldToLocal(eye.clone()),far=(TUNING.bankTreeDistanceM?.value??2600)**2;for(const g of this.banks.userData.segments)g.visible=g.userData.center.distanceToSquared(local)<far;}
    WIND.value=t;
    for(const d of this.decor){
      // Forest: impostors at every scale, model levels only near the eye at small scales.
      // Understory: only at small scales, near the eye.
      const shown=stage<=(d.slot.visibleUpToStage??1);
      if(d.object.userData.updateLod){
        d.object.visible=shown||!!d.object.userData.forest;
        if(localEye&&d.object.visible)d.object.userData.updateLod(shown?localEye:null);
        continue;
      }
      d.object.visible=shown;
      if(d.object.visible&&d.object.userData.tick)d.object.userData.tick(dt,REDUCED_MOTION?.matches,this.shared?.night?.value??0);
      if(d.object.userData.wind)d.object.userData.wind.value=t;
      // Dense cells beyond their draw distance are hidden (positions are in the carrier frame).
      if(d.object.visible&&localEye&&d.object.userData.cells&&d.object.parent===this.islandRoot){
        const far=d.object.userData.drawDistance**2;for(const m of d.object.userData.cells)m.visible=m.userData.center.distanceToSquared(localEye)<far;
      }
    }
    // Water surfaces stay drawn from below too (their shader shows the underside).
    if(localEye&&this.underwaterFx){
      const under=!!this.scene.userData.underwater,pool=under?this.water(localEye.x,localEye.z):null;
      const enclosed=pool?.type==='enclosed',level=enclosed?pool.surface:-(localEye.x**2+localEye.z**2)/(2*PLANET_RADIUS)+this.seaLevel;
      const surfaceY=under?this.islandRoot.localToWorld(new THREE.Vector3(localEye.x,level,localEye.z)).y:0;
      this.underwaterFx.update(eye,under,surfaceY,this.underwaterLook(enclosed?pool.id:null));
      this.waterMat.uniforms.below.value=under&&!enclosed?1:0;
      this.waterBodies.forEach((m,i)=>{m.material.uniforms.below.value=enclosed&&pool.id===this.waterBodyIds[i]?1:0;});
    }
    // Small bodies are not drawn at large scales; their state is kept.
    const hideBelow=stage-(TUNING.scaleHideBelowStageOffset?.value??1);
    for(const e of this.entities){
      const s=SPECIES[e.kind];
      if(e.visual)e.visual.visible=e===player||s.stage>=hideBelow;
      if(this.firstPersonBodies?.includes(e)&&s.firstPerson?.hideBody)e.visual.visible=false;
      // A body hidden for first person still drives its animation (the eye follows its wingbeat or tail).
      if(e.visual&&!e.visual.visible&&e===player){e.visual.userData.moving=e.animationMoving??e.moving;e.visual.userData.boosting=e.moving&&e.boosting;e.visual.userData.movementRatio=e.movementRatio;e.visual.userData.swimming=e.swimming;}
      if(e.visual?.userData.flap)e.visual.userData.flap.value=0.3+0.7*Math.sin(t*2*Math.PI*6+e.seed);
      if(!e.visual||!e.visual.visible)continue;
      const v=e.visual;
      if(v.userData.sway)v.rotation.z=Math.sin(t*.9+e.seed)*v.userData.sway;
      v.userData.moving=e===player?(e.animationMoving??e.moving):e.moving;
      v.userData.boosting=e.moving&&e.boosting;
      v.userData.movementRatio=e===player?e.movementRatio:1;
      v.userData.swimming=e.swimming;
    }
    this.assets.update(dt);
    if(target){
      this.ripple.visible=true;const s=SPECIES[target.kind];
      if(targetPoint)this.ripple.position.copy(targetPoint).y+=.06;
      else{const p=this.position(target);this.ripple.position.copy(p);this.ripple.position.y+=Math.min(s.height*.035,8)+.04;}
      for(let i=0;i<3;i++){const f=(t*.3+i/3)%1;this.rings[i].scale.setScalar(targetSize*(1.05+f*.55));this.rings[i].material.opacity=(1-f)*.42;}
    }else this.ripple.visible=false;
  }
  serialize(){return this.entities.map(e=>({id:e.id,kind:e.kind,position:e.root.position.toArray(),rotation:[e.root.rotation.x,e.root.rotation.y,e.root.rotation.z],baseY:e.baseY,heading:e.heading}));}
  serializeLayout(){return this.entities.map(e=>({id:e.id,kind:e.kind,position:e.home.toArray(),rotation:e.homeRotation||[0,0,0],baseY:e.homeBaseY??e.baseY}));}
  restore(records,layout=[]){
    const old=new Map((Array.isArray(layout)?layout:[]).filter(r=>r&&typeof r.id==='string').map(r=>[r.id,r]));
    for(const record of records||[]){
      const e=this.byId.get(record.id);if(!e||!Array.isArray(record.position)||record.position.length!==3||!record.position.every(Number.isFinite))continue;
      const prior=old.get(record.id),position=prior?.position?.length===3?e.home.clone().add(new THREE.Vector3(...record.position).sub(new THREE.Vector3(...prior.position))):new THREE.Vector3(...record.position);e.root.position.copy(position);e.heading=Number.isFinite(record.heading)?record.heading:0;
      if(Array.isArray(record.rotation)&&record.rotation.length===3&&record.rotation.every(Number.isFinite)){const oldRotation=prior?.rotation;e.root.rotation.set(...(Array.isArray(oldRotation)&&oldRotation.length===3?record.rotation.map((v,i)=>e.homeRotation[i]+v-oldRotation[i]):record.rotation));}
      else if(SPECIES[e.kind].mode!=='island')e.root.rotation.y=e.heading;
      e.baseY=Number.isFinite(record.baseY)&&Number.isFinite(prior?.baseY)?(e.homeBaseY??e.baseY)+record.baseY-prior.baseY:(Number.isFinite(record.baseY)?record.baseY:e.root.position.y);
    }
    this.scene.updateMatrixWorld(true);
    this.journey?.syncIsland();
  }
}
