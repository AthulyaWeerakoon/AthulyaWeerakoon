const introToggle = document.querySelector(".intro-toggle");
const introExpanded = document.getElementById("intro-expanded");
const articleCards = Array.from(document.querySelectorAll("[data-article]"));
const articlesSeeMore = document.getElementById("articles-see-more");
const articlesSeparator = document.getElementById("articles-separator");
const weatherButtons = Array.from(document.querySelectorAll(".weather-btn"));

let visibleArticleCount = 5;
let isArticleRevealRunning = false;

function updateIntroToggle() {
  if (!introToggle || !introExpanded) return;

  const isExpanded = introToggle.getAttribute("aria-expanded") === "true";
  introExpanded.hidden = isExpanded;
  introToggle.setAttribute("aria-expanded", String(!isExpanded));
  introToggle.querySelector("span").textContent = isExpanded ? "More intro" : "Less intro";
}

function renderArticles() {
  articleCards.forEach((card, index) => {
    card.classList.toggle("article-hidden", index >= visibleArticleCount);
    card.classList.remove("article-revealing", "article-visible");
    card.style.transitionDelay = "";
  });

  if (articlesSeparator) {
    articlesSeparator.hidden = articleCards.length <= 5 || visibleArticleCount >= articleCards.length;
    articlesSeparator.classList.remove("is-exiting");
  }
}

function revealMoreArticles() {
  if (isArticleRevealRunning) return;

  const start = visibleArticleCount;
  const nextVisibleCount = Math.min(visibleArticleCount + 5, articleCards.length);
  const cardsToReveal = articleCards.slice(start, nextVisibleCount);

  if (cardsToReveal.length === 0) return;

  isArticleRevealRunning = true;
  visibleArticleCount = nextVisibleCount;

  cardsToReveal.forEach((card, index) => {
    card.classList.remove("article-hidden");
    card.classList.add("article-revealing");
    card.style.transitionDelay = `${index * 120}ms`;

    requestAnimationFrame(() => {
      card.classList.add("article-visible");
    });
  });

  cardsToReveal.forEach((card, index) => {
    window.setTimeout(() => {
      card.classList.remove("article-revealing", "article-visible");
      card.style.transitionDelay = "";
      if (index === cardsToReveal.length - 1) {
        isArticleRevealRunning = false;
      }
    }, 820 + index * 120);
  });

  if (articlesSeparator && visibleArticleCount >= articleCards.length) {
    const exitDelay = 720 + Math.max(cardsToReveal.length - 1, 0) * 120;

    window.setTimeout(() => {
      articlesSeparator.classList.add("is-exiting");
    }, exitDelay);

    window.setTimeout(() => {
      articlesSeparator.hidden = true;
      articlesSeparator.classList.remove("is-exiting");
    }, exitDelay + 380);
  }
}

function renderWeatherButtons() {
  weatherButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.weather === theme));
  });
}

if (introToggle) {
  introToggle.addEventListener("click", updateIntroToggle);
}

if (articlesSeeMore) {
  articlesSeeMore.addEventListener("click", () => {
    revealMoreArticles();
  });
}

weatherButtons.forEach((button) => {
  button.addEventListener("click", () => {
    theme = button.dataset.weather;
    localStorage.setItem("theme", theme);
    updateModeAndTheme(false);
  });
});

window.addEventListener("themechange", renderWeatherButtons);

renderArticles();
renderWeatherButtons();
