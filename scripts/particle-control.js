// Theme switcher
const bgLayer = document.getElementById('particle-layer');

setInterval(() => {
  // Pseudo frequency amplifier logic to overcome browser tick limits
  let activeParticles = allParticles[theme];
  if (activeParticles) {
    let expected = activeParticles.frequency / 1000;
    let duplicates = Math.floor(expected) + (Math.random() < (expected % 1) ? 1 : 0);
    for (let i = 0; i < duplicates; i++) {
      const p = document.createElement('div');
      Object.assign(p.style, activeParticles.style);

      const size = Math.pow(Math.random(), activeParticles.sizeDistributionSkew) * activeParticles.randomSize + activeParticles.baseSize;
      p.style.transform = `scale(${size})`;
      p.style.left = `${
        Math.random() * 
        (window.innerWidth + Math.abs(activeParticles.translateXOffset) + Math.abs(activeParticles.translateXRandom) / 2) +
        Math.min(0, -activeParticles.translateXOffset - Math.abs(activeParticles.translateXRandom / 2))
      }px`;
      p.style.opacity = activeParticles.baseOpacity * size / (activeParticles.baseSize + activeParticles.randomSize);

      bgLayer.appendChild(p);

      const duration = activeParticles.durationMultiplier * (3000 + (1.5 - size) * 2000);
      const start = performance.now();

      const xError = (0.5 - Math.random()) * activeParticles.translateXRandom;
      const yError = (0.5 - Math.random()) * activeParticles.translateYRandom;

      function animateFrame(time) {
        const progress = Math.min((time - start) / duration, 1);
        const y = progress * (activeParticles.translateYOffset + yError);
        const x = progress * (activeParticles.translateXOffset + xError);

        p.style.transform = `scale(${size}) translateX(${x}px) translateY(${y}px)`;

        if (progress < 1) requestAnimationFrame(animateFrame);
        else p.remove();
      }

      requestAnimationFrame(animateFrame);
    }
  }
}, 1);
