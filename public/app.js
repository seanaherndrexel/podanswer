// Small progressive enhancements. Site works fully without JS.
(function () {
  // GA4 event on listen clicks if gtag is present
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a.btn-listen');
    if (a && window.gtag) {
      var parts = a.getAttribute('href').split('/');
      gtag('event', 'listen_click', { podcast: parts[2], platform: (parts[3] || '').split('?')[0] });
    }
  });
})();

// Timestamp jump: clicking a quote's timestamp seeks the episode player.
(function () {
  function fmt(el) { return el; }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.ts-btn');
    if (!b) return;
    var audio = document.getElementById('ep-audio');
    if (!audio) return;
    var t = parseFloat(b.getAttribute('data-t'));
    if (isNaN(t)) return;
    e.preventDefault();
    document.querySelectorAll('.ts-btn.playing').forEach(function (x) { x.classList.remove('playing'); });
    b.classList.add('playing');
    var go = function () { try { audio.currentTime = t; } catch (err) {} audio.play(); };
    if (audio.readyState >= 1) { go(); }
    else { audio.addEventListener('loadedmetadata', go, { once: true }); audio.load(); }
    var box = document.getElementById('player');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (window.gtag) gtag('event', 'timestamp_play', { seconds: t });
  });
})();
