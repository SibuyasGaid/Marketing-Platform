"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { editImage, uploadEditMask } from "@/app/(app)/images/actions";
import { Button } from "@/components/ui/Button";

/**
 * Region (mask) editor: the user brushes over the area to change, and only
 * that region is edited. The brush is painted onto a canvas sized to fit the
 * image; on apply it is exported white-on-black as a mask PNG, uploaded, and
 * passed to the edit so the model changes only the marked area.
 */
const MAX_DISPLAY = 460;
const MAX_EXPORT = 1024;
// Mask encoding, not UI colors: the edit API reads white as "change" and black as "keep".
const MASK_PAINT = "#ffffff";
const MASK_KEEP = "#000000";

export function RegionEditModal({
  itemId,
  imageUrl,
  onClose,
  onApplied,
}: {
  itemId: string;
  imageUrl: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const reduce = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [brush, setBrush] = useState(36);
  const [instruction, setInstruction] = useState("");
  const [hasStrokes, setHasStrokes] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawing = useRef(false);

  // Size the canvas to fit the image inside the display box.
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const scale = Math.min(MAX_DISPLAY / img.naturalWidth, MAX_DISPLAY / img.naturalHeight, 1);
      setDims({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
    };
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pointerPos = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const paint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerPos(event);
    ctx.fillStyle = MASK_PAINT;
    ctx.beginPath();
    ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
    setHasStrokes(true);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
  };

  const exportMaskBase64 = (): string | null => {
    const canvas = canvasRef.current;
    if (!canvas || !dims) return null;
    const scale = Math.min(MAX_EXPORT / dims.w, MAX_EXPORT / dims.h, 2);
    const out = document.createElement("canvas");
    out.width = Math.round(dims.w * scale);
    out.height = Math.round(dims.h * scale);
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    // White strokes on a black background = the mask.
    ctx.fillStyle = MASK_KEEP;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return out.toDataURL("image/png").split(",")[1] ?? null;
  };

  const apply = async () => {
    setError(null);
    if (!instruction.trim()) {
      setError("Describe the change for the marked area.");
      return;
    }
    if (!hasStrokes) {
      setError("Brush over the area you want to change.");
      return;
    }
    setIsBusy(true);
    try {
      const dataBase64 = exportMaskBase64();
      if (!dataBase64) {
        setError("Could not read the mask. Try again.");
        setIsBusy(false);
        return;
      }
      const uploaded = await uploadEditMask({ dataBase64 });
      if (uploaded.error || !uploaded.path) {
        setError(uploaded.error ?? "Mask upload failed.");
        setIsBusy(false);
        return;
      }
      const form = new FormData();
      form.set("itemId", itemId);
      form.set("instruction", instruction.trim());
      form.set("maskPath", uploaded.path);
      const result = await editImage({ error: null }, form);
      if (result.error) {
        setError(result.error);
        setIsBusy(false);
        return;
      }
      onApplied();
    } catch {
      setError("Something went wrong. Try again.");
      setIsBusy(false);
    }
  };

  // Portal to the body so the fixed overlay escapes the history card's CSS
  // columns + hover transform, which otherwise mis-position and flicker it.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit a region"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <motion.button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-bg-nav/80"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
      />
      <motion.div
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-border-subtle bg-bg-raised p-5"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
          <h2 className="font-display text-xl font-semibold text-text-primary">Edit a region</h2>
          <p className="mt-1 text-[13px] text-text-faint">
            Brush over the area to change. Only the marked region is edited; the rest stays.
          </p>

          <div className="mt-3 flex justify-center">
            <div className="relative" style={{ width: dims?.w, height: dims?.h }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt=""
                width={dims?.w}
                height={dims?.h}
                className="rounded-xl"
                draggable={false}
              />
              {dims ? (
                <canvas
                  ref={canvasRef}
                  width={dims.w}
                  height={dims.h}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drawing.current = true;
                    paint(event);
                  }}
                  onPointerMove={(event) => {
                    if (drawing.current) paint(event);
                  }}
                  onPointerUp={() => {
                    drawing.current = false;
                  }}
                  className="absolute inset-0 cursor-crosshair touch-none rounded-xl opacity-60"
                  style={{ mixBlendMode: "screen" }}
                />
              ) : null}
            </div>
          </div>

          <label className="mt-3 flex items-center gap-2 text-[13px] text-text-secondary">
            Brush size
            <input
              type="range"
              min={12}
              max={80}
              value={brush}
              onChange={(event) => setBrush(Number(event.target.value))}
              className="flex-1 accent-[color:var(--primary)]"
            />
            <button
              type="button"
              onClick={clear}
              className="text-[13px] text-text-faint hover:text-text-primary"
            >
              Clear
            </button>
          </label>

          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={2}
            placeholder="What should change in the marked area? e.g. replace with a navy background"
            className="mt-2 w-full resize-y rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-[13px] text-text-primary outline-none focus:border-border-strong"
          />

          {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

          <div className="mt-3 flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={apply} isLoading={isBusy}>
              Apply region edit
            </Button>
          </div>
      </motion.div>
    </div>,
    document.body,
  );
}
