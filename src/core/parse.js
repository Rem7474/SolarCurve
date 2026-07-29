export function parseDecimal(val) {
  const normalized = String(val ?? '')
    .trim()
    .replace(',', '.');
  if (!normalized) return Number.NaN;
  return Number(normalized);
}
