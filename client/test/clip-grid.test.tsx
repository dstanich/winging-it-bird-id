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

/** Clicks the "Include non-birds & unidentified" toggle button so unidentified/non-bird items render. */
async function includeNonBirds() {
  await userEvent.setup().click(screen.getByRole("button", { name: /include non-birds/i }));
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

describe("ClipGrid media filter", () => {
  const data = {
    clips: [clip(1, "2026-07-04T13:00:00Z"), clip(2, "2026-07-04T15:00:00Z")],
    audioIdentifications: [audio(1, "2026-07-04T14:00:00Z")],
  };

  function mediaGroup() {
    return screen.getByRole("group", { name: "Detection types to show" });
  }

  it("selects All by default and displays counts for All, Video, and Audio", () => {
    renderGrid(data);
    const group = within(mediaGroup());

    expect(group.getByRole("button", { name: /all \(3\)/i })).toHaveAttribute("aria-pressed", "true");
    expect(group.getByRole("button", { name: /video \(2\)/i })).toHaveAttribute("aria-pressed", "false");
    expect(group.getByRole("button", { name: /audio \(1\)/i })).toHaveAttribute("aria-pressed", "false");
    expect(feedOrder()).toEqual(["video 2", "audio 1", "video 1"]);
  });

  it("filters to video only and back to all", async () => {
    const user = userEvent.setup();
    renderGrid(data);
    const group = within(mediaGroup());

    await user.click(group.getByRole("button", { name: /video/i }));
    expect(group.getByRole("button", { name: /video/i })).toHaveAttribute("aria-pressed", "true");
    expect(group.getByRole("button", { name: /all/i })).toHaveAttribute("aria-pressed", "false");
    expect(feedOrder()).toEqual(["video 2", "video 1"]);
    expect(screen.getByText("2 items")).toBeInTheDocument();

    await user.click(group.getByRole("button", { name: /all/i }));
    expect(feedOrder()).toEqual(["video 2", "audio 1", "video 1"]);
  });

  it("filters to audio only", async () => {
    const user = userEvent.setup();
    renderGrid(data);
    const group = within(mediaGroup());

    await user.click(group.getByRole("button", { name: /audio/i }));
    expect(group.getByRole("button", { name: /audio/i })).toHaveAttribute("aria-pressed", "true");
    expect(feedOrder()).toEqual(["audio 1"]);
    expect(screen.getByText("1 item")).toBeInTheDocument();
  });
});

describe("ClipGrid non-bird filter", () => {
  const data = {
    clips: [
      clip(1, "2026-07-04T11:00:00Z", [ident({ species: "house finch" })]),
      clip(2, "2026-07-04T12:00:00Z", [ident({ isBird: false, species: null, nonBirdSpecies: "squirrel" })]),
      clip(3, "2026-07-04T13:00:00Z", [ident({ species: "unknown bird" })]),
      clip(4, "2026-07-04T14:00:00Z", []),
      clip(5, "2026-07-04T15:00:00Z", [ident({ species: null })]),
      // A known bird alongside a non-bird still counts as a bird clip.
      clip(6, "2026-07-04T16:00:00Z", [
        ident({ isBird: false, species: null, nonBirdSpecies: "squirrel" }),
        ident({ species: "blue jay" }),
      ]),
    ],
    audioIdentifications: [
      audio(1, "2026-07-04T11:30:00Z"),
      audio(2, "2026-07-04T12:30:00Z", { species: null }),
      audio(3, "2026-07-04T13:30:00Z", { species: "Unidentified Sparrow" }),
    ],
  };

  it("is off by default and shows the non-bird count", () => {
    renderGrid(data);
    const button = screen.getByRole("button", { name: /include non-birds/i });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveTextContent("(6)");
  });

  it("shows only items with an identified bird species by default", () => {
    renderGrid(data);
    expect(feedOrder()).toEqual(["video 6", "audio 1", "video 1"]);
    expect(screen.getByText("3 items")).toBeInTheDocument();
    expect(screen.getByText(/6 without an identified bird hidden/)).toBeInTheDocument();
  });

  it("shows everything when toggled on, and filters again via toggle or active pill", async () => {
    const user = userEvent.setup();
    renderGrid(data);
    const button = screen.getByRole("button", { name: /include non-birds/i });

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(feedOrder()).toHaveLength(9);
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument();

    // Active filter pill is rendered and can remove the filter
    const removePill = screen.getByRole("button", { name: /remove non-birds and unidentified filter/i });
    await user.click(removePill);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(feedOrder()).toEqual(["video 6", "audio 1", "video 1"]);
  });

  it("only counts hidden items for the media types being shown", async () => {
    const user = userEvent.setup();
    renderGrid(data);

    await user.click(screen.getByRole("button", { name: /^audio/i }));
    expect(screen.getByText(/2 without an identified bird hidden/)).toBeInTheDocument();
  });

  it("omits the hidden note when nothing is hidden", () => {
    renderGrid({ clips: [clip(1, "2026-07-04T13:00:00Z")] });
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument();
  });
});

describe("ClipGrid species filter", () => {
  const fixtures = () => ({
    clips: [
      clip(1, "2026-07-04T11:00:00Z", [ident({ species: "northern cardinal" })]),
      clip(2, "2026-07-04T12:00:00Z", [ident({ species: "blue jay" })]),
      clip(3, "2026-07-04T13:00:00Z", [ident({ isBird: false, species: null, nonBirdSpecies: "squirrel" })]),
      clip(4, "2026-07-04T14:00:00Z", [ident({ species: "unknown bird" })]),
      clip(5, "2026-07-04T15:00:00Z", [
        ident({ isBird: false, species: null, nonBirdSpecies: "squirrel" }),
        ident({ species: "house finch" }),
      ]),
    ],
    audioIdentifications: [
      audio(1, "2026-07-04T11:30:00Z", { species: "American Robin" }),
      audio(2, "2026-07-04T12:30:00Z", { species: "Blue Jay" }),
      audio(3, "2026-07-04T13:30:00Z", { species: "Unidentified Sparrow" }),
    ],
  });

  function speciesButton() {
    return screen.getByRole("button", { name: /^species:/i });
  }

  async function openSpeciesMenu() {
    const user = userEvent.setup();
    await user.click(speciesButton());
    return user;
  }

  it("shows 'All species' with menu closed by default", () => {
    renderGrid(fixtures());
    const button = speciesButton();

    expect(button).toHaveTextContent("All species");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).not.toBeDisabled();
    expect(screen.queryByRole("group", { name: "Filter by species" })).not.toBeInTheDocument();
  });

  it("disables the button when there are no known bird species on the day", () => {
    renderGrid({
      clips: [clip(1, "2026-07-04T11:00:00Z", [ident({ isBird: false, species: null, nonBirdSpecies: "squirrel" })])],
      audioIdentifications: [audio(1, "2026-07-04T12:00:00Z", { species: "Unidentified" })],
    });

    expect(speciesButton()).toBeDisabled();
  });

  it("lists unique known bird species from video and audio, sorted A–Z with item counts", async () => {
    renderGrid(fixtures());
    await openSpeciesMenu();

    expect(speciesButton()).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("group", { name: "Filter by species" });
    const checkboxes = within(menu).getAllByRole("checkbox");
    expect(checkboxes.map((cb) => cb.closest("label")?.textContent)).toEqual([
      "American Robin1",
      "Blue Jay2",
      "House Finch1",
      "Northern Cardinal1",
    ]);
    for (const cb of checkboxes) {
      expect(cb).not.toBeChecked();
    }
    expect(within(menu).queryByRole("button", { name: /clear selection/i })).not.toBeInTheDocument();
  });

  it("keeps all species in the menu even when filtered to Audio or Video only", async () => {
    const user = userEvent.setup();
    renderGrid(fixtures());

    await user.click(screen.getByRole("button", { name: /^audio/i }));
    await user.click(speciesButton());
    const menu = screen.getByRole("group", { name: "Filter by species" });

    expect(within(menu).getByRole("checkbox", { name: /american robin/i })).toBeInTheDocument();
    expect(within(menu).getByRole("checkbox", { name: /northern cardinal/i })).toBeInTheDocument();
  });

  it("filters items when selecting species, shows removable active pills, and restores all when cleared", async () => {
    renderGrid(fixtures());
    const user = await openSpeciesMenu();
    const menu = screen.getByRole("group", { name: "Filter by species" });

    // Select Blue Jay (matches both video 2 and audio 2, case-insensitively)
    await user.click(within(menu).getByRole("checkbox", { name: /blue jay/i }));
    expect(speciesButton()).toHaveTextContent("1 selected");
    expect(feedOrder()).toEqual(["audio 2", "video 2"]);
    expect(screen.getByText("2 items")).toBeInTheDocument();

    // Also select House Finch (matches multi-identification video 5)
    await user.click(within(menu).getByRole("checkbox", { name: /house finch/i }));
    expect(speciesButton()).toHaveTextContent("2 selected");
    expect(feedOrder()).toEqual(["video 5", "audio 2", "video 2"]);
    expect(screen.getByText("3 items")).toBeInTheDocument();

    // Remove Blue Jay via its active filter pill
    await user.click(screen.getByRole("button", { name: "Remove Blue Jay filter" }));
    expect(speciesButton()).toHaveTextContent("1 selected");
    expect(feedOrder()).toEqual(["video 5"]);

    // Remove House Finch via its active filter pill
    await user.click(screen.getByRole("button", { name: "Remove House Finch filter" }));
    expect(speciesButton()).toHaveTextContent("All species");
    expect(feedOrder()).toEqual(["video 5", "audio 2", "video 2", "audio 1", "video 1"]);
  });

  it("clears all selected species via 'Clear selection' in menu or 'Reset filters'", async () => {
    renderGrid(fixtures());
    const user = await openSpeciesMenu();
    const menu = screen.getByRole("group", { name: "Filter by species" });

    await user.click(within(menu).getByRole("checkbox", { name: /american robin/i }));
    await user.click(within(menu).getByRole("checkbox", { name: /northern cardinal/i }));
    expect(speciesButton()).toHaveTextContent("2 selected");
    expect(feedOrder()).toEqual(["audio 1", "video 1"]);

    await user.click(within(menu).getByRole("button", { name: /clear selection/i }));
    expect(speciesButton()).toHaveTextContent("All species");
    expect(within(menu).queryByRole("button", { name: /clear selection/i })).not.toBeInTheDocument();
    expect(feedOrder()).toEqual(["video 5", "audio 2", "video 2", "audio 1", "video 1"]);

    // Select again + change media filter, then use Reset filters
    await user.click(within(menu).getByRole("checkbox", { name: /blue jay/i }));
    await user.click(screen.getByRole("button", { name: /^video/i }));
    expect(feedOrder()).toEqual(["video 2"]);

    await user.click(screen.getByRole("button", { name: /reset filters/i }));
    expect(speciesButton()).toHaveTextContent("All species");
    expect(feedOrder()).toEqual(["video 5", "audio 2", "video 2", "audio 1", "video 1"]);
  });

  it("works additively with Include non-birds & unidentified when a species is selected", async () => {
    const user = userEvent.setup();
    renderGrid(fixtures());

    await user.click(screen.getByRole("button", { name: /include non-birds/i }));
    expect(feedOrder()).toHaveLength(8);

    await user.click(speciesButton());
    const menu = screen.getByRole("group", { name: "Filter by species" });
    await user.click(within(menu).getByRole("checkbox", { name: /northern cardinal/i }));

    // Shows Northern Cardinal (video 1) PLUS non-bird/unidentified items (video 4, audio 3, video 3)
    expect(feedOrder()).toEqual(["video 4", "audio 3", "video 3", "video 1"]);
    expect(screen.getByText("4 items")).toBeInTheDocument();
  });

  it("closes the menu when clicking the button again, clicking outside, or pressing Escape", async () => {
    renderGrid(fixtures());
    const user = await openSpeciesMenu();
    expect(screen.getByRole("group", { name: "Filter by species" })).toBeInTheDocument();

    // Toggle closed via button
    await user.click(speciesButton());
    expect(screen.queryByRole("group", { name: "Filter by species" })).not.toBeInTheDocument();

    // Reopen and close via Escape (ignoring other keys)
    await user.click(speciesButton());
    await user.keyboard("a");
    expect(screen.getByRole("group", { name: "Filter by species" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Filter by species" })).not.toBeInTheDocument();

    // Reopen and close by clicking outside
    await user.click(speciesButton());
    expect(screen.getByRole("group", { name: "Filter by species" })).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole("group", { name: "Filter by species" })).not.toBeInTheDocument();
  });
});

describe("ClipGrid sorting", () => {
  function sortGroup() {
    return screen.getByRole("group", { name: "Sort order" });
  }

  async function sortBy(label: RegExp) {
    await userEvent.setup().click(within(sortGroup()).getByRole("button", { name: label }));
  }

  const fixtures = () => ({
    clips: [
      clip(1, "2026-07-04T13:00:00Z", [ident({ species: "northern cardinal" })]),
      clip(2, "2026-07-04T15:00:00Z", [ident({ species: "blue jay" })]),
      clip(3, "2026-07-04T17:00:00Z", [ident({ isBird: false, species: null, nonBirdSpecies: "squirrel" })]),
      clip(4, "2026-07-04T18:00:00Z", [ident({ species: "northern cardinal" })]),
    ],
    audioIdentifications: [
      audio(1, "2026-07-04T14:00:00Z", { species: "American Robin" }),
      audio(2, "2026-07-04T16:00:00Z", { species: "Blue Jay" }),
    ],
  });

  it("sorts by time by default", () => {
    renderGrid(fixtures());

    expect(within(sortGroup()).getByRole("button", { name: /newest/i })).toHaveAttribute("aria-pressed", "true");
    expect(within(sortGroup()).getByRole("button", { name: /species/i })).toHaveAttribute("aria-pressed", "false");
    expect(feedOrder()).toEqual(["video 4", "audio 2", "video 2", "audio 1", "video 1"]);
  });

  it("sorts alphabetically by species, case-insensitively, newest first within a species", async () => {
    renderGrid(fixtures());
    await sortBy(/species/i);

    expect(within(sortGroup()).getByRole("button", { name: /species/i })).toHaveAttribute("aria-pressed", "true");
    expect(feedOrder()).toEqual(["audio 1", "audio 2", "video 2", "video 4", "video 1"]);
  });

  it("puts items without a known bird species last", async () => {
    renderGrid(fixtures());
    await includeNonBirds();
    await sortBy(/species/i);

    expect(feedOrder()).toEqual(["audio 1", "audio 2", "video 2", "video 4", "video 1", "video 3"]);
  });

  it("sorts a clip by its first known bird identification", async () => {
    renderGrid({
      clips: [
        clip(1, "2026-07-04T13:00:00Z", [
          ident({ isBird: false, species: null, nonBirdSpecies: "squirrel" }),
          ident({ species: "unknown" }),
          ident({ species: "zebra finch" }),
          ident({ species: "american goldfinch" }),
        ]),
        clip(2, "2026-07-04T14:00:00Z", [ident({ species: "mourning dove" })]),
      ],
    });
    await sortBy(/species/i);

    expect(feedOrder()).toEqual(["video 2", "video 1"]);
  });

  it("can switch back to time order", async () => {
    renderGrid(fixtures());
    await sortBy(/species/i);
    await sortBy(/newest/i);

    expect(feedOrder()).toEqual(["video 4", "audio 2", "video 2", "audio 1", "video 1"]);
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
    expect(c.getByRole("img")).toHaveAttribute("alt", "House Finch");
    expect(c.getByText("House Finch (male) ×3")).toBeInTheDocument();
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
    expect(within(card("video 1")).getByText("Blue Jay")).toBeInTheDocument();
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

    expect(c.getByText("House Finch")).toBeInTheDocument();
    expect(c.getByText("80% confidence")).toBeInTheDocument();
    expect(c.getByText("Blue Jay")).toBeInTheDocument();
    expect(c.getByText("60% confidence")).toBeInTheDocument();
  });

  it("shows non-bird identifications by label in red", async () => {
    renderGrid({
      clips: [
        clip(1, "2026-07-04T13:00:00Z", [ident({ isBird: false, species: null, nonBirdSpecies: "squirrel", confidence: 0.7 })]),
      ],
    });
    await includeNonBirds();
    const c = within(card("video 1"));

    expect(c.getByText("squirrel").parentElement).toHaveClass("text-red-500");
    expect(c.getByText("70% confidence")).toBeInTheDocument();
  });

  it("falls back to 'Not a bird' when the non-bird label is missing", async () => {
    renderGrid({
      clips: [clip(1, "2026-07-04T13:00:00Z", [ident({ isBird: false, species: null, nonBirdSpecies: null })])],
    });
    await includeNonBirds();
    expect(within(card("video 1")).getByText("Not a bird")).toBeInTheDocument();
  });

  it("shows a placeholder for a clip with no identifications", async () => {
    renderGrid({ clips: [clip(1, "2026-07-04T13:00:00Z", [])] });
    await includeNonBirds();
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

  it("falls back to 'Unidentified species' when the species is missing", async () => {
    renderGrid({ audioIdentifications: [audio(7, "2026-07-04T13:00:00Z", { species: null })] });
    await includeNonBirds();
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
    expect(img).toHaveAttribute("alt", "House Finch");
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
