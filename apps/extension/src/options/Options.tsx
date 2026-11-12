import { useEffect, useState } from "react";
import { getSettings, saveSettings } from "../shared/settings.js";

export function Options() {
  const [apiUrl, setApiUrl] = useState("");
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getSettings().then((settings) => {
      setApiUrl(settings.apiUrl);
      setToken(settings.token);
    });
  }, []);

  const save = async () => {
    await saveSettings({ apiUrl, token });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: 8,
    fontSize: 14,
    marginTop: 4,
  };

  return (
    <div>
      <h1 style={{ fontSize: 18 }}>Resume Tailor Agent — Settings</h1>
      <p>
        The extension talks to your locally running API. Both values must match
        your <code>apps/api/.env</code>.
      </p>

      <label style={{ fontWeight: 600, display: "block", marginTop: 16 }}>
        API base URL
        <input
          style={fieldStyle}
          placeholder="http://localhost:3847"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
        />
      </label>

      <label style={{ fontWeight: 600, display: "block", marginTop: 16 }}>
        Shared token (AUTH_TOKEN)
        <input
          style={fieldStyle}
          type="password"
          placeholder="paste the AUTH_TOKEN value"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>

      <button
        style={{
          marginTop: 20,
          padding: "10px 18px",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          background: "#1a56db",
          color: "#fff",
          border: "none",
          borderRadius: 6,
        }}
        onClick={() => void save()}
      >
        Save
      </button>
      {saved && <span style={{ marginLeft: 10, color: "#15803d" }}>Saved ✓</span>}
    </div>
  );
}
