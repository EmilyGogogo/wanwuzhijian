import * as THREE from 'three';
import { mulberry32 } from './species.js';

// The rainforest along both banks of the river: scenery, not bodies. A canopy surface is
// shaded as packed tree crowns (cellular noise), its river face as a wall of trunks and
// lianas, and emergent trees break the skyline. Built on the standard material so the sun,
// the moon and the fog light it like everything else.

export function canopyMaterial(extra={},bankFloor=false){
  const mat=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.92,metalness:0,...extra});
  mat.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 vCanopy;varying vec3 vCanopyN;\n'+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
vCanopy=(modelMatrix*vec4(position,1.)).xyz;vCanopyN=normalize(mat3(modelMatrix)*normal);`);
    shader.fragmentShader=`varying vec3 vCanopy;varying vec3 vCanopyN;
float cHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
// Distance to the nearest crown centre (cellular noise) and that crown's id.
vec3 crowns(vec2 p){vec2 i=floor(p),f=fract(p);float best=8.;vec2 id=vec2(0.);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(x,y),o=vec2(cHash(i+g),cHash(i+g+19.7));float d=length(g+o-f);if(d<best){best=d;id=i+g;}}
  return vec3(best,id);}
`+shader.fragmentShader.replace('#include <map_fragment>',`
vec3 cr=crowns(vCanopy.xz/13.);vec3 cr2=crowns(vCanopy.xz/4.3+7.);
float hue=cHash(cr.yz);
vec3 green=mix(vec3(.13,.24,.08),vec3(.27,.38,.12),cHash(cr.yz+3.1));
green=mix(green,vec3(.42,.43,.16),step(.93,hue)*.8);          // yellowing crowns
green=mix(green,vec3(.58,.36,.52),step(.985,hue));            // a flowering tree
green=mix(green,vec3(.66,.58,.2),step(.975,hue)*(1.-step(.985,hue)));
float dome=1.-cr.x*cr.x;float leaf=.75+.25*(1.-cr2.x);
float face=1.-smoothstep(.35,.75,vCanopyN.y);                  // steep river face: trunks, lianas
float trunks=smoothstep(.7,.95,cHash(vec2(floor(vCanopy.x*.9+vCanopy.z*.9),3.)));
vec3 wall=mix(vec3(.09,.13,.06),vec3(.25,.22,.17),trunks*.7);
vec3 col=mix(green*(.45+.65*dome)*leaf,wall,face);
#ifdef USE_INSTANCING_COLOR
col=mix(col,col*vColor.rgb*2.2,.6);
#endif
diffuseColor.rgb*=col;`).replace('#include <normal_fragment_maps>',`
vec2 cg=vec2(dFdx(cr.x),dFdy(cr.x));
normal=normalize(normal+vec3(cg.x,0.,cg.y)*-14.*(1.-face));`);
    if(bankFloor){
      shader.vertexShader='attribute float bankFloor;varying float vBankFloor;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBankFloor=bankFloor;');
      shader.fragmentShader='varying float vBankFloor;\n'+shader.fragmentShader.replace('diffuseColor.rgb*=col;','diffuseColor.rgb*=mix(col,vec3(.94),vBankFloor);').replace('*(1.-face));','*(1.-face)*(1.-vBankFloor));');
    }
  };
  mat.customProgramCacheKey=()=>bankFloor?'canopy-bank-floor-v2':'canopy-v1';
  return mat;
}

// Where the bank meets the water at `x` on one side (side -1: z < 0, 1: z > 0), in metres from
// the river's centre line; also read by the minimap.
export function bankShore(halfWidth,x,side){
  const noise=(x,z)=>Math.sin(x*.011+z*.007)*.5+Math.sin(x*.023-z*.019+1.3)*.3+Math.sin(x*.061+z*.05)*.2;
  return halfWidth+45*noise(x*.6,side*90)+18*noise(x*2.1,side*40);
}

function reachAt(x,side,reaches){
  let reach=null,weight=0;
  for(const r of reaches){const w=r.side===side?1-THREE.MathUtils.smoothstep(Math.abs(x-r.x),r.radiusM*.2,r.radiusM*.65):0;if(w>weight){reach=r;weight=w;}}
  return {reach,weight};
}

// Banks run along the river on both sides. `place(x,z,h)` maps flat river coordinates and a
// height to the curved frame the river surface lives in. A muddy bank and forest floor
// lead to a tree line of impostors, denser at the river face, with the canopy surface set back
// as the mass of forest behind. Trees come in segments along the river, culled by distance.
export function createBanks({halfWidth,length,step=18,seed=31,reaches=[]},place,veg){
  const group=new THREE.Group(),r=mulberry32(seed);
  const noise=(x,z)=>Math.sin(x*.011+z*.007)*.5+Math.sin(x*.023-z*.019+1.3)*.3+Math.sin(x*.061+z*.05)*.2;
  const shoreOf=(x,side)=>bankShore(halfWidth,x,side);
  // Bank trees: the tall Aholo trees (strangler figs and kapok giants), as impostors.
  const trees=Object.values(veg.models).filter(t=>t.impostor&&['strangler_fig','kapok'].includes(t.name)),setBack=70;
  group.userData.segments=[];
  for(const side of [-1,1]){
    // Rows grow wider inland; the forest reaches the horizon.
    const rows=[];for(let d=0;d<=2600;d+=step*(1+Math.max(0,d-300)/250))rows.push(d);
    const nx=Math.round(length/step)+1,nz=rows.length,pos=new Float32Array(nx*nz*3),col=new Float32Array(nx*nz*3),floors=new Float32Array(nx*nz);
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
      const x=-length/2+i*step,inward=rows[j];
      // The shore line itself wanders; a muddy bank rises, then the forest wall.
      const z=side*(shoreOf(x,side)+inward);
      const bank=-3+7*Math.min(1,inward/18);
      const mood=reachAt(x,side,reaches),opening=mood.weight*(mood.reach?.kind==='mist_forest'?.3:1),setback=setBack+opening*135;
      const canopy=26+9*noise(x,z)+6*noise(x*3.3,z*2.7)-6;
      const h=inward<14+setback?bank:THREE.MathUtils.lerp(bank,canopy,Math.min(1,(inward-14-setback)/16));
      const p=place(x,z,h);pos.set([p.x,p.y,p.z],(j*nx+i)*3);
      // Forest floor under the trees: wet mud at the water, leaf litter inland.
      const floor=inward<14+setback;
      floors[j*nx+i]=floor?1:0;
      const pale=opening*(1-THREE.MathUtils.smoothstep(inward,90,200));
      col.set(floor?[THREE.MathUtils.lerp(.27,.66,pale),THREE.MathUtils.lerp(.24,.61,pale),THREE.MathUtils.lerp(.17,.44,pale)]:[1,1,1],(j*nx+i)*3);
    }
    const idx=[];for(let j=0;j<nz-1;j++)for(let i=0;i<nx-1;i++){const a=j*nx+i,b=a+1,c=a+nx,d=c+1;if(side>0)idx.push(a,c,b,b,c,d);else idx.push(a,b,c,b,d,c);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setIndex(idx);geo.computeVertexNormals();
    geo.setAttribute('color',new THREE.BufferAttribute(col,3));geo.setAttribute('bankFloor',new THREE.BufferAttribute(floors,1));
    const mesh=new THREE.Mesh(geo,canopyMaterial({vertexColors:true},true));mesh.receiveShadow=false;group.add(mesh);
    addTreeLine(group,side,{length,shoreOf,place,trees,r,reaches});
  }
  return group;
}
// Tree impostors along one bank: a dense line at the river face, thinning inland where the
// canopy surface takes over; heights from young trees to emergents.
function addTreeLine(group,side,{length,shoreOf,place,trees,r,reaches},segment=300){
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new THREE.Vector3(),UP=new THREE.Vector3(0,1,0),tint=new THREE.Color();
  for(let x0=-length/2;x0<length/2;x0+=segment){
    const lists=trees.map(()=>[]);
    // [from, to, trees per 100 m of river, height range]: the river face, the forest behind it
    // (its crowns above the canopy surface), and scattered emergents far inland.
    const bands=[[14,60,90,[10,34]],[60,160,140,[22,40]],[160,700,90,[30,44]],[30,1600,7,[44,58]]];
    for(const [a,b,per,[h0,h1]] of bands)for(let k=0;k<per*segment/100;k++){
      const x=x0+r()*segment,inward=a+(b-a)*r()**1.3,z=side*(shoreOf(x,side)+inward);
      const mood=reachAt(x,side,reaches),opening=mood.weight*(mood.reach?.kind==='mist_forest'?.3:1);
      if(inward<170&&r()<opening*.96)continue;
      // Stands and gaps along the bank.
      if(Math.sin(x*.013+side)*.5+Math.sin(x*.041+inward*.03)*.5<-.55)continue;
      const tall=inward<20?r()*.7:r(),height=h0+(h1-h0)*tall**1.4,t=Math.floor(r()*trees.length),tree=trees[t];
      const sy=height/tree.height,sxz=sy*(.6+r()*.25);
      const p=place(x,z,-3.3+7*Math.min(1,inward/18));
      lists[t].push({matrix:m.compose(p,q.setFromAxisAngle(UP,r()*6.28),s.set(sxz,sy,sxz)).clone(),tint:tint.setRGB(.86+.1*r(),1,.82+.1*r()).multiplyScalar(.74+.3*r()).clone()});
    }
    const holder=new THREE.Group();
    lists.forEach((list,t)=>{if(!list.length)return;const part=trees[t].impostor,im=new THREE.InstancedMesh(part.geometry,part.material,list.length);
      list.forEach((it,i)=>{im.setMatrixAt(i,it.matrix);im.setColorAt(i,it.tint);});im.frustumCulled=false;holder.add(im);});
    holder.userData.center=place(x0+segment/2,side*shoreOf(x0+segment/2,side),0);
    group.add(holder);group.userData.segments.push(holder);
  }
}
