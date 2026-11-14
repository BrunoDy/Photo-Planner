// Zet de rasterverwachting (bewolking + neerslag) om in een vloeiende afbeelding:
// elk rasterpunt wordt één pixel, de browser vergroot dat met bilineaire interpolatie
// en de afbeelding wordt bijgesneden tot de grens van België.

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** RGBA voor één punt. Neerslag (mm/u) gaat voor op bewolking (%). */
export function pixelColor(cc, pr) {
  if (pr != null && pr >= 0.1) {
    if (pr < 1) return [110, 175, 255, Math.round(255 * (0.5 + 0.2 * pr))];
    if (pr < 4) return [40, 110, 240, Math.round(255 * 0.78)];
    if (pr < 8) return [25, 50, 200, Math.round(255 * 0.85)];
    return [150, 40, 200, Math.round(255 * 0.88)];
  }
  const a = clamp01(((cc ?? 0) - 10) / 90) * 0.72;
  return [232, 236, 242, Math.round(255 * a)];
}

/**
 * @param {{lats:number[], lons:number[], dLat:number, dLon:number}} grid rij-index = breedte (zuid → noord)
 * @param {{cc:number[], pr:number[]}[]} cells per punt, volgorde: rij voor rij
 * @param {number} idx uur-index
 * @param {[number, number][]} clip omtrek [lat, lon] om bij te snijden
 * @returns {{url: string, bounds: [[number, number], [number, number]]}}
 */
export function renderField(grid, cells, idx, clip, scale = 24) {
  const W = grid.lons.length;
  const H = grid.lats.length;
  const small = document.createElement('canvas');
  small.width = W;
  small.height = H;
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(W, H);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const d = cells[r * W + c];
      const px = d ? pixelColor(d.cc[idx], d.pr[idx]) : [0, 0, 0, 0];
      const o = ((H - 1 - r) * W + c) * 4; // canvas: bovenaan = noord
      img.data.set(px, o);
    }
  }
  sctx.putImageData(img, 0, 0);

  const south = grid.lats[0] - grid.dLat / 2;
  const north = grid.lats[H - 1] + grid.dLat / 2;
  const west = grid.lons[0] - grid.dLon / 2;
  const east = grid.lons[W - 1] + grid.dLon / 2;
  const big = document.createElement('canvas');
  big.width = W * scale;
  big.height = H * scale;
  const ctx = big.getContext('2d');
  if (clip) {
    ctx.beginPath();
    clip.forEach(([lat, lon], i) => {
      const x = ((lon - west) / (east - west)) * big.width;
      const y = ((north - lat) / (north - south)) * big.height;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.clip();
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, big.width, big.height);
  return { url: big.toDataURL('image/png'), bounds: [[south, west], [north, east]] };
}
