// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
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
