import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SPECIES, TUNING, mulberry32 } from './species.js';
import { loadVegetation, foliage } from './vegetation.js';

const standard = (color, extra={}) => new THREE.MeshStandardMaterial({color,roughness:.9,...extra});
const rockMat=standard('#7b7f70');
const sphereGeo=new THREE.SphereGeometry(1,16,12);
const rockGeo=new THREE.IcosahedronGeometry(1,2);


const WING_SHADER=`
uniform float flapAngle;
varying float vWingUnderside;
float wingAngle(vec3 p){return -sign(p.x)*smoothstep(0.06,0.21,abs(p.x))*flapAngle;}
vec3 turnWing(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);}
`;
function animateMorpho(model,root){
  const flap={value:0};root.userData.flap=flap;
  model.traverse(object=>{
    if(!object.isMesh)return;
    object.frustumCulled=false;object.material=object.material.clone();
    object.material.onBeforeCompile=shader=>{
      shader.uniforms.flapAngle=flap;
      shader.vertexShader=WING_SHADER+shader.vertexShader
        .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>\nobjectNormal=turnWing(objectNormal,wingAngle(position));`)
        .replace('#include <begin_vertex>',`#include <begin_vertex>\nvWingUnderside=smoothstep(0.08,0.22,abs(position.x))*smoothstep(0.15,0.75,-normal.z);\nfloat hinge=sign(position.x)*0.06;\nvec3 pivot=vec3(hinge,0.,0.);\ntransformed=pivot+turnWing(position-pivot,wingAngle(position));`);
      shader.fragmentShader='varying float vWingUnderside;\n'+shader.fragmentShader
        .replace('#include <map_fragment>',`#include <map_fragment>\nfloat wingTone=dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722));\nvec3 brownWing=vec3(0.23,0.103,0.038)*(0.43+2.3*wingTone);\ndiffuseColor.rgb=mix(diffuseColor.rgb,brownWing,vWingUnderside);`);
    };
  });
}

const plantMergedMat=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.8});

function mergePlant(root){
  root.updateMatrixWorld(true);const geometries=[];
  for(const m of [...root.children]){
    m.traverse(child=>{
      if(!child.isMesh||child.material.isMeshPhysicalMaterial)return;
      const g=child.geometry.clone();g.applyMatrix4(child.matrixWorld);const c=child.material.color,colors=[],shade=g.attributes.shade;
      // A blade carries its own root-to-tip shading; it is baked into the colour and dropped.
      for(let i=0;i<g.attributes.position.count;i++){const k=shade?shade.getX(i):1;colors.push(c.r*k,c.g*k,c.b*k);}
      if(shade)g.deleteAttribute('shade');
      g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometries.push(g);
    });
  }
  for(const m of [...root.children])if(!m.material?.isMeshPhysicalMaterial)root.remove(m);
  if(geometries.length){const merged=mergeGeometries(geometries);mesh(merged,plantMergedMat,root);for(const g of geometries)g.dispose();}
}

function mesh(geometry,material,parent,x=0,y=0,z=0,sx=1,sy=sx,sz=sx){
  const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function blade(height,width,bend){
  const pos=[],uv=[],shade=[],indices=[],droop=Math.min(1,Math.abs(bend)/.25);
  // A slender grass leaf: narrow at the root, widest a little above it, a long soft tip that
  // arches over under its own weight; shaded from the dim root to the sunlit tip.
  for(let i=0;i<=7;i++){
    const t=i/7,w=width*(.6+.4*Math.min(1,t*3))*Math.pow(1-t,.6),x=bend*t*t,y=height*(t-.16*droop*t*t*t);
    pos.push(x-w,y,0,x+w,y,0);uv.push(0,t,1,t);shade.push(.6+.55*t,.6+.55*t);if(i<7){let n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geo.setAttribute('shade',new THREE.Float32BufferAttribute(shade,1));geo.setIndex(indices);geo.computeVertexNormals();return geo;
}
function plant(seed){
  const root=new THREE.Group(),r=mulberry32(seed);
  // A tussock: tall thin leaves at the heart, a skirt of shorter ones leaning outwards.
  const mats=['#5d9436','#74a843','#8dba52','#538a33'].map(c=>standard(c,{side:THREE.DoubleSide}));
  for(let i=0;i<34;i++){
    const skirt=i>=14,spread=skirt?.3:.16;
    const m=mesh(blade(skirt?.14+r()*.2:.34+r()*.36,.005+r()*.008,(r()-.5)*(skirt?.5:.7)),mats[i%4],root,(r()-.5)*spread,0,(r()-.5)*spread);
    m.rotation.y=r()*Math.PI*2;m.rotation.z=(r()-.5)*(skirt?.7:.34);
  }
  // Glossy, see-through dew without transmission: a transmissive material makes the renderer
  // draw the whole scene once more whenever a grass plant is on screen.
  const dew=new THREE.MeshPhysicalMaterial({color:'#e5f2d4',roughness:.05,clearcoat:1,transparent:true,opacity:.55});
  mesh(sphereGeo,dew,root,.09,.47,.04,.026,.034,.026);
  mesh(sphereGeo,dew,root,-.06,.3,-.08,.014);
  mergePlant(root);root.userData.sway=.09;return root;
}
export function makeRock(seed=1,scale=1){
  const r=mulberry32(seed),geo=rockGeo.clone(),p=geo.attributes.position;
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);const n=1+.13*Math.sin(x*8+z*5)+.1*Math.cos(y*7+x*4);p.setXYZ(i,x*n,y*n,z*n);}geo.computeVertexNormals();
  const root=new THREE.Group();const m=mesh(geo,rockMat,root,0,.7*scale,0,1.45*scale,1*scale,1.1*scale);m.rotation.y=r()*6.28;return root;
}

// Grass is the one body drawn by code rather than loaded from a model file.

const UP=new THREE.Vector3(0,1,0);
// Bytes of model downloads so far, for the loading bar. Counted once per file.
export const loadProgress={loaded:0,total:0,files:new Map()};
let lastBytesAt=0;   // when any model download last received data
// A download fails only after loadTimeoutSec in which no model download anywhere received data:
// downloads share the connection and the browser queues requests, so a large or queued file on
// a slow connection keeps waiting while the network is busy.
function loadModel(loader,url){
  return new Promise((resolve,reject)=>{
    const limit=()=>(TUNING.loadTimeoutSec?.value??10)*1000,started=performance.now();
    let timer,settled=false;
    const finish=f=>v=>{if(settled)return;settled=true;clearTimeout(timer);f(v);};
    const ok=finish(resolve),fail=finish(reject);
    const check=()=>{const idle=performance.now()-Math.max(started,lastBytesAt);if(idle>=limit())fail(new Error('timeout'));else timer=setTimeout(check,limit()-idle);};
    timer=setTimeout(check,limit());
    // Downloaded and read in two steps, so that a file which arrived but cannot be read is told
    // apart from a download that failed: only the download is worth trying again.
    new THREE.FileLoader(loader.manager).setResponseType('arraybuffer').load(url,data=>{
      if(settled)return;
      const unreadable=e=>fail(new UnreadableModel(e?.message||'unreadable'));
      try{loader.parse(data,THREE.LoaderUtils.extractUrlBase(url),ok,unreadable);}catch(e){unreadable(e);}
    },e=>{
      if(settled)return;
      const file=loadProgress.files.get(url)||{loaded:0,total:0};loadProgress.files.set(url,file);
      if(e.lengthComputable&&!file.total){file.total=e.total;loadProgress.total+=e.total;}
      if(e.loaded>file.loaded){loadProgress.loaded+=e.loaded-file.loaded;file.loaded=e.loaded;}
      lastBytesAt=performance.now();
    },fail);
  });
}
const LOAD_ATTEMPTS=3;
class UnreadableModel extends Error {}
// The models are meshopt-compressed and need WebAssembly to be read. Without it (Lockdown Mode,
// Safari without JIT, a page whose CSP forbids WebAssembly) the game cannot start, and says why.
export class ModelsUnsupported extends Error {}

// Loads every model the manifest names. Nothing stands in for a model that fails: a failed
// download is tried again, and if it still fails (or the file cannot be read) prepare() rejects
// and the game does not start.
export class AssetLibrary {
  constructor(){this.loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);this.manifest=null;this.templates=new Map();this.decorTemplates=new Map();this.mixers=[];this.loading=new Map();}
  async prepare(){
    if(!MeshoptDecoder.supported)throw new ModelsUnsupported('WebAssembly unavailable');
    try{await MeshoptDecoder.ready;}catch(e){throw new ModelsUnsupported(`meshopt decoder: ${e?.message||e}`);}
    const r=await fetch('./public/models/manifest.json');if(!r.ok)throw Error(`Manifest ${r.status}`);
    this.manifest=await r.json();
    const jobs=[];
    for(const [kind,entry] of Object.entries(this.manifest.species))if(entry.url)jobs.push(this.loadSlot(entry).then(t=>this.templates.set(kind,t)));
    for(const slot of this.manifest.decor)if(slot.url)jobs.push(this.loadSlot(slot).then(t=>this.decorTemplates.set(slot.slotId,t)));
    // Rainforest models for the scenery forest and floor (env.forest, env.understory).
    const vegetationUrl=this.manifest.decor.map(s=>s.scatter?.vegetation).find(Boolean);
    jobs.push(loadVegetation(vegetationUrl,url=>this.load(url)).then(v=>{this.vegetation=v;}));
    await Promise.all(jobs);
    // Tree bodies wear the same files as the scenery: give them the same leaf light and sway.
    for(const t of this.templates.values()){
      const shape=this.vegetation.files[t.entry.url.split('/').pop()];
      if(shape)t.gltf.scene.traverse(o=>{if(o.isMesh)foliage(o.material,shape);});
    }
  }
  // A file named twice (a tree that is both a species and scenery) is loaded once; callers clone
  // what they change, and foliage() leaves a material it has already prepared as it is.
  load(url){
    if(!this.loading.has(url))this.loading.set(url,this.download(url));
    return this.loading.get(url);
  }
  async download(url){
    for(let attempt=1;;attempt++){
      try{return await loadModel(this.loader,url);}
      catch(e){if(e instanceof UnreadableModel||attempt>=LOAD_ATTEMPTS)throw new Error(`${url}: ${e?.message||'load failed'}`);}
    }
  }
  async loadSlot(entry){
    const [gltf,idle,run,swim]=await Promise.all([entry.url,entry.idleUrl,entry.runUrl,entry.swimUrl].map(url=>url?this.load(url):null));
    return {gltf,idle,run,swim,entry};
  }
  fit(model,entry,height){
    if(entry.rotation)model.rotation.fromArray(entry.rotation);
    model.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
    const factor=(entry.height||height)/Math.max(size.y,.0001);
    // Bodies stand on their base; a file whose origin already marks the base (a trunk that is
    // not the middle of its crown) keeps it.
    model.scale.multiplyScalar(factor);
    if(entry.pivot==='file_origin')model.position.set(0,0,0);
    else model.position.set(-center.x*factor,-bounds.min.y*factor,-center.z*factor);
  }
  make(kind,seed){
    const template=this.templates.get(kind);
    if(!template)return plant(seed);
    const entry=template.entry,root=new THREE.Group(),model=clone(template.gltf.scene);
    if(entry.proceduralAnimation==='morpho_wings')animateMorpho(model,root);
    this.fit(model,entry,SPECIES[kind].height);
    if(entry.lod?.length){
      // Levels inside the file: `lod0` near, then the named nodes; all share the file's fit.
      const lod=new THREE.LOD(),near=model.getObjectByName('lod0');
      near.parent.add(lod);lod.addLevel(near,0);
      for(const level of entry.lod){const far=model.getObjectByName(level.node);if(far)lod.addLevel(far,level.distance,.1);}
    }
    root.add(model);
    let idleModel=null;
    if(template.idle){idleModel=clone(template.idle.scene);this.fit(idleModel,entry,SPECIES[kind].height);root.add(idleModel);model.visible=false;}
    root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    if(template.gltf.animations.length){
      const mixer=new THREE.AnimationMixer(model),actions={};
      for(const [role,name] of Object.entries(entry.animations||{})){const clips=role==='run'&&template.run?template.run.animations:role==='swim'&&template.swim?template.swim.animations:template.gltf.animations;let clip=THREE.AnimationClip.findByName(clips,name);
        if(clip&&template.idle&&(role==='move'||role==='run'||role==='swim')){clip=clip.clone();for(const track of clip.tracks){if(!/Hips\.position$/i.test(track.name))continue;for(let i=3;i<track.values.length;i+=3){track.values[i]=track.values[0];track.values[i+2]=track.values[2];}}}
        if(clip)actions[role]=mixer.clipAction(clip);}
      if(!actions.idle)actions.idle=mixer.clipAction(template.gltf.animations[0]);
      actions.idle.play();
      if(actions.idle===actions.move)actions.idle.paused=true;
      root.userData.animation={mixer,actions,current:'idle',model,idleModel};this.mixers.push(root);
    }
    root.updateMatrixWorld(true);root.userData.localBounds=new THREE.Box3().setFromObject(model);
    root.userData.collisionBoxes=entry.collisionBoxes;root.userData.external=true;return root;
  }
  hasDecor(slotId){return this.decorTemplates.has(slotId);}
  // Scattered decoration from a model: one instanced draw per mesh.
  // placements: [{position:[x,y,z], rotationY, scale}] in the carrier's frame.
  makeDecor(slot,placements){
    const template=this.decorTemplates.get(slot.slotId),group=new THREE.Group();
    const m=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),scale=new THREE.Vector3();
    const model=template.gltf.scene.clone();this.fit(model,template.entry,slot.height);model.updateMatrixWorld(true);
    model.traverse(o=>{
      if(!o.isMesh)return;const instanced=new THREE.InstancedMesh(o.geometry,o.material,placements.length);
      placements.forEach((p,i)=>{m.compose(v.fromArray(p.position),q.setFromAxisAngle(UP,p.rotationY),scale.setScalar(p.scale));m.multiply(o.matrixWorld);instanced.setMatrixAt(i,m);});
      instanced.computeBoundingSphere();instanced.castShadow=true;instanced.receiveShadow=true;group.add(instanced);
    });
    return group;
  }
  update(dt){
    for(const root of this.mixers){const a=root.userData.animation,desired=root.userData.swimming&&a.actions.swim?'swim':root.userData.moving&&a.actions.move?(root.userData.boosting&&a.actions.run?'run':'move'):'idle';
      if(a.idleModel){a.idleModel.visible=desired==='idle';a.model.visible=desired!=='idle';}
      if(a.current!==desired){
        const previous=a.actions[a.current],next=a.actions[desired];
        if(previous!==next){previous?.fadeOut(.3);next.reset().fadeIn(.3).play();}
        if(next===a.actions.move&&next===a.actions.idle){next.paused=desired==='idle';if(next.paused)next.time=0;}
        next.setEffectiveTimeScale(desired==='run'&&next===a.actions.move?1.5:1);a.current=desired;
      }
      if(a.idleModel&&desired!=='idle')a.actions[desired].setEffectiveTimeScale(desired==='swim'&&!root.userData.moving?1:Math.max(.05,Math.min(1,root.userData.movementRatio??1)));
      a.mixer.update(dt);
    }
  }
}
