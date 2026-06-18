/*
To add a new theme,
 - Add the theme name to themes list,
 - Define light and dark mode colours for it in styles.css,
 - Define a particle configuration,
 - Map the new particle to a theme in allParticles dictionary below,
*/
// Theme variable
const themes = ["normal", "rain", "snow"];
var theme = "rain";
var mode = "light";
var init = true;

// Element fetches
const themeToggle = document.getElementById("mode-toggle");
const html = document.documentElement;
const backgroundImgs = document.querySelectorAll(".back-images");
const fogLayers = document.querySelectorAll(".fog");

// Tab Switching for Writing Page
const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");
const sidebar = document.getElementById("sidebar");
const sidebarLinks = Array.from(document.querySelectorAll('#sidebar a')).reverse();

// Slow scroll background
const backgroundImg1 = document.getElementById("backimg1");
const backgroundImg2 = document.getElementById("backimg2");
const backgroundImg3 = document.getElementById("backimg3");
const backgroundImg4 = document.getElementById("backimg4");
const backgroundImg5 = document.getElementById("backimg5");

// Particle presets
var rainParticles = {
  baseSize: 0.4,
  randomSize: 0.1,
  durationMultiplier: 0.125,
  translateYRandom: 0,
  translateYOffset: 2.5 * screen.height,
  translateXRandom: 40,
  translateXOffset: -400,
  frequency: 3500,
  baseOpacity: 0.6,
  sizeDistributionSkew: 2,
  style: {
    backgroundColor: "var(--particle)",
    position: "absolute",
    width: "5px",
    height: "18px",
    borderRadius: "1px",
    rotate: "30deg"
  }
};

var noneParticles = {
  baseSize: 0.4,
  randomSize: 0.6,
  durationMultiplier: 0.125,
  translateYRandom: 0,
  translateYOffset: 0,
  translateXRandom: 0,
  translateXOffset: 0,
  frequency: 1,
  baseOpacity: 0.8,
  sizeDistributionSkew: 5,
  style: {
    backgroundColor: "var(--particle)",
    position: "absolute"
  }
};

var snowParticles = {
  baseSize: 0.6,
  randomSize: 1.6,
  sizeDistributionSkew: 4,
  durationMultiplier: 0.9,
  translateYOffset: 1.4 * screen.height,
  translateYRandom: 80,
  translateXOffset: 120,
  translateXRandom: 200,
  frequency: 900,
  baseOpacity: 0.85,
  style: {
    backgroundColor: "var(--particle)",
    position: "absolute",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    boxShadow: "0 0 10px rgb(from var(--particle) r g b / 0.6)",
    rotate: "0deg",
    transformOrigin: "center center"
  }
};

// Particle dictionary
const allParticles = {
  normal: noneParticles,
  rain: rainParticles,
  snow: snowParticles
}