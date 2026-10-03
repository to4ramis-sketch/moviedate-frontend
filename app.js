const BACKEND_URL = "https://moviedate-backend-production.up.railway.app";
const socket = io(BACKEND_URL, { transports: ["websocket", "polling"] });
const params = new URLSearchParams(window.location.search);
let roomId = params.get("room");
let isHost = false;
let hasJoinedRoom = false;
let localStream = null;
let peer = null;
let partnerSocketId = null;
let pendingIceCandidates = [];

const $ = (id) => document.getElementById(id);
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

async function startCamera() {
  if (localStream) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Camera is not supported in this browser");
    return;
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: true,
    });

    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true;
      localVideo.autoplay = true;
      localVideo.playsInline = true;
      localVideo.play().catch(() => {});
    }

    if ($("localPlaceholder")) $("localPlaceholder").style.display = "none";
    if ($("youStatus")) $("youStatus").textContent = "● live";

    if (peer) {
      localStream.getTracks().forEach((track) => {
        if (!peer.getSenders().some((sender) => sender.track === track)) {
          peer.addTrack(track, localStream);
        }
      });
    }
  } catch (error) {
    console.error("Camera/mic permission error:", error);
    if ($("youStatus")) $("youStatus").textContent = "○ camera off";
    toast("Camera/mic permission not granted");
  }
}

async function joinRoom(id) {
  if (!id || hasJoinedRoom) return;
  roomId = id.trim().toUpperCase();
  hasJoinedRoom = true;
  $("roomCode").textContent = roomId;
  $("hostBtn").textContent = isHost ? "Host" : "Joined";
  await startCamera();
  socket.emit("join-room", { roomId });
}

async function createRoom() {
  const id = randomRoom();
  isHost = true;
  hasJoinedRoom = false;
  history.replaceState({}, "", `?room=${id}`);
  $("roomCode").textContent = id;
  $("hostBtn").textContent = "Host";
  $("hostNote").textContent = "You are the host. Choose a local movie.";
  await joinRoom(id);
  toast("Room created — share the link");
}

function setConnected(on) {
  $("roomStatus")?.classList.toggle("on", on);
  if ($("connectionText")) $("connectionText").textContent = on ? "Connected" : "Offline";
  if ($("syncBadge")) $("syncBadge").textContent = on ? "Synced room" : "Not connected";
}

function addMessage(text, me = false) {
  const messages = $("messages");
  if (!messages) return;
  const el = document.createElement("div");
  el.className = "bubble" + (me ? " me" : "");
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

function reactionEmoji(emoji) {
  const el = document.createElement("div");
  el.className = "float-reaction";
  el.textContent = emoji;
  el.style.left = 25 + Math.random() * 60 + "vw";
  el.style.top = 55 + Math.random() * 25 + "vh";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

socket.on("connect", async () => {
  console.log("MovieDate Socket.IO connected:", socket.id);
  setConnected(true);
  if (roomId && !hasJoinedRoom) await joinRoom(roomId);
});

socket.on("disconnect", () => {
  console.log("MovieDate Socket.IO disconnected");
  setConnected(false);
  hasJoinedRoom = false;
  if ($("partnerStatus")) $("partnerStatus").textContent = "○ offline";
});

socket.on("room-error", (data) => toast(data?.message || "Room error"));

socket.on("room-state", (data) => {
  if (!data) return;
  if (data.roomId) {
    roomId = data.roomId;
    $("roomCode").textContent = roomId;
  }
  isHost = data.hostSocketId === socket.id;
  $("hostBtn").textContent = isHost ? "Host" : "Joined";
  if (isHost && $("hostNote")) $("hostNote").textContent = "You are the host. Choose a local movie.";
  if ($("partnerStatus")) $("partnerStatus").textContent = data.participants > 1 ? "● connected" : "○ waiting";
});

socket.on("peer-joined", async ({ socketId, hostSocketId }) => {
  partnerSocketId = socketId;
  if ($("partnerStatus")) $("partnerStatus").textContent = "● connecting";
  // Only the host starts the WebRTC offer.
  if (socket.id === hostSocketId) await createPeer(true);
});

socket.on("peer-left", () => {
  if ($("partnerStatus")) $("partnerStatus").textContent = "○ waiting";
  if (peer) peer.close();
  peer = null;
  partnerSocketId = null;
  pendingIceCandidates = [];
  if (remoteVideo) remoteVideo.srcObject = null;
  if ($("remotePlaceholder")) $("remotePlaceholder").style.display = "grid";
});

async function createPeer(offerer = false) {
  if (peer) peer.close();
  peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
    ],
  });

  pendingIceCandidates = [];

  if (localStream) {
    localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));
  }

  peer.ontrack = (event) => {
    if (!remoteVideo) return;
    remoteVideo.srcObject = event.streams[0];
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    remoteVideo.play().catch(() => {});
    if ($("remotePlaceholder")) $("remotePlaceholder").style.display = "none";
  };

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc", { roomId, type: "ice", candidate: event.candidate });
    }
  };

  peer.onconnectionstatechange = () => {
    const state = peer.connectionState;
    console.log("WebRTC state:", state);
    if (!$('partnerStatus')) return;
    if (state === "connected") $("partnerStatus").textContent = "● live";
    else if (state === "connecting" || state === "new") $("partnerStatus").textContent = "○ connecting";
    else if (state === "failed" || state === "disconnected" || state === "closed") $("partnerStatus").textContent = "○ " + state;
  };

  if (offerer) {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("webrtc", { roomId, type: "offer", sdp: offer });
  }
}

async function flushIceCandidates() {
  if (!peer?.remoteDescription) return;
  while (pendingIceCandidates.length) {
    const candidate = pendingIceCandidates.shift();
    try { await peer.addIceCandidate(candidate); } catch (e) { console.warn("ICE error", e); }
  }
}

socket.on("webrtc", async (message) => {
  try {
    if (message.type === "offer") {
      if (!peer) await createPeer(false);
      await peer.setRemoteDescription(new RTCSessionDescription(message.sdp));
      await flushIceCandidates();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("webrtc", { roomId, type: "answer", sdp: answer });
      return;
    }

    if (message.type === "answer") {
      if (!peer) return;
      await peer.setRemoteDescription(new RTCSessionDescription(message.sdp));
      await flushIceCandidates();
      return;
    }

    if (message.type === "ice" && message.candidate) {
      const candidate = new RTCIceCandidate(message.candidate);
      if (peer?.remoteDescription) await peer.addIceCandidate(candidate);
      else pendingIceCandidates.push(candidate);
    }
  } catch (error) {
    console.error("WebRTC signaling error:", error);
  }
});

movieFile?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  movie.src = URL.createObjectURL(file);
  movie.load();
  movie.play().catch(() => {});
  $("emptyState")?.classList.add("hidden");
  if ($("movieName")) $("movieName").textContent = file.name;
  if ($("movieTitle")) $("movieTitle").textContent = file.name;
  socket.emit("movie-meta", { roomId, name: file.name });
});

$("changeMovie")?.addEventListener("click", () => movieFile?.click());
$("playBtn")?.addEventListener("click", () => togglePlay(true));
movie?.addEventListener("click", () => togglePlay(true));

async function togglePlay(send = true) {
  if (!movie) return;
  if (movie.paused) await movie.play().catch(() => {});
  else movie.pause();
  if ($("playBtn")) $("playBtn").textContent = movie.paused ? "▶" : "Ⅱ";
  if (send && roomId) socket.emit("playback", { roomId, action: movie.paused ? "pause" : "play", time: movie.currentTime });
}

movie?.addEventListener("play", () => { if ($("playBtn")) $("playBtn").textContent = "Ⅱ"; });
movie?.addEventListener("pause", () => { if ($("playBtn")) $("playBtn").textContent = "▶"; });
movie?.addEventListener("timeupdate", () => {
  if ($("currentTime")) $("currentTime").textContent = formatTime(movie.currentTime);
  if ($("seek")) $("seek").value = movie.duration ? (movie.currentTime / movie.duration) * 100 : 0;
});
movie?.addEventListener("loadedmetadata", () => { if ($("duration")) $("duration").textContent = formatTime(movie.duration); });
$("seek")?.addEventListener("input", (e) => { if (movie?.duration) movie.currentTime = (Number(e.target.value) / 100) * movie.duration; });
$("seek")?.addEventListener("change", () => { if (movie) socket.emit("playback", { roomId, action: "seek", time: movie.currentTime }); });
socket.on("playback", async (data) => {
  if (!data || !movie) return;
  if (Number.isFinite(data.time) && Math.abs(movie.currentTime - data.time) > 0.8) movie.currentTime = data.time;
  if (data.action === "play") await movie.play().catch(() => {});
  if (data.action === "pause") movie.pause();
});
socket.on("movie-meta", (data) => { if (data && $("movieName")) $("movieName").textContent = data.name; if (data && $("movieTitle")) $("movieTitle").textContent = data.name; });

$("chatForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("chatInput");
  const text = input?.value.trim();
  if (!text) return;
  addMessage(text, true);
  socket.emit("chat", { roomId, text });
  input.value = "";
});
socket.on("chat", (data) => { if (data) addMessage(data.text, false); });

$("reactionRow")?.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const emoji = button.dataset.reaction;
  if (!emoji) return;
  reactionEmoji(emoji);
  socket.emit("reaction", { roomId, emoji });
});
socket.on("reaction", (data) => { if (data) reactionEmoji(data.emoji); });

$("micBtn")?.addEventListener("click", () => {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return toast("Microphone unavailable");
  track.enabled = !track.enabled;
  if ($( "micBtn").firstChild) $("micBtn").firstChild.textContent = track.enabled ? "🎙 " : "🔇 ";
  toast(track.enabled ? "Mic on" : "Mic off");
});

$("cameraBtn")?.addEventListener("click", () => {
  const track = localStream?.getVideoTracks()[0];
  if (!track) return toast("Camera unavailable");
  track.enabled = !track.enabled;
  if ($("localPlaceholder")) $("localPlaceholder").style.display = track.enabled ? "none" : "grid";
  toast(track.enabled ? "Camera on" : "Camera off");
});

$("muteBtn")?.addEventListener("click", () => { if (movie) { movie.muted = !movie.muted; $("muteBtn").textContent = movie.muted ? "🔇" : "🔊"; } });
$("fullscreenBtn")?.addEventListener("click", () => $("videoWrap")?.requestFullscreen?.());

async function copyRoomLink() {
  const url = window.location.href;
  try { await navigator.clipboard.writeText(url); toast("Room link copied"); }
  catch { window.prompt("Copy this room link:", url); }
}

$("shareBtn")?.addEventListener("click", copyRoomLink);
$("copyRoom")?.addEventListener("click", copyRoomLink);
$("newRoom")?.addEventListener("click", createRoom);
$("hostBtn")?.addEventListener("click", () => roomId ? copyRoomLink() : createRoom());
$("moreBtn")?.addEventListener("click", () => toast("Room: " + (roomId || "not created")));

if (roomId) $("roomCode").textContent = roomId;
else $("roomCode").textContent = "—";
