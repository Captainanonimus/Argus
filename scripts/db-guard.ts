// Write guard shared by record, replay and backtest. These scripts write to
// whatever DATABASE_URL points at, so they refuse to run unless
// ALLOW_DB_WRITES_HOST is set to a substring of that database's host
// (e.g. "localhost" or "ep-quiet-lake-123456").

export function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").host || "(unset)";
  } catch {
    return "(DATABASE_URL is not a valid URL)";
  }
}

export function requireWritableDb(tag: string) {
  const host = dbHost();
  const allowed = process.env.ALLOW_DB_WRITES_HOST?.trim() ?? "";
  if (allowed && host.includes(allowed)) return;
  console.error(
    `[${tag}] refusing to write to database host: ${host}\n` +
      `Set ALLOW_DB_WRITES_HOST to a substring of that host to allow it` +
      (allowed ? ` (current value "${allowed}" does not match).` : "."),
  );
  process.exit(1);
}
