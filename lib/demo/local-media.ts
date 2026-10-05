import type { CloudinaryMedia } from "@/lib/cloudinary";

/*
 * The demo keeps photographs on the device instead of uploading
 * them: each image is scaled down and stored inline as a JPEG
 * data URL, small enough that a few dozen hires fit comfortably
 * in the browser's storage, and shaped exactly like the record a
 * Cloudinary upload returns so every screen shows it unchanged.
 */

const MAX_EDGE = 1280;
const QUALITY = 0.72;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image could not be read."));
    };

    image.src = url;
  });
}

export async function storeDemoImage(
  file: File,
): Promise<CloudinaryMedia> {
  const image = await loadImage(file);

  const scale = Math.min(
    1,
    MAX_EDGE /
      Math.max(image.naturalWidth, image.naturalHeight),
  );

  const width = Math.max(
    1,
    Math.round(image.naturalWidth * scale),
  );
  const height = Math.max(
    1,
    Math.round(image.naturalHeight * scale),
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("This browser cannot process images.");
  }

  context.drawImage(image, 0, 0, width, height);

  const url = canvas.toDataURL("image/jpeg", QUALITY);

  return {
    url,
    publicId: `demo/${globalThis.crypto.randomUUID()}`,
    resourceType: "image",
    format: "jpg",
    bytes: Math.round((url.length * 3) / 4),
    originalFilename: file.name,
    width,
    height,
  };
}

/*
 * Media that can be shown as-is: an uploaded https URL, or a
 * demo image stored inline. Anything else is a legacy Firebase
 * Storage path that has to be resolved first.
 */
export function isDirectMediaUrl(
  value: string | null | undefined,
): boolean {
  return Boolean(
    value &&
      (value.startsWith("https://") ||
        value.startsWith("data:image/")),
  );
}
