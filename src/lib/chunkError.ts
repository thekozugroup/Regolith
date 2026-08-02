const CHUNK_ERROR_PATTERNS = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "loading chunk",
  "chunkloaderror",
  "module script",
];

export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  const normalized = message.toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}
