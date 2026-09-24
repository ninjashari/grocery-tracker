/** "YYYY-MM" -> the first and last calendar day of that month, as "YYYY-MM-DD" strings. */
export function monthRange(key: string): { from: string; to: string } {
  const [yearStr, monthStr] = key.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const from = `${yearStr}-${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

/** Same as monthRange, pre-encoded as a `from=...&to=...` query string. */
export function monthRangeQs(key: string): string {
  const { from, to } = monthRange(key);
  return `from=${from}&to=${to}`;
}
