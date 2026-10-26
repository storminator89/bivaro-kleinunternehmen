import { describe, expect, it } from "vitest";
import { simpleMarkdownToHtml } from "../documentation-print-markdown";

describe("documentation print Markdown conversion", () => {
  it.each([
    ["- [ ] Pending", "☐", "Pending"],
    ["- [x] Done", "☑", "Done"],
  ])("renders %s as a checkbox rather than an ordinary bullet", (markdown, symbol, label) => {
    expect(simpleMarkdownToHtml(markdown)).toBe(
      `<p class="my-2"><div class="ml-4 flex"><span class="mr-2">${symbol}</span><span>${label}</span></div></p>`,
    );
  });

  it("keeps ordinary bullets and numbered items between checkbox lines", () => {
    expect(simpleMarkdownToHtml("- First\n- [ ] Pending\n2. Second\n- [x] Done\n- Last")).toBe(
      '<p class="my-2"><div class="ml-4 flex"><span class="mr-2">•</span><span>First</span></div><br/>' +
      '<div class="ml-4 flex"><span class="mr-2">☐</span><span>Pending</span></div><br/>' +
      '<div class="ml-4 flex"><span class="mr-2 min-w-[1.5rem]">2.</span><span>Second</span></div><br/>' +
      '<div class="ml-4 flex"><span class="mr-2">☑</span><span>Done</span></div><br/>' +
      '<div class="ml-4 flex"><span class="mr-2">•</span><span>Last</span></div></p>',
    );
  });

  it.each([
    ["- [ ] **Review** <tag> & value", "☐"],
    ["- [x] **Review** <tag> & value", "☑"],
  ])("preserves bold formatting and HTML escaping in %s", (markdown, symbol) => {
    expect(simpleMarkdownToHtml(markdown)).toBe(
      `<p class="my-2"><div class="ml-4 flex"><span class="mr-2">${symbol}</span><span><strong>Review</strong> &lt;tag&gt; &amp; value</span></div></p>`,
    );
  });

  it("preserves headings, bold text, paragraphs and single line breaks", () => {
    expect(simpleMarkdownToHtml("## Heading\n### Detail\n\n**Bold** text\nNext")).toBe(
      '<p class="my-2"><h3 class="text-lg font-semibold mt-4 mb-2">Heading</h3><br/>' +
      '<h4 class="text-base font-medium mt-3 mb-1">Detail</h4></p><p class="my-2">' +
      '<strong>Bold</strong> text<br/>Next</p>',
    );
  });

  it("preserves basic table cells and separator-row handling", () => {
    expect(simpleMarkdownToHtml("| Name | Value |\n| --- | --- |\n| A & B | <tag> |")).toBe(
      '<p class="my-2"><tr><td class="border px-2 py-1">Name</td><td class="border px-2 py-1">Value</td></tr></p><p class="my-2">' +
      '<tr><td class="border px-2 py-1">A &amp; B</td><td class="border px-2 py-1">&lt;tag&gt;</td></tr></p>',
    );
  });

  it("keeps escaping ampersands before angle brackets, including existing entity text", () => {
    expect(simpleMarkdownToHtml('<script>"text" & &lt;</script>')).toBe(
      '<p class="my-2">&lt;script&gt;"text" &amp; &amp;lt;&lt;/script&gt;</p>',
    );
  });

  it.each(["- [X] Uppercase", "- [] Compact", "- [ ] ", "- [x] "])(
    "keeps the existing ordinary-bullet fallback for unsupported syntax %s",
    (markdown) => {
      expect(simpleMarkdownToHtml(markdown)).toBe(
        `<p class="my-2"><div class="ml-4 flex"><span class="mr-2">•</span><span>${markdown.slice(2)}</span></div></p>`,
      );
    },
  );

  it("keeps empty input empty", () => {
    expect(simpleMarkdownToHtml("")).toBe("");
  });
});
