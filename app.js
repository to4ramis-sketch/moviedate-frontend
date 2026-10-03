const BACKEND_URL = "https://moviedate-backend-production.up.railway.app";

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 700,
  reconnectionDelayMax: 5000,
});

const params = new URLSearchParams(location.search);
let roomId = params.get("room")?.trim().toUpperCase() || null;
let isHost = false;
let joinedOnServer = false;
let joinInProgress = false;
let localStream = null;
let peer = null;
let partnerSocketId = null;
let pendingIce = [];
let movieCaptureStream = null;
let movieVideoSender = null;
let movieAudioSender = null;
let movieStreamId = null;
let remoteMovieStreamId = null;
let remoteMovieStream = null;
let makingOffer = false;
let queuedOffer = false;
let hostPlaybackState = "idle";
let heartbeat = null;
let controlsTimer = null;
let reconnectTimer = null;

const $ = (id) => document.getElementById(id);
const movie = $("movie");
const movieFile = $("movieFile");
const localVideo = $("localVideo");
const remoteVideo = $("remoteVideo");

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "00:00";
  seconds = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function randomRoom() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function setConnected(connected) {
  $("roomStatus")?.classList.toggle("on", connected);
  if ($("syncBadge")) $("syncBadge").textContent = connected ? "online" : "offline";
}

function setPartnerStatus(value) {
  if ($("partnerStatus")) $("partnerStatus").textContent = value;
}

function updateHostUI() {
  const changeMovie = $("changeMovie");
  const seek = $("seek");
  if (changeMovie) changeMovie.style.display = isHost ? "" : "none";
  if (seek) seek.style.display = isHost ? "" : "none";
}

function showGate(show) {
  $("roomGate")?.classList.toggle("show", show);
}

function showMovieControls() {
  $("videoWrap")?.classList.add("controls-visible");
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => {
    if (!movie?.paused) $("videoWrap")?.classList.remove("controls-visible");
  }, 2200);
}

function addMessage(text, mine = false) {
  const list = $("messages");
  if (!list) return;
  $("messageEmpty")?.remove();
  const item = document.createElement("div");
  item.className = `bubble${mine ? " me" : ""}`;
  item.textContent = text;
  list.appendChild(item);
  list.scrollTop = list.scrollHeight;
}

function showReaction(emoji) {
  const el = document.createElement("div");
  el.className = "float-reaction";
  el.textContent = emoji;
  el.style.left = `${25 + Math.random() * 60}vw`;
  el.style.top = `${55 + Math.random() * 25}vh`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

/* -------------------- room -------------------- */

async function startCamera() {
  if (localStream) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Camera unavailable");
    return false;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640, max: 640 },
        height: { ideal: 360, max: 360 },
        frameRate: { ideal: 15, max: 20 },
      },
      audio: true,
    });

    localVideo.srcObject = localStream;
    localVideo.muted = true;
    localVideo.autoplay = true;
    localVideo.playsInline = true;
    localVideo.play().catch(() => {});
    $("localPlaceholder")?.style.setProperty("display", "none");
    if ($("youStatus")) $("youStatus").textContent = "●";
    return true;
  } catch (error) {
    console.error("getUserMedia:", error);
    if ($("youStatus")) $("youStatus").textContent = "○";
    toast("Camera permission needed");
    return false;
  }
}

async function joinRoom(id) {
  const normalized = String(id || "").trim().toUpperCase();
  if (!normalized || joinedOnServer || joinInProgress) return;

  roomId = normalized;
  history.replaceState({}, "", `?room=${encodeURIComponent(roomId)}`);
  $("roomCode").textContent = roomId;
  showGate(false);
  updateHostUI();

  joinInProgress = true;
  await startCamera();

  if (socket.connected) {
    socket.emit("join-room", { roomId });
  }
}

async function createRoom() {
  isHost = true;
  joinedOnServer = false;
  joinInProgress = false;
  await joinRoom(randomRoom());
  toast("Room ready");
}

function leaveRoom() {
  stopHeartbeat();
  clearTimeout(reconnectTimer);

  if (roomId && socket.connected) socket.emit("leave-room", { roomId });

  peer?.close();
  peer = null;
  partnerSocketId = null;
  pendingIce = [];
  makingOffer = false;
  queuedOffer = false;

  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;

  movieCaptureStream?.getTracks().forEach((track) => track.stop());
  movieCaptureStream = null;
  movieVideoSender = null;
  movieAudioSender = null;
  movieStreamId = null;
  remoteMovieStreamId = null;
  remoteMovieStream = null;

  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
  if (movie) {
    movie.pause();
    movie.srcObject = null;
    movie.removeAttribute("src");
    movie.load();
  }

  joinedOnServer = false;
  joinInProgress = false;
  roomId = null;
  isHost = false;
  hostPlaybackState = "idle";

  history.replaceState({}, "", location.pathname);
  $("roomCode").textContent = "—";
  setPartnerStatus("○");
  $("localPlaceholder")?.style.setProperty("display", "grid");
  $("remotePlaceholder")?.style.setProperty("display", "grid");
  updateHostUI();
  showGate(true);
}

/* -------------------- socket -------------------- */

socket.on("connect", async () => {
  console.log("Socket connected", socket.id);
  setConnected(true);
  if (roomId && !joinedOnServer && !joinInProgress) await joinRoom(roomId);
});

socket.on("disconnect", () => {
  console.log("Socket disconnected");
  setConnected(false);
  joinedOnServer = false;
  joinInProgress = false;
  setPartnerStatus("○");
});

socket.on("connect_error", (error) => {
  console.warn("Socket error", error.message);
  setConnected(false);
});

socket.on("room-full", () => {
  joinedOnServer = false;
  joinInProgress = false;
  toast("Room is full");
});

socket.on("room-error", ({ message }) => {
  joinedOnServer = false;
  joinInProgress = false;
  toast(message || "Room error");
});

socket.on("room-state", async (data) => {
  if (!data) return;

  joinedOnServer = true;
  joinInProgress = false;
  roomId = data.roomId || roomId;
  isHost = data.hostSocketId === socket.id;
  hostPlaybackState = data.playback?.state || "idle";

  $("roomCode").textContent = roomId || "—";
  updateHostUI();
  showGate(false);
  setPartnerStatus(data.participants > 1 ? "●" : "○");

  if (data.movie?.name) setMovieMeta(data.movie);
});

socket.on("peer-available", async ({ socketId, hostSocketId }) => {
  partnerSocketId = socketId;
  setPartnerStatus("◌");

  if (socket.id === hostSocketId) {
    isHost = true;
    await ensurePeer();
    await sendOffer();
  }
});

socket.on("peer-joined", async ({ socketId, hostSocketId }) => {
  partnerSocketId = socketId;
  setPartnerStatus("◌");

  if (socket.id === hostSocketId) {
    isHost = true;
    await ensurePeer();
    await sendOffer();
  }
});

socket.on("peer-left", () => {
  partnerSocketId = null;
  peer?.close();
  peer = null;
  pendingIce = [];
  makingOffer = false;
  queuedOffer = false;
  remoteVideo.srcObject = null;
  remoteMovieStream = null;
  remoteMovieStreamId = null;
  setPartnerStatus("○");
  $("remotePlaceholder")?.style.setProperty("display", "grid");
});

/* -------------------- WebRTC -------------------- */

async function ensurePeer() {
  if (peer) return peer;

  peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
    ],
  });

  localStream?.getTracks().forEach((track) => {
    peer.addTrack(track, localStream);
  });

  if (isHost && movieCaptureStream) addMovieTracks();

  peer.ontrack = handleRemoteTrack;

  peer.onicecandidate = (event) => {
    if (event.candidate && roomId) {
      socket.emit("webrtc", {
        roomId,
        type: "ice",
        candidate: event.candidate,
      });
    }
  };

  peer.onconnectionstatechange = () => {
    const state = peer?.connectionState;
    console.log("WebRTC", state);

    if (state === "connected") {
      setPartnerStatus("●");
      reconnectingPeer = false;
    } else if (state === "connecting" || state === "new") {
      setPartnerStatus("◌");
    } else if (state === "failed" || state === "disconnected") {
      setPartnerStatus("○");
      schedulePeerReconnect();
    }
  };

  peer.oniceconnectionstatechange = () => {
    if (peer?.iceConnectionState === "failed") schedulePeerReconnect();
  };

  return peer;
}

function addMovieTracks() {
  if (!peer || !movieCaptureStream || !isHost) return;

  const videoTrack = movieCaptureStream.getVideoTracks()[0];
  const audioTrack = movieCaptureStream.getAudioTracks()[0];

  if (videoTrack && !movieVideoSender) {
    movieVideoSender = peer.addTrack(videoTrack, movieCaptureStream);
  }
  if (audioTrack && !movieAudioSender) {
    movieAudioSender = peer.addTrack(audioTrack, movieCaptureStream);
  }

  movieStreamId = movieCaptureStream.id;
}

async function replaceMovieTracks() {
  if (!peer || !movieCaptureStream || !isHost) return;

  const videoTrack = movieCaptureStream.getVideoTracks()[0];
  const audioTrack = movieCaptureStream.getAudioTracks()[0];

  if (movieVideoSender && videoTrack) {
    await movieVideoSender.replaceTrack(videoTrack);
  } else if (videoTrack) {
    movieVideoSender = peer.addTrack(videoTrack, movieCaptureStream);
  }

  if (movieAudioSender && audioTrack) {
    await movieAudioSender.replaceTrack(audioTrack);
  } else if (audioTrack) {
    movieAudioSender = peer.addTrack(audioTrack, movieCaptureStream);
  }

  movieStreamId = movieCaptureStream.id;
}

async function sendOffer() {
  if (!isHost || !peer) return;

  if (makingOffer || peer.signalingState !== "stable") {
    queuedOffer = true;
    return;
  }

  makingOffer = true;

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("webrtc", {
      roomId,
      type: "offer",
      sdp: peer.localDescription,
      movieStreamId: movieStreamId || null,
    });
  } catch (error) {
    console.error("Offer", error);
  } finally {
    makingOffer = false;
  }
}

async function flushIce() {
  if (!peer?.remoteDescription) return;

  while (pendingIce.length) {
    const candidate = pendingIce.shift();
    try {
      await peer.addIceCandidate(candidate);
    } catch (error) {
      console.warn("ICE candidate", error);
    }
  }
}

socket.on("webrtc", async (message) => {
  if (!message) return;

  try {
    if (message.type === "offer") {
      const newMovieId = message.movieStreamId || null;
      if (newMovieId !== remoteMovieStreamId) {
        remoteMovieStreamId = newMovieId;
        remoteMovieStream = null;
      }

      await ensurePeer();
      await peer.setRemoteDescription(new RTCSessionDescription(message.sdp));
      await flushIce();

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      socket.emit("webrtc", {
        roomId,
        type: "answer",
        sdp: peer.localDescription,
      });
      return;
    }

    if (message.type === "answer") {
      if (!peer) return;
      await peer.setRemoteDescription(new RTCSessionDescription(message.sdp));
      await flushIce();

      if (queuedOffer && peer.signalingState === "stable") {
        queuedOffer = false;
        setTimeout(() => sendOffer(), 0);
      }
      return;
    }

    if (message.type === "ice" && message.candidate) {
      const candidate = new RTCIceCandidate(message.candidate);
      if (peer?.remoteDescription) await peer.addIceCandidate(candidate);
      else pendingIce.push(candidate);
    }
  } catch (error) {
    console.error("WebRTC signal", error);
  }
});

let reconnectingPeer = false;
function schedulePeerReconnect() {
  if (reconnectingPeer || !roomId) return;
  reconnectingPeer = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(async () => {
    try {
      peer?.close();
      peer = null;
      pendingIce = [];
      makingOffer = false;
      queuedOffer = false;

      if (isHost && partnerSocketId && socket.connected) {
        await ensurePeer();
        await sendOffer();
      }
    } finally {
      reconnectingPeer = false;
    }
  }, 900);
}

/* -------------------- remote media -------------------- */

function handleRemoteTrack(event) {
  const stream = event.streams?.[0];
  const track = event.track;
  if (!stream) return;

  if (!isHost && remoteMovieStreamId && stream.id === remoteMovieStreamId) {
    if (!remoteMovieStream) remoteMovieStream = new MediaStream();
    if (!remoteMovieStream.getTrackById(track.id)) remoteMovieStream.addTrack(track);

    movie.srcObject = remoteMovieStream;
    movie.autoplay = true;
    movie.playsInline = true;
    movie.muted = false;
    $("emptyState")?.classList.add("hidden");

    if (hostPlaybackState === "playing") {
      movie.play().catch(() => toast("Tap movie"));
    } else {
      movie.pause();
    }

    track.onended = () => {
      if (hostPlaybackState === "ended") movie.pause();
    };
    return;
  }

  if (track.kind === "video") {
    remoteVideo.srcObject = stream;
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    remoteVideo.play().catch(() => {});
    $("remotePlaceholder")?.style.setProperty("display", "none");
    setPartnerStatus("●");
  }
}

/* -------------------- playback sync -------------------- */

function stopHeartbeat() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

function startHeartbeat() {
  stopHeartbeat();
  if (!isHost || !movieCaptureStream || !roomId) return;
  heartbeat = setInterval(() => {
    if (movie && !movie.paused && !movie.ended) sendPlayback("playing");
  }, 2000);
}

function sendPlayback(state) {
  if (!isHost || !roomId || !movie) return;
  hostPlaybackState = state;
  socket.emit("playback-state", {
    roomId,
    state,
    time: Number(movie.currentTime) || 0,
  });
}

function applyGuestPlayback(state) {
  hostPlaybackState = state || "paused";
  if (!movie?.srcObject) return;

  if (state === "playing") {
    movie.play().catch(() => toast("Tap movie"));
  } else {
    movie.pause();
  }
}

socket.on("playback-state", (state) => {
  if (isHost || !state) return;
  applyGuestPlayback(state.state);
});

movie?.addEventListener("play", () => {
  $("videoWrap")?.classList.remove("paused");
  if (isHost && movieCaptureStream) {
    sendPlayback("playing");
    startHeartbeat();
  }
});

movie?.addEventListener("pause", () => {
  $("videoWrap")?.classList.add("paused");
  if (isHost && movieCaptureStream && !movie.ended) sendPlayback("paused");
});

movie?.addEventListener("ended", () => {
  $("videoWrap")?.classList.add("paused");
  if (isHost) {
    stopHeartbeat();
    sendPlayback("ended");
    movieCaptureStream?.getTracks().forEach((track) => track.stop());
  }
});

movie?.addEventListener("waiting", () => {
  if (isHost && movieCaptureStream && !movie.ended) sendPlayback("buffering");
});

movie?.addEventListener("playing", () => {
  if (isHost && movieCaptureStream && !movie.ended) {
    sendPlayback("playing");
    startHeartbeat();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;

  if (!socket.connected && roomId) {
    socket.connect();
    return;
  }

  if (isHost && movieCaptureStream && movie) {
    sendPlayback(movie.ended ? "ended" : movie.paused ? "paused" : "playing");
  }

  if (!isHost && movie?.srcObject && hostPlaybackState === "playing") {
    movie.play().catch(() => {});
  }
});

/* -------------------- movie -------------------- */

async function loadLocalMovie(file) {
  if (!file || !movie || !isHost) return;

  if (typeof movie.captureStream !== "function") {
    toast("Use Chrome");
    return;
  }

  movieCaptureStream?.getTracks().forEach((track) => track.stop());
  movieCaptureStream = null;
  movieStreamId = null;

  const url = URL.createObjectURL(file);
  movie.srcObject = null;
  movie.src = url;
  movie.load();
  $("emptyState")?.classList.add("hidden");

  await new Promise((resolve) => {
    if (movie.readyState >= 1) resolve();
    else movie.addEventListener("loadedmetadata", resolve, { once: true });
  });

  try {
    await movie.play();
  } catch {
    $("videoWrap")?.classList.add("paused");
  }

  try {
    movieCaptureStream = movie.captureStream();
    movieStreamId = movieCaptureStream.id;

    await ensurePeer();
    await replaceMovieTracks();

    if (partnerSocketId) await sendOffer();
    startHeartbeat();
    sendPlayback(movie.paused ? "paused" : "playing");

    socket.emit("movie-meta", {
      roomId,
      name: file.name,
      duration: Number(movie.duration) || 0,
    });

    toast("Streaming");
  } catch (error) {
    console.error("Movie stream", error);
    toast("Could not stream movie");
  }

  movieFile.value = "";
}

movieFile?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) loadLocalMovie(file);
});

$("chooseMovieBtn")?.addEventListener("click", () => movieFile?.click());
$("changeMovie")?.addEventListener("click", () => movieFile?.click());

function setMovieMeta(data) {
  if ($("movieName")) $("movieName").textContent = data.name || "";
  if ($("movieTitle")) $("movieTitle").textContent = data.name || "";
  if ($("duration") && Number(data.duration) > 0) $("duration").textContent = formatTime(Number(data.duration));
}

socket.on("movie-meta", setMovieMeta);

/* -------------------- movie controls -------------------- */

async function togglePlay() {
  if (!movie) return;

  if (!isHost) {
    movie.play().catch(() => toast("Tap movie"));
    return;
  }

  if (movie.paused) await movie.play().catch(() => {});
  else movie.pause();
}

$("playBtn")?.addEventListener("click", togglePlay);
$("movieTap")?.addEventListener("click", togglePlay);
$("videoWrap")?.addEventListener("pointermove", showMovieControls);
$("movie")?.addEventListener("click", showMovieControls);

$("seek")?.addEventListener("input", (event) => {
  if (!isHost || !movie?.duration) return;
  movie.currentTime = (Number(event.target.value) / 100) * movie.duration;
});

$("seek")?.addEventListener("change", () => {
  if (isHost) sendPlayback(movie?.paused ? "paused" : "playing");
});

movie?.addEventListener("timeupdate", () => {
  if ($("currentTime")) $("currentTime").textContent = formatTime(movie.currentTime);
  if ($("seek") && isHost && Number.isFinite(movie.duration)) {
    $("seek").value = (movie.currentTime / movie.duration) * 100;
  }
});

movie?.addEventListener("loadedmetadata", () => {
  if ($("duration")) $("duration").textContent = formatTime(movie.duration);
});

$("muteBtn")?.addEventListener("click", () => {
  if (movie) movie.muted = !movie.muted;
});

$("fullscreenBtn")?.addEventListener("click", () => {
  $("videoWrap")?.requestFullscreen?.();
});

/* -------------------- chat / reactions -------------------- */

$("chatForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("chatInput");
  const text = input?.value.trim();
  if (!text || !roomId) return;
  addMessage(text, true);
  socket.emit("chat", { roomId, text });
  input.value = "";
});

socket.on("chat", (data) => {
  if (data?.text) addMessage(data.text, false);
});

$("reactionRow")?.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  const emoji = button?.dataset.reaction;
  if (!emoji || !roomId) return;
  showReaction(emoji);
  socket.emit("reaction", { roomId, emoji });
});

socket.on("reaction", (data) => {
  if (data?.emoji) showReaction(data.emoji);
});

/* -------------------- camera controls -------------------- */

$("micBtn")?.addEventListener("click", async () => {
  await startCamera();
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  toast(track.enabled ? "Mic on" : "Mic off");
});

$("cameraBtn")?.addEventListener("click", async () => {
  await startCamera();
  const track = localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  $("localPlaceholder")?.style.setProperty("display", track.enabled ? "none" : "grid");
});

/* -------------------- sharing / exit -------------------- */

async function shareRoom() {
  if (!roomId) return;
  const url = location.href;

  try {
    if (navigator.share) {
      await navigator.share({ title: "MovieDate", url });
    } else {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    }
  } catch {}
}

$("shareBtn")?.addEventListener("click", shareRoom);
$("roomPill")?.addEventListener("click", shareRoom);
$("exitBtn")?.addEventListener("click", leaveRoom);

/* -------------------- room gate -------------------- */

$("createRoomBtn")?.addEventListener("click", createRoom);
$("joinPromptBtn")?.addEventListener("click", () => {
  $("joinSheet").hidden = false;
  setTimeout(() => $("roomCodeInput")?.focus(), 40);
});
$("closeJoinBtn")?.addEventListener("click", () => {
  $("joinSheet").hidden = true;
});
$("joinRoomBtn")?.addEventListener("click", async () => {
  const code = $("roomCodeInput")?.value.trim().toUpperCase();
  if (!code) return;
  isHost = false;
  joinedOnServer = false;
  joinInProgress = false;
  $("joinSheet").hidden = true;
  await joinRoom(code);
});
$("roomCodeInput")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("joinRoomBtn")?.click();
});

/* -------------------- initial -------------------- */

if (roomId) {
  $("roomCode").textContent = roomId;
  updateHostUI();
  showGate(false);
} else {
  $("roomCode").textContent = "—";
  showGate(true);
}
