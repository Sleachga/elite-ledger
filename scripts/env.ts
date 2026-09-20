/** Next.js loads .env for the app; scripts run under tsx and need this. */
export function loadDotEnv(file = ".env"): void {
  try {
    process.loadEnvFile(file);
  } catch {
    // No .env is fine: PGlite is the default.
  }
}
