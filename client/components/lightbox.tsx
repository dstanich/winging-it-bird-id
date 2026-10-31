"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface LightboxImage {
  src: string;
  alt: string;
}

const ENTER_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const EXIT_EASING = "cubic-bezier(0.4, 0, 1, 1)";
const BACKDROP_ENTER_MS = 180;
const CONTENT_ENTER_MS = 200;
const EXIT_MS = 150;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

/**
 * Full-screen image modal; closes via backdrop click, the × button, or Escape.
 * Portaled to <body> so it can be triggered from inline content (e.g. inside a <p>).
 */
export function Lightbox({ image, onClose }: { image: LightboxImage | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const closingGhostRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!image) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [image, onClose]);

  useLayoutEffect(() => {
    if (!image) return;

    // Clean up any in-flight closing ghost if the user re-opens a lightbox quickly.
    if (closingGhostRef.current) {
      closingGhostRef.current.remove();
      closingGhostRef.current = null;
    }

    const dialogEl = dialogRef.current;
    const imgEl = imgRef.current;
    if (!dialogEl || prefersReducedMotion()) return;

    if (typeof dialogEl.animate === "function") {
      dialogEl.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: BACKDROP_ENTER_MS,
        easing: "ease-out",
      });
    }
    if (imgEl && typeof imgEl.animate === "function") {
      imgEl.animate(
        [
          { opacity: 0, transform: "scale(0.92)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        {
          duration: CONTENT_ENTER_MS,
          easing: ENTER_EASING,
        }
      );
    }

    return () => {
      if (prefersReducedMotion() || typeof dialogEl.animate !== "function") {
        return;
      }
      const ghost = dialogEl.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("role");
      ghost.removeAttribute("aria-modal");
      ghost.setAttribute("aria-hidden", "true");
      ghost.dataset.lightboxClosing = "true";
      ghost.classList.remove("animate-lightbox-backdrop-in");
      ghost.style.pointerEvents = "none";

      const ghostImg = ghost.querySelector("img");
      ghostImg?.classList.remove("animate-lightbox-content-in");

      document.body.appendChild(ghost);
      closingGhostRef.current = ghost;

      const backdropAnim = ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: EXIT_MS,
        easing: EXIT_EASING,
        fill: "forwards",
      });
      if (ghostImg && typeof ghostImg.animate === "function") {
        ghostImg.animate(
          [
            { opacity: 1, transform: "scale(1)" },
            { opacity: 0, transform: "scale(0.92)" },
          ],
          {
            duration: EXIT_MS,
            easing: EXIT_EASING,
            fill: "forwards",
          }
        );
      }

      const removeGhost = () => {
        ghost.remove();
        if (closingGhostRef.current === ghost) {
          closingGhostRef.current = null;
        }
      };
      backdropAnim.onfinish = removeGhost;
      backdropAnim.oncancel = removeGhost;
    };
  }, [image]);

  if (!image) return null;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-lightbox-backdrop-in"
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
        ref={imgRef}
        src={image.src}
        alt={image.alt}
        className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg animate-lightbox-content-in"
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
