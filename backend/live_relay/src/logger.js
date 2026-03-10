/**
 * Structured JSON logger for Cloud Run.
 *
 * Cloud Run parses stdout JSON lines and uses the `severity` field
 * to assign log levels in Cloud Logging.
 *
 * @module logger
 */

/** @typedef {'INFO' | 'WARNING' | 'ERROR' | 'DEBUG'} Severity */

/**
 * @typedef {Object} Logger
 * @property {(message: string, extra?: Record<string, unknown>) => void} info
 * @property {(message: string, extra?: Record<string, unknown>) => void} warn
 * @property {(message: string, extra?: Record<string, unknown>) => void} error
 * @property {(message: string, extra?: Record<string, unknown>) => void} debug
 */

/**
 * Writes a single JSON log line to stdout.
 *
 * @param {Severity} severity
 * @param {string}   component
 * @param {string}   message
 * @param {Record<string, unknown>} [extra]
 */
function write(severity, component, message, extra) {
  const entry = {
    timestamp: new Date().toISOString(),
    severity,
    component,
    message,
    ...extra,
  };

  process.stdout.write(JSON.stringify(entry) + '\n');
}

/**
 * Creates a logger bound to a specific component name.
 *
 * @param {string} component - Identifier for the subsystem (e.g. 'relay-session', 'ws-handler').
 * @returns {Logger}
 */
export function createLogger(component) {
  return {
    info:  (message, extra) => write('INFO',    component, message, extra),
    warn:  (message, extra) => write('WARNING', component, message, extra),
    error: (message, extra) => write('ERROR',   component, message, extra),
    debug: (message, extra) => write('DEBUG',   component, message, extra),
  };
}
