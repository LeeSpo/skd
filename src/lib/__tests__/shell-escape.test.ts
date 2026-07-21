import { describe, expect, it } from "vitest";
import { formatPathsForShell, shellEscapePath } from "../shell-escape";

describe("shellEscapePath", () => {
  it("leaves safe absolute paths unquoted", () => {
    expect(shellEscapePath("/Users/a/b.txt")).toBe("/Users/a/b.txt");
    expect(shellEscapePath("/tmp/build_1")).toBe("/tmp/build_1");
    expect(shellEscapePath("/Users/me/file@v1.2")).toBe("/Users/me/file@v1.2");
  });

  it("returns empty quotes for empty string", () => {
    expect(shellEscapePath("")).toBe("''");
  });

  it("single-quotes paths with spaces", () => {
    expect(shellEscapePath("/Users/a/My File.txt")).toBe(
      "'/Users/a/My File.txt'",
    );
  });

  it("escapes embedded single quotes", () => {
    expect(shellEscapePath("/tmp/it's")).toBe("'/tmp/it'\\''s'");
  });

  it("quotes paths with other shell metacharacters", () => {
    expect(shellEscapePath("/tmp/a$(x)")).toBe("'/tmp/a$(x)'");
    expect(shellEscapePath("/tmp/a&b")).toBe("'/tmp/a&b'");
    expect(shellEscapePath("/tmp/a*")).toBe("'/tmp/a*'");
  });
});

describe("formatPathsForShell", () => {
  it("joins multiple paths with spaces", () => {
    expect(
      formatPathsForShell(["/tmp/a", "/tmp/b c", "/tmp/d"]),
    ).toBe("/tmp/a '/tmp/b c' /tmp/d");
  });

  it("drops empty path entries", () => {
    expect(formatPathsForShell(["/tmp/a", "", "/tmp/b"])).toBe(
      "/tmp/a /tmp/b",
    );
  });

  it("returns empty string for empty input", () => {
    expect(formatPathsForShell([])).toBe("");
    expect(formatPathsForShell([""])).toBe("");
  });
});
