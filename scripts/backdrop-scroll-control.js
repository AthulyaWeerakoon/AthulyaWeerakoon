var fullHeight, windowHeight, scrollTop;

// Initial calculation
function updateDisplayAttributes() {
  fullHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight,
    document.body.offsetHeight,
    document.documentElement.offsetHeight,
    document.body.clientHeight,
    document.documentElement.clientHeight
  );

  windowHeight = window.innerHeight || document.documentElement.clientHeight;
  scrollTop = window.scrollY || document.documentElement.scrollTop;
}

// Run at startup
updateDisplayAttributes();

window.addEventListener("resize", function() {
  updateDisplayAttributes();
  updateBackgroundScroll();
});

function updateBackgroundScroll() {
  scrollTop = window.scrollY || document.documentElement.scrollTop;

  const scrollPercent = (scrollTop / (fullHeight - windowHeight)) * 100;

  backgroundImg1.style.bottom = `${(Math.min(scrollPercent - 100, 0))}%`;
  backgroundImg2.style.bottom = `${(Math.min(0.75 * scrollPercent - 75, 0))}%`;
  backgroundImg3.style.bottom = `${(Math.min(0.5 * scrollPercent - 50, 0) + 5)}%`;
  backgroundImg4.style.bottom = `${(Math.min(0.25 * scrollPercent - 25, 0))}%`;
  backgroundImg5.style.bottom = `${(Math.min(0.1 * scrollPercent - 10, 0) + 15)}%`;
}

window.addEventListener("scroll", updateBackgroundScroll);
