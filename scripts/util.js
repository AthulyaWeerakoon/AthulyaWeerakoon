// Parse hex color string to [r,g,b] (numbers 0-255)
// Accepts "#fff", "fff", "#ffffff", "ffffff" (case-insensitive)
function codeToHex(colour) {
  if (typeof colour !== "string") throw new TypeError("colour must be a string");
  colour = colour.trim().replace(/^#/, "").toLowerCase();
  if (colour.length === 3) {
    colour = colour.split("").map(c => c + c).join("");
  }
  if (colour.length !== 6 || !/^[0-9a-f]{6}$/.test(colour)) {
    throw new TypeError(`Invalid hex colour: "${colour}"`);
  }
  return [
    parseInt(colour.substring(0, 2), 16),
    parseInt(colour.substring(2, 4), 16),
    parseInt(colour.substring(4, 6), 16)
  ];
}

// Clamp helper
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Convert 0-255 to 2-digit hex (lowercase)
function byteToHex(v) {
  v = Math.round(clamp(v, 0, 255));
  return v.toString(16).padStart(2, "0");
}

// Blend colors by linear interpolation; fraction in [0,1]
function blendColors(color1, color2, fraction) {
  const [r1, g1, b1] = codeToHex(color1);
  const [r2, g2, b2] = codeToHex(color2);

  if (typeof fraction !== "number" || !Number.isFinite(fraction)) {
    throw new TypeError("fraction must be a finite number");
  }
  fraction = clamp(fraction, 0, 1);

  const r = Math.round(r1 + (r2 - r1) * fraction);
  const g = Math.round(g1 + (g2 - g1) * fraction);
  const b = Math.round(b1 + (b2 - b1) * fraction);

  return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
}

function lighten(color, fraction) {
  return blendColors(color, "#ffffff", fraction);
}

function darken(color, fraction) {
  return blendColors(color, "#000000", fraction);
}

// Convert RGB (0..255) to HSL and return hue in degrees [0,360).
function rgbToHueDeg(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  if (delta === 0) {
    throw new EvalError("chosen colour is achromatic: colour undefined");
  }

  let hue;
  if (max === rn) {
    hue = ((gn - bn) / delta) % 6;
  } else if (max === gn) {
    hue = (bn - rn) / delta + 2;
  } else {
    hue = (rn - gn) / delta + 4;
  }

  hue = hue * 60; // to degrees
  if (hue < 0) hue += 360;
  return hue;
}

// Return angle (degrees) for a given hex colour (Red ≈ 0, Green ≈ 120, Blue ≈ 240)
function getAngleFromColour(colour) {
  const [r, g, b] = codeToHex(colour);
  return rgbToHueDeg(r, g, b);
}

// Rotate from sepia angle (30deg) to colour
function angleToRotateFromSepiaToColour(colour) {
  const hue = getAngleFromColour(colour);
  // minimal signed rotation from sepia (30) to hue, in degrees
  // result in range [-180, 180)
  let delta = ((hue - 30 + 180) % 360) - 180;
  return delta;
}

// Filter string for grayscale and recolour
function grayScaleAndRecolourFilter(colour, brightnessPercent) {
  return `grayscale(1) sepia(1) hue-rotate(${angleToRotateFromSepiaToColour(colour)}deg) brightness(${brightnessPercent}%)`;
}

// Get random value based on weight
function weightedRandom(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;

  for (const [key, weight] of Object.entries(weights)) {
    if ((r -= weight) <= 0) return key;
  }
}
