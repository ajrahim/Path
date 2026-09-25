import { describe, expect, it } from "vitest";
import { parsePathAppLink, PathAppLinkError } from "../src/links/PathAppLink";

function generateLink(fields: Record<string, string> = {}): string {
  return `pathai://generate?${new URLSearchParams({
    videoPath: "C:\\Clips\\My capture.mp4",
    ...fields,
  })}`;
}

describe("Path app links", () => {
  it.each(["pathai://status", "pathai://status/"])("checks app status from %s", (url) => {
    expect(parsePathAppLink(url)).toEqual({ route: "status" });
  });

  it.each([
    "pathai://status?auto=true",
    "pathai://status?unknown=1",
    "pathai://status/nested",
    "pathai://status#fragment",
  ])("rejects invalid status links: %s", (url) => {
    expect(() => parsePathAppLink(url)).toThrow(PathAppLinkError);
  });

  it.each(["pathai://", "pathai:///", "PATHAI://"])("opens the app from %s", (url) => {
    expect(parsePathAppLink(url)).toEqual({ route: "open" });
  });

  it("parses the complete generation contract without interpreting the reserved type", () => {
    expect(
      parsePathAppLink(
        generateLink({
          title: "Project walkthrough",
          type: "future recording type",
          documentType: "API Review",
          folder: "Example project",
          auto: "true",
          logPath: "C:\\Clips\\capture.log",
          elementsPath: "C:\\Clips\\elements.json",
        }),
      ),
    ).toEqual({
      route: "generate",
      videoPath: "C:\\Clips\\My capture.mp4",
      title: "Project walkthrough",
      type: "future recording type",
      documentType: "API Review",
      folder: "Example project",
      auto: true,
      logPath: "C:\\Clips\\capture.log",
      elementsPath: "C:\\Clips\\elements.json",
    });
  });

  it("derives a bounded title from the filename and defaults optional fields", () => {
    expect(parsePathAppLink(generateLink())).toEqual({
      route: "generate",
      videoPath: "C:\\Clips\\My capture.mp4",
      title: "My capture",
      type: null,
      documentType: null,
      folder: null,
      auto: false,
      logPath: null,
      elementsPath: null,
    });
    expect(
      parsePathAppLink(generateLink({ videoPath: `/clips/${"x".repeat(180)}.mp4` })),
    ).toMatchObject({ title: "x".repeat(120) });
  });

  it.each(["", "null"])("accepts %s for nullable query fields", (value) => {
    expect(
      parsePathAppLink(
        generateLink({
          type: value,
          documentType: value,
          folder: value,
          logPath: value,
          elementsPath: value,
          auto: "false",
        }),
      ),
    ).toMatchObject({
      type: null,
      documentType: null,
      folder: null,
      auto: false,
      logPath: null,
      elementsPath: null,
    });
  });

  it("supports local POSIX paths, Unicode, and query escaping exactly once", () => {
    const videoPath = "/clips/C++ & résumé %20 #1.mp4";

    expect(parsePathAppLink(generateLink({ videoPath }))).toMatchObject({
      videoPath,
      title: "C++ & résumé %20 #1",
    });
    expect(
      parsePathAppLink("pathai://generate/?videoPath=%2Fclips%2Fx.mp4&title=My+recording%2Bnotes"),
    ).toMatchObject({ title: "My recording+notes" });
  });

  it.each([
    "pathai://other",
    "pathai:generate?videoPath=/clips/x.mp4",
    "pathai://generate/../?videoPath=/clips/x.mp4",
    "pathai://generate/nested?videoPath=/clips/x.mp4",
    "pathai://generate#",
    "pathai://user:password@generate?videoPath=/clips/x.mp4",
    "pathai://generate:80?videoPath=/clips/x.mp4",
    "pathai://?title=anything",
    "https://generate?videoPath=/clips/x.mp4",
    "pathai://generate?videoPath=/clips/My recording.mp4",
    "pathai://generate?videoPath=%ZZ",
    "pathai://generate?videoPath=%E0%A4%A",
    "pathai://generate?videoPath=/clips/x.mp4&folder=%FF",
    "pathai://generate?videoPath=/clips/x.mp4&videoPath=/clips/y.mp4",
    "pathai://generate?videoPath=/clips/x.mp4&%76ideoPath=/clips/y.mp4",
    "pathai://generate?videoPath=/clips/x.mp4&video_path=/clips/y.mp4",
    "pathai://generate?videoPath=/clips/x.mp4&elements=/clips/y.mp4",
  ])("rejects malformed or unsupported links: %s", (url) => {
    expect(() => parsePathAppLink(url)).toThrow(PathAppLinkError);
  });

  it.each(["1", "yes", "TRUE", "", "null"])("rejects ambiguous auto value %s", (auto) => {
    expect(() => parsePathAppLink(generateLink({ auto }))).toThrow("auto must be true or false");
  });

  it.each([
    "",
    "null",
    "clip.mp4",
    "C:clip.mp4",
    "\\clips\\clip.mp4",
    "\\\\server\\share\\clip.mp4",
    "//server/share/clip.mp4",
    "\\\\?\\C:\\clip.mp4",
    "\\\\.\\pipe\\example",
    "C:\\clips\\NUL.mp4",
    "C:\\clips\\COM1.mp4",
    "C:\\clips\\movie.mp4:stream",
    "C:\\clips\\movie?.mp4",
    "C:\\clips\\movie.mp4.",
    "C:\\clips\\movie.mp4 ",
    "/clips/movie\u0000.mp4",
    "https://example.com/movie.mp4",
    "file:///clips/movie.mp4",
  ])("rejects non-local, relative, device or invalid file paths: %s", (videoPath) => {
    expect(() => parsePathAppLink(generateLink({ videoPath }))).toThrow(PathAppLinkError);
  });

  it("checks companion paths and text limits before creating a command", () => {
    expect(() => parsePathAppLink(generateLink({ logPath: "relative.log" }))).toThrow("logPath");
    expect(() => parsePathAppLink(generateLink({ elementsPath: "//host/elements.json" }))).toThrow(
      "elementsPath",
    );
    expect(() => parsePathAppLink(generateLink({ title: "x".repeat(121) }))).toThrow("title");
    expect(() => parsePathAppLink(generateLink({ folder: "x".repeat(81) }))).toThrow("folder");
    expect(() =>
      parsePathAppLink(generateLink({ videoPath: `/clips/${"x".repeat(4096)}` })),
    ).toThrow("videoPath");
    expect(() => parsePathAppLink(generateLink({ title: "x".repeat(16_384) }))).toThrow("too long");
  });

  it("never includes incoming values in validation errors", () => {
    try {
      parsePathAppLink(`${generateLink()}&privateValue=secret`);

      throw new Error("Expected an invalid link");
    } catch (error) {
      expect(error).toBeInstanceOf(PathAppLinkError);
      expect((error as Error).message).not.toMatch(/privateValue|secret|Clips/);
    }
  });
});
