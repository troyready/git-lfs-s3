/**
 * Shared functions
 *
 * @packageDocumentation
 */

export function ISODateString(d: Date) {
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
