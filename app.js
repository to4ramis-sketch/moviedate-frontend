const BACKEND_URL = "https://moviedate-backend-production.up.railway.app";
const socket = io(BACKEND_URL, { transports: ["websocket", "polling"] });
const params = new URLSearchParams(window.location.search);

let roomId = (params.get("room") || "").toUpperCase();
let isHost = false;
let hasJoinedRoom = false;
let localStream = null;
let cameraPeer = null;
let moviePeer = null;
let partnerSocketId = null;
let movieCaptureStream = null;
let remoteMovieStream = null;
let movieStreamStarted = false;
let cameraIceQueue = [];
let movieIceQueue = [];
let suppressMovieEvent = false;
let objectUrl = null;
let ffmpeg = null;
let ffmpegLoaded = false;
let ffmpegLoading = null;
let convertedObjectUrl = null;

const $ = id => document.getElementById(id);
const movie = $("movie");
const movieFile = $("movieFile");
const localVideo = $("localVideo");
const remoteVideo = $("remoteVideo");

if (movieFile) {
  movieFile.accept = "video/mp4,video/webm,video/x-matroska,.mp4,.webm,.mkv";
}

function ensureChangeMovieButton() {
  const header = document.querySelector(".topbar");
  const roomInfo = document.querySelector(".room-info");
  if (!header || !roomInfo || $("changeMovieTopBtn")) return;

  const button = document.createElement("button");
  button.id = "changeMovieTopBtn";
  button.type = "button";
  button.className = "top-button change-movie-button";
  button.textContent = "Change movie";
  button.title = "Choose a different movie";
  button.style.display = "none";
  button.addEventListener("click", () => {
    if (!isHost) {
      toast("Only the room host can change the movie");
      return;
    }
    movieFile?.click();
  });

  roomInfo.insertAdjacentElement("afterend", button);
}

function updateChangeMovieButton() {
  ensureChangeMovieButton();
  const button = $("changeMovieTopBtn");
  if (button) button.style.display = isHost && hasJoinedRoom ? "inline-flex" : "none";
}

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function formatTime(sec) {
  if (!Number.isFinite(sec)) return "00:00";
  sec = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

function randomRoom() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function show(id, visible = true) {
  const el = $(id);
  if (el) el.classList.toggle("hidden", !visible);
}

function setConnectionUI(text, online = false) {
  const el = $("connectionStatus");
  if (!el) return;
  el.innerHTML = `<i></i>${text}`;
  el.classList.toggle("on", online);
}

function setPartnerStatus(text) {
  setConnectionUI(text, text.includes("live") || text.includes("connected"));
  setText("bottomRoomStatus", text.includes("live") || text.includes("connected") ? "Partner connected" : "Waiting for partner");
}

function addMessage(text, me = false) {
  const box = $("messages");
  if (!box) return;
  const el = document.createElement("div");
  el.className = `bubble${me ? " me" : ""}`;
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function showReaction(emoji, options = {}) {
  if (!emoji) return;

  const layer = $("reactionLayer");
  const movieArea =
    $("movieTap") ||
    movie?.closest(".movie-container, .movie-stage, .movie-area") ||
    movie?.parentElement;

  const target = layer || movieArea || document.body;
  if (!target) return;

  const isOverlay = target === layer;
  const count = Math.max(1, Math.min(12, Number(options.count) || 1));
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  if (isOverlay && movieArea && !layer.dataset.movieDatePositioned) {
    const movieAreaStyle = getComputedStyle(movieArea);
    if (movieAreaStyle.position === "static") movieArea.style.position = "relative";
    if (layer.parentElement !== movieArea && !movieArea.contains(layer)) {
      movieArea.appendChild(layer);
    }
    layer.dataset.movieDatePositioned = "true";
  }

  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "float-reaction";
    el.textContent = emoji;
    el.setAttribute("aria-hidden", "true");

    const spread = count > 1 ? (Math.random() - 0.5) * Math.min(70, count * 8) : 0;
    const left = 12 + Math.random() * 76 + spread;
    const top = 52 + Math.random() * 28;

    el.style.left = `${Math.max(5, Math.min(90, left))}%`;
    el.style.top = `${Math.max(35, Math.min(82, top))}%`;
    el.style.setProperty("--reaction-delay", `${i * (reducedMotion ? 0 : 65)}ms`);
    el.style.setProperty("--reaction-drift", `${Math.round((Math.random() - 0.5) * 100)}px`);
    el.style.setProperty("--reaction-rotate", `${Math.round((Math.random() - 0.5) * 30)}deg`);

    if (reducedMotion) {
      el.style.animation = "none";
      el.style.opacity = "1";
    }

    target.appendChild(el);
    window.setTimeout(() => el.remove(), reducedMotion ? 1000 : 1900);
  }
}

window.addEventListener("moviedate:gesture-reaction", event => {
  const detail = event.detail || {};
  const allowed = new Set([
    "hearts",
    "balloons",
    "emoji",
    "rain",
    "confetti",
    "fireworks",
    "lasers"
  ]);

  if (!detail.emoji || !allowed.has(detail.effect)) return;

  showReaction(detail.emoji, { count: detail.count || 1 });
  socket.emit("reaction", {
    emoji: detail.emoji,
    effect: detail.effect,
    count: detail.count || 1
  });
});

function openApp() {
  show("roomGate", false);
  show("joinSheet", false);
  show("app", true);
  ensureChangeMovieButton();
  updateChangeMovieButton();
}

function openJoinSheet() {
  const sheet = $("joinSheet");
  if (!sheet) return;
  sheet.classList.remove("hidden");
  sheet.setAttribute("aria-hidden", "false");
  setTimeout(() => $("roomCodeInput")?.focus(), 50);
}

function closeJoinSheet() {
  const sheet = $("joinSheet");
  if (!sheet) return;
  sheet.classList.add("hidden");
  sheet.setAttribute("aria-hidden", "true");
}

async function startCamera() {
  if (localStream) return localStream;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Camera is not supported in this browser");
    return null;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: true
    });

    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true;
      localVideo.playsInline = true;
      localVideo.autoplay = true;
      localVideo.play().catch(() => {});
    }

    if ($("localPlaceholder")) $("localPlaceholder").style.display = "none";
    setText("localMicState", "🎙");

    if (cameraPeer) {
      for (const track of localStream.getTracks()) {
        if (!cameraPeer.getSenders().some(s => s.track === track)) {
          cameraPeer.addTrack(track, localStream);
        }
      }
    }

    return localStream;
  } catch (error) {
    console.error("CAMERA ERROR:", error);
    toast("Camera/mic permission not granted");
    setText("localMicState", "○");
    return null;
  }
}
