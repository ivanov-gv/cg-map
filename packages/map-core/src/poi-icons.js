// Category symbols drawn at runtime: the style has no sprite, and this keeps every icon a local asset.
const iconPixelRatio = 2;
const iconSizePixels = 22;
const iconBorderInsetPixels = 1.5;
const iconBorderWidthPixels = 2;
const glyphStrokeWidthPixels = 1.6;
const sharedIconColor = '#193f36';
const fallbackIconColor = '#5f6f7d';
const glyphColor = '#ffffff';
const sharedCategory = 'shared';
const otherCategory = 'other';
const glyphs = {
  food(context) {
    // cup
    context.fillRect(-4, -3, 7, 7);
    context.beginPath();
    context.arc(4, 0.5, 2.2, -Math.PI / 2, Math.PI / 2);
    context.stroke();
  },
  sights(context) {
    // star
    context.beginPath();
    for (let vertexIndex = 0; vertexIndex < 10; vertexIndex++) {
      const radius = vertexIndex % 2 ? 2.4 : 5.6;
      const angle = -Math.PI / 2 + (vertexIndex * Math.PI) / 5;
      context.lineTo(radius * Math.cos(angle), radius * Math.sin(angle));
    }
    context.closePath();
    context.fill();
  },
  shops(context) {
    // bag
    context.fillRect(-4.5, -1.5, 9, 6.5);
    context.beginPath();
    context.arc(0, -1.5, 2.6, Math.PI, 0);
    context.stroke();
  },
  stay(context) {
    // bed
    context.fillRect(-5, 0, 10, 3);
    context.fillRect(-5, -3.5, 3, 3.5);
    context.fillRect(-5, 3, 1.4, 2);
    context.fillRect(3.6, 3, 1.4, 2);
  },
  essentials(context) {
    // plus
    context.fillRect(-1.5, -5, 3, 10);
    context.fillRect(-5, -1.5, 10, 3);
  }
};

export const sharedPlaceIcon = 'place-shared';
// Unknown categories keep a visible fallback symbol.
export function placeIconId(category) {
  return 'place-' + (Object.hasOwn(glyphs, category) ? category : otherCategory);
}

// Returns a data URL per category so the map key can show the same symbols.
export function installPlaceIcons(map, colors) {
  const urls = {};
  for (const category of [...Object.keys(glyphs), otherCategory, sharedCategory]) {
    const canvas = document.createElement('canvas');
    canvas.width = iconSizePixels * iconPixelRatio;
    canvas.height = iconSizePixels * iconPixelRatio;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable; place symbols cannot be drawn.');
    context.scale(iconPixelRatio, iconPixelRatio);
    context.translate(iconSizePixels / 2, iconSizePixels / 2);
    context.beginPath();
    context.arc(0, 0, iconSizePixels / 2 - iconBorderInsetPixels, 0, 2 * Math.PI);
    context.fillStyle = category === sharedCategory ? sharedIconColor : (colors[category] ?? fallbackIconColor);
    context.fill();
    context.lineWidth = iconBorderWidthPixels;
    context.strokeStyle = glyphColor;
    context.stroke();
    context.fillStyle = glyphColor;
    context.lineWidth = glyphStrokeWidthPixels;
    glyphs[category]?.(context);
    if (category === otherCategory) {
      context.beginPath();
      context.arc(0, 0, 2.5, 0, 2 * Math.PI);
      context.fill();
    }
    map.addImage(
      category === sharedCategory ? sharedPlaceIcon : placeIconId(category),
      context.getImageData(0, 0, canvas.width, canvas.height),
      {pixelRatio: iconPixelRatio}
    );
    urls[category] = canvas.toDataURL();
  }
  return urls;
}
