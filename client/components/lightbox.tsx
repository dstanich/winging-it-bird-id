"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface LightboxImage {
  src: string;
  alt: string;
}

/**
 * Full-screen image modal; closes via backdrop click, the × button, or Escape.
 * Portaled to <body> so it can be triggered from inline content (e.g. inside a <p>).
 */
export function Lightbox({ image, onClose }: { image: LightboxImage | null; onClose: () => void }) {
  useEffect(() => {
    if (!image) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [image, onClose]);

  if (!image) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-3xl leading-none"
      >
        &times;
      </button>
      <img
        src={image.src}
        alt={image.alt}
        className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  );
}

/** An image that opens itself in a Lightbox when clicked. */
export function ZoomableImage({ src, alt, title, className }: LightboxImage & { title?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <img src={src} alt={alt} title={title} className={className} onClick={() => setOpen(true)} />
      <Lightbox image={open ? { src, alt } : null} onClose={() => setOpen(false)} />
    </>
  );
}

/** Inline link-styled text that opens an image in a Lightbox when clicked. */
export function LightboxLink({
  src,
  alt,
  className,
  children,
}: LightboxImage & { className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <Lightbox image={open ? { src, alt } : null} onClose={() => setOpen(false)} />
    </>
  );
}
