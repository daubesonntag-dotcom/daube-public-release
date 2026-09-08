export function normalizeNotes(value, count) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => {
    const item = source[index];
    return typeof item === 'string' ? item : '';
  });
}

export function nextPage(index, count) {
  return index >= count ? 0 : index + 1;
}

export function previousPage(index) {
  return index <= 0 ? 0 : index - 1;
}

export function countCharacters(value) {
  return String(value ?? '').length;
}

export function formatEntryStamp(date) {
  const value = date instanceof Date ? date : new Date(date);
  const day = String(value.getUTCDate()).padStart(2, '0');
  const month = value.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  return `${day} ${month} ${value.getUTCFullYear()}`;
}

export function nextPaperAccent(current) {
  const accents = ['ivory', 'rose', 'sage'];
  const index = accents.indexOf(current);
  return accents[(index + 1 + accents.length) % accents.length];
}
