import { describe, expect, it } from "vitest";
import { isKnownSpecies, isUnknownSpecies, toTitleCase } from "@/lib/species";

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

describe("toTitleCase", () => {
  it.each([
    ["house sparrow", "House Sparrow"],
    ["black-capped chickadee", "Black-capped Chickadee"],
    ["American Robin", "American Robin"],
  ])("%s → %s", (name, expected) => {
    expect(toTitleCase(name)).toBe(expected);
  });
});
