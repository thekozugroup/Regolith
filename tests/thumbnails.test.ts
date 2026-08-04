import { describe, expect, test } from "bun:test";
import { pickThumbnail, thumbnailUrlFor } from "../src/lib/thumbnails";

/**
 * The Fluidd path convention is a convention, not a promise. Guessing it and
 * probing with an <img> meant a 404 for every file whose slicer embedded no
 * preview — on every dashboard load, for the life of the machine. These
 * helpers exist so a doomed request becomes NO request.
 */

const THUMBS = [
  { width: 32, height: 32, size: 900, relative_path: ".thumbs/part-32x32.png" },
  { width: 300, height: 300, size: 9000, relative_path: ".thumbs/part-300x300.png" },
  { width: 600, height: 600, size: 40_000, relative_path: ".thumbs/part-600x600.png" },
];

describe("pickThumbnail", () => {
  test("takes the smallest preview that still clears the size bar", () => {
    expect(pickThumbnail(THUMBS, 200)).toBe(".thumbs/part-300x300.png");
    expect(pickThumbnail(THUMBS, 400)).toBe(".thumbs/part-600x600.png");
  });

  test("falls back to the largest available when none clear the bar", () => {
    expect(pickThumbnail([THUMBS[0]], 200)).toBe(".thumbs/part-32x32.png");
  });

  test("answers null for a file with no embedded preview", () => {
    // The normal answer for plenty of real gcode, and NOT an error state.
    expect(pickThumbnail([])).toBeNull();
    expect(pickThumbnail(undefined)).toBeNull();
  });

  test("refuses every malformed metadata shape rather than building a bad URL", () => {
    const hostile: unknown[] = [
      null,
      "a string",
      42,
      {},
      { thumbnails: [] },
      [null],
      [{ width: 300 }], // no path
      [{ relative_path: "" }],
      [{ relative_path: 123 }],
      ["not an object"],
    ];
    for (const value of hostile) {
      expect(pickThumbnail(value), JSON.stringify(value)).toBeNull();
    }
  });

  test("tolerates entries with no width by ranking them last", () => {
    expect(
      pickThumbnail([{ relative_path: ".thumbs/unknown.png" }], 200),
    ).toBe(".thumbs/unknown.png");
  });
});

describe("thumbnailUrlFor", () => {
  test("resolves relative to the FILE's directory, not the gcode root", () => {
    // Getting this wrong fails silently: it 404s and shows the placeholder,
    // exactly like a file that genuinely has no preview.
    expect(
      thumbnailUrlFor("calibration/benchy.gcode", ".thumbs/benchy-300x300.png"),
    ).toBe("/server/files/gcodes/calibration/.thumbs/benchy-300x300.png");
  });

  test("handles a file at the gcode root", () => {
    expect(thumbnailUrlFor("benchy.gcode", ".thumbs/benchy-300x300.png")).toBe(
      "/server/files/gcodes/.thumbs/benchy-300x300.png",
    );
  });

  test("handles nested directories and a leading ./", () => {
    expect(
      thumbnailUrlFor("a/b/c/part.gcode", "./.thumbs/part-300x300.png"),
    ).toBe("/server/files/gcodes/a/b/c/.thumbs/part-300x300.png");
  });

  test("percent-encodes names that would otherwise break the URL", () => {
    const url = thumbnailUrlFor(
      "my prints/a+b & c.gcode",
      ".thumbs/a+b & c-300x300.png",
    );
    expect(url).toBe(
      "/server/files/gcodes/my%20prints/.thumbs/a%2Bb%20%26%20c-300x300.png",
    );
    // Path separators must survive the encoding pass: leading "", the four
    // fixed segments, the directory, and the file.
    expect(url?.split("/")).toHaveLength(7);
  });

  test("answers null for an empty path instead of a directory URL", () => {
    expect(thumbnailUrlFor("a/b.gcode", "")).toBeNull();
  });
});
