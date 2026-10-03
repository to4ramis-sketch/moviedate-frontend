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

const $ = id => document.getElementById(id);
const movie = $("movie");
const movieFile = $("movieFile");
const localVideo = $("localVideo");
const remoteVideo = $("remoteVideo");

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

function showReaction(emoji) {
  const layer = $("reactionLayer") || document.body;
  const el = document.createElement("div");
  el.className = "float-reaction";
  el.textContent = emoji;
  el.style.left = `${25 + Math.random() * 55}vw`;
  el.style.top = `${55 + Math.random() * 20}vh`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

function openApp() {
  show("roomGate", false);
  show("joinSheet", false);
  show("app", true);
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
  const id = randomRoom();
  isHost = true;
  history.replaceState({}, "", `?room=${id}`);
  await joinRoom(id, true);
  toast("Room created — share the link");
}

async function joinRoom(id, host = false) {
  id = String(id || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  if (!id || hasJoinedRoom) return;

  roomId = id;
  isHost = host;
  hasJoinedRoom = true;

  setText("roomCode", roomId);
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

  if (localStream) {
    for (const track of localStream.getTracks()) cameraPeer.addTrack(track, localStream);
  } else {
    cameraPeer.addTransceiver("video", { direction: "recvonly" });
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
  setPartnerStatus(data?.participants > 1 ? "● connected" : "○ waiting");
});

socket.on("room-state", data => {
  if (!data) return;
  if (data.hostSocketId === socket.id) isHost = true;
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

movieFile?.addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (!file) return;

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);

  movie.srcObject = null;
  movie.src = objectUrl;
  movie.load();
  movie.muted = false;
  movie.playsInline = true;

  show("emptyState", false);
  show("movieTitle", true);
  show("movieLoading", false);
  setText("movieTitleText", file.name);

  socket.emit("movie-meta", { name: file.name });
  toast("Movie ready");
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

// Initial UI state.
show("app", false);
if (roomId) {
  // A direct room link still shows the room gate until Socket.IO connects,
  // then joinExistingRoom() opens the app. This prevents a broken blank room.
  setText("roomCode", roomId);
}
