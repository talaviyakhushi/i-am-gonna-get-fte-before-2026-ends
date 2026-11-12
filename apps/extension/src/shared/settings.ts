export interface ExtensionSettings {
  apiUrl: string;
  token: string;
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.sync.get({ apiUrl: "", token: "" });
  return {
    apiUrl: String(stored.apiUrl ?? "").replace(/\/+$/, ""),
    token: String(stored.token ?? ""),
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.sync.set({
    apiUrl: settings.apiUrl.trim().replace(/\/+$/, ""),
    token: settings.token.trim(),
  });
}
