(() => {
  const names = {
    '01': 'RẠNG TRONG ATELIER',
    '02': 'OBSIDIAN CINEMA',
    '03': 'CELESTIAL THRESHOLD',
    '04': 'PORCELAIN INDEX',
    '05': 'JADE INTELLIGENCE',
    '06': 'LACQUER VERMILION',
    '07': 'MONSOON GLASS',
    '08': 'SILK PAPER',
    '09': 'NEO-CIVIC MONUMENT',
    '10': 'FUTURE MAISON'
  };
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('v');
  const current = Object.prototype.hasOwnProperty.call(names, requested) ? requested : '01';
  document.body.dataset.template = current;
  const label = document.getElementById('template-name');
  if (label) label.textContent = names[current];
  document.title = `D’AUBE SONNTAG · ${current} ${names[current]}`;
  document.querySelectorAll('[data-switch]').forEach((link) => {
    if (link.dataset.switch === current) link.setAttribute('aria-current', 'page');
  });
})();