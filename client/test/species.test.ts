import { describe, expect, it } from "vitest";
import { isKnownSpecies, isUnknownSpecies } from "@/lib/species";

describe("isUnknownSpecies", () => {
  it.each(["unknown", "Unknown bird", "unidentified sparrow", "bird (unknown)"])("flags %s", (name) => {
    expect(isUnknownSpecies(name)).toBe(true);
  });

  it.each(["house finch", "unknownish warbler"])("accepts %s", (name) => {
    expect(isUnknownSpecies(name)).toBe(false);
  });
});

describe("isKnownSpecies", () => {
  it.each([
    [null, false],
    ["", false],
    ["   ", false],
    ["unknown bird", false],
    ["northern cardinal", true],
  ])("%j → %s", (name, expected) => {
    expect(isKnownSpecies(name)).toBe(expected);
  });
});
