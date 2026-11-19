import * as THREE from 'three';
import { bankShore } from './banks.js';
import { mulberry32 } from './species.js';

const smooth=THREE.MathUtils.smoothstep;
const finite=(n,fallback=0)=>Number.isFinite(n)?n:fallback;

// Mechanics publish confirmed encounters; the scenery and audio consume the same state.
// The river's coordinates stay fixed while the island and everything it carries travel.
export class JourneyState {
  constructor(config,halfWidth){
    this.config=config;this.halfWidth=halfWidth;this.time=0;this.events=[];
    this.reaches=config.reaches.map(r=>({...r,tint:new THREE.Color(r.fogTint),inside:false,flight:-1,lastRise:-1e6,visits:0}));
  }
  update(dt,island,halfZ,active){
    if(!(dt>0))return;
    this.time+=dt;const rules=this.config.encounters;
    for(const r of this.reaches){
      if(r.flight>=0){r.flight+=dt;if(r.flight>=rules.flightDurationSec)r.flight=-1;}
      const margin=r.inside?rules.leaveMarginM:0;
      const shoreGap=bankShore(this.halfWidth,r.x,r.side)-r.side*island.z-halfZ;
      const inside=active&&Math.abs(island.x-r.x)<r.radiusM+margin&&shoreGap<rules.shoreDistanceM+margin;
      if(inside&&!r.inside&&r.flight<0&&this.time-r.lastRise>=rules.cooldownSec){
        r.flight=0;r.lastRise=this.time;r.visits++;
        this.events.push({type:'bank_birds_risen',id:r.id,visit:r.visits,time:this.time});
        if(this.events.length>12)this.events.shift();
      }
      r.inside=inside;
    }
  }
  serialize(){return {version:1,time:this.time,reaches:this.reaches.map(r=>({id:r.id,inside:r.inside,flight:r.flight,lastRise:r.lastRise,visits:r.visits}))};}
  restore(saved){
    this.time=Math.max(0,finite(saved?.time));this.events.length=0;
    for(const r of this.reaches){
      const s=saved?.reaches?.find(x=>x?.id===r.id);
      r.inside=Boolean(s?.inside);r.flight=Number.isFinite(s?.flight)&&s.flight>=0&&s.flight<this.config.encounters.flightDurationSec?s.flight:-1;
      r.lastRise=Math.min(this.time,finite(s?.lastRise,-1e6));r.visits=Math.max(0,Math.floor(finite(s?.visits)));
    }
  }
}

function fogTexture(){
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;
  const ctx=canvas.getContext('2d'),img=ctx.createImageData(256,64);
  for(let y=0;y<64;y++)for(let x=0;x<256;x++){
    const k=(y*256+x)*4,u=(x-127.5)/128,v=(y-31.5)/32;
    img.data.set([205,225,216,Math.round(115*Math.exp(-u*u*5-v*v*8))],k);
  }
  ctx.putImageData(img,0,0);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

function birdGeometry(){
  // A white body and pointed wings retain a readable silhouette across a wide flock.
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([
    0,.08,-.52,-.22,0,.34,.22,0,.34,
    -.12,0,-.12,-1.18,.12,.2,-.55,0,.52,
    .12,0,-.12,.55,0,.52,1.18,.12,.2,
  ],3));
  g.setAttribute('color',new THREE.Float32BufferAttribute([
    .94,.95,.9,.94,.95,.9,.94,.95,.9,
    .94,.95,.9,.08,.11,.1,.94,.95,.9,
    .94,.95,.9,.94,.95,.9,.08,.11,.1,
  ],3));g.computeVertexNormals();return g;
}

class RiverWake extends THREE.Group {
  constructor(world,config){
    super();this.world=world;this.config=config;this.position.y=world.journeyRadius;this.renderOrder=3;
    this.last=world.islandRoot.position.clone();this.direction=new THREE.Vector2(-1,0);this.distance=0;this.strength=0;this.next=0;
    const points=[];for(let i=0;i<=16;i++){const x=(i/16-.5)*220;points.push(new THREE.Vector3(x,0,Math.abs(x)*.23));}
    const geometry=new THREE.BufferGeometry().setFromPoints(points);
    this.trails=Array.from({length:config.maxSegments},()=>{
      const line=new THREE.Line(geometry.clone(),new THREE.LineBasicMaterial({color:'#e2e9dc',transparent:true,opacity:0,depthWrite:false}));
      line.renderOrder=3;line.visible=false;line.userData.age=config.lifetimeSec;this.add(line);return line;
    });
    // Follow the actual dry shoreline rather than drawing a geometric oval over the land.
    const coast=[],radius=Math.max(world.field?.width??1200,world.field?.depth??900)*.55;
    for(let i=0;i<128;i++){
      const a=i/128*Math.PI*2,dx=Math.cos(a),dz=Math.sin(a);let lastDry=0;
      for(let r=8;r<radius;r+=8)if(world.waterDepth(dx*r,dz*r)<=0)lastDry=r;
      const r=lastDry+12;coast.push(new THREE.Vector3(dx*r,world.seaLevel-(r*r)/(2*world.journeyRadius)+.14,dz*r));
    }
    this.coast=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(coast),new THREE.LineBasicMaterial({color:'#e5eddf',transparent:true,opacity:0,depthWrite:false}));
    this.coast.renderOrder=3;world.islandRoot.add(this.coast);
  }
  sync(){this.last.copy(this.world.islandRoot.position);this.distance=0;this.strength=0;this.coast.material.opacity=0;for(const l of this.trails)l.visible=false;}
  update(dt,night,reducedMotion){
    if(!(dt>0))return;
    const c=this.config,p=this.world.islandRoot.position,dx=p.x-this.last.x,dz=p.z-this.last.z,d=Math.hypot(dx,dz),speed=d/dt;
    this.last.copy(p);
    if(d>500){this.sync();return;}
    if(d>.001)this.direction.set(dx/d,dz/d);
    this.strength=THREE.MathUtils.damp(this.strength,smooth(speed,c.minSpeedMps,c.fullSpeedMps),2.2,dt);
    this.coast.material.opacity=this.strength*(.2-night*.09);
    for(const l of this.trails){l.userData.age+=dt;l.visible=!reducedMotion&&l.userData.age<c.lifetimeSec;l.material.opacity=(1-smooth(l.userData.age,0,c.lifetimeSec))*(.18-night*.08);}
    this.distance+=d;
    if(!reducedMotion&&speed>c.minSpeedMps&&this.distance>=c.sampleDistanceM){
      this.distance%=c.sampleDistanceM;const l=this.trails[this.next++%this.trails.length],dir=this.direction;
      const behind=Math.hypot(dir.x*600,dir.y*350)+35,x=p.x-dir.x*behind,z=p.z-dir.y*behind;
      l.position.set(x,this.world.riverHeight(x,z,.16),z);l.rotation.y=Math.atan2(dir.x,dir.y);const size=.7+Math.min(1,speed/c.fullSpeedMps)*.4;l.scale.setScalar(size);
      const vertices=l.geometry.attributes.position;
      for(let i=0;i<vertices.count;i++){
        const u=(i/16-.5)*220,v=Math.abs(u)*.23,wx=x+size*(u*dir.y+v*dir.x),wz=z+size*(-u*dir.x+v*dir.y);
        vertices.setY(i,(this.world.riverHeight(wx,wz,.16)-l.position.y)/size);
      }
      vertices.needsUpdate=true;l.geometry.computeBoundingSphere();l.userData.age=0;l.visible=true;
    }
  }
}

export class RiverJourney extends THREE.Group {
  constructor(world,config){
    super();this.world=world;this.config=config;this.position.y=world.journeyRadius;
    this.state=new JourneyState(config,world.river.corridor.halfWidthM);this.flocks=[];this.mist=[];this.cuePosition=new THREE.Vector3();
    this.reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
    this.wake=new RiverWake(world,config.wake);world.planetRoot.add(this.wake);
    const fog=fogTexture();
    this.state.reaches.forEach((reach,index)=>this.createReach(reach,index,fog));
  }
  createReach(reach,index,fog){
    const W=this.world,r=mulberry32(4901+index*787),root=new THREE.Group();root.name=reach.id;root.position.x=reach.x;this.add(root);
    const shore=x=>bankShore(W.river.corridor.halfWidthM,x,reach.side);
    const point=(dx,inward,h)=>{const x=reach.x+dx,z=reach.side*(shore(x)+inward);return new THREE.Vector3(dx,W.riverHeight(x,z,h),z);};
    const treeModels=Object.values(W.assets.vegetation?.models||{}),tree=treeModels.find(t=>t.name==='kapok'&&t.impostor)||treeModels.find(t=>t.impostor);
    const bark=new THREE.MeshStandardMaterial({color:reach.kind==='mist_forest'?'#565e50':'#736956',roughness:1});
    const giants=reach.kind==='mist_forest'?3:1;
    for(let k=0;k<giants;k++){
      const dx=(k-(giants-1)/2)*100,base=point(dx,reach.kind==='mist_forest'?55:90,4),height=reach.treeHeightM*(1-k*.12);
      const giant=new THREE.Group();giant.position.copy(base);root.add(giant);
      if(tree){
        const size=height/tree.height,parts=tree.levels[tree.levels.length-1];
        for(const part of parts){const mesh=new THREE.Mesh(part.geometry,part.material);mesh.scale.set(size*.95,size,size*.95);giant.add(mesh);}
      }
      else{const trunk=new THREE.Mesh(new THREE.CylinderGeometry(2,4,height,9),bark);trunk.position.y=height/2;giant.add(trunk);}
      for(let j=0;j<6;j++){
        const a=j/6*Math.PI*2,len=18+r()*12;
        const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,17,0),new THREE.Vector3(Math.cos(a)*5,5,Math.sin(a)*5),new THREE.Vector3(Math.cos(a)*len,-1,Math.sin(a)*len)]);
        giant.add(new THREE.Mesh(new THREE.TubeGeometry(curve,12,1.5,5,false),bark));
      }
    }
    if(reach.kind==='reed_bay'){
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-.12,0,0,.12,0,0,.32,1,0],3));geometry.computeVertexNormals();
      const material=new THREE.MeshStandardMaterial({color:'#bba457',side:THREE.DoubleSide,roughness:.95});
      material.onBeforeCompile=s=>{s.uniforms.reedTime=W.shared.time;s.vertexShader='uniform float reedTime;\n'+s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\ntransformed.x+=sin(reedTime*.8+instanceMatrix[3].x*.17)*.16*position.y*position.y;`);};
      material.customProgramCacheKey=()=>'bank-reed-v1';
      const reeds=new THREE.InstancedMesh(geometry,material,3072),matrix=new THREE.Matrix4(),quat=new THREE.Quaternion(),scale=new THREE.Vector3(),color=new THREE.Color();
      for(let i=0;i<3072;i++){
        const clump=Math.floor(i/96),dx=(clump/31-.5)*650+(r()-.5)*20,inward=22+20*Math.sin(clump*1.7)**2+(r()-.5)*14,base=point(dx,inward,-3+7*Math.min(1,inward/18)-.05);
        reeds.setMatrixAt(i,matrix.compose(base,quat.setFromAxisAngle(new THREE.Vector3(0,1,0),r()*6.283),scale.set(1.5+r()*2,3.5+r()*3.5,1)));
        reeds.setColorAt(i,color.setHSL(.11+r()*.025,.25+r()*.15,.4+r()*.2));
      }
      root.add(reeds);
    }
    if(reach.kind==='mist_forest')for(let i=0;i<7;i++){
      const material=new THREE.SpriteMaterial({map:fog,transparent:true,opacity:.5,depthWrite:false,fog:true,color:'#d6e6dc'}),sprite=new THREE.Sprite(material);
      sprite.position.copy(point((i-3)*100,20+(i%3)*65,14+(i%3)*10));sprite.scale.set(650,80+(i%3)*20,1);sprite.renderOrder=4;root.add(sprite);this.mist.push(sprite);
    }
    const flight={value:0},material=new THREE.MeshStandardMaterial({color:'#ffffff',vertexColors:true,roughness:1,side:THREE.DoubleSide});
    material.onBeforeCompile=s=>{s.uniforms.birdTime=W.shared.time;s.uniforms.birdFlight=flight;s.vertexShader='uniform float birdTime;uniform float birdFlight;\n'+s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\ntransformed.y+=abs(position.x)*sin(birdTime*7.+instanceMatrix[3].x*.23)*.42*birdFlight;`);};
    material.customProgramCacheKey=()=>'river-bank-bird-v1';
    const birds=new THREE.InstancedMesh(birdGeometry(),material,reach.birdCount),homes=[];
    birds.frustumCulled=false;root.add(birds);
    for(let i=0;i<reach.birdCount;i++){const inward=8+r()*20;homes.push({point:point((r()-.5)*200,inward,-3+7*Math.min(1,inward/18)+.35),phase:r()*6.283,spread:70+r()*100});}
    this.flocks.push({reach,root,birds,homes,flight});
  }
  syncIsland(){this.wake.sync();}
  update(dt,isIsland,transition){
    const W=this.world,p=W.islandRoot.position;
    this.state.update(dt,p,340,isIsland&&!transition&&!!W.scene.userData.exploring);
    const night=W.shared.night.value,matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1),axis=new THREE.Vector3(0,1,0);
    for(const f of this.flocks){
      const t=f.reach.flight<0?0:Math.min(1,f.reach.flight/this.config.encounters.flightDurationSec),lift=Math.sin(t*Math.PI),flying=f.reach.flight>=0;
      f.flight.value=flying?1:0;
      f.homes.forEach((home,i)=>{
        const phase=home.phase+t*Math.PI*2,point=home.point.clone();
        point.x+=lift*Math.cos(phase)*home.spread;point.z-=f.reach.side*lift*(150+Math.sin(phase)*80);point.y+=lift*(75+Math.sin(phase*2)*12);
        rotation.setFromAxisAngle(axis,flying?-phase:home.phase);f.birds.setMatrixAt(i,matrix.compose(point,rotation,scale));
      });f.birds.instanceMatrix.needsUpdate=true;
      const eye=W.scene.userData.cameraPosition;if(eye){const local=this.worldToLocal(eye.clone());f.root.visible=Math.abs(local.x-f.reach.x)<3200;}
    }
    for(const sprite of this.mist)sprite.material.opacity=.5*(1-night*.3);
    this.wake.update(dt,night,this.reducedMotion.matches);
  }
  lookAtWorld(point){
    const local=this.worldToLocal(point.clone());let best=null,weight=0;
    for(const reach of this.state.reaches){const w=1-smooth(Math.abs(local.x-reach.x),reach.radiusM*.25,reach.radiusM);if(w>weight){best=reach;weight=w;}}
    return best?{id:best.id,name:best.name,fogMultiplier:THREE.MathUtils.lerp(1,best.fogMultiplier,weight),tint:best.tint,weight:weight*.2}:null;
  }
  placeAtWorld(point){const reach=this.lookAtWorld(point);return reach&&reach.weight>.1?reach.name:null;}
  drainEvents(){
    return this.state.events.splice(0).map(e=>{const r=this.state.reaches.find(r=>r.id===e.id),z=r.side*bankShore(this.world.river.corridor.halfWidthM,r.x,r.side);
      return {...e,position:this.localToWorld(new THREE.Vector3(r.x,this.world.riverHeight(r.x,z,20),z))};});
  }
  serialize(){return this.state.serialize();}
  restore(saved){this.state.restore(saved);this.syncIsland();this.update(0,false,null);}
}
