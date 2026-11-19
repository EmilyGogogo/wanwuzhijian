import * as THREE from 'three';
import { loadTexture } from './textures.js';

// Rainforest vegetation from Aholo Lux3D text-to-3D models, rebuilt for the game:
// each model has a near mesh level lod0 (tree bodies also
// a far lod1) sharing one material, and trees a far impostor, a camera-facing card that shows the model from
// the nearest of 16 headings × 3 elevations, lit with the normals baked beside it.

function texture(url,color){const t=loadTexture(url);t.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;t.anisotropy=4;return t;}

// Cross-fade between a tree's mesh and its stand-in (LodField): each instance's `instFade` hides a
// share of its pixels in a fixed screen pattern; a positive value hides that share, a negative one
// keeps only that share, so mesh and stand-in at the same value fill each pixel exactly once.
const FADE_VERTEX=`#ifdef USE_INSTANCING
attribute float instFade;varying float vFade;
#endif
`,FADE_FRAGMENT=`#ifdef USE_INSTANCING
varying float vFade;
#endif
`,FADE_DISCARD=`#ifdef USE_INSTANCING
{float fd=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
if(vFade>0.?fd<vFade:vFade<0.&&fd>=-vFade)discard;}
#endif
`,FADE_PASS=`#ifdef USE_INSTANCING
vFade=instFade;
#endif
`;
// How strongly the leaves of a stand-in lean toward a rounded crown (see impostorMaterial).
export const IMP_ROUND=1.2;
export function impostorMaterial(imp,base){
  const mat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.85,metalness:0});
  const uniforms={impColor:{value:texture(base+imp.color,true)},impNormal:{value:texture(base+imp.normal,false)},
    impCenter:{value:new THREE.Vector3(...imp.center)},impHalf:{value:imp.half},impHeadings:{value:imp.headings},
    impElev:{value:imp.elevations.map(e=>e*Math.PI/180)},impLit:{value:imp.gain??1},impConst:{value:imp.ambient??.22*(imp.gain??1)},impRound:{value:IMP_ROUND}};
  mat.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=FADE_VERTEX+`uniform vec3 impCenter;uniform float impHalf;uniform float impHeadings;uniform float impElev[3];
varying vec2 vImpUv;varying vec3 vImpR;varying vec3 vImpU;varying vec3 vImpF;varying vec2 vCard;varying vec3 vCardR;varying vec3 vCardU;varying vec3 vCardE;
`+shader.vertexShader.replace('#include <project_vertex>',`
mat3 inst=mat3(instanceMatrix);float sc=length(inst[0]),sy=length(inst[1]);
vec3 cW=(modelMatrix*instanceMatrix*vec4(impCenter,1.)).xyz;
vec3 X=normalize(mat3(modelMatrix)*inst[0]),Y=normalize(mat3(modelMatrix)*inst[1]),Z=normalize(mat3(modelMatrix)*inst[2]);
vec3 toEye=normalize(cameraPosition-cW),lv=vec3(dot(toEye,X),dot(toEye,Y),dot(toEye,Z));
// The baked view nearest to this one.
float hStep=6.2831853/impHeadings,col=mod(floor(atan(lv.x,lv.z)/hStep+.5)+impHeadings,impHeadings);
float el=asin(clamp(lv.y,-1.,1.)),row=el<(impElev[0]+impElev[1])*.5?0.:el<(impElev[1]+impElev[2])*.5?1.:2.;
float az=col*hStep,elq=impElev[int(row)];
vec3 fv=vec3(sin(az)*cos(elq),sin(elq),cos(az)*cos(elq)),fr=normalize(cross(-fv,vec3(0.,1.,0.))),fu=cross(fr,-fv);
vImpR=fr.x*X+fr.y*Y+fr.z*Z;vImpU=fu.x*X+fu.y*Y+fu.z*Z;vImpF=fv.x*X+fv.y*Y+fv.z*Z;
// The card faces the eye, upright along the tree's own axis.
vec3 right=normalize(cross(-toEye,Y)),up=cross(right,-toEye);
vec3 wp=cW+(right*position.x+up*position.y*(sy/sc))*impHalf*sc;
vCard=position.xy;vCardR=right;vCardU=up;vCardE=toEye;
vImpUv=vec2((col+position.x*.5+.5)/impHeadings,(2.-row+position.y*.5+.5)/3.);
`+FADE_PASS+`
vec4 mvPosition=viewMatrix*vec4(wp,1.);gl_Position=projectionMatrix*mvPosition;`).replace('#include <worldpos_vertex>','vec4 worldPosition=vec4(wp,1.);');
    shader.fragmentShader=FADE_FRAGMENT+`uniform sampler2D impColor;uniform sampler2D impNormal;uniform float impLit;uniform float impConst;uniform float impRound;varying vec2 vImpUv;varying vec3 vImpR;varying vec3 vImpU;varying vec3 vImpF;varying vec2 vCard;varying vec3 vCardR;varying vec3 vCardU;varying vec3 vCardE;
`+shader.fragmentShader.replace('#include <map_fragment>',FADE_DISCARD+`vec4 impC=texture2D(impColor,vImpUv);if(impC.a<.3)discard;
diffuseColor.rgb*=impC.rgb;
// Leaves (green or blossom, not grey or brown wood) let the sun through like the mesh's leaves.
float impLeaf=smoothstep(.03,.1,max(impC.g,impC.b)-impC.r);`)
      .replace('#include <normal_fragment_begin>',`vec3 impN=texture2D(impNormal,vImpUv).xyz*2.-1.;
// Leaf normals are noisy at this size; lean them toward the crown's overall shape. The mesh's
// leaves lean outward from the crown, so it is lit as one rounded volume, bright on the sun side
// and dark on the other: leaves of the card lean toward a ball behind it, wood toward the eye.
vec2 cq=vCard*1.15;vec3 ball=normalize(vCardR*cq.x+vCardU*cq.y+vCardE*sqrt(max(1.-dot(cq,cq),.05)));
vec3 nW=normalize(normalize(vImpR*impN.x+vImpU*impN.y+vImpF*impN.z)+mix(vImpF*.35,ball*impRound,impLeaf));
vec3 normal=normalize((viewMatrix*vec4(nW,0.)).xyz);vec3 nonPerturbedNormal=normal;`)
      .replace('#include <normal_fragment_maps>','')
      .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
// The same sun through the leaves as foliage() gives the mesh, so the stand-in follows the mesh
// through the day instead of only matching it at one sun angle.
#if NUM_DIR_LIGHTS > 0
for(int i=0;i<NUM_DIR_LIGHTS;i++){
  float through=max(dot(-geometryNormal,directionalLights[i].direction),0.);
  float toSun=pow(max(dot(-geometryViewDir,directionalLights[i].direction),0.),3.);
  reflectedLight.directDiffuse+=directionalLights[i].color*diffuseColor.rgb*RECIPROCAL_PI*impLeaf*through*(.4+.6*toSun);
}
#endif
// impLit and impConst (vegetation.json impostor gain and ambient, measured per tree in the game)
// match the stand-in to the mesh it replaces through the day: how strongly it follows the light,
// and how much light its leaves keep whatever the sun does.
reflectedLight.directDiffuse*=impLit;reflectedLight.indirectDiffuse=reflectedLight.indirectDiffuse*impLit+diffuseColor.rgb*impConst;`);
  };
  mat.customProgramCacheKey=()=>'impostor-v8';
  return mat;
}
const cardGeometry=new THREE.PlaneGeometry(2,2);

// Wind time for every plant material, in seconds (World.update advances it).
export const WIND={value:0};
// The tiling bark detail (vegetation.json `barkDetail`), shared by every tree with a `bark` entry.
let BARK=null;
// Plant material. Leaves are thin: both sides are drawn, the shaded side keeps some sky light,
// and sun behind a crown shines through it, brightest when looking toward the sun. The whole
// plant leans a little with slow gusts and its crown flutters; `m` is the model's entry
// in vegetation.json: height, crownBase (where the crown starts) and sway, in model metres.
// A material named `leaves` is a sheet of single leaves: cut out by the alpha of its
// texture, and its normals, which lean toward the outside of the crown, are not flipped on back
// faces, so a crown is lit as one volume. The wood of a tree with a `bark` entry gets the bark
// detail: the generated texture has a texel per 8–10 cm of trunk, so a tiling bark
// texture, projected from three sides, multiplies its colour and bumps its surface; green parts
// (moss, epiphytes) are left as they are.
export function foliage(material,m){
  if(material.userData.foliage)return material;
  material.userData.foliage=true;material.side=THREE.DoubleSide;
  const cut=material.name==='leaves';
  if(cut){
    Object.assign(material,{transparent:false,depthWrite:true,alphaTest:.42,roughness:.72,metalness:0});
    material.defines={...material.defines,LEAF_CUTOUT:''};
    if(material.map)material.map.anisotropy=8;
  }
  const uniforms={windTime:WIND,swayHeight:{value:m.height},swayCrown:{value:m.crownBase??0},swayAmount:{value:m.sway??1}};
  const bark=!cut&&m.bark&&BARK;
  if(bark){
    material.defines={...material.defines,BARK_DETAIL:''};
    Object.assign(uniforms,{barkMap:{value:BARK},barkTile:{value:m.bark.tileM},barkDepth:{value:m.bark.depthM},barkStrength:{value:m.bark.strength??.6}});
  }
  const BARK_PARS=`#ifdef BARK_DETAIL
varying vec3 vBarkP;varying vec3 vBarkN;varying float vBarkS;
#endif
`;
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=FADE_VERTEX+BARK_PARS+`uniform float windTime;uniform float swayHeight;uniform float swayCrown;uniform float swayAmount;varying float vCrown;
`+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
`+FADE_PASS+`#ifdef BARK_DETAIL
// The bark sticks to the tree: projected in the model's own frame; vBarkS is its size in the world.
vBarkP=position;vBarkN=normal;vBarkS=length(modelMatrix[0].xyz);
#ifdef USE_INSTANCING
vBarkS*=length(instanceMatrix[0].xyz);
#endif
#endif
// Each individual sways on its own beat; a body one can become keeps a steady beat as it moves.
#ifdef USE_INSTANCING
float swPhase=dot(instanceMatrix[3].xz,vec2(.37,.71));
#else
float swPhase=0.;
#endif
float swH=clamp(position.y/swayHeight,0.,1.);
vCrown=smoothstep(swayCrown*.7,swayCrown*1.2+swayHeight*.03,position.y);
float gust=sin(windTime*.8+swPhase)*.65+sin(windTime*2.1+swPhase*1.7)*.35;
transformed.xz+=vec2(.8,.6)*gust*swH*swH*swayHeight*.01*swayAmount;
float fl=windTime*2.4+swPhase+dot(position,vec3(2.1,1.7,2.6))*(14./swayHeight);
transformed+=vec3(sin(fl),sin(fl*1.3+1.7)*.5,cos(fl*.9))*vCrown*swayHeight*.003*swayAmount;`);
    shader.fragmentShader=FADE_FRAGMENT+BARK_PARS+`#ifdef BARK_DETAIL
uniform sampler2D barkMap;uniform float barkTile;uniform float barkDepth;uniform float barkStrength;
float barkH=.5;float barkWood=0.;
#endif
varying float vCrown;
`+shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\n'+FADE_DISCARD).replace('#include <map_fragment>',`#include <map_fragment>
#ifdef BARK_DETAIL
{vec3 bw=pow(abs(normalize(vBarkN)),vec3(4.));bw/=bw.x+bw.y+bw.z;vec3 bp=vBarkP/barkTile;
// The grain runs up the trunk: the two side projections keep the model's up as the texture's.
barkH=texture2D(barkMap,bp.zy).r*bw.x+texture2D(barkMap,bp.xz).r*bw.y+texture2D(barkMap,bp.xy).r*bw.z;
barkWood=1.-smoothstep(1.1,1.35,diffuseColor.g/max(max(diffuseColor.r,diffuseColor.b),.001));
diffuseColor.rgb*=mix(1.,barkH*2.,barkStrength*barkWood);}
#endif`).replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
#if defined( LEAF_CUTOUT ) && defined( DOUBLE_SIDED )
normal*=faceDirection;nonPerturbedNormal=normal;
#endif
#ifdef BARK_DETAIL
// Bumps from the bark's height, in world metres, so they look the same near and far.
{vec3 sx=dFdx(-vViewPosition),sy=dFdy(-vViewPosition);vec2 dh=vec2(dFdx(barkH),dFdy(barkH))*barkDepth*vBarkS*barkWood;
vec3 r1=cross(sy,normal),r2=cross(normal,sx);float det=dot(sx,r1);
normal=normalize(abs(det)*normal-sign(det)*(dh.x*r1+dh.y*r2));}
#endif`).replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
reflectedLight.indirectDiffuse+=diffuseColor.rgb*.18*(1.-max(dot(normal,vec3(0.,0.,1.)),0.));
// Single leaves are thin: light scattered inside the crown fills them, and more sun comes through.
#ifdef LEAF_CUTOUT
reflectedLight.indirectDiffuse+=diffuseColor.rgb*.2;
#define LEAF_THROUGH vec2(.4,.6)
#else
#define LEAF_THROUGH vec2(.22,.5)
#endif
#if NUM_DIR_LIGHTS > 0
for(int i=0;i<NUM_DIR_LIGHTS;i++){
  float through=max(dot(-geometryNormal,directionalLights[i].direction),0.);
  float toSun=pow(max(dot(-geometryViewDir,directionalLights[i].direction),0.),3.);
  reflectedLight.directDiffuse+=directionalLights[i].color*diffuseColor.rgb*RECIPROCAL_PI*vCrown*through*(LEAF_THROUGH.x+LEAF_THROUGH.y*toSun);
}
#endif`);
  };
  material.customProgramCacheKey=()=>'aholo-foliage-v6'+(cut?'-cut':'')+(bark?'-bark':'');
  return material;
}

// `load` is AssetLibrary.load: the same stall timeout as every other model.
export async function loadVegetation(url,load){
  const base=url.slice(0,url.lastIndexOf('/')+1),r=await fetch(url);if(!r.ok)throw Error(`${url} ${r.status}`);
  // `files`: every model's shape by file name, for the bodies that wear the same files.
  const meta=await r.json(),out={models:{},files:{}};
  if(meta.barkDetail){BARK=texture(base+meta.barkDetail.texture,false);BARK.wrapS=BARK.wrapT=THREE.RepeatWrapping;BARK.anisotropy=8;}
  await Promise.all(Object.entries(meta.models||{}).map(async([name,m])=>{
    out.files[m.model]=m;
    if(m.scenery===false)return;          // only a body wears it; its asset slot loads the file
    const gltf=await load(base+m.model),levels=[];
    gltf.scene.updateMatrixWorld(true);
    // A level is its mesh `lodN` plus, for trees with leaf sprigs, the leaves `lodN_leaves`.
    gltf.scene.traverse(o=>{const k=o.isMesh&&/^lod(\d+)(_leaves)?$/.exec(o.name);if(k)(levels[+k[1]]||=[]).push({geometry:o.geometry.clone().applyMatrix4(o.matrixWorld),material:foliage(o.material,m)});});
    out.models[name]={...m,name,levels:levels.filter(Boolean),impostor:m.impostor?{geometry:cardGeometry,material:impostorMaterial(m.impostor,base)}:null};
  }));
  return out;
}

// Scenery of one model drawn by distance from the eye: every individual is in exactly one level
// at a time — a mesh level while nearer than that level's range, the impostor beyond the last one
// (or nothing for models without one, up to `farM`) — so trees never vanish between levels.
// Plants have one mesh level: nothing changes shape while walking among them; only far
// away does a tree become its impostor, and not at once: over the last FADE_BAND share past the
// range its mesh dissolves pixel by pixel while the impostor fills in the same pixels (a plant
// without an impostor just dissolves), so a hand-over never pops. Inner ranges (the shadow lot)
// keep a 10% margin so they do not flip back and forth. Each individual's ranges are stretched a little by its own
// jitter, so no ring of hand-overs shows. With `shadowM` the first level is drawn in two lots of
// the same mesh: casting shadows near the eye, where the sun's shadow map reaches, and not
// beyond. The instance buffers are refilled whenever the eye has moved a few metres.
const FADE_BAND=.12;
// The same geometry with a per-instance fade of its own (the buffers are shared, not copied).
function fadeGeometry(g,n){
  const f=new THREE.BufferGeometry();f.setIndex(g.index);for(const k in g.attributes)f.setAttribute(k,g.attributes[k]);
  for(const gr of g.groups)f.addGroup(gr.start,gr.count,gr.materialIndex);
  if(!g.boundingSphere)g.computeBoundingSphere();f.boundingSphere=g.boundingSphere;f.boundingBox=g.boundingBox;
  f.setAttribute('instFade',new THREE.InstancedBufferAttribute(new Float32Array(n),1));return f;
}
export class LodField extends THREE.Group {
  constructor(model,items,{ranges,farM=Infinity,shadowLevels=2,shadowM=0}){
    super();this.items=items;this.farM=farM;this.last=new THREE.Vector3(1e9,0,0);this.lastNear=null;
    const split=shadowM>0&&shadowM<ranges[0],meshes=model.levels.slice(0,ranges.length);
    this.ranges=split?[shadowM,...ranges]:ranges;
    // A level is one part ({geometry, material}) or several drawn together.
    const instanced=(level,shadow)=>[level].flat().map(part=>{const n=Math.max(1,items.length),im=new THREE.InstancedMesh(fadeGeometry(part.geometry,n),part.material,n);
      im.castShadow=shadow;im.receiveShadow=true;im.count=0;this.add(im);return im;});
    this.levels=(split?[meshes[0],...meshes]:meshes).map((level,i)=>instanced(level,split?i===0:i<shadowLevels));
    this.impostor=model.impostor?instanced(model.impostor,false):null;
    for(const im of this.impostor||[])im.frustumCulled=false;
    for(const it of items)it.jitter??=1+(Math.abs(Math.sin(it.x*12.9898+it.z*78.233)*43758.5453)%1-.5)*.16;
    // Until the eye is known each draw holds one individual, so loading compiles its shaders.
    if(items.length)for(const im of [...this.levels,this.impostor].flat().filter(Boolean)){im.setMatrixAt(0,items[0].matrix);im.setColorAt(0,items[0].tint);im.count=1;}
  }
  // eye: in the carrier's frame, or null to show only impostors (large scales).
  update(eye,force=false){
    const near=!!eye;
    if(!force&&near===this.lastNear&&(!near||eye.distanceToSquared(this.last)<9))return;
    if(near)this.last.copy(eye);this.lastNear=near;
    const counts=new Array(this.levels.length).fill(0);let far=0;const L=this.ranges.length;
    const put=(draws,n,it,fade)=>{for(const im of draws){im.setMatrixAt(n,it.matrix);im.setColorAt(n,it.tint);im.geometry.attributes.instFade.array[n]=fade;}};
    for(const it of this.items){
      // fade: 0 drawn whole; in the band past the last range, the share of the mesh dissolved.
      let level=L,fade=0;
      if(near){
        const d=Math.hypot(it.x-eye.x,it.z-eye.z,(it.y??eye.y)-eye.y)/it.jitter,R=this.ranges[L-1];
        if(d<R){level=L-1;while(level>0&&d<this.ranges[level-1]*(it.level<level?1.1:1))level--;}
        else if(d<R*(1+FADE_BAND)){level=L-1;fade=Math.max((d-R)/(R*FADE_BAND),.001);}
        it.level=level;if(level===L&&d>this.farM){it.fade=0;continue;}
      }
      it.fade=fade;
      if(level<L)put(this.levels[level],counts[level]++,it,fade);
      if(this.impostor&&(level===L||fade>0))put(this.impostor,far++,it,-fade);
    }
    const commit=(im,n,bounds)=>{im.count=n;im.instanceMatrix.needsUpdate=true;if(im.instanceColor)im.instanceColor.needsUpdate=true;im.geometry.attributes.instFade.needsUpdate=true;if(bounds)im.computeBoundingSphere();};
    this.levels.forEach((draws,i)=>{for(const im of draws)commit(im,counts[i],true);});
    for(const im of this.impostor||[])commit(im,far,false);
  }
}
