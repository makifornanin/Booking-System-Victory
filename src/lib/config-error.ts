/** Thrown when required configuration is missing or invalid. Safe to import anywhere (including the proxy). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
