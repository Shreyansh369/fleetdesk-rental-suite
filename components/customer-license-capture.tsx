"use client";

import {
  Camera,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  getDownloadURL,
  ref,
} from "firebase/storage";

import { getFirebaseClient } from "@/lib/firebase/client";
import { uploadCustomerDocument } from "@/lib/cloudinary";

type Props = {
  customerId: string | null;
  value: string | null;
  onChange: (
    storagePath: string | null,
  ) => void;
};

export function CustomerLicenseCapture({
  customerId,
  value,
  onChange,
}: Props) {
  const videoRef =
    useRef<HTMLVideoElement | null>(
      null,
    );

  const streamRef =
    useRef<MediaStream | null>(
      null,
    );

  const fileInputRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  const [cameraOpen, setCameraOpen] =
    useState(false);

  const [cameraError, setCameraError] =
    useState<string>();

  const [uploadError, setUploadError] =
    useState<string>();

  const [uploading, setUploading] =
    useState(false);

  const [previewUrl, setPreviewUrl] =
    useState<string | null>(
      null,
    );

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadExistingPreview() {
      if (!value) {
        setPreviewUrl(null);
        return;
      }

      if (
        value.startsWith("https://")
      ) {
        setPreviewUrl(value);
        return;
      }

      /*
       * Licence images captured before the move to Cloudinary
       * were stored as Firebase Storage paths. Those records
       * still resolve here so nothing disappears.
       */
      try {
        const { storage } =
          getFirebaseClient();

        const url =
          await getDownloadURL(
            ref(storage, value),
          );

        if (!cancelled) {
          setPreviewUrl(url);
        }
      } catch {
        if (!cancelled) {
          setPreviewUrl(null);
        }
      }
    }

    void loadExistingPreview();

    return () => {
      cancelled = true;
    };
  }, [value]);

  function stopCamera() {
    const stream =
      streamRef.current;

    if (stream) {
      stream
        .getTracks()
        .forEach((track) =>
          track.stop(),
        );

      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();

      videoRef.current.srcObject =
        null;
    }
  }

  function closeCamera() {
    stopCamera();

    setCameraOpen(false);

    setCameraError(undefined);
  }

  async function openCamera() {
    setCameraError(undefined);
    setUploadError(undefined);

    if (!customerId) {
      setCameraError(
        "Save the customer before taking a licence photo.",
      );

      return;
    }

    if (
      !navigator.mediaDevices?.getUserMedia
    ) {
      setCameraError(
        "Camera access is not supported by this browser.",
      );

      return;
    }

    try {
      stopCamera();

      const stream =
        await navigator.mediaDevices.getUserMedia(
          {
            video: {
              facingMode: {
                ideal:
                  "environment",
              },

              width: {
                ideal: 1600,
              },

              height: {
                ideal: 1000,
              },
            },

            audio: false,
          },
        );

      streamRef.current =
        stream;

      setCameraOpen(true);

      requestAnimationFrame(() => {
        const video =
          videoRef.current;

        if (!video) {
          return;
        }

        video.srcObject =
          stream;

        video.muted = true;
        video.playsInline = true;

        void video
          .play()
          .catch(() => {
            // Some mobile browsers require
            // an additional user gesture.
          });
      });
    } catch (cause) {
      stopCamera();

      if (
        cause instanceof DOMException &&
        cause.name ===
          "NotAllowedError"
      ) {
        setCameraError(
          "Camera permission was denied. Allow camera access and try again.",
        );

        return;
      }

      if (
        cause instanceof DOMException &&
        cause.name ===
          "NotFoundError"
      ) {
        setCameraError(
          "No camera was found on this device.",
        );

        return;
      }

      setCameraError(
        "Unable to open the camera. Check browser permissions and try again.",
      );
    }
  }

  async function uploadLicensePhoto(
    file: File,
  ): Promise<string | null> {
    if (!customerId) {
      throw new Error(
        "Customer must be saved before uploading the licence.",
      );
    }

    setUploadError(undefined);
    setUploading(true);

    try {
      const uploaded =
        await uploadCustomerDocument(
          file,
          customerId,
        );

      setPreviewUrl(
        uploaded.url,
      );

      onChange(
        uploaded.url,
      );

      return uploaded.url;
    } catch (cause) {
      setUploadError(
        cause instanceof Error
          ? cause.message
          : "Licence photo upload failed.",
      );

      return null;
    } finally {
      setUploading(false);
    }
  }

  async function capturePhoto() {
    const video =
      videoRef.current;

    if (!video) {
      return;
    }

    if (
      !video.videoWidth ||
      !video.videoHeight
    ) {
      setCameraError(
        "Camera is still starting. Try again in a moment.",
      );

      return;
    }

    const canvas =
      document.createElement(
        "canvas",
      );

    /*
     * Keep the original camera proportions.
     * Licence images need enough resolution to
     * remain readable.
     */
    canvas.width =
      video.videoWidth;

    canvas.height =
      video.videoHeight;

    const context =
      canvas.getContext("2d");

    if (!context) {
      setCameraError(
        "Unable to capture the licence image.",
      );

      return;
    }

    context.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          setCameraError(
            "Unable to create the licence photo.",
          );

          return;
        }

        closeCamera();

        const file =
          new File(
            [blob],
            `drivers-licence-${Date.now()}.jpg`,
            {
              type:
                "image/jpeg",
            },
          );

        await uploadLicensePhoto(
          file,
        );
      },
      "image/jpeg",
      0.94,
    );
  }

  async function handleFile(
    file: File | null,
  ) {
    if (!file) {
      return;
    }

    const uploadedUrl =
      await uploadLicensePhoto(
        file,
      );

    if (uploadedUrl) {
      setPreviewUrl(
        uploadedUrl,
      );
    }

    if (
      fileInputRef.current
    ) {
      fileInputRef.current.value =
        "";
    }
  }

  return (
    <div className="media-capture">
      <div className="media-capture-heading">
        <div>
          <label className="media-label">
            Driver&apos;s licence
          </label>

          <p className="media-hint">
            Take a clear photo of the
            customer&apos;s driver&apos;s
            licence or choose an existing
            photo.
          </p>
        </div>
      </div>

      <div className="media-actions">
        <button
          className="button button-secondary compact"
          type="button"
          disabled={
            uploading ||
            !customerId
          }
          onClick={() =>
            void openCamera()
          }
        >
          <Camera
            size={16}
          />
          Take ID photo
        </button>

        <button
          className="button button-secondary compact"
          type="button"
          disabled={
            uploading ||
            !customerId
          }
          onClick={() =>
            fileInputRef.current?.click()
          }
        >
          <ImagePlus
            size={16}
          />
          Choose photo
        </button>
      </div>

      <input
        ref={fileInputRef}
        className="media-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          void handleFile(
            event.target.files?.[0] ??
              null,
          );
        }}
      />

      {cameraError && (
        <div
          className="media-error"
          role="alert"
        >
          {cameraError}
        </div>
      )}

      {uploadError && (
        <div
          className="media-error"
          role="alert"
        >
          {uploadError}
        </div>
      )}

      {uploading && (
        <div
          className="media-uploading"
          role="status"
          aria-live="polite"
        >
          <LoaderCircle
            className="spin"
            size={16}
          />
          Uploading licence photo...
        </div>
      )}

      {(previewUrl || value) && (
        <div className="media-list">
          <div className="media-item">
            <img
              src={
                previewUrl ||
                undefined
              }
              alt="Driver's licence"
              loading="lazy"
            />

            <div className="media-item-footer">
              <span>
                Driver&apos;s licence
                photo
              </span>

              <button
                className="icon-button media-remove"
                type="button"
                aria-label="Remove driver's licence photo"
                disabled={uploading}
                onClick={() => {
                  setPreviewUrl(
                    null,
                  );

                  onChange(
                    null,
                  );
                }}
              >
                <X
                  size={15}
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {cameraOpen && (
        <div
          className="camera-modal-backdrop"
          role="presentation"
        >
          <section
            className="camera-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Take driver's licence photo"
          >
            <header className="camera-modal-header">
              <div>
                <span>
                  ID PHOTO
                </span>

                <h3>
                  Capture driver&apos;s
                  licence
                </h3>
              </div>

              <button
                className="icon-button"
                type="button"
                onClick={
                  closeCamera
                }
                aria-label="Close camera"
              >
                <X size={19} />
              </button>
            </header>

            <div className="camera-preview">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
              />
            </div>

            <footer className="camera-controls">
              <button
                className="camera-main-button"
                type="button"
                onClick={() =>
                  void capturePhoto()
                }
                disabled={
                  uploading
                }
                aria-label="Capture driver's licence photo"
              >
                <Camera
                  size={25}
                />
              </button>

              <button
                className="camera-secondary-button"
                type="button"
                onClick={
                  closeCamera
                }
              >
                <RotateCcw
                  size={17}
                />
                Cancel
              </button>
            </footer>

            <div className="camera-help">
              Place the entire licence
              inside the frame. Avoid glare
              and make sure all text is
              readable.
            </div>
          </section>
        </div>
      )}
    </div>
  );
}