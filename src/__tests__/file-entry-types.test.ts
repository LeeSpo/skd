/**
 * Task 10.3 — Unit tests for file-entry-types.ts helpers
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  formatSize,
  pathJoin,
  parentPath,
  breadcrumbSegments,
  localParentPath,
  localBreadcrumbSegments,
  getFileIcon,
  type FileEntry,
} from "../lib/file-entry-types";

describe("file-entry-types helpers", () => {
  // ── formatSize ──
  describe("formatSize", () => {
    it("returns '—' for 0", () => expect(formatSize(0)).toBe("—"));
    it("formats 500 as '500 B'", () => expect(formatSize(500)).toBe("500 B"));
    it("formats 1024 as '1.0 KB'", () =>
      expect(formatSize(1024)).toBe("1.0 KB"));
    it("formats 1 MB", () => expect(formatSize(1048576)).toBe("1.0 MB"));
    it("formats 1 GB", () => expect(formatSize(1073741824)).toBe("1.0 GB"));
    it("formats 1 TB", () =>
      expect(formatSize(1099511627776)).toBe("1.0 TB"));
    it("rounds large KB values", () =>
      expect(formatSize(51200)).toBe("50 KB"));

    it("property: always returns a non-empty string for positive input", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 1e15 }), (n) => {
          const result = formatSize(n);
          expect(result.length).toBeGreaterThan(0);
          expect(result).not.toBe("—");
        }),
      );
    });
  });

  // ── pathJoin (Unix) ──
  describe("pathJoin", () => {
    it("joins root + name", () => expect(pathJoin("/", "foo")).toBe("/foo"));
    it("joins non-root + name", () =>
      expect(pathJoin("/home", "user")).toBe("/home/user"));
    it("joins deep path", () =>
      expect(pathJoin("/a/b/c", "d")).toBe("/a/b/c/d"));
  });

  // ── parentPath (Unix) ──
  describe("parentPath", () => {
    it("root returns root", () => expect(parentPath("/")).toBe("/"));
    it("empty returns root", () => expect(parentPath("")).toBe("/"));
    it("single level returns root", () =>
      expect(parentPath("/home")).toBe("/"));
    it("two levels", () => expect(parentPath("/home/user")).toBe("/home"));
    it("deep path", () =>
      expect(parentPath("/a/b/c/d")).toBe("/a/b/c"));

    it("property: parentPath(pathJoin(base, child)) === base", () => {
      const seg = fc
        .string({ minLength: 1, maxLength: 10 })
        .filter((s) => !s.includes("/") && s !== "." && s !== "..");
      const absPath = fc
        .array(seg, { minLength: 0, maxLength: 5 })
        .map((parts) =>
          parts.length === 0 ? "/" : `/${parts.join("/")}`,
        );

      fc.assert(
        fc.property(absPath, seg, (base, child) => {
          expect(parentPath(pathJoin(base, child))).toBe(base);
        }),
      );
    });
  });

  // ── breadcrumbSegments ──
  describe("breadcrumbSegments", () => {
    it("root produces single segment", () =>
      expect(breadcrumbSegments("/")).toEqual([{ label: "/", path: "/" }]));

    it("deep path", () =>
      expect(breadcrumbSegments("/a/b/c")).toEqual([
        { label: "/", path: "/" },
        { label: "a", path: "/a" },
        { label: "b", path: "/a/b" },
        { label: "c", path: "/a/b/c" },
      ]));

    it("property: last segment path equals original", () => {
      const seg = fc
        .string({ minLength: 1, maxLength: 10 })
        .filter((s) => !s.includes("/") && s !== "." && s !== "..");
      const absPath = fc
        .array(seg, { minLength: 0, maxLength: 5 })
        .map((parts) =>
          parts.length === 0 ? "/" : `/${parts.join("/")}`,
        );

      fc.assert(
        fc.property(absPath, (path) => {
          const segs = breadcrumbSegments(path);
          expect(segs[segs.length - 1].path).toBe(path);
          expect(segs[0]).toEqual({ label: "/", path: "/" });
        }),
      );
    });
  });
});
