import { GestureRecognizer, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

(() => {
  const video = document.getElementById("localVideo");
  const header = document.querySelector(".people-header");
  if (!video || !header) return;

  const storeKey = "moviedate-gesture-reactions-enabled";
  const emojiFor = {
    ILoveYou: "❤️",
    Thumb_Up: "❤️",
    Victory: "🥰",
    Open_Palm: "😘",
    Pointing_Up: "🔥"
  };
  let enabled = localStorage.getItem(storeKey) === "true";
  let recognizer = null, loading = false, raf = 0, lastFrame = 0;
  let lastSentAt = 0, lastSentGesture = "";

  const control = document.createElement("div");
  control.className = "gesture-reaction-control";
  const status = document.createElement("span");
  status.className = "gesture-reaction-status";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gesture-reaction-toggle";
  control.append(status, button);
  header.appendChild(control);

  function update(message) {
    status.textContent = message || (enabled ? "Show a hand gesture" : "Gestures off");
    button.textContent = enabled ? "Gestures on ✓" : "Gestures off";
    button.classList.toggle("is-enabled", enabled);
    button.setAttribute("aria-pressed", String(enabled));
  }
  function setEnabled(value) {
    enabled = value;
    localStorage.setItem(storeKey, String(value));
    update();
    if (enabled) init();
    else cancelAnimationFrame(raf);
  }
  button.addEventListener("click", () => setEnabled(!enabled));

  async function init() {
    if (!enabled || recognizer || loading) return;
    loading = true;
    update("Loading model…");
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
        numHands: 1
      };
      try {
        recognizer = await GestureRecognizer.createFromOptions(vision, options);
      } catch (_) {
        options.baseOptions.delegate = "CPU";
        recognizer = await GestureRecognizer.createFromOptions(vision, options);
      }
      update("Show a hand gesture");
      loop();
    } catch (error) {
      console.error("[MovieDate gestures]", error);
      update("Model unavailable");
    } finally {
      loading = false;
    }
  }
  function loop() {
    cancelAnimationFrame(raf);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!enabled || !recognizer || video.readyState < 2 || !video.videoWidth) return;
      const now = performance.now();
      if (now - lastFrame < 125) return;
      lastFrame = now;
      try {
        const result = recognizer.recognizeForVideo(video, now);
        const item = result.gestures?.[0]?.[0];
        if (!item || item.score < 0.72) return;
        const emoji = emojiFor[item.categoryName];
        if (!emoji || now - lastSentAt < 1100) return;
        if (item.categoryName === lastSentGesture && now - lastSentAt < 1800) return;
        const reactionButton = [...document.querySelectorAll(".reaction-btn")]
          .find(el => el.dataset.emoji === emoji);
        if (!reactionButton) return;
        lastSentAt = now;
        lastSentGesture = item.categoryName;
        update(`Sent ${emoji}`);
        reactionButton.click(); // Reuses existing app reaction/socket behavior.
        setTimeout(() => enabled && update(), 1200);
      } catch (error) {
        console.debug("[MovieDate gestures] Frame skipped", error);
      }
    };
    raf = requestAnimationFrame(tick);
  }

  video.addEventListener("loadeddata", () => enabled && init());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && enabled) init();
  });
  update();
  if (enabled) init();
})();
