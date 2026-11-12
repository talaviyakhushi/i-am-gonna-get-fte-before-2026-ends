declare const __DEV__: boolean;

/** Sensible localhost default in dev builds; empty in prod builds. */
export const DEV_DEFAULTS = {
  apiUrl: __DEV__ ? "http://localhost:3847" : "",
  token: "",
};
