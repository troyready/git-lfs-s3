/**
 * Shared functions
 *
 * @packageDocumentation
 */

/** Generate a RFC 3339 date string */
export function ISODateString(d: Date): string {
  function pad(num: number) {
    return num < 10 ? "0" + num : num;
  }
  return (
    d.getUTCFullYear() +
    "-" +
    pad(d.getUTCMonth() + 1) +
    "-" +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    ":" +
    pad(d.getUTCMinutes()) +
    ":" +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}
