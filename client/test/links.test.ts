import { describe, expect, it, vi } from "vitest";
import { pageHref } from "@/lib/links";

describe("pageHref", () => {
  it("points at index.html in production, since S3 has no directory-index rewriting", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(pageHref("/settings")).toBe("/settings/index.html");
    expect(pageHref("/2026-07-04")).toBe("/2026-07-04/index.html");
  });

  it.each(["development", "test"])("uses a trailing-slash path when NODE_ENV=%s", (env) => {
    vi.stubEnv("NODE_ENV", env);
    expect(pageHref("/settings")).toBe("/settings/");
    expect(pageHref("/2026-07-04")).toBe("/2026-07-04/");
  });
});
