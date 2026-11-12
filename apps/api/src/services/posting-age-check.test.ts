import { describe, it, expect } from "vitest";
import { extractDatePosted } from "./posting-age-check.js";

function pageWithJsonLd(json: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head><body></body></html>`;
}

describe("extractDatePosted", () => {
  it("finds datePosted on a plain JobPosting node", () => {
    const html = pageWithJsonLd({ "@type": "JobPosting", datePosted: "2026-01-01" });
    expect(extractDatePosted(html)).toBe("2026-01-01");
  });

  it("finds datePosted nested inside an @graph array", () => {
    const html = pageWithJsonLd({
      "@graph": [
        { "@type": "Organization", name: "Acme" },
        { "@type": "JobPosting", datePosted: "2025-12-15" },
      ],
    });
    expect(extractDatePosted(html)).toBe("2025-12-15");
  });

  it("finds datePosted when the top-level JSON-LD is an array", () => {
    const html = pageWithJsonLd([
      { "@type": "WebPage" },
      { "@type": "JobPosting", datePosted: "2025-11-01" },
    ]);
    expect(extractDatePosted(html)).toBe("2025-11-01");
  });

  it("returns null when there is no JobPosting structured data", () => {
    const html = pageWithJsonLd({ "@type": "Organization", name: "Acme" });
    expect(extractDatePosted(html)).toBeNull();
  });

  it("returns null when there is no JSON-LD at all", () => {
    expect(extractDatePosted("<html><body>No structured data here</body></html>")).toBeNull();
  });

  it("returns null when the JSON-LD is malformed", () => {
    const html = `<html><head><script type="application/ld+json">{not valid json</script></head></html>`;
    expect(extractDatePosted(html)).toBeNull();
  });
});
