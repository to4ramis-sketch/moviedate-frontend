import { GestureRecognizer, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

/* MovieDate: invisible one-hand gesture recognition + horizontal emoji picker. */
(() => {
  const video = document.getElementById("localVideo");
  if (!video || document.querySelector("[data-moviedate-emoji-panel]")) return;

  const STORAGE_KEY = "moviedate-gesture-reactions-enabled";
  let enabled = localStorage.getItem(STORAGE_KEY) !== "false";
  let recognizer = null, loading = false, rafId = 0, lastVideoTime = -1, lastInferenceAt = 0;
  let candidate = "", candidateFrames = 0, lastGesture = "", lastTriggerAt = 0;

  const GESTURES = {
    hearts: { emoji: "❤️", category: "ILoveYou", effect: "hearts" },
    balloons: { emoji: "🎈", category: "Victory", effect: "balloons" },
    thumbsUp: { emoji: "👍", category: "Thumb_Up", effect: "emoji" },
    thumbsDown: { emoji: "👎", category: "Thumb_Down", effect: "emoji" },
    rain: { emoji: "🌧️", category: "Open_Palm", effect: "rain" },
    confetti: { emoji: "🎉", category: "Pointing_Up", effect: "confetti" },
    fireworks: { emoji: "🎆", category: "Closed_Fist", effect: "fireworks" },
    lasers: { emoji: "🔫", category: "Horns", effect: "lasers" }
  };

  const EMOJIS = ["❤️","🥰","😘","😍","💋","💕","💖","💗","💘","💞","🫶","🤗","😊","😉","😏","😂","🤣","🥹","😭","😈","🔥","✨","💯","👍","👎","👏","🙌","🎉","🎊","🎈","🌹","🌷","💐","🧸","🍿","🌙","⭐","💫","🌧️","🎆"];
  const panel = document.createElement("section");
  panel.className = "md-emoji-panel";
  panel.dataset.moviedateEmojiPanel = "true";
  panel.setAttribute("aria-label", "Emoji reactions");
  panel.innerHTML = `
    <div class="md-emoji-panel-head"><span>Reactions</span><button type="button" class="md-gesture-toggle" aria-label="Pause hand gestures" title="Pause hand gestures" aria-pressed="${enabled}">${enabled ? "✋" : "⏸"}</button></div>
    <div class="md-emoji-strip" role="toolbar" aria-label="Swipe for more emoji reactions">
      ${EMOJIS.map((emoji, i) => `<button type="button" class="md-emoji-button" data-emoji-index="${i}" aria-label="Send ${emoji}">${emoji}</button>`).join("")}
    </div>`;
  const anchor = document.querySelector(".people-header") || video.parentElement;
  if (anchor) anchor.insertAdjacentElement("afterend", panel);

  panel.querySelectorAll(".md-emoji-button").forEach(button => {
    button.addEventListener("click", () => {
      const emoji = EMOJIS[Number(button.dataset.emojiIndex)];
      if (emoji) window.dispatchEvent(new CustomEvent("moviedate:gesture-reaction", { detail: { emoji, effect: "emoji" } }));
      button.classList.add("is-tapped");
      window.setTimeout(() => button.classList.remove("is-tapped"), 220);
    });
  });
  const toggle = panel.querySelector(".md-gesture-toggle");
  toggle.addEventListener("click", () => {
    enabled = !enabled;
    localStorage.setItem(STORAGE_KEY, String(enabled));
    toggle.textContent = enabled ? "✋" : "⏸";
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.setAttribute("aria-label", enabled ? "Pause hand gestures" : "Resume hand gestures");
    toggle.title = enabled ? "Pause hand gestures" : "Resume hand gestures";
    if (enabled) { init(); loop(); } else cancelAnimationFrame(rafId);
  });

  function renderEffect(effect) {
    const layer = document.getElementById("reactionLayer") || video.parentElement;
    if (!layer) return;
    if (getComputedStyle(layer).position === "static") layer.style.position = "relative";
    const palettes = {
      hearts: ["❤️", "💗", "💕", "💖"], balloons: ["🎈", "🎈", "💖"],
      rain: ["💧", "🌧️", "💧"], confetti: ["🎉", "✨", "🎊", "💖"],
      fireworks: ["🎆", "✨", "💥", "⭐"], lasers: ["💫", "✨", "🔴"], emoji: []
    };
    const particles = palettes[effect];
    if (!particles || effect === "emoji") return;
    const count = effect === "rain" ? 12 : effect === "lasers" ? 5 : 8;
    for (let i = 0; i < count; i++) {
      const particle = document.createElement("span");
      particle.className = "md-gesture-burst";
      particle.textContent = particles[Math.floor(Math.random() * particles.length)];
      particle.style.left = `${8 + Math.random() * 84}%`;
      particle.style.top = effect === "rain" ? `${Math.random() * 30}%` : `${45 + Math.random() * 35}%`;
      particle.style.setProperty("--md-drift", `${Math.round(Math.random() * 90 - 45)}px`);
      if (effect === "rain") particle.style.animationDuration = `${.75 + Math.random() * .55}s`;
      layer.appendChild(particle);
      particle.addEventListener("animationend", () => particle.remove(), { once: true });
      window.setTimeout(() => particle.remove(), 2400);
    }
  }
  window.addEventListener("moviedate:play-gesture-effect", event => renderEffect(event.detail?.effect));
  window.addEventListener("moviedate:remote-gesture-effect", event => renderEffect(event.detail?.effect));

  function classifyHorns(result) {
    const landmarks = result?.landmarks?.[0];
    const category = result?.gestures?.[0]?.[0]?.categoryName;
    if (!landmarks || category !== "ILoveYou") return null;
    const thumbTip = landmarks[4], indexMcp = landmarks[5], pinkyMcp = landmarks[17];
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const palmWidth = Math.max(d(indexMcp, pinkyMcp), 0.001);
    return d(thumbTip, indexMcp) / palmWidth < 0.62 ? "lasers" : "hearts";
  }
  function mapGesture(result) {
    if (!result?.gestures?.length || !result.gestures[0]?.length) return null;
    const category = result.gestures[0][0].categoryName;
    if (category === "ILoveYou") return classifyHorns(result);
    const byCategory = { Victory: "balloons", Thumb_Up: "thumbsUp", Thumb_Down: "thumbsDown", Open_Palm: "rain", Pointing_Up: "confetti", Closed_Fist: "fireworks" };
    return byCategory[category] || null;
  }
  function sendReaction(key) {
    const item = GESTURES[key];
    if (!item) return;
    window.dispatchEvent(new CustomEvent("moviedate:gesture-reaction", { detail: { emoji: item.emoji, effect: item.effect } }));
    window.dispatchEvent(new CustomEvent("moviedate:play-gesture-effect", { detail: { effect: item.effect } }));
    toggle.classList.add("is-gesture-active");
    window.setTimeout(() => toggle.classList.remove("is-gesture-active"), 500);
  }
  async function init() {
    if (!enabled || recognizer || loading) return;
    loading = true;
    try {
      const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
      const options = { baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task", delegate: "GPU" }, runningMode: "VIDEO", numHands: 1, minHandDetectionConfidence: .55, minHandPresenceConfidence: .55, minTrackingConfidence: .55 };
      try { recognizer = await GestureRecognizer.createFromOptions(vision, options); }
      catch (_) { options.baseOptions.delegate = "CPU"; recognizer = await GestureRecognizer.createFromOptions(vision, options); }
      loop();
    } catch (error) { console.error("[MovieDate hand gestures]", error); toggle.classList.add("is-gesture-unavailable"); }
    finally { loading = false; }
  }
  function loop() {
    cancelAnimationFrame(rafId);
    const tick = now => {
      rafId = requestAnimationFrame(tick);
      if (!enabled || !recognizer || document.hidden || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
      if (now - lastInferenceAt < 130 || video.currentTime === lastVideoTime) return;
      lastInferenceAt = now; lastVideoTime = video.currentTime;
      try {
        const key = mapGesture(recognizer.recognizeForVideo(video, now));
        if (!key) { candidate = ""; candidateFrames = 0; if (now - lastTriggerAt > 900) lastGesture = ""; return; }
        candidateFrames = key === candidate ? candidateFrames + 1 : 1; candidate = key;
        if (candidateFrames >= 4 && (key !== lastGesture || now - lastTriggerAt > 1700)) { sendReaction(key); lastGesture = key; lastTriggerAt = now; }
      } catch (error) { console.warn("[MovieDate gesture frame]", error); }
    };
    rafId = requestAnimationFrame(tick);
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelAnimationFrame(rafId); else if (enabled) { lastVideoTime = -1; init(); loop(); } });
  video.addEventListener("loadedmetadata", () => { if (enabled) { init(); loop(); } });
  if (enabled) init();
})();
