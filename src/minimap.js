import * as THREE from 'three';
import { SPECIES } from './species.js';
import { bankShore } from './banks.js';

// Minimap (framework; details such as icons, colours and size are left to tune). A fixed
// top-down map of the river around the main island: the island, the river channels on both
// sides, the lakes and ponds, and the forested banks; the body the player is in is a gold arrow
// along its heading. Zoom with the map keys (+ / −, see the input map in game.json), the buttons or the
// mouse wheel over the map while the pointer is free; M shows or hides it.
//
// Coordinates are the main island's own metres (x along the river, z across it; the map shows
// x to the right and z downward). The view never reaches past the mapped area: `bounds` is deep
// enough across the river for the widest zoom step at the panel's aspect, and a step that would
// still overflow is narrowed to fit. The player's arrow points along the body's heading turned
// into island coordinates, and stays pinned to the panel's edge when the body is off the map.
// After the island travels, the bank samples use its actual transform in the river.
// The base map is sampled from World.water() and the heightfield, a few rows per frame so loading
// does not stall; each frame only the visible part is copied and the markers drawn on top.
//
// Extending it: addLayer(draw) adds a layer drawn after the base map and before the player,
// called as draw(ctx, toMap, view) where toMap(x, z) gives canvas pixels for island metres and
// view = {cx, cz, widthM, pxPerM}. Creature icons, "seen" lists and so on belong in layers.

export const MAP = {
  // Area the map covers, island metres: the island, both river channels and the forest beyond.
  // Across the river (z) it reaches ±1250 m so the widest step (3600 m at 220×150 or 160×110 px,
  // about 2450–2480 m tall) still shows forest, not empty canvas, beyond the banks.
  bounds: { x0: -1800, x1: 1800, z0: -1250, z1: 1250 },
  metresPerPixel: 2,             // base map resolution
  zoomWidthsM: [3600, 2400, 1600, 1000, 600, 350, 200], // width shown at each zoom step
  defaultZoom: 1,                // 2400 m: the island, both channels and both banks
  sizePx: [220, 150],            // panel size (CSS pixels); narrow windows use `narrowSizePx`
  narrowSizePx: [160, 110],
  hiddenModes: ['island'],       // body modes for which the map is hidden (a whole island)
  fps: 10,                       // map redraws per second
  colours: {
    river: [38, 64, 66], lake: [58, 104, 112], bank: [44, 70, 44], shore: [236, 234, 208],
    sand: [212, 201, 164], mud: [124, 110, 84], grass: [151, 173, 113], crack: [178, 163, 128], litter: [104, 133, 86],
  },
};

const CSS = `
.minimap{position:absolute;top:86px;right:42px;z-index:4;border:1px solid #edf0de40;border-radius:4px;overflow:hidden;
  background:#23392eea;box-shadow:0 2px 14px rgba(18,39,24,.35);pointer-events:auto;user-select:none}
.minimap canvas{display:block}
.minimap-zoom{position:absolute;right:4px;top:4px;display:flex;flex-direction:column;gap:3px}
.minimap-zoom button{width:20px;height:20px;padding:0;border:1px solid #edf0de55;border-radius:3px;background:#23392ecc;color:#f5f5e6;font:13px/1 -apple-system,BlinkMacSystemFont,sans-serif}
.minimap-scale{position:absolute;left:6px;bottom:4px;color:#f5f5e6;font:10px/1 -apple-system,BlinkMacSystemFont,sans-serif;text-shadow:0 1px 3px #172a1d}
.minimap-scale i{display:block;height:3px;margin-bottom:2px;border:1px solid #f5f5e6;border-top:0}
.minimap-loading{position:absolute;inset:0;display:grid;place-items:center;color:#f5f5e6aa;font:11px -apple-system,BlinkMacSystemFont,sans-serif}
@media(max-width:700px){.minimap{top:70px;right:16px}}
`;

export class Minimap {
  constructor(game, parent = document.getElementById('experience')) {
    this.game = game; this.world = game.world; this.layers = []; this.config = MAP;
    this.zoom = MAP.defaultZoom; this.visible = true; this.wait = 0;
    if (!document.getElementById('minimap-style')) {
      const style = document.createElement('style'); style.id = 'minimap-style'; style.textContent = CSS; document.head.appendChild(style);
    }
    const el = this.el = document.createElement('div');
    el.id = 'minimap'; el.className = 'minimap'; el.hidden = true; el.setAttribute('aria-label', '地图');
    el.innerHTML = `<canvas></canvas><div class="minimap-zoom"><button type="button" data-z="1" aria-label="放大地图" title="放大 · +">+</button>`
      + `<button type="button" data-z="-1" aria-label="缩小地图" title="缩小 · −">−</button></div>`
      + `<div class="minimap-scale"><i></i><span></span></div><div class="minimap-loading">地图生成中</div>`;
    parent.appendChild(el);
    this.canvas = el.querySelector('canvas'); this.ctx = this.canvas.getContext('2d');
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.zoomBy(+b.dataset.z); }));
    this.canvas.addEventListener('wheel', e => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1 : -1); }, { passive: false });
    this.startBase();
  }

  // ---- input
  // Map actions from the input map in game.json: map_toggle, map_zoom_in, map_zoom_out.
  handle(action) {
    if (action === 'map_toggle') { this.visible = !this.visible; this.wait = 0; }
    else if (action === 'map_zoom_in') this.zoomBy(1);
    else if (action === 'map_zoom_out') this.zoomBy(-1);
  }
  zoomBy(step) { this.zoom = THREE.MathUtils.clamp(this.zoom + step, 0, MAP.zoomWidthsM.length - 1); this.wait = 0; }
  addLayer(draw) { this.layers.push(draw); return () => { this.layers = this.layers.filter(d => d !== draw); }; }

  // ---- base map, built a few rows per frame
  startBase() {
    const b = MAP.bounds, m = MAP.metresPerPixel;
    const W=this.world;W.islandRoot.updateWorldMatrix(true,false);
    this.basePose={position:W.islandRoot.position.clone(),quaternion:W.islandRoot.quaternion.clone()};
    this.mapToRiver=new THREE.Matrix4().copy(W.planetRoot.matrixWorld).invert().multiply(W.islandRoot.matrixWorld);
    if(this.baseReady)this.previousBase=this.base;
    const base = this.base = document.createElement('canvas');
    base.width = Math.round((b.x1 - b.x0) / m); base.height = Math.round((b.z1 - b.z0) / m);
    this.baseCtx = base.getContext('2d');
    this.kind = new Uint8Array(base.width * base.height);     // 0 river, 1 land, 2 still water, 3 bank
    this.rowsDone = 0; this.baseReady = false;
    this.el.querySelector('.minimap-loading').style.display='grid';
  }
  riverPoint(x,z){const e=this.mapToRiver.elements;return {x:e[0]*x+e[8]*z+e[12],z:e[2]*x+e[10]*z+e[14]};}
  buildRows(budgetMs = 4) {
    const W = this.world, F = W.field, b = MAP.bounds, m = MAP.metresPerPixel, C = MAP.colours, base = this.base;
    const halfWidth = W.river?.corridor?.halfWidthM ?? 640, w = [0, 0, 0, 0], t0 = performance.now();
    while (this.rowsDone < base.height && performance.now() - t0 < budgetMs) {
      const j = this.rowsDone++, z = b.z0 + (j + .5) * m, row = this.baseCtx.createImageData(base.width, 1), d = row.data;
      for (let i = 0; i < base.width; i++) {
        const x = b.x0 + (i + .5) * m; let c, k;
        const river=this.riverPoint(x,z);
        if (Math.abs(river.z) > bankShore(halfWidth, river.x, Math.sign(river.z))) { c = C.bank; k = 3; }
        else {
          const wat = W.water(x, z);
          if (wat) { k = wat.type === 'river' ? 0 : 2; c = k ? C.lake : C.river; }
          else if (F) {
            F.weights(x, z, w); const l = Math.max(0, 1 - w[0] - w[1] - w[2] - w[3]); k = 1;
            c = [0, 1, 2].map(n => w[0] * C.sand[n] + w[1] * C.mud[n] + w[2] * C.grass[n] + w[3] * C.crack[n] + l * C.litter[n]);
          } else { c = C.grass; k = 1; }
        }
        this.kind[j * base.width + i] = k; d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
      }
      this.baseCtx.putImageData(row, 0, j);
    }
    if (this.rowsDone >= base.height) this.finishBase();
  }
  // A pale line where land meets the river, so the island and the banks read at a glance.
  finishBase() {
    const base = this.base, wd = base.width, img = this.baseCtx.getImageData(0, 0, wd, base.height), K = this.kind, s = MAP.colours.shore;
    for (let j = 1; j < base.height - 1; j++) for (let i = 1; i < wd - 1; i++) {
      const n = j * wd + i; if (K[n] !== 1 && K[n] !== 3) continue;
      if (K[n - 1] === 0 || K[n + 1] === 0 || K[n - wd] === 0 || K[n + wd] === 0) img.data.set([s[0], s[1], s[2], 255], n * 4);
    }
    this.baseCtx.putImageData(img, 0, 0);
    this.baseReady = true;this.previousBase=null; this.el.querySelector('.minimap-loading').style.display='none';
  }

  // ---- per frame
  update(dt) {
    const g = this.game, p = g.player, show = g.started && this.visible && !!p && !MAP.hiddenModes.includes(SPECIES[p.kind]?.mode);
    const root=this.world.islandRoot,moved=this.basePose.position.distanceTo(root.position)>20||Math.abs(this.basePose.quaternion.dot(root.quaternion))<.99995;
    if((show||!g.started)&&moved)this.startBase();
    if(!this.baseReady&&(show||!g.started))this.buildRows();
    if (this.el.hidden === show) this.el.hidden = !show;
    if (!show) return;
    this.wait -= dt; if (this.wait > 0) return; this.wait = 1 / MAP.fps;
    this.draw();
  }
  // Where the player is, in island metres, and which way it faces there (radians, measured like
  // Entity.heading). The heading is in the body's parent frame (root.rotation.y): a body carried
  // by something else, or an island that has turned, is turned back into island coordinates.
  playerPose() {
    const W = this.world, p = this.game.player, at = W.islandRoot.worldToLocal(W.position(p)), h = p.heading ?? 0;
    const dir = new THREE.Vector3(-Math.sin(h), 0, -Math.cos(h));
    if (p.root.parent) dir.transformDirection(p.root.parent.matrixWorld);
    dir.transformDirection(new THREE.Matrix4().copy(W.islandRoot.matrixWorld).invert());
    return { x: at.x, z: at.z, heading: dir.x || dir.z ? Math.atan2(-dir.x, -dir.z) : h };
  }
  draw() {
    const narrow = innerWidth <= 700, [cw, ch] = narrow ? MAP.narrowSizePx : MAP.sizePx, dpr = Math.min(2, devicePixelRatio || 1);
    const cv = this.canvas, ctx = this.ctx;
    if (cv.width !== cw * dpr || cv.height !== ch * dpr) { cv.width = cw * dpr; cv.height = ch * dpr; cv.style.width = cw + 'px'; cv.style.height = ch + 'px'; }
    // The view fits inside the mapped area in both directions.
    const b = MAP.bounds, pose = this.playerPose(), widthM = Math.min(MAP.zoomWidthsM[this.zoom], b.x1 - b.x0, (b.z1 - b.z0) * cw / ch);
    const heightM = widthM * ch / cw, pxPerM = cw / widthM;
    // Centre on the player, kept inside the mapped area.
    const clampC = (v, lo, hi, half) => hi - lo <= 2 * half ? (lo + hi) / 2 : THREE.MathUtils.clamp(v, lo + half, hi - half);
    const cx = clampC(pose.x, b.x0, b.x1, widthM / 2), cz = clampC(pose.z, b.z0, b.z1, heightM / 2);
    const toMap = (x, z) => [(x - cx) * pxPerM + cw / 2, (z - cz) * pxPerM + ch / 2];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = `rgb(${MAP.colours.river})`; ctx.fillRect(0, 0, cw, ch);
    if (this.baseReady||this.previousBase) {
      const m = MAP.metresPerPixel;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.baseReady?this.base:this.previousBase, (cx - widthM / 2 - b.x0) / m, (cz - heightM / 2 - b.z0) / m, widthM / m, heightM / m, 0, 0, cw, ch);
    }
    const view = { cx, cz, widthM, pxPerM };
    for (const layer of this.layers) { ctx.save(); try { layer(ctx, toMap, view); } catch (e) { console.warn('minimap layer', e); } ctx.restore(); }
    // Off the map (a body carried away on a drifting island, say) the arrow waits at the edge.
    const edge = 10, [mx, my] = toMap(pose.x, pose.z), px = THREE.MathUtils.clamp(mx, edge, cw - edge), py = THREE.MathUtils.clamp(my, edge, ch - edge);
    const offMap = px !== mx || py !== my;
    ctx.globalAlpha = offMap ? .6 : 1; drawPlayer(ctx, px, py, pose.heading); ctx.globalAlpha = 1;
    this.updateScale(widthM, pxPerM);
    this.lastView = { ...view, heightM, player: [px, py], offMap };
  }
  // A scale bar of a round length about a quarter of the map's width.
  updateScale(widthM, pxPerM) {
    if (this.scaleFor === widthM) return; this.scaleFor = widthM;
    const nice = [10, 20, 50, 100, 200, 500, 1000], len = nice.find(n => n >= widthM / 5) ?? 1000;
    const el = this.el.querySelector('.minimap-scale');
    el.querySelector('i').style.width = Math.round(len * pxPerM) + 'px';
    el.querySelector('span').textContent = len >= 1000 ? `${len / 1000} km` : `${len} m`;
  }
}

// The body the player is in: a gold arrow along its heading (forward is -sin, -cos), on a halo.
function drawPlayer(ctx, x, y, h) {
  const dx = -Math.sin(h), dy = -Math.cos(h);
  ctx.fillStyle = 'rgba(255,214,107,.3)'; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffd66b'; ctx.strokeStyle = '#23392e'; ctx.lineWidth = 1.2; ctx.beginPath();
  ctx.moveTo(x + dx * 7, y + dy * 7); ctx.lineTo(x - dx * 4 - dy * 4.5, y - dy * 4 + dx * 4.5);
  ctx.lineTo(x - dx * 1.5, y - dy * 1.5); ctx.lineTo(x - dx * 4 + dy * 4.5, y - dy * 4 - dx * 4.5);
  ctx.closePath(); ctx.fill(); ctx.stroke();
}
