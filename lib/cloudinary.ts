export type CloudinaryMedia = {
  url: string;
  publicId: string;
  resourceType: "image" | "video";
  format: string;
  bytes: number;
  originalFilename: string;
  width?: number;
  height?: number;
  duration?: number;
};

const MAX_IMAGE_BYTES =
  10 * 1024 * 1024;

/*
 * Cloudinary omits dimensions for some responses. Firestore
 * rejects a document containing undefined anywhere, including
 * inside a nested media object, so an absent value is left out
 * of the record rather than carried through as undefined.
 */
function withOptionalDimensions(
  media: Omit<
    CloudinaryMedia,
    "width" | "height" | "duration"
  >,
  source: {
    width?: number;
    height?: number;
    duration?: number;
  },
): CloudinaryMedia {
  return {
    ...media,

    ...(typeof source.width === "number"
      ? { width: source.width }
      : {}),

    ...(typeof source.height === "number"
      ? { height: source.height }
      : {}),

    ...(typeof source.duration === "number"
      ? { duration: source.duration }
      : {}),
  };
}

function cloudinaryConfig() {
  const cloudName =
    process.env
      .NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

  const uploadPreset =
    process.env
      .NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error(
      "Cloudinary is not configured. Set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET.",
    );
  }

  return {
    cloudName,
    uploadPreset,
  };
}

const MAX_DOCUMENT_BYTES =
  5 * 1024 * 1024;

const DOCUMENT_TYPES =
  /^image\/(jpeg|png|webp)$/;

export type MediaStage =
  | "booking"
  | "return"
  | "vehicle";

export async function uploadVehicleMedia(
  file: File,
  stage: MediaStage,
): Promise<CloudinaryMedia> {
  const {
    cloudName,
    uploadPreset,
  } = cloudinaryConfig();

  if (!file.type.startsWith("image/")) {
    throw new Error(
      "Only image files can be uploaded.",
    );
  }

  if (
    file.size <= 0 ||
    file.size > MAX_IMAGE_BYTES
  ) {
    throw new Error(
      "Each image must be 10 MB or smaller.",
    );
  }

  const payload = new FormData();

  payload.append(
    "file",
    file,
  );

  payload.append(
    "upload_preset",
    uploadPreset,
  );

  payload.append(
    "tags",
    `fleetdesk,vehicle-evidence,${stage}`,
  );

  const uploadUrl =
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(
      cloudName,
    )}/auto/upload`;

  const response = await fetch(
    uploadUrl,
    {
      method: "POST",
      body: payload,
    },
  );

  const data =
    (await response.json()) as {
      secure_url?: string;
      public_id?: string;
      resource_type?: string;
      format?: string;
      bytes?: number;
      original_filename?: string;
      width?: number;
      height?: number;
      duration?: number;
      error?: {
        message?: string;
      };
    };

  if (
    !response.ok ||
    !data.secure_url ||
    !data.public_id
  ) {
    throw new Error(
      data.error?.message ||
        "Cloudinary could not upload the media file.",
    );
  }

  if (data.resource_type !== "image") {
    throw new Error(
      "Cloudinary returned an unsupported media type.",
    );
  }

  return withOptionalDimensions(
    {
      url: data.secure_url,

      publicId:
        data.public_id,

      resourceType:
        data.resource_type,

      format:
        data.format ||
        file.type.split("/")[1] ||
        "unknown",

      bytes:
        data.bytes ??
        file.size,

      originalFilename:
        data.original_filename ||
        file.name,
    },
    data,
  );
}
/**
 * Uploads a customer identity document.
 *
 * The rental workspace has no server of its own, so the image
 * goes straight to Cloudinary with the same unsigned preset the
 * vehicle photos use. Only the returned URL is written to
 * Firestore, where the security rules already restrict customer
 * records to approved staff.
 *
 * The checks below bind this application, not the endpoint: the
 * preset is unsigned and its name ships in the bundle, so the
 * same limits have to be set on the preset itself in Cloudinary.
 * See docs/security.md.
 */
export async function uploadCustomerDocument(
  file: File,
  customerId: string,
): Promise<CloudinaryMedia> {
  const {
    cloudName,
    uploadPreset,
  } = cloudinaryConfig();

  if (
    !DOCUMENT_TYPES.test(file.type)
  ) {
    throw new Error(
      "Licence photo must be a JPEG, PNG or WebP image.",
    );
  }

  if (
    file.size <= 0 ||
    file.size > MAX_DOCUMENT_BYTES
  ) {
    throw new Error(
      "Licence photo must be 5 MB or smaller.",
    );
  }

  const payload = new FormData();

  payload.append(
    "file",
    file,
  );

  payload.append(
    "upload_preset",
    uploadPreset,
  );

  payload.append(
    "tags",
    `fleetdesk,customer-document,customer-${customerId}`,
  );

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(
      cloudName,
    )}/image/upload`,
    {
      method: "POST",
      body: payload,
    },
  );

  const data =
    (await response.json()) as {
      secure_url?: string;
      public_id?: string;
      resource_type?: string;
      format?: string;
      bytes?: number;
      original_filename?: string;
      width?: number;
      height?: number;
      error?: {
        message?: string;
      };
    };

  if (
    !response.ok ||
    !data.secure_url ||
    !data.public_id ||
    data.resource_type !== "image"
  ) {
    throw new Error(
      data.error?.message ||
        "Cloudinary could not upload the licence photo.",
    );
  }

  return withOptionalDimensions(
    {
      url: data.secure_url,

      publicId:
        data.public_id,

      resourceType: "image",

      format:
        data.format ||
        file.type.split("/")[1] ||
        "unknown",

      bytes:
        data.bytes ?? file.size,

      originalFilename:
        data.original_filename ||
        file.name,
    },
    data,
  );
}
