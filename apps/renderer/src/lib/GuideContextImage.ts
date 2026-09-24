import {
  MAX_GUIDE_CONTEXT_IMAGE_BYTES,
  MAX_GUIDE_CONTEXT_IMAGE_DIMENSION,
  type GuideContextItem,
} from "@path/shared";

/** Normalize supported raster images to bounded PNG context for every model provider. */
export async function readGuideContextImage(file: File): Promise<GuideContextItem> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > MAX_GUIDE_CONTEXT_IMAGE_BYTES
  ) {
    throw new Error("Unsupported context image");
  }

  const image = await createImageBitmap(file);

  try {
    const scale = Math.min(
      1,
      MAX_GUIDE_CONTEXT_IMAGE_DIMENSION / Math.max(image.width, image.height),
    );

    const canvas = document.createElement("canvas");

    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const drawing = canvas.getContext("2d");

    if (!drawing) throw new Error("Image conversion unavailable");

    drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");

    if (dataUrl.length > Math.ceil(MAX_GUIDE_CONTEXT_IMAGE_BYTES / 3) * 4 + 22) {
      throw new Error("Converted image exceeds context limit");
    }

    return { kind: "image", name: file.name.slice(0, 255) || "Image", dataUrl };
  } finally {
    image.close();
  }
}
