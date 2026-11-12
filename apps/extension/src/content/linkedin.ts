import type { SiteSelectors } from "./generic.js";

export const linkedinSelectors: SiteSelectors = {
  hostPattern: /(^|\.)linkedin\.com$/i,
  title: [
    ".job-details-jobs-unified-top-card__job-title h1",
    ".jobs-unified-top-card__job-title",
    "h1.top-card-layout__title",
    "h1",
  ],
  company: [
    ".job-details-jobs-unified-top-card__company-name a",
    ".job-details-jobs-unified-top-card__company-name",
    ".jobs-unified-top-card__company-name a",
    "a.topcard__org-name-link",
    ".topcard__flavor",
  ],
  description: [
    ".jobs-description__content",
    "#job-details",
    ".jobs-box__html-content",
    ".description__text",
  ],
};
