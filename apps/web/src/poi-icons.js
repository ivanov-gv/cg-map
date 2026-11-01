// Category symbols drawn at runtime: the style has no sprite, and this keeps every icon a local asset.
const RATIO = 2, SIZE = 22;
const glyphs = {
  food(c) { // cup
    c.fillRect(-4, -3, 7, 7); c.beginPath(); c.arc(4, 0.5, 2.2, -Math.PI / 2, Math.PI / 2); c.stroke();
  },
  sights(c) { // star
    c.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 2.4 : 5.6, a = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(r * Math.cos(a), r * Math.sin(a)); }
    c.closePath(); c.fill();
  },
  shops(c) { // bag
    c.fillRect(-4.5, -1.5, 9, 6.5); c.beginPath(); c.arc(0, -1.5, 2.6, Math.PI, 0); c.stroke();
  },
  stay(c) { // bed
    c.fillRect(-5, 0, 10, 3); c.fillRect(-5, -3.5, 3, 3.5); c.fillRect(-5, 3, 1.4, 2); c.fillRect(3.6, 3, 1.4, 2);
  },
  essentials(c) { // plus
    c.fillRect(-1.5, -5, 3, 10); c.fillRect(-5, -1.5, 10, 3);
  }
};

export function placeIconId(category) { return 'place-' + (Object.hasOwn(glyphs, category) ? category : 'other'); }

// Returns a data URL per category so the map key can show the same symbols.
export function installPlaceIcons(map, colors) {
  const urls = {};
  for (const category of [...Object.keys(glyphs), 'other']) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE * RATIO;
    const c = canvas.getContext('2d');
    if (!c) throw new Error('Canvas 2D is unavailable; place symbols cannot be drawn.');
    c.scale(RATIO, RATIO); c.translate(SIZE / 2, SIZE / 2);
    c.beginPath(); c.arc(0, 0, SIZE / 2 - 1.5, 0, 2 * Math.PI);
    c.fillStyle = colors[category] ?? '#5f6f7d'; c.fill();
    c.lineWidth = 2; c.strokeStyle = '#ffffff'; c.stroke();
    c.fillStyle = c.strokeStyle = '#ffffff'; c.lineWidth = 1.6;
    glyphs[category]?.(c);
    if (!glyphs[category]) { c.beginPath(); c.arc(0, 0, 2.5, 0, 2 * Math.PI); c.fill(); }
    map.addImage(placeIconId(category), c.getImageData(0, 0, canvas.width, canvas.height), {pixelRatio: RATIO});
    urls[category] = canvas.toDataURL();
  }
  return urls;
}
