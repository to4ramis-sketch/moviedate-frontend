import { GestureRecognizer, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

/* MovieDate hand gestures: uses the existing camera stream and existing bottom reaction row. */
(() => {
  const video = document.getElementById("localVideo");
  const reactionRow = document.querySelector(".reactions");
  if (!video || !reactionRow || window.__movieDateGestureModuleLoaded) return;
  window.__movieDateGestureModuleLoaded = true;

  const STORAGE_KEY = "moviedate-gesture-reactions-enabled";
  let enabled = localStorage.getItem(STORAGE_KEY) !== "false";
  let recognizer = null;
  let loading = false;
  let rafId = 0;
  let lastVideoTime = -1;
  let lastInferenceAt = 0;
  let candidate = "";
  let candidateFrames = 0;
  let lastGesture = "";
  let lastTriggerAt = 0;

  const GESTURES = {
    hearts: { emoji: "❤️", effect: "hearts" },
    balloons: { emoji: "🎈", effect: "balloons" },
    thumbsUp: { emoji: "👍", effect: "emoji" },
    thumbsDown: { emoji: "👎", effect: "emoji" },
    rain: { emoji: "🌧️", effect: "rain" },
    confetti: { emoji: "🎉", effect: "confetti" },
    fireworks: { emoji: "🎆", effect: "fireworks" },
    lasers: { emoji: "💫", effect: "lasers" }
  };

  const EXTRA_EMOJIS = [
    "😍", "💋", "💕", "💖", "💗", "💘", "💞", "🫶", "🤗", "😊",
    "😉", "😏", "🤣", "🥹", "😭", "😈", "✨", "💯", "👏", "🙌",
    "🎊", "🌹", "🌷", "💐", "🧸", "🍿", "🌙", "⭐", "💫", "🎆", "💌", "💝"
  ];

  // Keep the five existing buttons. Add extra emojis into that same bottom row.
  EXTRA_EMOJIS.forEach(emoji => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reaction-btn md-extra-reaction-btn";
    button.dataset.emoji = emoji;
    button.setAttribute("aria-label", `Send ${emoji}`);
    button.title = emoji;
    button.textContent = emoji;
    button.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("moviedate:gesture-reaction", {
        detail: { emoji, effect: "emoji" }
      }));
      button.classList.add("md-reaction-tapped");
      window.setTimeout(() => button.classList.remove("md-reaction-tapped"), 220);
    });
    reactionRow.appendChild(button);
  });

  // Tiny hand toggle in the existing row; no visible gesture directory or extra panel.
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "reaction-btn md-gesture-toggle";
  toggleButton.textContent = enabled ? "✋" : "⏸";
  toggleButton.title = enabled ? "Pause hand gestures" : "Resume hand gestures";
  toggleButton.setAttribute("aria-label", toggleButton.title);
  toggleButton.setAttribute("aria-pressed", String(enabled));
  toggleButton.dataset.noReaction = "true";
  reactionRow.appendChild(toggleButton);

  toggleButton.addEventListener("click", () => {
    enabled = !enabled;
    localStorage.setItem(STORAGE_KEY, String(enabled));
    toggleButton.textContent = enabled ? "✋" : "⏸";
    toggleButton.title = enabled ? "Pause hand gestures" : "Resume hand gestures";
    toggleButton.setAttribute("aria-label", toggleButton.title);
    toggleButton.setAttribute("aria-pressed", String(enabled));
    toggleButton.classList.toggle("md-gesture-active", enabled);
    if (enabled) {
      initRecognizer();
      startLoop();
    } else {
      cancelAnimationFrame(rafId);
    }
  });

  function ensureFloatingLayer() {
    let layer = document.getElementById("reactionLayer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "reactionLayer";
      document.body.appendChild(layer);
    }
    layer.classList.add("md-floating-reaction-layer");
    return layer;
  }

  function playEffect(effect, emoji = "❤️") {
    const layer = ensureFloatingLayer();
    const target = document.getElementById("movieTap") || document.getElementById("movie")?.parentElement || document.querySelector(".movie-container");
    const rect = target?.getBoundingClientRect();
    const area = rect && rect.width > 0 && rect.height > 0
      ? rect
      : { left: window.innerWidth * 0.04, top: window.innerHeight * 0.12, width: window.innerWidth * 0.72, height: window.innerHeight * 0.72 };
    const palettes = {
      hearts: ["❤️", "💗", "💕", "💖", "💘", "💞", "🥰"],
      balloons: ["🎈", "🎈", "💖", "✨"],
      rain: ["💧", "🌧️", "💧", "💦"],
      confetti: ["🎉", "✨", "🎊", "💖", "⭐"],
      fireworks: ["🎆", "✨", "💥", "⭐", "🎇"],
      lasers: ["💫", "✨", "🔴", "⚡"],
      emoji: [emoji, emoji, emoji, "✨"]
    };
    const particles = palettes[effect] || palettes.emoji;
    const count = effect === "rain" ? 18 : effect === "emoji" ? 12 : 14;

    for (let i = 0; i < count; i++) {
      const particle = document.createElement("span");
      particle.className = "md-gesture-burst";
      particle.textContent = particles[Math.floor(Math.random() * particles.length)];
      particle.style.left = `${area.left + area.width * (0.12 + Math.random() * 0.76)}px`;
      particle.style.top = effect === "rain"
        ? `${area.top + area.height * (0.02 + Math.random() * 0.22)}px`
        : `${area.top + area.height * (0.42 + Math.random() * 0.45)}px`;
      particle.style.setProperty("--md-drift", `${Math.round(Math.random() * 150 - 75)}px`);
      particle.style.setProperty("--md-rise", `${Math.round(180 + Math.random() * 260)}px`);
      particle.style.setProperty("--md-delay", `${Math.random() * 180}ms`);
      layer.appendChild(particle);
      particle.addEventListener("animationend", () => particle.remove(), { once: true });
      window.setTimeout(() => particle.remove(), 2800);
    }
  }

  window.addEventListener("moviedate:play-gesture-effect", event => {
    playEffect(event.detail?.effect, event.detail?.emoji);
  });
  window.addEventListener("moviedate:remote-gesture-effect", event => {
    playEffect(event.detail?.effect, event.detail?.emoji);
  });
  // Manual taps on either the original emoji buttons or added buttons produce a floating burst.
  window.addEventListener("moviedate:gesture-reaction", event => {
    const detail = event.detail || {};
    playEffect(detail.effect || "emoji", detail.emoji || "❤️");
  });
  reactionRow.addEventListener("click", event => {
    const button = event.target.closest(".reaction-btn");
    if (!button || button.dataset.noReaction === "true") return;
    // Original five buttons are handled by app.js; this adds only the local floating animation.
    if (!button.classList.contains("md-extra-reaction-btn")) {
      playEffect("emoji", button.dataset.emoji || button.textContent.trim() || "❤️");
    }
  });

  function mapGesture(result) {
    const category = result?.gestures?.[0]?.[0]?.categoryName;
    const mapping = {
      ILoveYou: "hearts",
      Victory: "balloons",
      Thumb_Up: "thumbsUp",
      Thumb_Down: "thumbsDown",
      Open_Palm: "rain",
      Pointing_Up: "confetti",
      Closed_Fist: "fireworks"
    };
    return mapping[category] || null;
  }

  function sendGesture(key) {
    const item = GESTURES[key];
    if (!item) return;
    window.dispatchEvent(new CustomEvent("moviedate:gesture-reaction", {
      detail: { emoji: item.emoji, effect: item.effect }
    }));
    toggleButton.classList.add("md-gesture-active");
    window.setTimeout(() => toggleButton.classList.remove("md-gesture-active"), 450);
  }

  async function initRecognizer() {
    if (!enabled || recognizer || loading) return;
    loading = true;
    toggleButton.classList.remove("md-gesture-unavailable");
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );
      const options = {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.45,
        minHandPresenceConfidence: 0.45,
        minTrackingConfidence: 0.45
      };
      try {
        recognizer = await GestureRecognizer.createFromOptions(vision, options);
      } catch (gpuError) {
        options.baseOptions.delegate = "CPU";
        recognizer = await GestureRecognizer.createFromOptions(vision, options);
      }
      toggleButton.classList.remove("md-gesture-unavailable");
      startLoop();
    } catch (error) {
      console.error("[MovieDate] Could not start hand gesture recognition:", error);
      toggleButton.classList.add("md-gesture-unavailable");
      toggleButton.title = "Hand gestures unavailable — check camera permission and internet connection";
    } finally {
      loading = false;
    }
  }

  function startLoop() {
    cancelAnimationFrame(rafId);
    const tick = now => {
      rafId = requestAnimationFrame(tick);
      if (!enabled || !recognizer || document.hidden) return;
      if (!video.srcObject || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return;
      if (now - lastInferenceAt < 100 || video.currentTime === lastVideoTime) return;
      lastInferenceAt = now;
      lastVideoTime = video.currentTime;
      try {
        const result = recognizer.recognizeForVideo(video, now);
        const key = mapGesture(result);
        if (!key) {
          candidate = "";
          candidateFrames = 0;
          if (now - lastTriggerAt > 1100) lastGesture = "";
          return;
        }
        candidateFrames = key === candidate ? candidateFrames + 1 : 1;
        candidate = key;
        if (candidateFrames >= 3 && (key !== lastGesture || now - lastTriggerAt > 1800)) {
          sendGesture(key);
          lastGesture = key;
          lastTriggerAt = now;
        }
      } catch (error) {
        console.warn("[MovieDate] Hand gesture frame failed:", error);
      }
    };
    rafId = requestAnimationFrame(tick);
  }

  video.addEventListener("loadeddata", () => { if (enabled) { initRecognizer(); startLoop(); } });
  video.addEventListener("playing", () => { if (enabled) { initRecognizer(); startLoop(); } });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(rafId);
    else if (enabled) { lastVideoTime = -1; initRecognizer(); startLoop(); }
  });
  if (enabled) initRecognizer();
})();
