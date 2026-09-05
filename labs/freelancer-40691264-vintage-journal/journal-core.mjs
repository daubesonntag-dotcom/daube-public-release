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
