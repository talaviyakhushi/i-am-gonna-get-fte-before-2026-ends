import { DEV_DEFAULTS } from "./dev-defaults.js";

/** On install: seed settings that are still unset. Never overwrites user values. */
export async function applyDefaultSettings(): Promise<void> {
  const current = await chrome.storage.sync.get(["apiUrl", "token"]);
  const updates: Record<string, string> = {};
  if (!current.apiUrl) updates.apiUrl = DEV_DEFAULTS.apiUrl;
  if (current.token === undefined) updates.token = DEV_DEFAULTS.token;
  if (Object.keys(updates).length > 0) {
    await chrome.storage.sync.set(updates);
  }
}
