const GUIDE_IMAGE_EVENT = "path:insert-guide-image";

export interface GuideImageDetail {
  dataUrl: string;
  alt: string;
}

/** Dispatches a captured screenshot to the mounted guide editor without shared state. */
export function dispatchGuideImage(dataUrl: string, alt: string): void {
  window.dispatchEvent(
    new CustomEvent<GuideImageDetail>(GUIDE_IMAGE_EVENT, { detail: { dataUrl, alt } }),
  );
}

export function subscribeGuideImages(handler: (image: GuideImageDetail) => void): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<GuideImageDetail>).detail;

    if (detail?.dataUrl) handler(detail);
  };

  window.addEventListener(GUIDE_IMAGE_EVENT, listener);

  return () => window.removeEventListener(GUIDE_IMAGE_EVENT, listener);
}

/** Reads a media-server screenshot into an embeddable data URL for Markdown insertion. */
export async function screenshotUrlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) throw new Error(`Screenshot request failed (${response.status})`);

  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Screenshot could not be read"));
    };

    reader.onerror = reader.onabort = () => reject(new Error("Screenshot could not be read"));

    try {
      reader.readAsDataURL(blob);
    } catch (error) {
      reject(error);
    }
  });
}
