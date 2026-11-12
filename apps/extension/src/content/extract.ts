import type { JobExtractResult } from "@resume-tailor/shared";
import { linkedinSelectors } from "./linkedin.js";
import {
  genericSelectors,
  greenhouseSelectors,
  leverSelectors,
  type SiteSelectors,
} from "./generic.js";

const SITES: SiteSelectors[] = [
  linkedinSelectors,
  greenhouseSelectors,
  leverSelectors,
  genericSelectors,
];

const MAX_DESCRIPTION_LENGTH = 12_000;

export function queryText(selectors: string[]): string {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return "";
}

export function queryDescription(selectors: string[]): string {
  const text = queryText(selectors);
  return text || document.body.innerText;
}

export function normalizeDescription(
  text: string,
  maxLen: number = MAX_DESCRIPTION_LENGTH,
): string {
  const collapsed = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return collapsed.length > maxLen ? collapsed.slice(0, maxLen) : collapsed;
}

function titleCase(input: string): string {
  return input
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function companyFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathSegments = parsed.pathname.split("/").filter(Boolean);

    // greenhouse.io: boards.greenhouse.io/<company>/jobs/<id>
    if (host.endsWith("greenhouse.io") && pathSegments[0]) {
      return titleCase(pathSegments[0]);
    }
    // lever.co: jobs.lever.co/<company>/<id>
    if (host.endsWith("lever.co") && pathSegments[0]) {
      return titleCase(pathSegments[0]);
    }
    // ashbyhq.com: jobs.ashbyhq.com/<company>/<job-id>
    if (host.endsWith("ashbyhq.com") && pathSegments[0]) {
      return titleCase(pathSegments[0]);
    }

    // Fallback: hostname minus common subdomains and TLD.
    const parts = host
      .replace(/^(www|jobs|careers|apply|boards|job-boards)\./, "")
      .split(".");
    return titleCase(parts[0] ?? "");
  } catch {
    return "";
  }
}

export function buildExtractResult(): JobExtractResult {
  const host = window.location.hostname;
  const site =
    SITES.find((s) => s !== genericSelectors && s.hostPattern.test(host)) ??
    genericSelectors;

  const title = queryText(site.title) || document.title.split("|")[0]!.trim();
  const company = queryText(site.company) || companyFromUrl(window.location.href);
  const description = normalizeDescription(queryDescription(site.description));

  const confidence: JobExtractResult["confidence"] =
    description.length > 200 && title.length > 0 && company.length > 0
      ? "high"
      : "low";

  return { title, company, url: window.location.href, description, confidence };
}

function sendExtract(): void {
  const payload = buildExtractResult();
  void chrome.runtime
    .sendMessage({ type: "JOB_EXTRACTED", payload })
    .catch(() => {
      // Background may not be awake yet; ignore.
    });
}

declare global {
  interface Window {
    __resumeAgentContentLoaded?: boolean;
  }
}

// Guard against double-injection (auto content script + popup executeScript).
if (!window.__resumeAgentContentLoaded) {
  window.__resumeAgentContentLoaded = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "EXTRACT_NOW") {
      const payload = buildExtractResult();
      void chrome.runtime.sendMessage({ type: "JOB_EXTRACTED", payload });
      sendResponse(payload);
    }
  });

  // Job boards render late; extract now and once more after things settle.
  sendExtract();
  setTimeout(sendExtract, 2000);
}
