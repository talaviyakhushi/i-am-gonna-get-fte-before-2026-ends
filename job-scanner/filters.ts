/**
 * filters.ts — drop-in replacement for the filtering in job-scanner/scan.ts.
 *
 * Fixes found by checking past results/*.md:
 *  1. Non-engineering roles passed ("Sales Development Representative (New Grad)",
 *     "Recruiting Coordinator, New Grad") because a level word alone was enough.
 *     Now a title needs an engineering word AND a level signal.
 *  2. Generic titles ("Backend Engineer", "Fullstack Engineer") passed with no level
 *     signal. Now they only pass if the description asks for under 2 years.
 *  3. The description check reused the TITLE exclude list, so any JD mentioning
 *     "senior engineers", "product manager" or "lead" was dropped. That silently
 *     removed real new grad roles. Replaced with a years-of-experience check.
 *  4. Interns, non-US locations (Bulgaria, Hungary, Norway, Tel Aviv) and very old
 *     postings (100+ days) slipped through.
 */

// Stack words (backend, frontend, full-stack) alone don't make a role: "Full-Stack Creator" isn't one.
// Titles like "Backend Engineer" still pass via "engineer".
const ROLE = /\b(software|engineer|engineering|developer|swe|sde|machine learning)\b/i;
const NOT_SWE = /\b(sales|recruit\w*|account executive|accounting|clerk|customer|(customer|technical) support|support (specialist|analyst|representative|engineer)|marketing|counsel|legal|business development|designer|mechanical|electrical|hardware|civil|chemical|manufacturing|solutions engineer|field engineer|sales engineer|analyst|cqv|industrialization|mechatronics|commissioning|escalation|gtm|rf|emc|it engineer|product design|enablement)\b/i;
// 2027: roles for the class of 2027 are out of scope (kept from the original scan.ts exclude list).
const NOT_LEVEL = /\b(senior|sr\.?|staff|principal|lead|manager|director|head|architect|founding|experienced|seniority|intern|internship|co-?op|ii|iii|iv|phd|2027|vp|vice president|chief)\b/i;
const NEW_GRAD = /\b(new[- ]?grads?|new graduate|university grad(uate)?|college grad(uate)?|recent grad(uate)?|early[- ]career|entry[- ]level|junior|jr\.?|associate|campus|class of 2026|2026 start|(engineer|developer|swe|sde)\s*,?\s*(i|1))\b/i;

export type TitleVerdict = "newgrad" | "generic" | "reject";

export function classifyTitle(title: string): TitleVerdict {
  if (!ROLE.test(title) || NOT_SWE.test(title) || NOT_LEVEL.test(title)) return "reject";
  return NEW_GRAD.test(title) ? "newgrad" : "generic";
}

/** Smallest "N years ... experience" requirement in the description, or null if none stated. */
export function minYearsRequired(description: string): number | null {
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?)?\s*years?\b([^.]{0,60})/gi;
  let min: number | null = null;
  for (const m of description.matchAll(re)) {
    if (!/experience|exp\b|industry|professional/i.test(m[2])) continue;
    const n = Number(m[1]);
    if (n > 15) continue; // "founded 25 years ago" etc.
    min = min === null ? n : Math.min(min, n);
  }
  return min;
}

/**
 * Final decision for one posting.
 *  - new grad titles: keep unless the JD clearly demands 3+ years
 *  - generic titles: keep only if the JD mentions new grads or asks for under 2 years
 */
export function isNewGradRole(title: string, description: string): boolean {
  const verdict = classifyTitle(title);
  if (verdict === "reject") return false;
  const years = minYearsRequired(description);
  if (verdict === "newgrad") return years === null || years < 3;
  if (/new grad|recent graduate|entry[- ]level|early career|0-2 years|0\+ years/i.test(description)) return true;
  return years !== null && years < 2;
}

const NON_US = /\b(india|bengaluru|bangalore|pune|hyderabad|mumbai|delhi|chennai|united kingdom|uk|london|ireland|dublin|germany|berlin|munich|france|paris|poland|warsaw|krakow|switzerland|zurich|spain|madrid|barcelona|portugal|lisbon|netherlands|amsterdam|sweden|stockholm|norway|oslo|denmark|copenhagen|finland|austria|vienna|hungary|budapest|bulgaria|sofia|romania|bucharest|czech|prague|serbia|belgrade|ukraine|estonia|israel|tel aviv|singapore|malaysia|kuala lumpur|mys|zielona gora|japan|tokyo|korea|seoul|china|beijing|shanghai|shenzhen|hong kong|taiwan|taipei|philippines|manila|vietnam|indonesia|australia|sydney|melbourne|new zealand|canada|toronto|montreal|montréal|vancouver|ontario|mexico|brazil|são paulo|sao paulo|argentina|colombia|bogota|chile|uae|dubai|ind|emea|apac|latam)\b/i;
const US = /\b(united states|usa|u\.s\.|us)\b/i; // "remote" alone is NOT proof of US

export function locationIsUS(location: string): boolean {
  if (!location) return true; // many real US postings leave it blank
  if (US.test(location)) return true; // explicit US wins: "London, UK; New York, US" stays
  return !NON_US.test(location);
}

export const MAX_AGE_DAYS = 60;

export function isFresh(postedAt: string | null): boolean {
  if (!postedAt) return true;
  const t = new Date(postedAt).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}
