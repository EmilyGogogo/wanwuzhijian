import * as THREE from 'three';

// River and still-water surfaces. The water knows the main island's heightfield, so it is
// clear and pale where it is shallow, foams along the shore, and takes its colour, sky
// reflection, sun or moon glint and rain rings from the shared atmosphere uniforms.
// Seen from below (the camera under this surface) it is the underside of the water: a bright
// window of sky overhead within the critical angle, above-water things showing through it,
// and outside it the surface mirrors the water itself (total internal reflection).

const vertex=`
uniform float time;uniform mat4 toIsland;uniform vec2 flow;
varying vec3 vWorld;varying vec3 vIsland;
#include <fog_pars_vertex>
void main(){
  vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;vIsland=(toIsland*w).xyz;
  vec4 mvPosition=viewMatrix*w;gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}`;
const fragment=`
uniform float time;uniform vec2 flow;uniform vec3 deep;uniform vec3 shallow;uniform float clarity;uniform float level;uniform float deepOpacity;uniform float shallowOpacity;uniform float stillWater;
uniform sampler2D heightMap;uniform vec2 fieldSize;uniform vec2 fieldRange;uniform float hasField;
uniform vec3 sunDir;uniform vec3 moonDir;uniform vec3 sunColor;uniform vec3 skyZenith;uniform vec3 skyHorizon;uniform float rain;uniform float night;
uniform vec4 holes[4];uniform int holeCount;uniform vec3 uwColor;uniform mat4 toIsland;uniform float below;
varying vec3 vWorld;varying vec3 vIsland;
#include <fog_pars_fragment>
float wHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float wNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(wHash(i),wHash(i+vec2(1,0)),f.x),mix(wHash(i+vec2(0,1)),wHash(i+vec2(1,1)),f.x),f.y);}
vec2 wGrad(vec2 p){float e=.15;return vec2(wNoise(p+vec2(e,0))-wNoise(p-vec2(e,0)),wNoise(p+vec2(0,e))-wNoise(p-vec2(0,e)))/(2.*e);}
// Rain: rings expanding from random points in a cell grid.
float rings(vec2 p,float t){
  vec2 cell=floor(p),f=fract(p);float s=0.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 c=cell+vec2(x,y),o=vec2(wHash(c),wHash(c+7.3));float ph=fract(t*.9+wHash(c+3.1));
    float d=length(f-vec2(x,y)-o);s+=sin(clamp((d-ph*.8)*40.,-3.14,3.14))*(1.-ph)*(1.-smoothstep(0.,.8,d));
  }
  return s;
}
void main(){
  vec2 p=vIsland.xz;
  // Still waters above river level draw themselves; the river leaves a hole under them.
  for(int i=0;i<4;i++){if(i>=holeCount)break;vec2 q=(p-holes[i].xy)/holes[i].zw;if(dot(q,q)<1.)discard;}
  float bed=hasField>.5?mix(fieldRange.x,fieldRange.y,texture2D(heightMap,(p+fieldSize*.5)/fieldSize).r):-20.;
  float depth=level-bed;
  if(depth<-.02)discard;
  vec2 g=wGrad(p*.09+flow*time*.05)*.55+wGrad(p*.31-flow.yx*time*.04)*.3+wGrad(p*1.3+flow*time*.22)*.15;
  vec2 rr=vec2(0.);
  if(rain>.001){
    rr=vec2(rings(p*.7,time),rings(p*.7+vec2(5.1,2.7),time*1.13))*rain*.6;
  }
  vec3 n=normalize(vec3(-(g.x+rr.x)*.35,1.,-(g.y+rr.y)*.35));
  vec3 eyeIsland=(toIsland*vec4(cameraPosition,1.)).xyz;
  // below is set each frame by World: the eye is in this body of water (the river surface
  // curves with the river frame, so comparing heights here would misjudge distant water).
  if(below>.5){
    vec3 up=normalize(vIsland-eyeIsland),nb=normalize(vec3(n.x*.7,1.,n.z*.7));
    float cosi=dot(up,nb),win=smoothstep(.63,.69,cosi);
    vec3 out_=refract(up,-nb,1.333);
    vec3 skyIn=mix(skyHorizon,skyZenith,smoothstep(.66,1.,cosi))*(1.15-night*.5);
    float glint=pow(max(dot(out_,sunDir),0.),260.)*3.*(1.-night)*(1.-rain*.7);
    float ring=exp(-pow((cosi-.665)/.018,2.));
    vec3 mirror=uwColor*(.5+.25*wNoise(p*.8+vec2(time*.3,0.)))*(1.-night*.6);
    vec3 cu=mix(mirror,skyIn,win)+sunColor*glint*win+vec3(.85,.95,1.)*ring*.35*(1.-night*.6);
    gl_FragColor=vec4(cu,mix(.88,.42,win)*smoothstep(-.02,.06,depth));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    return;
  }
  vec3 view=normalize(cameraPosition-vWorld);
  // Reflections use world-space directions. The lake follows the island frame.
  mat3 normalToWorld=transpose(mat3(toIsland));
  vec3 flatNormal=normalize(normalToWorld*vec3(0.,1.,0.));
  vec3 surfaceNormal=normalize(normalToWorld*normalize(mix(n,vec3(0.,1.,0.),stillWater*.65)));
  // Calm water uses the mean surface angle for broad reflection, with ripples
  // retained in the small sun and moon highlights.
  float facing=mix(max(dot(view,surfaceNormal),0.),max(dot(view,flatNormal),0.),stillWater*.75);
  float fres=.04+.96*pow(1.-facing,5.);
  float shallowRiver=1.-smoothstep(0.,clarity,depth);
  float shallowLake=exp(-max(depth,0.)/max(clarity,.01));
  float shallowness=mix(shallowRiver,shallowLake,stillWater);
  // Shore foam and the thin line where water meets land.
  float edge=1.-smoothstep(.0,.35,depth);
  float foam=edge*smoothstep(.45,.75,wNoise(p*1.7+vec2(time*.4,0.))+edge*.4);
  float coverage=mix(deepOpacity,shallowOpacity,shallowness);
  float shoreline=smoothstep(-.02,mix(.06,.24,stillWater),depth);
  // Keep the bed visible when looking down, with more sky reflected at a grazing angle.
  vec3 reflected=reflect(-view,surfaceNormal);
  float skyBlend=pow(clamp(reflected.y,0.,1.),.45);
  vec3 reflection=mix(skyHorizon,skyZenith,skyBlend);
  float reflectionWeight=fres*mix(.58,.32,rain)*mix(1.,.65,stillWater);
  float sunFacing=max(dot(reflected,sunDir),0.);
  float moonFacing=max(dot(reflected,moonDir),0.);
  float clearSky=1.-rain*.93;
  vec3 shimmer=sunColor*(.24*pow(sunFacing,28.)+1.25*pow(sunFacing,170.))*(1.-night);
  shimmer+=vec3(.48,.65,1.)*(.07*pow(moonFacing,30.)+.33*pow(moonFacing,150.))*night;
  vec3 waterColor=mix(deep,shallow,shallowness)*mix(1.,.48,night);
  waterColor*=1.+g.x*mix(.16,.025,stillWater);
  reflection=mix(reflection,waterColor,stillWater*.35);
  vec3 c=mix(waterColor,reflection,reflectionWeight);
  vec3 ringColor=mix(vec3(.31,.49,.56),waterColor+vec3(.12),stillWater);
  c+=ringColor*length(rr)*mix(.48,.22,stillWater)*(1.-night*.65);
  c=mix(c,vec3(.78,.92,.9)*(1.-night*.55),foam*.36);
  float alpha=mix(coverage,.85,reflectionWeight)*shoreline;
  // Raise coverage around glints so they read against a bright shallow bed.
  alpha=max(alpha,min(.72,length(shimmer)*clearSky*.65)*shoreline);
  c+=shimmer*clearSky;
  gl_FragColor=vec4(c,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function heightTexture(field){
  const data=new Uint16Array(field.heights.length),[lo,hi]=field.desc.heightRange;
  for(let i=0;i<data.length;i++)data[i]=THREE.DataUtils.toHalfFloat((field.heights[i]-lo)/(hi-lo));
  const t=new THREE.DataTexture(data,field.nx,field.nz,THREE.RedFormat,THREE.HalfFloatType);
  t.minFilter=t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;
}

export function waterMaterial({deep,shallow,clarity=1.4,deepOpacity=.97,shallowOpacity=.55,flow=[1,0],stillWater=false,level=0,holes=[],uwColor='#2f7f8f'},shared,field,heightMap){
  const uniforms=THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{
    time:{value:0},flow:{value:new THREE.Vector2(...flow)},deep:{value:new THREE.Color(deep)},shallow:{value:new THREE.Color(shallow)},
    stillWater:{value:Number(stillWater)},clarity:{value:clarity},deepOpacity:{value:deepOpacity},shallowOpacity:{value:shallowOpacity},level:{value:level},hasField:{value:field?1:0},
    holes:{value:[0,1,2,3].map(i=>new THREE.Vector4(...(holes[i]||[0,0,1,1])))},holeCount:{value:holes.length},uwColor:{value:new THREE.Color(uwColor)},below:{value:0},
    fieldSize:{value:new THREE.Vector2(field?.width||1,field?.depth||1)},fieldRange:{value:new THREE.Vector2(...(field?.desc.heightRange||[0,1]))},
  }]);
  // Shared uniforms are referenced, not copied, so one update reaches every water surface.
  Object.assign(uniforms,{heightMap:{value:heightMap},toIsland:shared.toIsland,sunDir:shared.sunDir,moonDir:shared.moonDir,sunColor:shared.sunColor,
    skyZenith:shared.skyZenith,skyHorizon:shared.skyHorizon,rain:shared.rain,night:shared.night,time:shared.time});
  return new THREE.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,fog:true,side:THREE.DoubleSide});
}
