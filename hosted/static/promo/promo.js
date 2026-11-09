// Scroll fallback for browsers without CSS scroll-driven animations.
// Each sentinel marks a beat of the pinned chat; crossing the viewport middle sets the step.
(function () {
  var root = document.documentElement;
  if (!root.classList.contains("motion") || root.classList.contains("sd")) return;
  var stage = document.getElementById("stage");
  var sentinels = document.querySelectorAll(".sent");
  if (!stage || !sentinels.length || !("IntersectionObserver" in window)) {
    root.classList.remove("motion");
    return;
  }
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) stage.dataset.step = entry.target.dataset.s;
    });
  }, { rootMargin: "-50% 0px -50% 0px" });
  sentinels.forEach(function (sentinel) { observer.observe(sentinel); });
})();
