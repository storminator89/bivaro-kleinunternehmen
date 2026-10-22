import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { requestHeaders } = vi.hoisted(() => ({ requestHeaders: vi.fn() }));
vi.mock("next/headers", () => ({ headers: requestHeaders }));
// Only the root font/head contract is rendered here; application behavior has its own suites.
vi.mock("@/components/theme-provider", () => ({ ThemeProvider: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/auth/auth-provider", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/components/route-progress", () => ({ RouteProgress: () => null }));
vi.mock("@/components/purchases/incoming-review-history-boundary", () => ({ IncomingReviewHistoryBoundary: () => null }));
import RootLayout from "../../app/layout";

type FontAsset = {
  path: string;
  family: string;
  subset: string;
  bytes: number;
  sha256: string;
  sourceURL: string;
  preload: boolean;
};
type FontManifest = {
  fontBytes: number;
  faceCount: number;
  originalFacesSha256: string;
  variables: Record<string, string>;
  licenses: Record<string, { path: string; sourceURL: string; sha256: string }>;
  fonts: FontAsset[];
};

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const manifestBytes = read("public/fonts/ui/manifest.json");
const manifest = JSON.parse(manifestBytes.toString()) as FontManifest;
const css = read("app/fonts.css").toString();
// Independent baseline: the accepted Google loader's 22 emitted faces, with src replaced
// by the corresponding font payload SHA256. No fonts or metrics are regenerated in tests.
const originalFaceDigest = "e19294df3390582e548e0f1bad343d013da74600ab8d75ff3714a4c294aa9ef2";

function declarations(body: string): Record<string, string> {
  return Object.fromEntries(body.split(";").filter((part) => part.trim()).map((part) => {
    const colon = part.indexOf(":");
    return [part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, " ")];
  }));
}

function faces(source: string) {
  return [...source.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((match) => {
    const face = declarations(match[1]);
    const url = /url\(["']?([^"')]+)["']?\)/.exec(face.src);
    if (url) {
      expect(url[1]).toMatch(/^\/fonts\/ui\/[a-z0-9/-]+\.woff2$/);
      expect(face.src).toMatch(/\)\s*format\(["']woff2["']\)$/);
      face.src = `sha256:${sha256(read(`public${url[1]}`))}`;
    }
    return Object.fromEntries(Object.keys(face).sort().map((key) => [key, face[key]]));
  });
}

function faceDigest(source: string) {
  return sha256(JSON.stringify(faces(source)));
}

describe("deterministic, unchanged self-hosted UI fonts", () => {
  it("pins all official source URLs, payload hashes and license hashes", () => {
    expect(sha256(manifestBytes)).toBe("d9aa70260f6cf8d3b7484e57de70c1072fdea1cc9ce81279c936b26d7ab60e92");
    expect(manifest.fonts).toHaveLength(16);
    expect(manifest.fontBytes).toBe(395736);
    expect(manifest.originalFacesSha256).toBe(originalFaceDigest);
  });

  it.each(manifest.fonts)("retains the original WOFF2 payload: $path", (font) => {
    const bytes = read(`public/fonts/ui/${font.path}`);
    expect(bytes.subarray(0, 4).toString()).toBe("wOF2");
    expect(bytes.length).toBe(font.bytes);
    expect(sha256(bytes)).toBe(font.sha256);
    expect(font.path).toContain(font.sha256.slice(0, 16));
    expect(font.sourceURL).toMatch(/^https:\/\/fonts\.gstatic\.com\/s\/(inter\/v20|geistmono\/v6|newsreader\/v26)\/[A-Za-z0-9_-]+\.woff2$/);
  });

  it.each(Object.entries(manifest.licenses))("retains the official OFL notice: %s", (_family, license) => {
    const bytes = read(`public/fonts/ui/${license.path}`);
    expect(sha256(bytes)).toBe(license.sha256);
    expect(bytes.toString()).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(license.sourceURL).toMatch(/^https:\/\/raw\.githubusercontent\.com\/google\/fonts\/main\/ofl\/(inter|geistmono|newsreader)\/OFL\.txt$/);
  });

  it("preserves all original styles, weights, Unicode ranges and fallback metrics", () => {
    expect(faces(css)).toHaveLength(22);
    expect(faceDigest(css)).toBe(originalFaceDigest);
    expect(faces(css).filter((face) => face["font-family"] === "Inter")).toHaveLength(7);
    expect(faces(css).filter((face) => face["font-family"] === "Geist Mono")).toHaveLength(6);
    expect(faces(css).filter((face) => face["font-family"] === "Newsreader")).toHaveLength(6);
  });

  it("keeps non-Latin coverage instead of treating the Latin preload as the whole font", () => {
    expect(new Set(faces(css).filter((face) => face.src.startsWith("sha256:")).map((face) => face.src)).size).toBe(16);
    expect(manifest.fonts.filter((font) => font.preload).map((font) => font.subset)).toEqual(["latin", "latin", "latin"]);
  });

  it("keeps the existing three CSS variable stacks", () => {
    const block = /\.ui-fonts\s*\{([^}]+)\}/.exec(css);
    expect(block).not.toBeNull();
    expect(declarations(block![1])).toEqual(manifest.variables);
    expect(read("app/layout.tsx").toString()).toContain('className="ui-fonts"');
  });

  it("does not load remote stylesheets or run a build-time Google font loader", () => {
    expect(css).not.toMatch(/https?:|@import|next\/font/);
    const layout = read("app/layout.tsx").toString();
    expect(layout).toContain('import "./fonts.css"');
    expect(layout).not.toContain("next/font/");
  });

  it.each([undefined, "font-test-nonce"])("renders only the same three anonymous Latin preloads, nonce=%s", async (nonce) => {
    requestHeaders.mockResolvedValue(new Headers(nonce ? { "x-nonce": nonce } : {}));
    const html = renderToStaticMarkup(await RootLayout({ children: createElement("main", null, "font fixture") }));
    const links = [...html.matchAll(/<link\b[^>]+>/g)].map((match) => match[0]).filter((link) => link.includes('as="font"'));
    expect(links).toHaveLength(3);
    expect(links.map((link) => /href="([^"]+)"/.exec(link)?.[1])).toEqual(manifest.fonts.filter((font) => font.preload).map((font) => `/fonts/ui/${font.path}`));
    for (const link of links) {
      expect(link).toContain('rel="preload"');
      expect(link).toContain('type="font/woff2"');
      expect(link).toContain('crossorigin=""');
      expect(link.includes('nonce="font-test-nonce"')).toBe(Boolean(nonce));
    }
    expect(html).toContain('class="ui-fonts"');
    expect(html).toContain("font fixture");
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it.each([
    ["fallback metric", (source: string) => source.replace("69.68%", "69.69%")],
    ["weight", (source: string) => source.replace("font-weight: 600", "font-weight: 700")],
    ["glyph coverage", (source: string) => source.replace("U+1F??", "U+1F00-1F01")],
  ] as const)("detects an otherwise silent typography regression: %s", (_name, change) => {
    expect(faceDigest(change(css))).not.toBe(originalFaceDigest);
  });

  it("rejects a format declaration that would prevent genuine WOFF2 loading", () => {
    expect(() => faces(css.replace('format("woff2")', 'format("woff")'))).toThrow();
  });
});
