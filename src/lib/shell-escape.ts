/**
 * POSIX shell path escaping for inserting OS paths into a terminal.
 *
 * Safe characters may stay unquoted; anything else is single-quoted with
 * embedded `'` rewritten as `'\''` (same semantics as the Rust helper
 * `shell_escape_single_quoted` in commands.rs).
 */

/** Characters that are safe to leave unquoted in a POSIX shell word. */
const SAFE_PATH_RE = /^[A-Za-z0-9/._@%+=:,-]+$/;

/**
 * Escape a single filesystem path for use as a shell argument.
 */
export function shellEscapePath(path: string): string {
  if (path === "") return "''";
  if (SAFE_PATH_RE.test(path)) return path;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/**
 * Format one or more absolute paths for insertion into a terminal:
 * each path shell-escaped, joined with a single space. Empty entries dropped.
 */
export function formatPathsForShell(paths: string[]): string {
  return paths
    .filter((p) => p.length > 0)
    .map(shellEscapePath)
    .join(" ");
}
