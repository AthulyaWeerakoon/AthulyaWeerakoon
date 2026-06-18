const navLinks = document.querySelectorAll('.topnav a[href^="#"]');
const sections = document.querySelectorAll('section[id]');
const topbar = document.querySelector('.topbar');
const navToggle = document.querySelector('.nav-toggle');

navLinks.forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    topbar?.classList.remove('nav-open');
    navToggle?.setAttribute('aria-expanded', 'false');
  });
});

function updateNavHighlight() {
  let activeId = sections[0]?.id;

  sections.forEach((section) => {
    const rect = section.getBoundingClientRect();
    if (rect.top <= window.innerHeight * 0.35) {
      activeId = section.id;
    }
  });

  navLinks.forEach((link) => {
    const href = link.getAttribute('href');
    link.classList.toggle('active', href === `#${activeId}`);
  });
}

if (navToggle && topbar) {
  navToggle.addEventListener('click', () => {
    const isOpen = topbar.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });
}

window.addEventListener('scroll', updateNavHighlight, { passive: true });
window.addEventListener('resize', updateNavHighlight);
updateNavHighlight();
