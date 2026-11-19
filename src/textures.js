import * as THREE from 'three';

// Every image texture the world draws with. The game starts only once all of them have
// arrived (texturesReady), so nothing is ever drawn with a missing texture.
const loader=new THREE.TextureLoader(),pending=[],ATTEMPTS=3;
export function loadTexture(url){
  const texture=new THREE.Texture();
  pending.push((async()=>{
    for(let attempt=1;;attempt++){
      try{texture.image=(await loader.loadAsync(url)).image;texture.needsUpdate=true;return;}
      catch{if(attempt>=ATTEMPTS)throw new Error(`${url}: load failed`);}
    }
  })());
  return texture;
}
export const texturesReady=()=>Promise.all(pending);
