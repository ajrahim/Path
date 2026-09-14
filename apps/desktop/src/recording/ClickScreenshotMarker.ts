import { PNG } from "pngjs";

interface MarkerColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

const CLICK_RED: MarkerColor = { red: 220, green: 54, blue: 46, alpha: 0.95 };
const CLICK_TINT: MarkerColor = { red: 220, green: 54, blue: 46, alpha: 0.2 };
const CLICK_WHITE: MarkerColor = { red: 255, green: 255, blue: 255, alpha: 0.92 };

export function addClickMarker(
  pngBuffer: Buffer,
  normalizedX: number,
  normalizedY: number,
): Buffer {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError("Click coordinates must be finite numbers");
  }

  const image = PNG.sync.read(pngBuffer);

  // Normalized edge coordinates map to the last valid pixel, never one pixel outside the image.
  const centerX = Math.round(clamp(normalizedX, 0, 1) * (image.width - 1));
  const centerY = Math.round(clamp(normalizedY, 0, 1) * (image.height - 1));
  const radius = clamp(Math.round(Math.min(image.width, image.height) * 0.018), 12, 28);
  const outerRadius = radius + 3;

  for (
    let y = Math.max(0, centerY - outerRadius);
    y <= Math.min(image.height - 1, centerY + outerRadius);
    y += 1
  ) {
    for (
      let x = Math.max(0, centerX - outerRadius);
      x <= Math.min(image.width - 1, centerX + outerRadius);
      x += 1
    ) {
      const distance = Math.hypot(x - centerX, y - centerY);

      if (distance > outerRadius) continue;

      const color =
        distance <= 3
          ? CLICK_WHITE
          : distance >= radius
            ? CLICK_WHITE
            : distance >= radius - 3
              ? CLICK_RED
              : CLICK_TINT;

      blendPixel(image.data, (image.width * y + x) * 4, color);
    }
  }

  return PNG.sync.write(image);
}

function blendPixel(pixels: Buffer, offset: number, color: MarkerColor): void {
  // Composite the marker over existing alpha so transparent screenshots remain correct.
  const destinationAlpha = pixels.readUInt8(offset + 3) / 255;
  const outputAlpha = color.alpha + destinationAlpha * (1 - color.alpha);

  for (let channel = 0; channel < 3; channel += 1) {
    const source = channel === 0 ? color.red : channel === 1 ? color.green : color.blue;
    const destination = pixels.readUInt8(offset + channel);

    pixels.writeUInt8(
      Math.round(
        (source * color.alpha + destination * destinationAlpha * (1 - color.alpha)) / outputAlpha,
      ),
      offset + channel,
    );
  }

  pixels.writeUInt8(Math.round(outputAlpha * 255), offset + 3);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
