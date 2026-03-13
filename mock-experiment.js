// TEST ONLY — remove before production
// Simulates a synchronous Optimizely experiment activation.
// Loaded via document.write so it blocks rendering, same as the real snippet.
// Mutates DOM targets immediately — if there is no flicker, the fix works.
(function () {
  // Read optional ?delay=ms from this script's own src URL
  var delay = 0;
  var scripts = document.getElementsByTagName('script');
  var thisScript = scripts[scripts.length - 1];
  if (thisScript && thisScript.src) {
    var m = thisScript.src.match(/[?&]delay=(\d+)/);
    if (m) delay = parseInt(m[1], 10);
  }

  function applyVariation() {
    var bar = document.getElementById('announcement-bar');
    if (bar) {
      bar.style.background = '#e6f4ed';
      bar.style.borderColor = '#a8d5b5';
      bar.innerHTML = '<span>🎉 Mock Experiment — Variation B is active</span>';
    }

    var hero = document.getElementById('hero-banner');
    if (hero) {
      hero.style.background = 'linear-gradient(135deg, #0d5c2e 0%, #1a8a4a 100%)';
      var h2 = hero.querySelector('h2');
      var p = hero.querySelector('p');
      if (h2) h2.textContent = 'Variation B — Mock Experiment Active';
      if (p) p.textContent = 'This content was applied synchronously before first paint. No flicker = fix works.';
    }
  }

  function schedule() {
    if (delay > 0) {
      setTimeout(applyVariation, delay);
    } else {
      applyVariation();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
})();
