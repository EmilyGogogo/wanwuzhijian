import * as THREE from 'three';
import { mulberry32 } from './species.js';
import { loadTexture } from './textures.js';

// The people living on the island (env.landing): the worn dirt trail they keep clear from
// the stilt house down to the river, the small jetty at its end and the dugout canoe they take
// off the island. Scenery only — nothing here can be possessed and nothing blocks a body.
// Everything sits in the carrier's (main island's) frame, so it drifts with the island.

const UP=new THREE.Vector3(0,1,0);

// Wood grain drawn once on a canvas: long streaks along U, a few knots.
let GRAIN=null;
function grainTexture(){
  if(GRAIN)return GRAIN;
  const c=document.createElement('canvas');c.width=512;c.height=128;const g=c.getContext('2d'),r=mulberry32(4101);
  g.fillStyle='#8a6a4c';g.fillRect(0,0,512,128);
  for(let i=0;i<220;i++){
    const y=r()*128,light=r()<.5;g.strokeStyle=light?`rgba(196,160,118,${.08+r()*.12})`:`rgba(52,34,20,${.1+r()*.18})`;g.lineWidth=.6+r()*1.8;
    g.beginPath();g.moveTo(0,y);for(let x=0;x<=512;x+=32)g.lineTo(x,y+Math.sin(x*.012+i)*2.2+(r()-.5)*1.2);g.stroke();
  }
  for(let i=0;i<6;i++){const x=r()*512,y=r()*128;g.fillStyle='rgba(48,30,18,.45)';g.beginPath();g.ellipse(x,y,7+r()*6,3+r()*2,0,0,6.28);g.fill();}
  GRAIN=new THREE.CanvasTexture(c);GRAIN.wrapS=GRAIN.wrapT=THREE.RepeatWrapping;GRAIN.colorSpace=THREE.SRGBColorSpace;GRAIN.anisotropy=4;
  return GRAIN;
}
function woodMaterial(color,roughness=.88){return new THREE.MeshStandardMaterial({color,map:grainTexture(),roughness,metalness:0});}

// The trail: a terrain-hugging ribbon of trodden earth, wider and narrower along its length,
// feathered at the edges so it reads as ground worn bare rather than a laid strip.
function createTrail(spec,points,surface){
  const curve=new THREE.CatmullRomCurve3(points.map(([x,z])=>new THREE.Vector3(x,0,z)),false,'centripetal');
  const length=curve.getLength(),count=Math.max(2,Math.ceil(length/.5)),r=mulberry32(spec.seed??17);
  const half=spec.halfWidthM??1.1,lift=spec.liftM??.05,across=[-1.75,-1.2,-.7,-.25,.25,.7,1.2,1.75],tile=spec.tileM??2.4;
  const wobble=[...Array(8)].map(()=>[r()*6.28,.5+r()*1.6]);
  const pos=[],col=[],uv=[],idx=[],p=new THREE.Vector3(),tan=new THREE.Vector3(),side=new THREE.Vector3();
  for(let i=0;i<=count;i++){
    const u=i/count,s=u*length;curve.getPointAt(u,p);curve.getTangentAt(u,tan);side.set(-tan.z,0,tan.x).normalize();
    // Width and edge raggedness drift slowly along the trail.
    let wave=0;for(const [ph,f] of wobble)wave+=Math.sin(s*f*.11+ph)/wobble.length;
    const w=half*(1+.35*wave),ends=Math.min(1,s/2,(length-s)/2.5);
    across.forEach((a,k)=>{
      const x=p.x+side.x*a*w,z=p.z+side.z*a*w,y=surface(x,z);
      const edge=Math.abs(a)>1.5?0:Math.abs(a)>1?.5+.3*Math.sin(s*1.7+a*3):1;
      // The trail fades where it reaches the water.
      const dry=THREE.MathUtils.smoothstep(y,-.05,.25);
      const worn=Math.abs(a)<.5?1:.86;
      pos.push(x,y+lift,z);col.push(1.08*worn,.98*worn,.86*worn,edge*dry*Math.max(0,ends));uv.push(a*w/tile,s/tile);
    });
    if(i<count){const n=across.length,b=i*n;for(let k=0;k<n-1;k++)idx.push(b+k,b+k+1,b+k+n,b+k+1,b+k+n+1,b+k+n);}
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(col,4));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
  const tex=url=>{const t=loadTexture(url);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=4;return t;};
  const map=tex(spec.texture);map.colorSpace=THREE.SRGBColorSpace;
  const mat=new THREE.MeshStandardMaterial({map,normalMap:spec.normalMap?tex(spec.normalMap):null,vertexColors:true,transparent:true,depthWrite:false,roughness:.97,
    polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4});
  const mesh=new THREE.Mesh(geo,mat);mesh.receiveShadow=true;mesh.renderOrder=1;mesh.name='settler-trail';
  mesh.userData.lengthM=length;
  return mesh;
}

// A plank jetty on posts, from the end of the trail out into the shallows.
function createJetty(spec,surface){
  const group=new THREE.Group();group.name='jetty';
  const [sx,sz]=spec.start,[hx,hz]=spec.heading,len=Math.hypot(hx,hz),dir=new THREE.Vector3(hx/len,0,hz/len),side=new THREE.Vector3(-dir.z,0,dir.x);
  const L=spec.lengthM,W=spec.widthM??1.5,deck=spec.deckY??.42,r=mulberry32(spec.seed??23);
  const yaw=Math.atan2(dir.x,dir.z),q=new THREE.Quaternion().setFromAxisAngle(UP,yaw),m=new THREE.Matrix4(),e=new THREE.Euler(),v=new THREE.Vector3(),sc=new THREE.Vector3();
  const at=(along,off,y)=>new THREE.Vector3(sx,y,sz).addScaledVector(dir,along).addScaledVector(side,off);
  // Planks run across the jetty: each a little different in width, height and angle.
  const plankW=.24,gap=.05,planks=Math.floor(L/(plankW+gap)),plank=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),woodMaterial('#c9b39a'),planks);
  const tint=new THREE.Color();
  for(let i=0;i<planks;i++){
    const along=(i+.5)*(plankW+gap);
    e.set((r()-.5)*.02,(r()-.5)*.05,(r()-.5)*.03);
    m.compose(at(along,(r()-.5)*.08,deck+(r()-.5)*.02),q.clone().multiply(new THREE.Quaternion().setFromEuler(e)),sc.set(W*(.94+r()*.1),.05,plankW*(.85+r()*.3)));
    plank.setMatrixAt(i,m);plank.setColorAt(i,tint.setHSL(.075+r()*.02,.1+r()*.1,.5+r()*.16));
  }
  plank.castShadow=plank.receiveShadow=true;group.add(plank);
  // Two stringers carry the planks.
  const beamMat=woodMaterial('#7b5c43');
  for(const off of [-W*.38,W*.38]){
    const beam=new THREE.Mesh(new THREE.BoxGeometry(.12,.14,L),beamMat);beam.position.copy(at(L/2,off,deck-.1));beam.quaternion.copy(q);beam.castShadow=true;group.add(beam);
  }
  // Round posts, driven into the river bed; the outer pair is taller for mooring.
  const postGeo=new THREE.CylinderGeometry(.085,.1,1,9),postMat=woodMaterial('#6d4f38',.95);
  const posts=[];for(let along=.4;along<L;along+=2.2)posts.push(along);posts.push(L-.15);
  for(const along of posts)for(const off of [-W*.5-.04,W*.5+.04]){
    const base=at(along,off,0),bed=surface(base.x,base.z)-.5,top=deck+(along>L-.5?.62:.12)+(r()-.5)*.06,post=new THREE.Mesh(postGeo,postMat);
    post.scale.set(1+(r()-.5)*.25,top-bed,1+(r()-.5)*.25);post.position.set(base.x,(top+bed)/2,base.z);post.rotation.set((r()-.5)*.05,r()*6,(r()-.5)*.05);post.castShadow=true;group.add(post);
  }
  group.userData.posts=posts;group.userData.postOffset=W*.5+.04;group.userData.deck=deck;
  group.userData.dir=dir;group.userData.side=side;group.userData.at=at;
  return group;
}

// A dugout canoe hollowed from one trunk: pointed ends that lift a little, two thwarts and a paddle.
function canoeHull(L,B,D,thick){
  const NS=48,NA=14,pos=[],idx=[],uv=[];
  // Cross-section half-width and depth along the hull (s from -1 at the stern to 1 at the bow).
  const beam=s=>B/2*Math.pow(Math.max(0,1-Math.pow(Math.abs(s),2.4)),.55),deep=s=>D*Math.pow(Math.max(0,1-Math.pow(Math.abs(s),3.2)),.35),sheer=s=>.1*Math.pow(Math.abs(s),5);
  const surface=(inner)=>{
    const base=pos.length/3;
    for(let i=0;i<=NS;i++){
      const s=-1+2*i/NS,b=Math.max(.002,beam(s)-(inner?thick:0)),d=Math.max(.002,deep(s)-(inner?thick:0)),top=D+sheer(s);
      for(let j=0;j<=NA;j++){
        const a=Math.PI*j/NA;pos.push(-Math.cos(a)*b,top-Math.sin(a)*d-(inner?0:0),s*L/2);uv.push(s*L/2,j/NA);
      }
    }
    for(let i=0;i<NS;i++)for(let j=0;j<NA;j++){
      const a=base+i*(NA+1)+j,b2=a+NA+1;
      if(inner)idx.push(a,a+1,b2,a+1,b2+1,b2);else idx.push(a,b2,a+1,a+1,b2,b2+1);
    }
    return base;
  };
  const outer=surface(false),inner=surface(true);
  // Gunwale: joins the top edges of the outer and inner surfaces.
  for(let i=0;i<NS;i++)for(const j of [0,NA]){
    const o=outer+i*(NA+1)+j,n=inner+i*(NA+1)+j,o2=o+NA+1,n2=n+NA+1;
    if(j===0)idx.push(o,n,o2,n,n2,o2);else idx.push(o,o2,n,n,o2,n2);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
  return {geo,deep,beam,sheer};
}
function createCanoe(spec,jetty){
  const L=spec.lengthM??5.6,B=spec.beamM??.82,D=spec.depthM??.42,group=new THREE.Group();group.name='canoe';
  const boat=new THREE.Group();group.add(boat);
  const {geo}=canoeHull(L,B,D,.045),hull=new THREE.Mesh(geo,woodMaterial('#b08560',.8));hull.castShadow=hull.receiveShadow=true;
  hull.material.side=THREE.DoubleSide;boat.add(hull);
  const seatMat=woodMaterial('#c4a07a');
  for(const z of [-L*.24,L*.2]){const seat=new THREE.Mesh(new THREE.BoxGeometry(B*.86,.04,.2),seatMat);seat.position.set(0,D-.07,z);seat.castShadow=true;boat.add(seat);}
  // A paddle resting across the thwarts.
  const paddle=new THREE.Group(),shaft=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,1.15,7),seatMat),blade=new THREE.Mesh(new THREE.BoxGeometry(.16,.018,.5),seatMat);
  shaft.rotation.x=Math.PI/2;shaft.position.z=-.3;blade.position.z=.5;paddle.add(shaft,blade);paddle.position.set(.12,D-.02,.1);paddle.rotation.set(-.06,.32,.08);boat.add(paddle);
  // Moored alongside the jetty, bow towards the shore.
  const {at,dir}=jetty.userData,c=at(spec.alongM??9,spec.offsetM??1.35,0);
  group.position.set(c.x,spec.waterY??-.1,c.z);group.rotation.y=Math.atan2(dir.x,dir.z)+(spec.yawDeg??4)*Math.PI/180;
  boat.position.y=-(spec.draftM??.13);
  // Mooring line from the bow to the tall post at the end of the jetty, sagging towards the water.
  const ropeMat=new THREE.MeshStandardMaterial({color:'#b59f74',roughness:1});
  const rope=new THREE.Mesh(new THREE.BufferGeometry(),ropeMat);rope.name='mooring-line';
  // Tied to the jetty post nearest the bow.
  const {posts,postOffset,deck}=jetty.userData,bowAlong=(spec.alongM??9)-L/2+.25;
  const postAlong=posts.reduce((a,b)=>Math.abs(b-bowAlong)<Math.abs(a-bowAlong)?b:a),tie=at(postAlong,postOffset*Math.sign(spec.offsetM??1.35),deck+.08);
  const bowLocal=new THREE.Vector3(0,D,-L/2+.25);
  const updateRope=()=>{
    group.updateMatrix();boat.updateMatrix();
    const a=bowLocal.clone().applyMatrix4(boat.matrix).applyMatrix4(group.matrix),mid=a.clone().lerp(tie,.5);mid.y=Math.min(a.y,tie.y)-.25;
    rope.geometry.dispose();rope.geometry=new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a,mid,tie),12,.012,5,false);
  };
  updateRope();
  // Rocks gently on the current.
  const tick=(t,reduced)=>{
    if(reduced)return;
    boat.position.y=-(spec.draftM??.13)+.022*Math.sin(t*1.25)+.01*Math.sin(t*2.7+1);
    boat.rotation.z=.025*Math.sin(t*.9+.4);boat.rotation.x=.012*Math.sin(t*1.1);
    group.rotation.y=Math.atan2(dir.x,dir.z)+((spec.yawDeg??4)+2.5*Math.sin(t*.17))*Math.PI/180;
    updateRope();
  };
  return {group,rope,tick};
}

// The yard in front of the house, in the house's own frame (+Z out of the front door): a patch
// of earth trodden bare, a woodpile against the end wall, a chopping stump, clay water jars by
// the steps and a stone hearth with a thread of smoke. Signs that people live here; no people.
function createYard(spec,surface,mudMap,mudNormal){
  const group=new THREE.Group();group.name='yard';
  const [ox,oz]=spec.origin,yaw=spec.rotationY,c=Math.cos(yaw),sn=Math.sin(yaw),r=mulberry32(spec.seed??31);
  const toIsland=(x,z)=>[ox+x*c+z*sn,oz-x*sn+z*c];
  const ground=(x,z)=>{const [wx,wz]=toIsland(x,z);return new THREE.Vector3(wx,surface(wx,wz),wz);};
  // Bare earth: a ragged ellipse that fades into the grass.
  const [cx,cz]=spec.center,[rx,rz]=spec.radii,rings=9,seg=56,lobes=[...Array(5)].map(()=>[r()*6.28,2+Math.floor(r()*4),.04+r()*.06]);
  const pos=[],col=[],uv=[],idx=[];
  for(let i=0;i<=rings;i++)for(let j=0;j<seg;j++){
    const a=j/seg*Math.PI*2;let k=1;for(const [ph,f,amp] of lobes)k+=amp*Math.sin(a*f+ph);
    const t=i/rings,x=cx+Math.cos(a)*rx*t*k,z=cz+Math.sin(a)*rz*t*k,[wx,wz]=toIsland(x,z);
    const edge=1-THREE.MathUtils.smoothstep(t,.62,1),worn=.9+.1*(1-t);
    pos.push(wx,surface(wx,wz)+.04,wz);col.push(1.05*worn,.96*worn,.84*worn,edge*.96);uv.push(wx/2.6,wz/2.6);
    if(i<rings){const a0=i*seg+j,a1=i*seg+(j+1)%seg;idx.push(a0,a1,a1+seg,a0,a1+seg,a0+seg);}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(col,4));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
  const earth=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({map:mudMap,normalMap:mudNormal,vertexColors:true,transparent:true,depthWrite:false,roughness:.98,
    polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4}));
  earth.receiveShadow=true;earth.renderOrder=1;earth.name='yard-earth';group.add(earth);
  const place=(obj,[x,z],turn=0,lift=0)=>{const p=ground(x,z);obj.position.set(p.x,p.y+lift,p.z);obj.rotation.y=yaw+turn;group.add(obj);return obj;};
  const bark=woodMaterial('#6e5038',.95),cut=new THREE.MeshStandardMaterial({color:'#c8a27a',roughness:.9});
  // Woodpile: split logs stacked in rows on two sleepers, end grain showing.
  {
    const pile=new THREE.Group(),log=new THREE.CylinderGeometry(1,1,1,8),mats=[bark,cut,cut],rows=[7,6,5,3];
    const count=rows.reduce((a,b)=>a+b,0),logs=new THREE.InstancedMesh(log,mats,count),m=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler();
    let n=0;rows.forEach((k,row)=>{for(let i=0;i<k;i++){
      const rad=.07+r()*.03,x=(i-(k-1)/2)*.17+(row%2)*.02,y=.12+rad+row*.15;
      e.set(Math.PI/2+(r()-.5)*.06,(r()-.5)*.08,0);q.setFromEuler(e);
      m.compose(new THREE.Vector3(x,y,(r()-.5)*.08),q,new THREE.Vector3(rad,1+(r()-.5)*.18,rad));logs.setMatrixAt(n++,m);
    }});
    logs.castShadow=logs.receiveShadow=true;pile.add(logs);
    for(const z of [-.32,.32]){const sl=new THREE.Mesh(new THREE.BoxGeometry(1.35,.1,.12),bark);sl.position.set(0,.05,z);sl.castShadow=true;pile.add(sl);}
    pile.name='woodpile';place(pile,spec.woodpile,Math.PI/2);
  }
  // Chopping stump with a split log resting on it.
  {
    const stump=new THREE.Group(),body=new THREE.Mesh(new THREE.CylinderGeometry(.3,.4,.36,12),[bark,cut,cut]);body.position.y=.16;
    const split=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,.55,8,1,false,0,Math.PI),[bark,cut,cut]);split.rotation.set(0,.5,Math.PI/2);split.position.set(.05,.36,.02);
    // Chips of split wood scattered round the stump.
    for(let i=0;i<7;i++){const a=r()*6.28,d=.45+r()*.5,chip=new THREE.Mesh(new THREE.BoxGeometry(.12+r()*.08,.025,.04+r()*.03),cut);chip.position.set(Math.cos(a)*d,.02,Math.sin(a)*d);chip.rotation.y=r()*3;stump.add(chip);}
    for(const o of [body,split]){o.castShadow=o.receiveShadow=true;stump.add(o);}
    stump.name='chopping-stump';place(stump,spec.stump,r()*6);
  }
  // Clay water jars by the steps.
  {
    const profile=[[0,0],[.13,0],[.2,.08],[.23,.22],[.21,.36],[.13,.46],[.1,.5],[.12,.54],[.105,.55],[.085,.5]].map(([x,y])=>new THREE.Vector2(x,y));
    const jarGeo=new THREE.LatheGeometry(profile,18),clay=new THREE.MeshStandardMaterial({color:'#a8583a',roughness:.85,side:THREE.DoubleSide});
    spec.jars.forEach((p,i)=>{const jar=new THREE.Mesh(jarGeo,clay);jar.scale.setScalar(i?.8:1);jar.castShadow=jar.receiveShadow=true;jar.name='water-jar';place(jar,p,r()*6,-.02);});
  }
  // Hearth: a ring of river stones round a charred bed, three half-burnt sticks and a little smoke.
  const hearth=new THREE.Group();hearth.name='hearth';
  {
    const stoneGeo=new THREE.IcosahedronGeometry(1,1),stoneMat=new THREE.MeshStandardMaterial({color:'#8a8378',roughness:.95});
    for(let i=0;i<9;i++){
      const a=i/9*Math.PI*2+(r()-.5)*.25,st=new THREE.Mesh(stoneGeo,stoneMat),s=.09+r()*.04;
      st.scale.set(s*(1.1+r()*.3),s*.75,s);st.position.set(Math.cos(a)*.5,s*.4,Math.sin(a)*.5);st.rotation.set(r()*3,r()*3,r()*3);st.castShadow=true;hearth.add(st);
    }
    const ash=new THREE.Mesh(new THREE.CircleGeometry(.44,20),new THREE.MeshStandardMaterial({color:'#3a332d',roughness:1}));ash.rotation.x=-Math.PI/2;ash.position.y=.03;hearth.add(ash);
    const char=new THREE.MeshStandardMaterial({color:'#2b2420',roughness:.9}),ember=new THREE.MeshStandardMaterial({color:'#5a2a18',emissive:'#ff5a1a',emissiveIntensity:.6});
    for(let i=0;i<3;i++){
      const a=i/3*Math.PI*2+.4,stick=new THREE.Mesh(new THREE.CylinderGeometry(.035,.04,.62,6),char);
      stick.rotation.set(0,-a,Math.PI/2-.22);stick.position.set(Math.cos(a)*.2,.1,Math.sin(a)*.2);stick.castShadow=true;hearth.add(stick);
    }
    const glow=new THREE.Mesh(new THREE.SphereGeometry(.07,8,6),ember);glow.scale.y=.5;glow.position.y=.05;hearth.add(glow);
  }
  place(hearth,spec.hearth);
  const smoke=createSmoke(spec.smoke??{});hearth.add(smoke.group);
  // After dark someone is home: lamplight fills the room and shows through the windows, the
  // door and the gaps between the wall boards, spills onto the yard, and the embers glow.
  const lamp=spec.lamp?createLamplight(spec.lamp):null;let clock=0;
  if(lamp){const p=ground(0,0);lamp.group.position.copy(p);lamp.group.rotation.y=yaw;group.add(lamp.group);hearth.add(lamp.fire);}
  const ember=hearth.children.find(o=>o.material?.emissiveIntensity>0);
  const tick=(dt,reduced,night=0)=>{
    smoke.tick(dt,reduced,night);if(!lamp)return;
    if(!reduced)clock+=dt;
    const lit=THREE.MathUtils.smoothstep(night,.15,.7),flicker=reduced?1:.84+.1*Math.sin(clock*7.3)+.06*Math.sin(clock*17.1+1.3);
    lamp.room.visible=lit>.01;lamp.room.material.opacity=lit;
    lamp.door.intensity=lit*(spec.lamp.doorIntensity??26)*(reduced?1:.95+.05*Math.sin(clock*3.1));
    lamp.fire.intensity=lit*(spec.lamp.fireIntensity??9)*flicker;
    if(ember)ember.material.emissiveIntensity=.6+2.2*lit*flicker;
  };
  tick(0,true,0);
  group.userData.earth=earth;group.userData.hearth=hearth;group.userData.smoke=smoke.group;group.userData.toIsland=toIsland;group.userData.lamp=lamp;
  return {group,tick};
}

// The lit room, in the house's own frame: a warm box just inside the walls (brighter low down,
// where the lamp stands), a light at the door and one over the hearth. Dark by day.
function createLamplight(spec){
  const group=new THREE.Group();group.name='lamplight';
  const [x0,y0,z0]=spec.roomMin,[x1,y1,z1]=spec.roomMax,geo=new THREE.BoxGeometry(x1-x0,y1-y0,z1-z0,1,4,1);
  const pos=geo.attributes.position,col=[],low=new THREE.Color('#ffc46e'),high=new THREE.Color('#d9701f'),c=new THREE.Color();
  for(let i=0;i<pos.count;i++){c.lerpColors(low,high,THREE.MathUtils.smoothstep(pos.getY(i)/(y1-y0)+.5,.1,1));col.push(c.r,c.g,c.b);}
  geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  const room=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:0,fog:false}));
  room.position.set((x0+x1)/2,(y0+y1)/2,(z0+z1)/2);room.name='lit-room';room.visible=false;group.add(room);
  const door=new THREE.PointLight('#ffb066',0,spec.doorReachM??14,2);door.position.set(...spec.door);door.name='door-light';group.add(door);
  const fire=new THREE.PointLight('#ff7a2e',0,spec.fireReachM??8,2);fire.position.set(0,.45,0);fire.name='fire-light';
  return {group,room,door,fire};
}

// A thin thread of smoke: soft sprites that rise, drift and fade, then start again at the fire.
let PUFF=null;
function puffTexture(){
  if(PUFF)return PUFF;
  const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),grad=g.createRadialGradient(32,32,0,32,32,32);
  grad.addColorStop(0,'rgba(255,255,255,1)');grad.addColorStop(.5,'rgba(255,255,255,.45)');grad.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=grad;g.fillRect(0,0,64,64);PUFF=new THREE.CanvasTexture(c);return PUFF;
}
function createSmoke(spec){
  const group=new THREE.Group();group.name='smoke';
  const n=spec.puffs??9,life=spec.lifeS??7,rise=spec.riseM??4.2,drift=spec.driftM??1.4,puffs=[];
  for(let i=0;i<n;i++){
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:puffTexture(),color:'#d9d9d9',transparent:true,depthWrite:false,opacity:0}));
    sp.renderOrder=2;group.add(sp);puffs.push(sp);
  }
  const pose=t=>{
    puffs.forEach((sp,i)=>{
      const u=((t/life)+i/n)%1,ease=Math.sqrt(u);
      sp.position.set(drift*u*u+.12*Math.sin(t*.7+i*1.9)*u,.25+rise*ease,.25*Math.sin(t*.45+i)*u);
      sp.scale.setScalar(.35+1.5*u);
      sp.material.opacity=(spec.opacity??.32)*Math.min(1,u*8)*(1-u)*(1-u);
    });
  };
  pose(life*.37);
  let clock=0;
  // By night the smoke is only lit from below, so it dims.
  const dim=night=>{for(const sp of puffs)sp.material.color.setScalar(.85-.45*night);};
  return {group,tick:(dt,reduced,night=0)=>{dim(night);if(reduced)return;clock+=dt;pose(life*.37+clock);}};
}

export function createLanding(slot,surface,trailPoints){
  const sc=slot.scatter,group=new THREE.Group();group.name='landing';
  const trail=createTrail(sc.trail,trailPoints,surface),jetty=createJetty(sc.jetty,surface),canoe=createCanoe(sc.canoe,jetty);
  group.add(trail,jetty,canoe.group,canoe.rope);
  const yard=sc.yard?createYard(sc.yard,surface,trail.material.map,trail.material.normalMap):null;
  if(yard)group.add(yard.group);
  let clock=0;
  group.userData.tick=(dt,reduced,night=0)=>{clock+=dt;canoe.tick(clock,reduced);yard?.tick(dt,reduced,night);};
  group.userData.trail=trail;group.userData.jetty=jetty;group.userData.canoe=canoe.group;group.userData.yard=yard?.group??null;
  return group;
}
