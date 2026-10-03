import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  uploadCustomerDocument,
  uploadVehicleMedia,
} from "../../lib/cloudinary";

/*
 * The upload runs straight from the browser against
 * Cloudinary's unsigned upload endpoint, so these tests hold
 * the contract at that boundary: what is sent, what is
 * accepted back, and what is refused before a request is
 * made at all.
 */
const CLOUD_NAME = "fleetdesk-test";
const UPLOAD_PRESET = "unsigned-workspace";

function file(options: {
  type: string;
  size: number;
  name?: string;
}): File {
  const created = new File(
    [new Uint8Array(1)],
    options.name ?? "photo.jpg",
    { type: options.type },
  );

  /* Allocating a real ten-megabyte buffer to exercise the
     size guard would slow the suite down for nothing. */
  Object.defineProperty(created, "size", {
    value: options.size,
  });

  return created;
}

function respondWith(
  body: unknown,
  status = 200,
): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
        },
      }),
  ) as unknown as typeof fetch;
}

const successBody = {
  secure_url:
    "https://res.cloudinary.com/fleetdesk-test/image/upload/v1/abc.jpg",
  public_id: "abc",
  resource_type: "image",
  format: "jpg",
  bytes: 2048,
  original_filename: "photo",
  width: 1200,
  height: 800,
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME =
    CLOUD_NAME;

  process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET =
    UPLOAD_PRESET;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Cloudinary configuration", () => {
  it("refuses to upload when the cloud name or preset is missing", async () => {
    delete process.env
      .NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

    await expect(
      uploadVehicleMedia(
        file({
          type: "image/jpeg",
          size: 1024,
        }),
        "vehicle",
      ),
    ).rejects.toThrow(
      "Cloudinary is not configured",
    );
  });
});

describe("vehicle media upload", () => {
  it("posts the file to the account's unsigned endpoint and normalises the response", async () => {
    const call = respondWith(successBody);

    vi.stubGlobal("fetch", call);

    const media = await uploadVehicleMedia(
      file({
        type: "image/jpeg",
        size: 2048,
      }),
      "booking",
    );

    expect(media).toEqual({
      url: successBody.secure_url,
      publicId: "abc",
      resourceType: "image",
      format: "jpg",
      bytes: 2048,
      originalFilename: "photo",
      width: 1200,
      height: 800,
    });

    const [url, init] = (
      call as unknown as {
        mock: {
          calls: [string, RequestInit][];
        };
      }
    ).mock.calls[0];

    expect(url).toBe(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`,
    );

    const body = init.body as FormData;

    expect(body.get("upload_preset")).toBe(
      UPLOAD_PRESET,
    );

    expect(body.get("tags")).toBe(
      "fleetdesk,vehicle-evidence,booking",
    );

    /* The unsigned preset is the only credential involved:
       nothing secret may be attached to the request. */
    expect(body.get("api_key")).toBeNull();
    expect(body.get("signature")).toBeNull();
  });

  it("leaves dimensions out entirely when Cloudinary omits them", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({
        ...successBody,
        width: undefined,
        height: undefined,
      }),
    );

    const media = await uploadVehicleMedia(
      file({
        type: "image/png",
        size: 2048,
      }),
      "return",
    );

    /* Firestore rejects a document containing undefined
       anywhere, so the keys must be absent, not undefined. */
    expect("width" in media).toBe(false);
    expect("height" in media).toBe(false);
  });

  it("rejects a file that is not an image before any request is made", async () => {
    const call = respondWith(successBody);

    vi.stubGlobal("fetch", call);

    await expect(
      uploadVehicleMedia(
        file({
          type: "application/pdf",
          size: 1024,
          name: "manual.pdf",
        }),
        "vehicle",
      ),
    ).rejects.toThrow(
      "Only image files can be uploaded.",
    );

    expect(call).not.toHaveBeenCalled();
  });

  it("rejects an empty or oversized image", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith(successBody),
    );

    await expect(
      uploadVehicleMedia(
        file({ type: "image/jpeg", size: 0 }),
        "vehicle",
      ),
    ).rejects.toThrow("10 MB or smaller");

    await expect(
      uploadVehicleMedia(
        file({
          type: "image/jpeg",
          size: 11 * 1024 * 1024,
        }),
        "vehicle",
      ),
    ).rejects.toThrow("10 MB or smaller");
  });

  it("surfaces the message Cloudinary returns on a rejected upload", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith(
        {
          error: {
            message:
              "Upload preset must be whitelisted for unsigned uploads",
          },
        },
        400,
      ),
    );

    await expect(
      uploadVehicleMedia(
        file({
          type: "image/jpeg",
          size: 2048,
        }),
        "vehicle",
      ),
    ).rejects.toThrow(
      "Upload preset must be whitelisted",
    );
  });

  it("refuses a response that is not an image", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({
        ...successBody,
        resource_type: "raw",
      }),
    );

    await expect(
      uploadVehicleMedia(
        file({
          type: "image/jpeg",
          size: 2048,
        }),
        "vehicle",
      ),
    ).rejects.toThrow(
      "unsupported media type",
    );
  });
});

describe("customer licence upload", () => {
  it("tags the image with the customer it belongs to", async () => {
    const call = respondWith(successBody);

    vi.stubGlobal("fetch", call);

    const media = await uploadCustomerDocument(
      file({
        type: "image/webp",
        size: 4096,
        name: "licence.webp",
      }),
      "customer_123",
    );

    expect(media.publicId).toBe("abc");

    const [url, init] = (
      call as unknown as {
        mock: {
          calls: [string, RequestInit][];
        };
      }
    ).mock.calls[0];

    expect(url).toBe(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    );

    expect(
      (init.body as FormData).get("tags"),
    ).toBe(
      "fleetdesk,customer-document,customer-customer_123",
    );
  });

  it("accepts only JPEG, PNG and WebP", async () => {
    const call = respondWith(successBody);

    vi.stubGlobal("fetch", call);

    for (const type of [
      "image/gif",
      "application/pdf",
      "image/svg+xml",
    ]) {
      await expect(
        uploadCustomerDocument(
          file({ type, size: 4096 }),
          "customer_123",
        ),
      ).rejects.toThrow(
        "JPEG, PNG or WebP",
      );
    }

    expect(call).not.toHaveBeenCalled();
  });

  it("rejects a licence photo above five megabytes", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith(successBody),
    );

    await expect(
      uploadCustomerDocument(
        file({
          type: "image/jpeg",
          size: 6 * 1024 * 1024,
        }),
        "customer_123",
      ),
    ).rejects.toThrow("5 MB or smaller");
  });

  it("reports a failed licence upload rather than storing a broken reference", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith(
        { error: { message: "Rate limited" } },
        429,
      ),
    );

    await expect(
      uploadCustomerDocument(
        file({
          type: "image/png",
          size: 4096,
        }),
        "customer_123",
      ),
    ).rejects.toThrow("Rate limited");
  });
});
