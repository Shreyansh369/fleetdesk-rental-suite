"use client";

import { Eraser } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

const CANVAS_HEIGHT = 220;
const STROKE_WIDTH = 2.2;

export function CustomerSignaturePad({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(Boolean(value));

  /*
   * The last image this pad put on screen. Finishing a stroke
   * reports a new data URL upwards, which comes straight back
   * in as `value`; without this the canvas would be torn down
   * and rebuilt after every stroke, flashing white and losing
   * anything drawn while the replacement image loaded.
   */
  const renderedRef = useRef<string | null>(value);

  const widthRef = useRef(0);

  const configureCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const cssWidth = Math.max(
      320,
      Math.floor(canvas.getBoundingClientRect().width),
    );
    const cssHeight = CANVAS_HEIGHT;
    const dpr = Math.max(
      1,
      window.devicePixelRatio || 1,
    );

    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);

    canvas.style.width = "100%";
    canvas.style.height = `${cssHeight}px`;

    const context = canvas.getContext("2d");
    if (!context) return null;

    /*
     * The transform handles device-pixel-ratio scaling.
     * Therefore lineWidth must remain in CSS pixels and
     * must NOT be multiplied by dpr again.
     */
    context.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0,
    );

    context.fillStyle = "#ffffff";
    context.fillRect(
      0,
      0,
      cssWidth,
      cssHeight,
    );

    context.strokeStyle = "#111827";
    context.lineWidth = STROKE_WIDTH;
    context.lineCap = "round";
    context.lineJoin = "round";

    return {
      context,
      cssWidth,
      cssHeight,
    };
  }, []);

  const redrawValue = useCallback(
    (nextValue: string | null) => {
      const configured =
        configureCanvas();

      if (!configured) return;

      const {
        context,
        cssWidth,
        cssHeight,
      } = configured;

      if (!nextValue) {
        hasStrokeRef.current = false;
        return;
      }

      const image = new Image();

      image.onload = () => {
        /*
         * Draw using CSS dimensions because the context
         * transform already accounts for device pixels.
         */
        context.drawImage(
          image,
          0,
          0,
          cssWidth,
          cssHeight,
        );

        hasStrokeRef.current = true;

        context.strokeStyle = "#111827";
        context.lineWidth = STROKE_WIDTH;
        context.lineCap = "round";
        context.lineJoin = "round";
      };

      image.src = nextValue;
    },
    [configureCanvas],
  );

  useEffect(() => {
    if (
      value !== renderedRef.current
    ) {
      renderedRef.current = value;
      redrawValue(value);
    }
  }, [redrawValue, value]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    widthRef.current = Math.floor(
      canvas.getBoundingClientRect().width,
    );

    redrawValue(renderedRef.current);

    /*
     * Only a genuine width change rebuilds the backing store.
     * Reconfiguring on every observer callback would reset the
     * canvas while the customer is still signing.
     */
    const resizeObserver =
      new ResizeObserver((entries) => {
        const width = Math.floor(
          entries[0]?.contentRect.width ?? 0,
        );

        if (
          width === widthRef.current ||
          drawingRef.current
        ) {
          return;
        }

        widthRef.current = width;
        redrawValue(renderedRef.current);
      });

    resizeObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
    };
  }, [redrawValue]);

  function position(
    event: React.PointerEvent<HTMLCanvasElement>,
  ) {
    const canvas = canvasRef.current;

    if (!canvas) {
      return {
        x: 0,
        y: 0,
      };
    }

    const rect =
      canvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function start(
    event: React.PointerEvent<HTMLCanvasElement>,
  ) {
    if (disabled) return;

    const canvas =
      canvasRef.current;

    const context =
      canvas?.getContext("2d");

    if (!canvas || !context) return;

    event.currentTarget.setPointerCapture(
      event.pointerId,
    );

    const point = position(event);

    /*
     * Re-establish drawing properties so they cannot
     * become contaminated by image restoration or
     * another canvas operation.
     */
    context.strokeStyle = "#111827";
    context.lineWidth = STROKE_WIDTH;
    context.lineCap = "round";
    context.lineJoin = "round";

    context.beginPath();
    context.moveTo(
      point.x,
      point.y,
    );

    drawingRef.current = true;
  }

  function move(
    event: React.PointerEvent<HTMLCanvasElement>,
  ) {
    if (
      !drawingRef.current ||
      disabled
    ) {
      return;
    }

    const canvas =
      canvasRef.current;

    const context =
      canvas?.getContext("2d");

    if (!canvas || !context) return;

    const point = position(event);

    context.lineTo(
      point.x,
      point.y,
    );

    context.stroke();

    hasStrokeRef.current = true;
  }

  function end(
    event?: React.PointerEvent<HTMLCanvasElement>,
  ) {
    if (!drawingRef.current) return;

    drawingRef.current = false;

    if (event) {
      try {
        event.currentTarget.releasePointerCapture(
          event.pointerId,
        );
      } catch {
        // Pointer capture may already have been released.
      }
    }

    const canvas =
      canvasRef.current;

    if (!canvas) return;

    const next =
      hasStrokeRef.current
        ? canvas.toDataURL("image/png")
        : null;

    renderedRef.current = next;

    onChange(next);
  }

  function clear() {
    const canvas =
      canvasRef.current;

    const context =
      canvas?.getContext("2d");

    if (
      !canvas ||
      !context ||
      disabled
    ) {
      return;
    }

    const rect =
      canvas.getBoundingClientRect();

    const dpr = Math.max(
      1,
      window.devicePixelRatio || 1,
    );

    context.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0,
    );

    context.fillStyle = "#ffffff";
    context.fillRect(
      0,
      0,
      rect.width,
      rect.height,
    );

    context.strokeStyle = "#111827";
    context.lineWidth = STROKE_WIDTH;
    context.lineCap = "round";
    context.lineJoin = "round";

    hasStrokeRef.current = false;
    drawingRef.current = false;
    renderedRef.current = null;

    onChange(null);
  }

  return (
    <div
      className="field full"
      style={{
        display: "grid",
        gap: "10px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
        }}
      >
        <div>
          <label htmlFor="customer-signature">
            Customer signature
          </label>

          <p>
            Have the customer sign on the
            device before confirming the
            booking.
          </p>
        </div>

        <button
          className="text-button"
          type="button"
          onClick={clear}
          disabled={disabled}
        >
          <Eraser size={15} />
          Clear
        </button>
      </div>

      <div
        style={{
          position: "relative",
          border: "1px solid #d7dde8",
          borderRadius: "14px",
          overflow: "hidden",
          background: "#fff",
        }}
      >
        <canvas
          id="customer-signature"
          ref={canvasRef}
          className="signature-pad-canvas"
          style={{
            display: "block",
            width: "100%",
            height: `${CANVAS_HEIGHT}px`,
            touchAction: "none",
            cursor: disabled
              ? "not-allowed"
              : "crosshair",
          }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={() => end()}
          aria-label="Customer signature"
        />

        <div
          style={{
            position: "absolute",
            left: "24px",
            right: "24px",
            bottom: "34px",
            borderBottom:
              "1px solid #9aa4b2",
            pointerEvents: "none",
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}