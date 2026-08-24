(() => {
  const button = document.querySelector('[data-update-toggle]');
  const note = document.getElementById('update-note');
  if (!button || !note) return;
  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    note.classList.toggle('isVisible', !expanded);
  });
})();
