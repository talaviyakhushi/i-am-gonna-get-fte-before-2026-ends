export interface SiteSelectors {
  hostPattern: RegExp;
  title: string[];
  company: string[];
  description: string[];
}

export const greenhouseSelectors: SiteSelectors = {
  hostPattern: /(^|\.)greenhouse\.io$/i,
  title: [".app-title", "h1.section-header", ".job__title h1", "h1"],
  company: [".company-name", ".job__company"],
  description: ["#content", ".job__description", "#app_body"],
};

export const leverSelectors: SiteSelectors = {
  hostPattern: /(^|\.)lever\.co$/i,
  title: [".posting-headline h2", "h2"],
  company: [".main-header-logo img[alt]"],
  description: [".posting-page .section-wrapper", ".content"],
};

export const genericSelectors: SiteSelectors = {
  hostPattern: /.*/,
  title: [
    "h1[class*='job']",
    "h1[class*='title']",
    "[data-testid*='title']",
    "h1",
  ],
  company: [
    "[class*='company-name']",
    "[data-testid*='company']",
    "[class*='employer']",
  ],
  description: [
    "[class*='job-description']",
    "[class*='jobDescription']",
    "[id*='job-description']",
    "[class*='description']",
    "article",
    "main",
  ],
};
