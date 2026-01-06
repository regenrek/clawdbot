/**
 * Minimal logger with levels (debug, info, warn, error, none).
 * Controlled by LOG_LEVEL env var.
 */

const LEVELS = /** @type {const} */ (["none", "debug", "info", "warn", "error"]);

function normalizeLevel(level) {
  if (!level) return "info";
  const v = String(level).toLowerCase();
  return LEVELS.includes(v) ? v : "info";
}

function shouldLog(current, level) {
  const order = { none: 99, debug: 10, info: 20, warn: 30, error: 40 };
  return order[level] >= order[current];
}

export function createLogger() {
  const current = normalizeLevel(process.env.LOG_LEVEL);

  /** @param {'debug'|'info'|'warn'|'error'} level */
  const mk = (level) => {
    return (...args) => {
      if (!shouldLog(current, level)) return;
      // Keep logs one-line-ish for bot consumption.
      const prefix = `[tvctl:${level}]`;
      // eslint-disable-next-line no-console
      console[level === "debug" ? "log" : level](prefix, ...args);
    };
  };

  return {
    level: current,
    debug: mk("debug"),
    info: mk("info"),
    warn: mk("warn"),
    error: mk("error"),
  };
}
