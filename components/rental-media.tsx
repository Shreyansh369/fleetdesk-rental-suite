"use client";

import {
  getDownloadURL,
  ref,
} from "firebase/storage";

import { ImageOff, X } from "lucide-react";

import {
  useEffect,
  useState,
} from "react";

import { getFirebaseClient } from "@/lib/firebase/client";

import type {
  RentalMediaItem,
} from "@/lib/services/firestore-client";

/*
 * The photographs filed against a rental, shown beside the
 * agreement rather than only living in the record.
 *
 * A thumbnail opens full size, because the reason to look at
 * a condition photo is usually to settle an argument about a
 * scratch, and a 120px square cannot do that.
 */

export function MediaGrid({
  items,
  emptyMessage,
}: {
  items: RentalMediaItem[];
  emptyMessage: string;
}) {
  const [openItem, setOpenItem] =
    useState<RentalMediaItem | null>(null);

  useEffect(() => {
    if (!openItem) {
      return;
    }

    function onKeyDown(
      event: KeyboardEvent,
    ) {
      if (event.key === "Escape") {
        setOpenItem(null);
      }
    }

    document.addEventListener(
      "keydown",
      onKeyDown,
    );

    return () =>
      document.removeEventListener(
        "keydown",
        onKeyDown,
      );
  }, [openItem]);

  if (items.length === 0) {
    return (
      <div className="rental-media-empty">
        <ImageOff size={20} />
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <div className="rental-media-grid">
        {items.map((item) => (
          <button
            type="button"
            key={item.publicId}
            className="rental-media-thumb"
            onClick={() =>
              setOpenItem(item)
            }
            title={`Open ${item.originalFilename}`}
          >
            <img
              src={item.url}
              alt={item.originalFilename}
              loading="lazy"
            />
          </button>
        ))}
      </div>

      {openItem && (
        <div
          className="rental-media-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={
            openItem.originalFilename
          }
        >
          <button
            type="button"
            className="rental-media-lightbox-close icon-button"
            onClick={() => setOpenItem(null)}
            aria-label="Close photo"
          >
            <X size={18} />
          </button>

          {/*
            * Clicking the backdrop closes it, which is what
            * anyone who has opened a photo expects.
            */}
          <button
            type="button"
            className="rental-media-lightbox-backdrop"
            aria-label="Close photo"
            onClick={() => setOpenItem(null)}
          />

          <img
            src={openItem.url}
            alt={openItem.originalFilename}
          />
        </div>
      )}
    </>
  );
}

/*
 * The renter's licence image.
 *
 * Licences captured before the move to Cloudinary were stored
 * as Firebase Storage paths rather than URLs, and those
 * records still have to resolve here or the image simply
 * disappears for every customer on file before the change.
 */
export function LicenceImage({
  storagePath,
}: {
  storagePath: string | null;
}) {
  /*
   * Keyed by the path it was resolved for, so a record that
   * changes underneath shows nothing rather than the previous
   * customer's licence while the new one loads. That also
   * keeps the effect free of a reset write on every change.
   */
  const [resolved, setResolved] = useState<{
    path: string;
    url: string | null;
  } | null>(null);

  const direct = Boolean(
    storagePath?.startsWith("https://"),
  );

  useEffect(() => {
    if (!storagePath || direct) {
      return;
    }

    let cancelled = false;

    async function resolve() {
      const path = storagePath as string;

      try {
        const { storage } =
          getFirebaseClient();

        const url = await getDownloadURL(
          ref(storage, path),
        );

        if (!cancelled) {
          setResolved({ path, url });
        }
      } catch {
        if (!cancelled) {
          setResolved({
            path,
            url: null,
          });
        }
      }
    }

    void resolve();

    return () => {
      cancelled = true;
    };
  }, [storagePath, direct]);

  if (!storagePath) {
    return (
      <div className="rental-media-empty">
        <ImageOff size={20} />

        <p>
          No licence photo is on file for this
          customer. It can be captured from
          their record on the Customers screen.
        </p>
      </div>
    );
  }

  const settled = direct
    ? { path: storagePath, url: storagePath }
    : resolved?.path === storagePath
      ? resolved
      : null;

  if (!settled) {
    return (
      <div
        className="inline-empty"
        role="status"
        aria-live="polite"
      >
        Loading licence photo…
      </div>
    );
  }

  if (!settled.url) {
    return (
      <div className="rental-media-empty">
        <ImageOff size={20} />

        <p>
          The licence photo could not be
          loaded.
        </p>
      </div>
    );
  }

  return (
    <MediaGrid
      items={[
        {
          url: settled.url,
          publicId: "licence",
          originalFilename:
            "Driver's licence",
          format: "",
        },
      ]}
      emptyMessage="No licence photo is on file."
    />
  );
}
