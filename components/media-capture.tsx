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
  uploadVehicleMedia,
  type CloudinaryMedia,
  type MediaStage,
} from "@/lib/cloudinary";

type CameraMode =
  | "photo"
  | null;

export function MediaCapture({
  stage,
  value,
  onChange,
  label = "Vehicle evidence",
  hint = "Capture photos of the vehicle.",
  maxFiles = 20,
}: {
  stage: MediaStage;
  value: CloudinaryMedia[];
  onChange: (
    media: CloudinaryMedia[],
  ) => void;
  label?: string;
  hint?: string;
  maxFiles?: number;
}) {
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

  const [cameraMode, setCameraMode] =
    useState<CameraMode>(null);

  const [cameraError, setCameraError] =
    useState<string>();

  const [uploading, setUploading] =
    useState(false);

  const [uploadError, setUploadError] =
    useState<string>();

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

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

    setCameraMode(null);

    setCameraError(undefined);
  }

  async function openCamera() {
    setCameraError(undefined);
    setUploadError(undefined);

    if (
      value.length >= maxFiles
    ) {
      setUploadError(
        `You can attach up to ${maxFiles} files.`,
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

      /*
       * Keep the camera request deliberately
       * conservative. Mobile browsers, especially
       * Safari, may reject overly-specific constraints.
       */
      const stream =
        await navigator.mediaDevices.getUserMedia(
          {
            video: {
              facingMode: {
                ideal:
                  "environment",
              },

              width: {
                ideal: 1280,
              },

              height: {
                ideal: 720,
              },
            },

            /*
             * Video recording has intentionally
             * been removed from this component.
             */
            audio: false,
          },
        );

      streamRef.current =
        stream;

      setCameraMode("photo");

      /*
       * Wait until the video element has been
       * mounted before assigning the stream.
       */
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
            /*
             * Safari may require another user gesture.
             * The stream itself remains attached.
             */
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
          "Camera permission was denied. Allow camera access in your browser settings and try again.",
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

      if (
        cause instanceof DOMException &&
        (
          cause.name ===
            "NotReadableError" ||
          cause.name ===
            "AbortError"
        )
      ) {
        setCameraError(
          "The camera is currently being used by another application or could not be opened. Close other camera apps and try again.",
        );

        return;
      }

      setCameraError(
        "Unable to open the camera. Check browser permissions and try again.",
      );
    }
  }

  async function uploadBlob(
    blob: Blob,
    filename: string,
  ) {
    setUploadError(undefined);
    setUploading(true);

    try {
      if (
        value.length >= maxFiles
      ) {
        throw new Error(
          `You can attach up to ${maxFiles} files.`,
        );
      }

      const file =
        new File(
          [blob],
          `${filename}.jpg`,
          {
            type:
              "image/jpeg",
          },
        );

      const uploaded =
        await uploadVehicleMedia(
          file,
          stage,
        );

      onChange([
        ...value,
        uploaded,
      ]);
    } catch (cause) {
      setUploadError(
        cause instanceof Error
          ? cause.message
          : "Photo upload failed.",
      );
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

    canvas.width =
      video.videoWidth;

    canvas.height =
      video.videoHeight;

    const context =
      canvas.getContext("2d");

    if (!context) {
      setCameraError(
        "Unable to capture the camera image.",
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
            "Unable to create the photo.",
          );

          return;
        }

        closeCamera();

        await uploadBlob(
          blob,
          `vehicle-${stage}-photo-${Date.now()}`,
        );
      },
      "image/jpeg",
      0.92,
    );
  }

  async function handleFiles(
    files: FileList | null,
  ) {
    if (!files?.length) {
      return;
    }

    setUploadError(undefined);
    setUploading(true);

    try {
      const remaining =
        Math.max(
          0,
          maxFiles -
            value.length,
        );

      if (!remaining) {
        throw new Error(
          `You can attach up to ${maxFiles} files.`,
        );
      }

      const selected =
        Array.from(
          files,
        )
          .filter((file) =>
            file.type.startsWith(
              "image/",
            ),
          )
          .slice(
            0,
            remaining,
          );

      if (!selected.length) {
        throw new Error(
          "Please select image files only.",
        );
      }

      const uploaded: CloudinaryMedia[] =
        [];

      for (
        const file of selected
      ) {
        uploaded.push(
          await uploadVehicleMedia(
            file,
            stage,
          ),
        );
      }

      onChange([
        ...value,
        ...uploaded,
      ]);
    } catch (cause) {
      setUploadError(
        cause instanceof Error
          ? cause.message
          : "Photo upload failed.",
      );
    } finally {
      setUploading(false);

      if (
        fileInputRef.current
      ) {
        fileInputRef.current.value =
          "";
      }
    }
  }

  return (
    <>
      <div className="media-capture">
        <div className="media-capture-heading">
          <div>
            <label className="media-label">
              {label}
            </label>

            <p className="media-hint">
              {hint}
            </p>
          </div>

          <span className="media-count">
            {value.length}/{maxFiles}
          </span>
        </div>

        <div className="media-actions">
          <button
            className="button button-secondary compact"
            type="button"
            disabled={
              uploading ||
              value.length >=
                maxFiles
            }
            onClick={() =>
              void openCamera()
            }
          >
            <Camera
              size={16}
            />
            Take photo
          </button>

          <button
            className="button button-secondary compact"
            type="button"
            disabled={
              uploading ||
              value.length >=
                maxFiles
            }
            onClick={() =>
              fileInputRef.current?.click()
            }
          >
            <ImagePlus
              size={16}
            />
            Choose photos
          </button>
        </div>

        <input
          ref={fileInputRef}
          className="media-input"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) =>
            void handleFiles(
              event.target.files,
            )
          }
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
            Uploading photo...
          </div>
        )}

        {value.length > 0 && (
          <div className="media-list">
            {value.map(
              (media) => (
                <div
                  className="media-item"
                  key={`${media.publicId}-${media.url}`}
                >
                  {/*
                   * Historical videos remain renderable so existing
                   * records are not broken. New uploads are image-only.
                   */}
                  {media.resourceType ===
                  "video" ? (
                    <video
                      src={
                        media.url
                      }
                      controls
                      preload="metadata"
                      playsInline
                    />
                  ) : (
                    <img
                      src={
                        media.url
                      }
                      alt={
                        media.originalFilename
                      }
                      loading="lazy"
                    />
                  )}

                  <div className="media-item-footer">
                    <span
                      title={
                        media.originalFilename
                      }
                    >
                      {
                        media.originalFilename
                      }
                    </span>

                    <button
                      className="icon-button media-remove"
                      type="button"
                      aria-label={`Remove ${media.originalFilename}`}
                      onClick={() =>
                        onChange(
                          value.filter(
                            (item) =>
                              item.url !==
                              media.url,
                          ),
                        )
                      }
                    >
                      <X
                        size={15}
                      />
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {cameraMode && (
        <div
          className="camera-modal-backdrop"
          role="presentation"
        >
          <section
            className="camera-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Take vehicle photo"
          >
            <header className="camera-modal-header">
              <div>
                <span>
                  PHOTO CAPTURE
                </span>

                <h3>
                  Capture vehicle photo
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
                aria-label="Capture photo"
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
              Position the vehicle
              inside the frame and
              press the camera button.
            </div>
          </section>
        </div>
      )}
    </>
  );
}