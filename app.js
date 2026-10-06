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

// Allow MP4, WebM and MKV in the device picker. MKV is handled by the
// browser natively when supported; otherwise FFmpeg WebAssembly converts it
// locally on the device before playback/streaming.
if (movieFile) {
  movieFile.accept = "video/mp4,video/webm,video/x-matroska,.mp4,.webm,.mkv";
}

// Persistent host-only movie changer in the top bar.
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

// Bridge gesture reactions to the same reaction UI and Socket.IO room.
window.addEventListener("moviedate:gesture-reaction", event => {
  const detail = event.detail || {};
  const allowed = new Set(["hearts", "balloons", "emoji", "rain", "confetti", "fireworks", "lasers"]);
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

async function createRoom() {
  if (hasJoinedRoom) return;
  if (!socket.connected) {
    toast("Connecting… please try again in a moment");
    socket.connect();
    return;
  }

  const id = randomRoom();
  try {
    await joinRoom(id, true);
    if (!hasJoinedRoom || !roomId) {
      toast("Could not create room. Please try again.");
      return;
    }
    history.replaceState({}, "", `?room=${id}`);
    toast("Room created — share the link");
  } catch (error) {
    console.error("CREATE ROOM ERROR:", error);
    hasJoinedRoom = false;
    roomId = "";
    isHost = false;
    toast("Could not create room. Please try again.");
  }
}

async function joinRoom(id, host = false) {
  id = String(id || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  if (!id || hasJoinedRoom) return;

  roomId = id;
  isHost = host;
  hasJoinedRoom = true;

  setText("roomCode", roomId);
  updateChangeMovieButton();
  openApp();
  socket.emit("join-room", { roomId });
  await startCamera();
}

async function joinExistingRoom() {
  if (!roomId || hasJoinedRoom) return;
  await joinRoom(roomId, false);
}

function createCameraPeer(offerer = false) {
  if (cameraPeer) return cameraPeer;

  cameraPeer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" }
    ]
  });

  // Always send our local camera + microphone tracks. This is important for
  // the second participant: recvonly transceivers alone make the partner
  // visible to them, but do not send their own camera/mic back.
  const localKinds = new Set();
  if (localStream) {
    for (const track of localStream.getTracks()) {
      cameraPeer.addTrack(track, localStream);
      localKinds.add(track.kind);
    }
  }

  if (!localKinds.has("video")) {
    cameraPeer.addTransceiver("video", { direction: "recvonly" });
  }
  if (!localKinds.has("audio")) {
    cameraPeer.addTransceiver("audio", { direction: "recvonly" });
  }

  cameraPeer.ontrack = event => {
    console.log("CAMERA REMOTE TRACK RECEIVED");
    const stream = event.streams?.[0];
    if (stream && remoteVideo) remoteVideo.srcObject = stream;
    if (remoteVideo) {
      remoteVideo.autoplay = true;
      remoteVideo.playsInline = true;
      remoteVideo.muted = false;
      remoteVideo.play().catch(() => {});
    }
    if ($("remotePlaceholder")) $("remotePlaceholder").style.display = "none";
  };

  cameraPeer.onicecandidate = event => {
    if (!event.candidate) return;
    console.log("CAMERA ICE:", event.candidate.candidate);
    socket.emit("webrtc", { channel: "camera", type: "ice", candidate: event.candidate });
  };

  cameraPeer.onconnectionstatechange = () => {
    const state = cameraPeer?.connectionState;
    console.log("CAMERA CONNECTION:", state);
    if (state === "connected") setPartnerStatus("● live");
    else if (state === "connecting" || state === "new") setPartnerStatus("○ connecting");
    else if (state === "failed") setPartnerStatus("○ connection failed");
    else if (state === "disconnected") setPartnerStatus("○ disconnected");
  };

  if (offerer) {
    cameraPeer.createOffer()
      .then(offer => cameraPeer.setLocalDescription(offer))
      .then(() => socket.emit("webrtc", { channel: "camera", type: "offer", sdp: cameraPeer.localDescription }))
      .catch(err => console.error("CAMERA OFFER ERROR:", err));
  }

  return cameraPeer;
}

async function addQueuedIce(peer, queue) {
  while (queue.length) {
    const candidate = queue.shift();
    try { await peer.addIceCandidate(candidate); } catch (e) { console.warn("ICE queue error", e); }
  }
}

function createMoviePeer(offerer = false) {
  if (moviePeer) return moviePeer;

  moviePeer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" }
    ]
  });

  if (offerer && movieCaptureStream) {
    for (const track of movieCaptureStream.getTracks()) moviePeer.addTrack(track, movieCaptureStream);
  } else {
    moviePeer.addTransceiver("video", { direction: "recvonly" });
    moviePeer.addTransceiver("audio", { direction: "recvonly" });
  }

  moviePeer.ontrack = event => {
    console.log("MOVIE REMOTE TRACK RECEIVED", event.track.kind);
    if (!remoteMovieStream) remoteMovieStream = new MediaStream();
    if (!remoteMovieStream.getTracks().some(t => t.id === event.track.id)) {
      remoteMovieStream.addTrack(event.track);
    }

    movie.srcObject = remoteMovieStream;
    movie.removeAttribute("src");
    movie.autoplay = true;
    movie.playsInline = true;
    movie.muted = false;
    show("emptyState", false);
    show("movieLoading", false);
    movie.play().catch(() => {});
  };

  moviePeer.onicecandidate = event => {
    if (!event.candidate) return;
    console.log("MOVIE ICE:", event.candidate.candidate);
    socket.emit("webrtc", { channel: "movie", type: "ice", candidate: event.candidate });
  };

  moviePeer.onconnectionstatechange = () => {
    console.log("MOVIE CONNECTION:", moviePeer?.connectionState);
    if (moviePeer?.connectionState === "connected") show("movieLoading", false);
  };

  if (offerer && movieCaptureStream) {
    moviePeer.createOffer()
      .then(offer => moviePeer.setLocalDescription(offer))
      .then(() => socket.emit("webrtc", { channel: "movie", type: "offer", sdp: moviePeer.localDescription }))
      .catch(err => console.error("MOVIE OFFER ERROR:", err));
  }

  return moviePeer;
}

async function startMovieStream() {
  if (!isHost || movieStreamStarted || !movie.src || movie.srcObject) return;
  if (!movie.captureStream) {
    toast("This browser cannot stream the selected movie");
    return;
  }
  if (!partnerSocketId) return;
  if (movie.readyState < 2) return;

  try {
    movieCaptureStream = movie.captureStream();
    const tracks = movieCaptureStream.getTracks();
    console.log("MOVIE CAPTURE TRACKS:", tracks.map(t => t.kind));
    if (!tracks.length) return;

    movieStreamStarted = true;
    if (moviePeer) { moviePeer.close(); moviePeer = null; }
    createMoviePeer(true);
  } catch (error) {
    console.error("MOVIE STREAM ERROR:", error);
    movieStreamStarted = false;
  }
}

async function handleCameraSignal(msg) {
  if (!msg) return;
  const pc = cameraPeer || createCameraPeer(false);

  if (msg.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    await addQueuedIce(pc, cameraIceQueue);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("webrtc", { channel: "camera", type: "answer", sdp: pc.localDescription });
  } else if (msg.type === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    await addQueuedIce(pc, cameraIceQueue);
  } else if (msg.type === "ice" && msg.candidate) {
    if (pc.remoteDescription) {
      try { await pc.addIceCandidate(msg.candidate); } catch (e) { console.warn("CAMERA ICE ERROR:", e); }
    } else cameraIceQueue.push(msg.candidate);
  }
}

async function handleMovieSignal(msg) {
  if (!msg) return;
  const pc = moviePeer || createMoviePeer(false);

  if (msg.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    await addQueuedIce(pc, movieIceQueue);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("webrtc", { channel: "movie", type: "answer", sdp: pc.localDescription });
  } else if (msg.type === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    await addQueuedIce(pc, movieIceQueue);
  } else if (msg.type === "ice" && msg.candidate) {
    if (pc.remoteDescription) {
      try { await pc.addIceCandidate(msg.candidate); } catch (e) { console.warn("MOVIE ICE ERROR:", e); }
    } else movieIceQueue.push(msg.candidate);
  }
}

socket.on("connect", () => {
  console.log("SOCKET CONNECTED:", socket.id);
  setConnectionUI("Connected", false);
  if (roomId) joinExistingRoom();
});

socket.on("disconnect", () => {
  console.log("SOCKET DISCONNECTED");
  setConnectionUI("Disconnected", false);
});

socket.on("room-error", data => toast(data?.message || "Room error"));
socket.on("room-full", () => toast("This room already has two people"));

socket.on("room-joined", data => {
  isHost = !!data?.isHost;
  setText("roomCode", data?.roomId || roomId);
  updateChangeMovieButton();
  setPartnerStatus(data?.participants > 1 ? "● connected" : "○ waiting");
});

socket.on("room-state", data => {
  if (!data) return;
  if (data.hostSocketId === socket.id) isHost = true;
  updateChangeMovieButton();
  setText("roomCode", data.roomId || roomId);
  setPartnerStatus(data.participants > 1 ? "● connected" : "○ waiting");

  if (data.movie?.name) {
    setText("movieTitleText", data.movie.name);
    show("movieTitle", true);
  }

  if (data.playback && !isHost && movie.srcObject) {
    syncPlayback(data.playback);
  }
});

socket.on("peer-joined", async ({ socketId, hostSocketId }) => {
  partnerSocketId = socketId;
  setPartnerStatus("● connected");
  if (socket.id === hostSocketId) {
    isHost = true;
    updateChangeMovieButton();
    await startCamera();
    createCameraPeer(true);
  }
});

socket.on("peer-ready", async () => {
  if (!isHost) return;
  await startCamera();
  createCameraPeer(true);
  if (movie.readyState >= 2 && !movie.paused) await startMovieStream();
});

socket.on("peer-left", () => {
  partnerSocketId = null;
  setPartnerStatus("○ waiting");
  cameraIceQueue = [];
  movieIceQueue = [];

  if (cameraPeer) { cameraPeer.close(); cameraPeer = null; }
  if (moviePeer) { moviePeer.close(); moviePeer = null; }

  remoteVideo.srcObject = null;
  remoteMovieStream = null;
  movieStreamStarted = false;
  movieCaptureStream = null;
  if ($("remotePlaceholder")) $("remotePlaceholder").style.display = "grid";
});

socket.on("webrtc", async msg => {
  try {
    if (msg.channel === "movie") await handleMovieSignal(msg);
    else await handleCameraSignal(msg);
  } catch (error) {
    console.error(`${String(msg.channel || "camera").toUpperCase()} SIGNAL ERROR:`, error);
  }
});

socket.on("movie-meta", data => {
  if (!data?.name) return;
  setText("movieTitleText", data.name);
  show("movieTitle", true);
  show("movieLoading", true);
  show("emptyState", false);
});

function syncPlayback(data) {
  if (!data || !movie) return;
  suppressMovieEvent = true;
  try {
    if (Number.isFinite(data.time)) movie.currentTime = data.time;
    if (data.action === "play") movie.play().catch(() => {});
    else movie.pause();
  } finally {
    setTimeout(() => { suppressMovieEvent = false; }, 120);
  }
}

function sendPlayback(action) {
  if (!roomId || suppressMovieEvent) return;
  socket.emit("playback", { action, time: movie.currentTime });
}

function togglePlay(send = true) {
  if (!movie.src && !movie.srcObject) {
    toast("Choose a movie first");
    return;
  }
  if (movie.paused) movie.play().catch(() => {});
  else movie.pause();
  if (send) sendPlayback(movie.paused ? "pause" : "play");
}

function resetMovieStreamForNewMovie() {
  movieStreamStarted = false;
  if (moviePeer) {
    moviePeer.close();
    moviePeer = null;
  }
  if (movieCaptureStream) {
    movieCaptureStream.getTracks().forEach(track => track.stop());
    movieCaptureStream = null;
  }
  remoteMovieStream = null;
}

function showAddMovieState() {
  setText("emptyState", "");
  const title = document.querySelector("#emptyState .empty-title");
  const text = document.querySelector("#emptyState .empty-text");
  const button = $("chooseMovieBtn");
  if (title) title.textContent = "Movie finished";
  if (text) text.textContent = "Choose another movie to keep watching together";
  if (button) button.textContent = "＋ Add another movie";
  show("emptyState", true);
}

function restoreChooseMovieState() {
  const title = document.querySelector("#emptyState .empty-title");
  const text = document.querySelector("#emptyState .empty-text");
  const button = $("chooseMovieBtn");
  if (title) title.textContent = "Choose a movie";
  if (text) text.textContent = "Pick a movie from your device";
  if (button) button.textContent = "Choose movie";
}

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      if (existing.dataset.loaded === "true") resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => { script.dataset.loaded = "true"; resolve(); };
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureFFmpegLibraries() {
  if (window.FFmpegWASM && window.FFmpegUtil) return;
  await loadExternalScript("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.min.js");
  await loadExternalScript("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/umd/index.js");
}

async function ensureFFmpegLoaded() {
  if (ffmpegLoaded && ffmpeg) return ffmpeg;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    await ensureFFmpegLibraries();
    if (!window.FFmpegWASM || !window.FFmpegUtil) {
      throw new Error("FFmpeg library is not available");
    }

    const { FFmpeg } = window.FFmpegWASM;
    const { toBlobURL } = window.FFmpegUtil;
    ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => console.log("FFMPEG:", message));

    const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
    const workerBase = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd";

    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      classWorkerURL: await toBlobURL(`${workerBase}/814.ffmpeg.js`, "text/javascript")
    });

    ffmpegLoaded = true;
    return ffmpeg;
  })();

  try {
    return await ffmpegLoading;
  } finally {
    ffmpegLoading = null;
  }
}

async function convertMkvToMp4(file) {
  const engine = await ensureFFmpegLoaded();
  const { fetchFile } = window.FFmpegUtil;
  const inputName = "moviedate-input.mkv";
  const outputName = "moviedate-output.mp4";

  try {
    toast("Loading MKV decoder…");
    await engine.writeFile(inputName, await fetchFile(file));

    // First try a fast remux. This keeps the original video/audio quality.
    try {
      await engine.exec([
        "-i", inputName,
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-c", "copy",
        "-movflags", "+faststart",
        outputName
      ]);
    } catch (remuxError) {
      console.warn("MKV remux failed; transcoding to H.264/AAC:", remuxError);
      try { await engine.deleteFile(outputName); } catch (_) {}

      await engine.exec([
        "-i", inputName,
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        outputName
      ]);
    }

    const data = await engine.readFile(outputName);
    const blob = new Blob([data.buffer], { type: "video/mp4" });
    return new File([blob], file.name.replace(/\.mkv$/i, ".mp4"), { type: "video/mp4" });
  } finally {
    try { await engine.deleteFile(inputName); } catch (_) {}
    try { await engine.deleteFile(outputName); } catch (_) {}
  }
}

movieFile?.addEventListener("change", async event => {
  const originalFile = event.target.files?.[0];
  if (!originalFile) return;
  window.__movieDateOriginalFile = originalFile;

  const isMkv = /\.mkv$/i.test(originalFile.name) || originalFile.type === "video/x-matroska";
  let file = originalFile;

  try {
    if (isMkv) {
      // Let browsers that can decode this MKV play it directly first.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(originalFile);
      movie.srcObject = null;
      movie.src = objectUrl;
      movie.load();
      movie.muted = false;
      movie.playsInline = true;
      show("emptyState", false);
      show("movieLoading", true);
      setText("movieTitleText", originalFile.name);
      show("movieTitle", true);

      // Give native playback a chance. If it fails, the error handler below
      // will automatically run the FFmpeg fallback.
      try { await movie.play(); } catch (_) {}
      if (!movie.error) {
        toast("MKV ready");
        socket.emit("movie-meta", { name: originalFile.name });
        return;
      }

      file = await convertMkvToMp4(originalFile);
    }

    if (convertedObjectUrl) {
      URL.revokeObjectURL(convertedObjectUrl);
      convertedObjectUrl = null;
    }

    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);

    restoreChooseMovieState();
    resetMovieStreamForNewMovie();
    movie.srcObject = null;
    movie.src = objectUrl;
    movie.load();
    movie.muted = false;
    movie.playsInline = true;

    show("emptyState", false);
    show("movieTitle", true);
    show("movieLoading", false);
    setText("movieTitleText", originalFile.name);

    socket.emit("movie-meta", { name: originalFile.name });
    toast(isMkv ? "MKV decoded — movie ready" : "Movie ready");
  } catch (error) {
    console.error("MOVIE FILE ERROR:", error);
    show("movieLoading", false);
    toast(isMkv ? "Could not decode this MKV on this device" : "Could not load this movie");
  } finally {
    // Allows selecting the same file again.
    movieFile.value = "";
  }
});

let mkvFallbackRunning = false;
movie?.addEventListener("error", async () => {
  const file = window.__movieDateOriginalFile;
  console.error("MOVIE MEDIA ERROR:", movie.error, file?.name || "this movie");
  show("movieLoading", false);

  if (file && (/\.mkv$/i.test(file.name) || file.type === "video/x-matroska") && !mkvFallbackRunning) {
    mkvFallbackRunning = true;
    try {
      const converted = await convertMkvToMp4(file);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(converted);
      resetMovieStreamForNewMovie();
      movie.srcObject = null;
      movie.src = objectUrl;
      movie.load();
      show("emptyState", false);
      show("movieLoading", false);
      setText("movieTitleText", file.name);
      socket.emit("movie-meta", { name: file.name });
      toast("MKV decoded — movie ready");
    } catch (error) {
      console.error("MKV DECODER ERROR:", error);
      toast("Could not decode this MKV on this device");
    } finally {
      mkvFallbackRunning = false;
    }
  } else {
    toast("This video cannot be played. Try another file.");
  }
});

movie?.addEventListener("loadedmetadata", () => {
  setText("movieTime", `00:00 / ${formatTime(movie.duration)}`);
});

movie?.addEventListener("canplay", () => {
  show("movieLoading", false);
  if (isHost && !movie.paused) startMovieStream();
});

movie?.addEventListener("play", async () => {
  setText("playBtn", "Ⅱ");
  setText("centerPlayBtn", "Ⅱ");
  if (!suppressMovieEvent) sendPlayback("play");
  if (isHost) await startMovieStream();
});

movie?.addEventListener("pause", () => {
  setText("playBtn", "▶");
  setText("centerPlayBtn", "▶");
  if (!suppressMovieEvent) sendPlayback("pause");
});

movie?.addEventListener("timeupdate", () => {
  const duration = Number.isFinite(movie.duration) ? movie.duration : 0;
  const percent = duration ? (movie.currentTime / duration) * 100 : 0;
  const seek = $("seekBar");
  if (seek && !seek.matches(":active")) seek.value = percent;
  setText("movieTime", `${formatTime(movie.currentTime)} / ${formatTime(duration)}`);
});

movie?.addEventListener("ended", () => {
  setText("playBtn", "▶");
  setText("centerPlayBtn", "▶");
  if (!suppressMovieEvent) sendPlayback("pause");
  if (isHost) resetMovieStreamForNewMovie();
  showAddMovieState();
  toast("Movie finished — add another movie");
});

$("chooseMovieBtn")?.addEventListener("click", () => movieFile?.click());
$("playBtn")?.addEventListener("click", () => togglePlay(true));
$("centerPlayBtn")?.addEventListener("click", () => togglePlay(true));
$("movieTap")?.addEventListener("click", event => {
  if (event.target.closest("button,input")) return;
  togglePlay(true);
});

$("seekBar")?.addEventListener("input", event => {
  if (!Number.isFinite(movie.duration)) return;
  movie.currentTime = (Number(event.target.value) / 100) * movie.duration;
});
$("seekBar")?.addEventListener("change", () => sendPlayback("seek"));

$("muteBtn")?.addEventListener("click", () => {
  movie.muted = !movie.muted;
  setText("muteBtn", movie.muted ? "🔇" : "🔊");
});

$("fullscreenBtn")?.addEventListener("click", () => {
  const target = $("movieTap") || movie;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else target.requestFullscreen?.();
});

$("micBtn")?.addEventListener("click", () => {
  const track = localStream?.getAudioTracks?.()[0];
  if (!track) return toast("Microphone is not available");
  track.enabled = !track.enabled;
  setText("localMicState", track.enabled ? "🎙" : "🔇");
  setText("micBtn", track.enabled ? "🎙" : "🔇");
});

$("cameraBtn")?.addEventListener("click", () => {
  const track = localStream?.getVideoTracks?.()[0];
  if (!track) return toast("Camera is not available");
  track.enabled = !track.enabled;
  if ($("cameraBtn")) $("cameraBtn").textContent = track.enabled ? "📷" : "🚫";
  if ($("localPlaceholder")) $("localPlaceholder").style.display = track.enabled ? "none" : "grid";
});

$("shareBtn")?.addEventListener("click", async () => {
  if (!navigator.mediaDevices?.getDisplayMedia) return toast("Screen sharing is not supported here");
  toast("Screen sharing is not connected to the movie stream yet");
});

$("shareRoomBtn")?.addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?room=${roomId}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Room link copied");
  } catch {
    window.prompt("Copy this room link", url);
  }
});

$("exitBtn")?.addEventListener("click", () => {
  socket.emit("leave-room");
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (cameraPeer) cameraPeer.close();
  if (moviePeer) moviePeer.close();
  localStream = null;
  cameraPeer = null;
  moviePeer = null;
  hasJoinedRoom = false;
  partnerSocketId = null;
  roomId = "";
  isHost = false;
  history.replaceState({}, "", location.pathname);
  show("app", false);
  show("roomGate", true);
  toast("Left room");
});

$("createRoomBtn")?.addEventListener("click", createRoom);
$("joinPromptBtn")?.addEventListener("click", openJoinSheet);
$("closeJoinBtn")?.addEventListener("click", closeJoinSheet);
$("joinBackdrop")?.addEventListener("click", closeJoinSheet);
$("joinRoomBtn")?.addEventListener("click", async () => {
  const code = $("roomCodeInput")?.value || "";
  closeJoinSheet();
  await joinRoom(code, false);
});
$("roomCodeInput")?.addEventListener("keydown", event => {
  if (event.key === "Enter") $("joinRoomBtn")?.click();
});

$("chatForm")?.addEventListener("submit", event => {
  event.preventDefault();
  const input = $("chatInput");
  const text = input?.value.trim();
  if (!text) return;
  addMessage(text, true);
  socket.emit("chat", { text });
  input.value = "";
});

socket.on("chat", data => addMessage(String(data?.text || ""), false));

for (const button of document.querySelectorAll(".reaction-btn")) {
  button.addEventListener("click", () => {
    const emoji = button.dataset.emoji;
    if (!emoji) return;
    showReaction(emoji);
    socket.emit("reaction", { emoji });
  });
}

socket.on("reaction", data => {
  if (data?.emoji) showReaction(data.emoji);
});

// Mobile browsers may block autoplay with audio. Once the user interacts
// with the page, retry playback for the remote camera and movie stream.
let mediaUnlocked = false;
const unlockRemoteMedia = () => {
  if (mediaUnlocked) return;
  mediaUnlocked = true;
  if (remoteVideo?.srcObject) remoteVideo.play().catch(() => {});
  if (movie?.srcObject) movie.play().catch(() => {});
};
document.addEventListener("pointerdown", unlockRemoteMedia, { once: true, passive: true });
document.addEventListener("touchstart", unlockRemoteMedia, { once: true, passive: true });

// Initial UI state.
show("app", false);
if (roomId) {
  // A direct room link still shows the room gate until Socket.IO connects,
  // then joinExistingRoom() opens the app. This prevents a broken blank room.
  setText("roomCode", roomId);
}
