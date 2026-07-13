function createOperationReporter(options = {}) {
  const warnings = [];
  const errors = [];
  const emit = (payload) => {
    const message = { type: "progress", ...payload };
    options.onProgress?.(message);
    if (typeof process.send === "function") process.send(message);
  };
  const logger = {
    info(message) {
      options.logger?.info?.(message);
      emit({ level: "info", message: String(message) });
    },
    warn(message) {
      warnings.push(String(message));
      options.logger?.warn?.(message);
      emit({ level: "warning", message: String(message) });
    },
    error(message) {
      errors.push(String(message));
      options.logger?.error?.(message);
      emit({ level: "error", message: String(message) });
    },
  };
  return { emit, logger, warnings, errors };
}

module.exports = { createOperationReporter };
