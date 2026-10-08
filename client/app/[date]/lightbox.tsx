"use client";

import { useEffect, useState } from "react";

export interface LightboxImage {
  src: string;
  alt: string;
}

/** Full-screen image modal; closes via backdrop click, the × button, or Escape. */
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

  return (
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
    </div>
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
