import * as THREE from 'three';
import { bankShore } from './banks.js';

// Small river traffic is environmental scenery, not a possessable body.
const brown=new THREE.MeshStandardMaterial({color:'#604932',roughness:.92});
const wood=new THREE.MeshStandardMaterial({color:'#8a6942',roughness:.94});
const dark=new THREE.MeshStandardMaterial({color:'#34423a',roughness:.92});
const cloth=new THREE.MeshStandardMaterial({color:'#a99b76',roughness:1});
const hullShape=new THREE.Shape();
hullShape.moveTo(-.48,1);hullShape.lineTo(.48,1);hullShape.lineTo(.32,-.78);hullShape.quadraticCurveTo(0,-1.22,-.32,-.78);hullShape.closePath();
const hullGeometry=new THREE.ExtrudeGeometry(hullShape,{depth:.24,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.06,bevelThickness:.05});
hullGeometry.translate(0,0,-.12);hullGeometry.rotateX(Math.PI/2);
const logGeometry=new THREE.CylinderGeometry(.18,.22,1,7);logGeometry.rotateX(Math.PI/2);
const boxGeometry=new THREE.BoxGeometry(1,1,1);
const sphereGeometry=new THREE.SphereGeometry(1,7,5);
const up=new THREE.Vector3(0,1,0),surfaceNormal=new THREE.Vector3(),heading=new THREE.Quaternion();
function part(parent,geometry,material,position,scale){
  const mesh=new THREE.Mesh(geometry,material);mesh.position.set(...position);mesh.scale.set(...scale);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function buildCraft(kind){
  const root=new THREE.Group();
  if(kind==='log_raft'){
    for(let i=0;i<9;i++)part(root,logGeometry,wood,[(i-4)*.4,.13,0],[1,1,9.5]);
    for(const z of [-3.2,3.2])part(root,boxGeometry,dark,[0,.34,z],[3.9,.15,.18]);
    for(let i=0;i<4;i++)part(root,boxGeometry,cloth,[(i%2-.5)*1.2,.67,(Math.floor(i/2)-.5)*1.8],[.85,.6,1.2]);
  }else{
    part(root,hullGeometry,brown,[0,0,0],[4.2,1.8,8]);
    part(root,boxGeometry,dark,[0,1.12,-1],[2.9,1.6,6.8]);
    part(root,boxGeometry,cloth,[0,1.98,-1],[3.6,.15,7.4]);
    for(const z of [3.5,5])part(root,boxGeometry,wood,[0,.45,z],[3.4,.16,.5]);
    for(const x of [-.7,.7]){
      const person=new THREE.Group();
      part(person,sphereGeometry,dark,[0,.85,0],[.16,.19,.16]);
      part(person,boxGeometry,cloth,[0,.49,0],[.22,.55,.2]);
      person.position.set(x,.35,3.5);root.add(person);
    }
  }
  return root;
}
function sampleRoute(route,distance){
  const pts=route.route,lengths=route.lengths,total=route.length;
  let remaining=((distance%total)+total)%total;
  for(let i=0;i<lengths.length;i++){
    if(remaining<=lengths[i]){
      const a=pts[i],b=pts[i+1],t=remaining/lengths[i],x=THREE.MathUtils.lerp(a[0],b[0],t),z=THREE.MathUtils.lerp(a[1],b[1],t);
      return {x,z,yaw:Math.atan2(-(b[0]-a[0]),-(b[1]-a[1]))};
    }
    remaining-=lengths[i];
  }
  return {x:pts[0][0],z:pts[0][1],yaw:0};
}
export class RiverTraffic extends THREE.Group{
  constructor(routes,{radius=100000,level=-.1,corridor={halfWidthM:640},rules={}}={}){
    super();this.radius=radius;this.level=level;this.corridor=corridor;
    this.rules={clearanceM:18,bankMarginM:12,approachM:240,slowRatio:.38,...rules};this.clock=0;
    this.routes=routes.map(route=>{const lengths=route.route.slice(1).map((p,i)=>Math.hypot(p[0]-route.route[i][0],p[1]-route.route[i][1]));return {...route,lengths,length:lengths.reduce((a,b)=>a+b,0)};});
    this.states=this.routes.map(route=>({distance:(route.phase||0)*route.length,offset:0,yielding:false}));
    this.craft=this.routes.map(route=>{const object=buildCraft(route.kind);object.rotation.y=0;
      // Each passer fades at the remote route endpoints without changing another boat.
      const copies=new Map();object.traverse(m=>{if(m.isMesh){if(!copies.has(m.material))copies.set(m.material,m.material.clone());m.material=copies.get(m.material);m.material.transparent=true;}});
      const points=[new THREE.Vector3(-2.5,.02,8),new THREE.Vector3(-4,.02,18),new THREE.Vector3(-6,.02,34),new THREE.Vector3(6,.02,34),new THREE.Vector3(4,.02,18),new THREE.Vector3(2.5,.02,8)];
      const wake=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#d6dfd3',transparent:true,opacity:.4,depthWrite:false}));wake.renderOrder=3;object.add(wake);object.userData.wake=wake;
      this.add(object);return object;});
    this.update(0);
  }
  update(dt,island=null){
    const elapsed=Math.max(0,Number.isFinite(dt)?dt:0);this.clock+=elapsed;
    this.routes.forEach((route,i)=>{
      const state=this.states[i],before=sampleRoute(route,state.distance),side=Math.sign(before.z)||1,R=this.rules;
      const near=!!island&&Math.abs(before.x-island.x)<610+R.approachM;
      const gap=island?side*(before.z-island.z)-350:Infinity;
      state.yielding=near&&gap<R.approachM;
      state.distance=(state.distance+elapsed*route.speedMps*(state.yielding?R.slowRatio:1))%route.length;
      const p=sampleRoute(route,state.distance),bank=bankShore(this.corridor.halfWidthM,p.x,side)-R.bankMarginM-3;
      const close=!!island&&Math.abs(p.x-island.x)<630;
      const safety=close?side*island.z+350+R.clearanceM+3:0;
      const desired=state.yielding?Math.max(side*p.z,safety,near?side*island.z+350+R.clearanceM+25:0):side*p.z;
      const goal=side*(Math.min(bank,desired)-side*p.z);
      state.offset=THREE.MathUtils.damp(state.offset,goal,1.8,elapsed);
      // A moving island can close the gap in one frame; preserve physical separation.
      let z=side*Math.min(bank,Math.max(side*(p.z+state.offset),safety));
      state.offset=z-p.z;
      const object=this.craft[i];object.position.set(p.x,Math.sqrt(Math.max(0,this.radius**2-p.x*p.x-z*z))+this.level+.025*Math.sin(this.clock*1.4+i),z);
      // Keep the hull and its wake tangent to the same curved water surface.
      object.quaternion.setFromUnitVectors(up,surfaceNormal.copy(object.position).normalize()).multiply(heading.setFromAxisAngle(up,p.yaw));
      const end=Math.min(state.distance,route.length-state.distance),fade=THREE.MathUtils.smoothstep(end,0,200);
      object.traverse(m=>{if(m.isMesh)m.material.opacity=fade;});object.userData.wake.material.opacity=fade*(state.yielding?.16:.38);
    });
  }
  serialize(){return {version:1,clock:this.clock,craft:this.routes.map((r,i)=>({id:r.id,distance:this.states[i].distance,offset:this.states[i].offset}))};}
  restore(saved){
    this.clock=Number.isFinite(saved?.clock)&&saved.clock>=0?saved.clock:0;
    this.routes.forEach((r,i)=>{const s=saved?.craft?.find(c=>c?.id===r.id);this.states[i]={distance:Number.isFinite(s?.distance)?((s.distance%r.length)+r.length)%r.length:(r.phase||0)*r.length,offset:Number.isFinite(s?.offset)?THREE.MathUtils.clamp(s.offset,-100,100):0,yielding:false};});
    this.update(0);
  }
}
