// Updates fog colour
function updateFog(isSlowTransition) {
  colour = getComputedStyle(document.documentElement).getPropertyValue("--fog").trim();
  intensityPercentage = getComputedStyle(document.documentElement).getPropertyValue("--fog-strength").trim();

  const alphaPerLayer = intensityPercentage / 500.0;
  const [r, g, b] = codeToHex(colour);
  fogLayers.forEach(layer => {

    // Change transition speed
    if (isSlowTransition) {
      layer.style.transition = "background-color 5s ease";
    } else {
      layer.style.transition = "background-color 0.2s ease";
    }

    layer.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${alphaPerLayer})`;
  });
}

// Updates background image based on colour theme
function updateBackground(isSlowTransition) {
  let blendFraction = 0.2;
  brightnessPercent = getComputedStyle(document.documentElement).getPropertyValue("--background-brightness").trim();
  backgroundImgs.forEach(image => {

    // Change transition speed
    if (isSlowTransition) {
      image.style.transition = "filter 5s ease";
    } else {
      image.style.transition = "filter 0.2s ease";
    }

    const colour_back = getComputedStyle(image).getPropertyValue("--layer-back").trim();
    const colour_front = getComputedStyle(image).getPropertyValue("--layer-front").trim();
    image.style.filter = grayScaleAndRecolourFilter(blendColors(colour_front, colour_back, blendFraction), brightnessPercent);
    blendFraction += 0.2;
  });
}

// Switch theme class
function switchThemeClass(newTheme) {
  themes.forEach((theme) => {
    if (theme == newTheme) {
      html.classList.add(newTheme);
    } else {
      html.classList.remove(theme);
    }
  });
}

// Updates mode and theme
function updateModeAndTheme(isSlowTransition) {
  if (!themes.includes(theme)) {
    theme = themes[0];
    updateModeAndTheme(isSlowTransition);
    return;
  }

  // Set theme effects
  switchThemeClass(theme);
  
  switch (mode) {
    case "dark":
      html.classList.add("dark");
      break;
    case "light":
      html.classList.remove("dark");
      break;
    default:
      // Fix inconsistent modes
      mode = "dark";
      updateModeAndTheme(isSlowTransition);
  }

  // Update background
  updateBackground(isSlowTransition);
  updateFog(isSlowTransition);

  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme, mode } }));
}

// Initialize theme from localStorage or system preference
function initTheme() {
  // Restore mode
  const savedMode = localStorage.getItem("mode");
  const systemMode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  mode = savedMode || systemMode;

  // Restore theme
  theme = localStorage.getItem("theme") || getSeasonalTheme();

  updateModeAndTheme(false);
  init = false;
}

// Toggle theme
function toggleMode() {
  const isDark = html.classList.contains("dark");

  if (isDark) {
    mode = "light";
    localStorage.setItem("mode", "light");
  } else {
    mode = "dark";
    localStorage.setItem("mode", "dark");
  }

  updateModeAndTheme(false);
}

// Initialize theme on page load
initTheme()

// Seasonal theme from likelihood
function getSeasonalTheme() {
  const month = new Date().getMonth();

  let weights;

  if (month === 11 || month === 0 || month === 1) {
    // Winter
    weights = {
      snow: 0.65,
      rain: 0.20,
      normal: 0.15
    };
  } else if (month >= 5 && month <= 8) {
    // Rainy
    weights = {
      rain: 0.55,
      normal: 0.40,
      snow: 0.05
    };
  } else {
    // Spring / autumn
    weights = {
      normal: 0.60,
      rain: 0.35,
      snow: 0.05
    };
  }

  return weightedRandom(weights);
}


// Add click event listener to theme toggle button
if (themeToggle) {
  themeToggle.addEventListener("click", toggleMode)
}

// Automatic theme switch
setInterval(() => {
  theme = getSeasonalTheme();
  updateModeAndTheme(true);

  // Store theme
  localStorage.setItem("theme", theme);
}, 30000);

