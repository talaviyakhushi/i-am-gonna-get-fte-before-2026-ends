import "dotenv/config";

export interface ApiConfig {
  anthropicApiKey: string;
  authToken: string;
  port: number;
  originAllowlist: string[];
}

const REQUIRED_VARS = ["ANTHROPIC_API_KEY", "AUTH_TOKEN"] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  for (const name of REQUIRED_VARS) {
    const value = env[name];
    if (!value || value.trim() === "") {
      throw new Error(
        `Missing required environment variable: ${name}. ` +
          `Copy apps/api/.env.example to apps/api/.env and fill it in.`,
      );
    }
  }

  const port = Number(env.PORT ?? 3847);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a valid port number, got: ${env.PORT}`);
  }

  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY as string,
    authToken: env.AUTH_TOKEN as string,
    port,
    originAllowlist: (env.API_ORIGIN_ALLOWLIST ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

let cached: ApiConfig | undefined;

/** Lazily-loaded singleton so modules can read config without re-parsing env. */
export function getConfig(): ApiConfig {
  cached ??= loadConfig();
  return cached;
}
