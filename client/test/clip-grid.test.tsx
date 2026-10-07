// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ClipGrid } from "@/app/[date]/clip-grid";
import type { AudioIdentification, Clip, Identification } from "@/lib/db";

afterEach(cleanup);

function ident(overrides: Partial<Identification> = {}): Identification {
  return {
    isBird: true,
    species: "northern cardinal",
    gender: null,
    count: 1,
    confidence: 0.9,
    nonBirdSpecies: null,
    model: "gemini-2.5-flash",
    ...overrides,
  };
}

function clip(id: number, createdAt: string, identifications: Identification[] = [ident()]): Clip {
  return { id, createdAt, thumbnailPath: `downloads/2026/7/4/${id}.jpg`, identifications };
}

function audio(id: number, detectedAt: string, overrides: Partial<AudioIdentification> = {}): AudioIdentification {
  return {
    id,
    detectedAt,
    species: "American Robin",
    scientificName: "Turdus migratorius",
    confidence: 0.75,
    audioPath: `downloads/2026/7/4/audio-${id}.wav`,
    speciesImagePath: "downloads/species/turdus-migratorius.jpg",
    ...overrides,
  };
}

function renderGrid({ clips = [] as Clip[], audioIdentifications = [] as AudioIdentification[] } = {}) {
  // Label each card with a recognizable time so tests can check feed order.
  const clipTimes = Object.fromEntries(clips.map((c) => [c.id, `video ${c.id}`]));
  const audioTimes = Object.fromEntries(audioIdentifications.map((a) => [String(a.id), `audio ${a.id}`]));
  render(
    <ClipGrid clips={clips} clipTimes={clipTimes} audioIdentifications={audioIdentifications} audioTimes={audioTimes} />
  );
}

/** The card containing the given time label. */
function card(timeLabel: string): HTMLElement {
  return screen.getByText(timeLabel).closest(".rounded-lg") as HTMLElement;
}

/** Time labels of every rendered card, in feed order. */
function feedOrder(): string[] {
  return screen.queryAllByText(/^(video|audio) /).map((el) => el.textContent!);
}

describe("ClipGrid feed", () => {
  it("merges video and audio items newest first", () => {
    renderGrid({
      clips: [clip(1, "2026-07-04T13:00:00Z"), clip(2, "2026-07-04T15:00:00Z")],
      audioIdentifications: [audio(1, "2026-07-04T14:00:00Z"), audio(2, "2026-07-04T16:00:00Z")],
    });

    expect(feedOrder()).toEqual(["audio 2", "video 2", "audio 1", "video 1"]);
  });

  it.each([
    [0, "0 items"],
    [1, "1 item"],
    [2, "2 items"],
  ])("shows the item count for %i items", (n, label) => {
    renderGrid({ clips: Array.from({ length: n }, (_, i) => clip(i, `2026-07-04T1${i}:00:00Z`)) });
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("ClipGrid toggles", () => {
  const data = {
    clips: [clip(1, "2026-07-04T13:00:00Z")],
    audioIdentifications: [audio(1, "2026-07-04T14:00:00Z")],
  };

  it("shows both video and audio by default", () => {
    renderGrid(data);
    expect(screen.getByRole("button", { name: "Video" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Audio" })).toHaveAttribute("aria-pressed", "true");
    expect(feedOrder()).toEqual(["audio 1", "video 1"]);
  });

  it("hides and re-shows video items", async () => {
    const user = userEvent.setup();
    renderGrid(data);
    const button = screen.getByRole("button", { name: "Video" });

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(feedOrder()).toEqual(["audio 1"]);
    expect(screen.getByText("1 item")).toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(feedOrder()).toEqual(["audio 1", "video 1"]);
  });

  it("hides audio items", async () => {
    const user = userEvent.setup();
    renderGrid(data);

    await user.click(screen.getByRole("button", { name: "Audio" }));
    expect(screen.getByRole("button", { name: "Audio" })).toHaveAttribute("aria-pressed", "false");
    expect(feedOrder()).toEqual(["video 1"]);
  });

  it("shows nothing when both are hidden", async () => {
    const user = userEvent.setup();
    renderGrid(data);

    await user.click(screen.getByRole("button", { name: "Video" }));
    await user.click(screen.getByRole("button", { name: "Audio" }));
    expect(feedOrder()).toEqual([]);
    expect(screen.getByText("0 items")).toBeInTheDocument();
  });
});

describe("ClipGrid video cards", () => {
  it("shows the time, thumbnail, identification details, and model", () => {
    renderGrid({
      clips: [
        clip(1, "2026-07-04T13:00:00Z", [
          ident({ species: "house finch", gender: "male", count: 3, confidence: 0.876 }),
        ]),
      ],
    });
    const c = within(card("video 1"));

    expect(c.getByRole("img")).toHaveAttribute("src", "/downloads/2026/7/4/1.jpg");
    expect(c.getByRole("img")).toHaveAttribute("alt", "house finch");
    expect(c.getByText("house finch (male) ×3")).toBeInTheDocument();
    expect(c.getByText("88% confidence")).toBeInTheDocument();
    expect(c.getByText("AI model: gemini-2.5-flash")).toBeInTheDocument();
  });

  it.each([
    ["unknown gender", { gender: "unknown" }],
    ["null gender", { gender: null }],
    ["a count of 1", { count: 1 }],
    ["a null count", { count: null }],
    ["a count of 0", { count: 0 }],
  ])("shows only the species name for %s", (_, overrides) => {
    renderGrid({ clips: [clip(1, "2026-07-04T13:00:00Z", [ident({ species: "blue jay", ...overrides })])] });
    expect(within(card("video 1")).getByText("blue jay")).toBeInTheDocument();
  });

  it("omits the confidence line when confidence is null", () => {
    renderGrid({ clips: [clip(1, "2026-07-04T13:00:00Z", [ident({ confidence: null })])] });
    expect(within(card("video 1")).queryByText(/confidence/)).not.toBeInTheDocument();
  });

  it("lists every identification for a clip", () => {
    renderGrid({
      clips: [
        clip(1, "2026-07-04T13:00:00Z", [
          ident({ species: "house finch", confidence: 0.8 }),
          ident({ species: "blue jay", confidence: 0.6 }),
        ]),
      ],
    });
    const c = within(card("video 1"));

    expect(c.getByText("house finch")).toBeInTheDocument();
    expect(c.getByText("80% confidence")).toBeInTheDocument();
    expect(c.getByText("blue jay")).toBeInTheDocument();
    expect(c.getByText("60% confidence")).toBeInTheDocument();
  });

  it("shows non-bird identifications by label in red", () => {
    renderGrid({
      clips: [
        clip(1, "2026-07-04T13:00:00Z", [ident({ isBird: false, species: null, nonBirdSpecies: "squirrel", confidence: 0.7 })]),
      ],
    });
    const c = within(card("video 1"));

    expect(c.getByText("squirrel").parentElement).toHaveClass("text-red-500");
    expect(c.getByText("70% confidence")).toBeInTheDocument();
  });

  it("falls back to 'Not a bird' when the non-bird label is missing", () => {
    renderGrid({
      clips: [clip(1, "2026-07-04T13:00:00Z", [ident({ isBird: false, species: null, nonBirdSpecies: null })])],
    });
    expect(within(card("video 1")).getByText("Not a bird")).toBeInTheDocument();
  });

  it("shows a placeholder for a clip with no identifications", () => {
    renderGrid({ clips: [clip(1, "2026-07-04T13:00:00Z", [])] });
    const c = within(card("video 1"));

    expect(c.getByText("No identification")).toBeInTheDocument();
    expect(c.getByRole("img")).toHaveAttribute("alt", "Unidentified clip");
    expect(c.queryByText(/AI model/)).not.toBeInTheDocument();
  });

  it("omits the model line when the first identification has no model", () => {
    renderGrid({ clips: [clip(1, "2026-07-04T13:00:00Z", [ident({ model: null })])] });
    expect(within(card("video 1")).queryByText(/AI model/)).not.toBeInTheDocument();
  });
});

describe("ClipGrid audio cards", () => {
  it("shows the time, species image, species, confidence, and audio player", () => {
    renderGrid({ audioIdentifications: [audio(7, "2026-07-04T13:00:00Z", { confidence: 0.834 })] });
    const el = card("audio 7");
    const c = within(el);

    expect(c.getByLabelText("Audio detection")).toBeInTheDocument();
    expect(c.getByRole("img", { name: "American Robin" })).toHaveAttribute(
      "src",
      "/downloads/species/turdus-migratorius.jpg"
    );
    expect(c.getByText("American Robin")).toBeInTheDocument();
    expect(c.getByText("83% confidence")).toBeInTheDocument();
    expect(el.querySelector("audio")).toHaveAttribute("src", "/downloads/2026/7/4/audio-7.wav");
  });

  it("shows a placeholder when there is no species image", () => {
    renderGrid({ audioIdentifications: [audio(7, "2026-07-04T13:00:00Z", { speciesImagePath: null })] });
    const c = within(card("audio 7"));

    expect(c.queryByRole("img")).not.toBeInTheDocument();
    expect(c.getByText("🐦")).toBeInTheDocument();
  });

  it("falls back to 'Unidentified species' when the species is missing", () => {
    renderGrid({ audioIdentifications: [audio(7, "2026-07-04T13:00:00Z", { species: null })] });
    const c = within(card("audio 7"));

    expect(c.getByText("Unidentified species")).toBeInTheDocument();
    expect(c.getByRole("img")).toHaveAttribute("alt", "Unidentified species");
  });

  it("omits the confidence line and audio player when they're missing", () => {
    renderGrid({ audioIdentifications: [audio(7, "2026-07-04T13:00:00Z", { confidence: null, audioPath: null })] });
    const el = card("audio 7");

    expect(within(el).queryByText(/confidence/)).not.toBeInTheDocument();
    expect(el.querySelector("audio")).toBeNull();
  });
});

describe("ClipGrid lightbox", () => {
  const data = {
    clips: [clip(1, "2026-07-04T13:00:00Z", [ident({ species: "house finch" })])],
    audioIdentifications: [audio(7, "2026-07-04T14:00:00Z")],
  };

  async function openVideoLightbox() {
    const user = userEvent.setup();
    renderGrid(data);
    await user.click(within(card("video 1")).getByRole("img"));
    return user;
  }

  it("is closed initially", () => {
    renderGrid(data);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens with the clicked video thumbnail", async () => {
    await openVideoLightbox();
    const img = within(screen.getByRole("dialog")).getByRole("img");

    expect(img).toHaveAttribute("src", "/downloads/2026/7/4/1.jpg");
    expect(img).toHaveAttribute("alt", "house finch");
  });

  it("opens with the clicked audio species image", async () => {
    const user = userEvent.setup();
    renderGrid(data);
    await user.click(within(card("audio 7")).getByRole("img"));
    const img = within(screen.getByRole("dialog")).getByRole("img");

    expect(img).toHaveAttribute("src", "/downloads/species/turdus-migratorius.jpg");
    expect(img).toHaveAttribute("alt", "American Robin");
  });

  it("closes via the close button", async () => {
    const user = await openVideoLightbox();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when clicking the backdrop", async () => {
    const user = await openVideoLightbox();
    await user.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays open when clicking the enlarged image", async () => {
    const user = await openVideoLightbox();
    await user.click(within(screen.getByRole("dialog")).getByRole("img"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = await openVideoLightbox();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores other keys", async () => {
    const user = await openVideoLightbox();
    await user.keyboard("{Enter}a");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("can be reopened after closing", async () => {
    const user = await openVideoLightbox();
    await user.keyboard("{Escape}");
    await user.click(within(card("video 1")).getByRole("img"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
