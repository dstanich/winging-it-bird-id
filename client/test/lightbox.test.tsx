// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LightboxLink, ZoomableImage } from "@/components/lightbox";

afterEach(cleanup);

describe("ZoomableImage", () => {
  async function openLightbox() {
    const user = userEvent.setup();
    render(<ZoomableImage src="/downloads/2026/7/4/daily-2026-07-04.png" alt="Cartoon of House Finch" title="House Finch" />);
    await user.click(screen.getByRole("img"));
    return user;
  }

  it("renders the image with its title and no dialog initially", () => {
    render(<ZoomableImage src="/a.png" alt="A" title="Title A" />);
    expect(screen.getByRole("img")).toHaveAttribute("title", "Title A");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a lightbox with the same image when clicked", async () => {
    await openLightbox();
    const img = within(screen.getByRole("dialog")).getByRole("img");
    expect(img).toHaveAttribute("src", "/downloads/2026/7/4/daily-2026-07-04.png");
    expect(img).toHaveAttribute("alt", "Cartoon of House Finch");
  });

  it("closes via the close button", async () => {
    const user = await openLightbox();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when clicking the backdrop", async () => {
    const user = await openLightbox();
    await user.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays open when clicking the enlarged image", async () => {
    const user = await openLightbox();
    await user.click(within(screen.getByRole("dialog")).getByRole("img"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = await openLightbox();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("LightboxLink", () => {
  it("renders its text as a button with no image or dialog initially", () => {
    render(<LightboxLink src="/images/feeder.jpg" alt="Feeder">3D printed bird feeder</LightboxLink>);
    expect(screen.getByRole("button", { name: "3D printed bird feeder" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the image in a lightbox when clicked, and closes on Escape", async () => {
    const user = userEvent.setup();
    render(<LightboxLink src="/images/feeder.jpg" alt="Feeder">3D printed bird feeder</LightboxLink>);
    await user.click(screen.getByRole("button", { name: "3D printed bird feeder" }));
    const img = within(screen.getByRole("dialog")).getByRole("img");
    expect(img).toHaveAttribute("src", "/images/feeder.jpg");
    expect(img).toHaveAttribute("alt", "Feeder");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Lightbox animations", () => {
  it("animates backdrop and image on open and animates a non-interactive ghost on close", async () => {
    const animations: { target: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void }[] = [];
    Element.prototype.animate = vi.fn(function (this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
      const anim = {
        onfinish: null as (() => void) | null,
        oncancel: null as (() => void) | null,
        cancel: vi.fn(),
      };
      animations.push({
        target: this,
        keyframes: keyframes as Keyframe[],
        options: (typeof options === "object" ? options : { duration: options }) as KeyframeAnimationOptions,
        finish: () => anim.onfinish?.(),
      });
      return anim as unknown as Animation;
    });

    const user = userEvent.setup();
    render(<ZoomableImage src="/a.png" alt="Bird A" />);
    await user.click(screen.getByRole("img"));

    // Open animations: backdrop (180ms) + image (200ms scale 0.92 -> 1)
    expect(animations).toHaveLength(2);
    expect(animations[0].options.duration).toBe(180);
    expect(animations[1].keyframes).toEqual([
      { opacity: 0, transform: "scale(0.92)" },
      { opacity: 1, transform: "scale(1)" },
    ]);
    expect(animations[1].options.duration).toBe(200);

    // Close triggers a 150ms exit ghost while immediately removing role="dialog"
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const ghost = document.querySelector("[data-lightbox-closing='true']");
    expect(ghost).toBeInTheDocument();
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    expect(animations).toHaveLength(4);
    expect(animations[2].options.duration).toBe(150);
    expect(animations[3].keyframes).toEqual([
      { opacity: 1, transform: "scale(1)" },
      { opacity: 0, transform: "scale(0.92)" },
    ]);

    // Finishing the backdrop animation removes the ghost from the DOM
    animations[2].finish();
    expect(document.querySelector("[data-lightbox-closing='true']")).not.toBeInTheDocument();

    delete (Element.prototype as Partial<Element>).animate;
  });

  it("skips animations when prefers-reduced-motion: reduce is active", async () => {
    const animateSpy = vi.fn();
    Element.prototype.animate = animateSpy;
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true })
    );

    const user = userEvent.setup();
    render(<ZoomableImage src="/a.png" alt="Bird A" />);
    await user.click(screen.getByRole("img"));
    await user.keyboard("{Escape}");

    expect(animateSpy).not.toHaveBeenCalled();
    expect(document.querySelector("[data-lightbox-closing='true']")).not.toBeInTheDocument();

    delete (Element.prototype as Partial<Element>).animate;
  });
});
