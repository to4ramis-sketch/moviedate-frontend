const BACKEND_URL = "https://moviedate-backend-production.up.railway.app";

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"]
});

const params = new URLSearchParams(window.location.search);

let roomId = params.get("room");
let isHost = false;
let hasJoinedRoom = false;

let localStream = null;
let peer = null;
let partnerSocketId = null;

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
  window.__toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 2200);
}

function formatTime(sec) {
  if (!Number.isFinite(sec)) return "00:00";
  sec = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(
    sec % 60
  ).padStart(2, "0")}`;
}

function randomRoom() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

/* ROOM */

function joinRoom(id) {
  if (!id || hasJoinedRoom) return;

  roomId = id;
  hasJoinedRoom = true;

  $("roomCode").textContent = roomId;
  $("hostBtn").textContent = "Joined";

  socket.emit("join-room", { roomId });
  startCamera();
}

async function createRoom() {
  const id = randomRoom();

  isHost = true;
  hasJoinedRoom = false;

  history.replaceState({}, "", `?room=${id}`);

  $("roomCode").textContent = id;
  $("hostBtn").textContent = "Host";
  $("hostNote").textContent = "You are the host. Choose a local movie.";

  joinRoom(id);
  toast("Room created — share the link");
}

function joinExistingRoom() {
  if (!roomId) return;
  joinRoom(roomId);
}

/* CAMERA + MICROPHONE */

async function startCamera() {
  if (localStream) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Camera is not supported in this browser");
    return;
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
      localVideo.play().catch(() => {});
    }

    if ($("localPlaceholder")) {
      $("localPlaceholder").style.display = "none";
    }

    if ($("youStatus")) {
      $("youStatus").textContent = "● live";
    }

    if (peer) {
      localStream.getTracks().forEach((track) => {
        const alreadyAdded = peer
          .getSenders()
          .some((sender) => sender.track === track);

        if (!alreadyAdded) {
          peer.addTrack(track, localStream);
        }
      });
    }
  } catch (error) {
    console.error("Camera error:", error);

    if ($("youStatus")) {
      $("youStatus").textContent = "○ camera off";
    }

    toast("Camera/mic permission not granted");
  }
}

/* CONNECTION UI */

function setConnected(on) {
  if ($("roomStatus")) {
    $("roomStatus").classList.toggle("on", on);
  }

  if ($("connectionText")) {
    $("connectionText").textContent = on ? "Connected" : "Offline";
  }

  if ($("syncBadge")) {
    $("syncBadge").textContent = on ? "Synced room" : "Not connected";
  }
}

/* CHAT */

function addMessage(text, me = false) {
  const messages = $("messages");
  if (!messages) return;

  const el = document.createElement("div");
  el.className = "bubble" + (me ? " me" : "");
  el.textContent = text;

  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

/* REACTIONS */

function reactionEmoji(emoji) {
  const el = document.createElement("div");

  el.className = "float-reaction";
  el.textContent = emoji;

  el.style.left = 25 + Math.random() * 60 + "vw";
  el.style.top = 55 + Math.random() * 25 + "vh";

  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

/* SOCKET CONNECTION */

socket.on("connect", () => {
  setConnected(true);

  if (roomId) {
    joinExistingRoom();
  }
});

socket.on("disconnect", () => {
  setConnected(false);
});

/* ROOM STATE */

socket.on("room-state", (data) => {
  if (!data) return;

  if (data.hostSocketId === socket.id) {
    isHost = true;
  }

  if (
    data.hostSocketId !== socket.id &&
    data.participants > 1
  ) {
    partnerSocketId = data.hostSocketId;

    if ($("partnerStatus")) {
      $("partnerStatus").textContent = "● connected";
    }

    createPeer(true);
  }
});

/* PARTNER JOIN / LEAVE */

socket.on("peer-joined", async ({ socketId, hostSocketId }) => {
  partnerSocketId = socketId;

  if ($("partnerStatus")) {
    $("partnerStatus").textContent = "● connected";
  }

  if (socket.id === hostSocketId) {
    isHost = true;
    await createPeer(true);
  }
});

socket.on("peer-left", () => {
  if ($("partnerStatus")) {
    $("partnerStatus").textContent = "○ waiting";
  }

  if (peer) {
    peer.close();
    peer = null;
  }

  partnerSocketId = null;

  if (remoteVideo) {
    remoteVideo.srcObject = null;
  }

  if ($("remotePlaceholder")) {
    $("remotePlaceholder").style.display = "grid";
  }
});

/* WEBRTC */

async function createPeer(offerer = false) {
  if (peer) {
    peer.close();
    peer = null;
  }

  peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" }
    ]
  });

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peer.addTrack(track, localStream);
    });
  }

  peer.ontrack = (event) => {
    if (!remoteVideo) return;

    remoteVideo.srcObject = event.streams[0];
    remoteVideo.playsInline = true;
    remoteVideo.play().catch(() => {});

    if ($("remotePlaceholder")) {
      $("remotePlaceholder").style.display = "none";
    }
  };

  peer.onicecandidate = (event) => {
    if (!event.candidate) return;

    socket.emit("webrtc", {
      roomId,
      type: "ice",
      candidate: event.candidate
    });
  };

  peer.onconnectionstatechange = () => {
    const state = peer.connectionState;

    if (!$("partnerStatus")) return;

    if (state === "connected") {
      $("partnerStatus").textContent = "● live";
    } else if (state === "connecting" || state === "new") {
      $("partnerStatus").textContent = "○ connecting";
    } else {
      $("partnerStatus").textContent = "○ " + state;
    }
  };

  if (offerer) {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    socket.emit("webrtc", {
      roomId,
      type: "offer",
      sdp: offer
    });
  }
}

socket.on("webrtc", async (msg) => {
  if (!msg) return;

  try {
    if (!peer) {
      await createPeer(false);
    }

    if (msg.type === "offer") {
      await peer.setRemoteDescription(
        new RTCSessionDescription(msg.sdp)
      );

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      socket.emit("webrtc", {
        roomId,
        type: "answer",
        sdp: answer
      });
    }

    if (msg.type === "answer") {
      await peer.setRemoteDescription(
        new RTCSessionDescription(msg.sdp)
      );
    }

    if (msg.type === "ice" && msg.candidate) {
      try {
        await peer.addIceCandidate(msg.candidate);
      } catch (error) {
        console.warn("ICE candidate error:", error);
      }
    }
  } catch (error) {
    console.error("WebRTC signaling error:", error);
  }
});

/* MOVIE */

movieFile?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const movieURL = URL.createObjectURL(file);

  movie.src = movieURL;
  movie.load();
  movie.play().catch(() => {});

  $("emptyState")?.classList.add("hidden");

  if ($("movieName")) $("movieName").textContent = file.name;
  if ($("movieTitle")) $("movieTitle").textContent = file.name;

  socket.emit("movie-meta", {
    roomId,
    name: file.name
  });
});

$("changeMovie")?.addEventListener("click", () => {
  movieFile?.click();
});

$("playBtn")?.addEventListener("click", () => {
  togglePlay(true);
});

movie?.addEventListener("click", () => {
  togglePlay(true);
});

async function togglePlay(send = true) {
  if (!movie) return;

  if (movie.paused) {
    await movie.play().catch(() => {});
  } else {
    movie.pause();
  }

  if ($("playBtn")) {
    $("playBtn").textContent = movie.paused ? "▶" : "Ⅱ";
  }

  if (send && roomId) {
    socket.emit("playback", {
      roomId,
      action: movie.paused ? "pause" : "play",
      time: movie.currentTime
    });
  }
}

movie?.addEventListener("play", () => {
  if ($("playBtn")) $("playBtn").textContent = "Ⅱ";
});

movie?.addEventListener("pause", () => {
  if ($("playBtn")) $("playBtn").textContent = "▶";
});

movie?.addEventListener("timeupdate", () => {
  if ($("currentTime")) {
    $("currentTime").textContent = formatTime(movie.currentTime);
  }

  if ($("seek")) {
    $("seek").value = movie.duration
      ? (movie.currentTime / movie.duration) * 100
      : 0;
  }
});

movie?.addEventListener("loadedmetadata", () => {
  if ($("duration")) {
    $("duration").textContent = formatTime(movie.duration);
  }
});

$("seek")?.addEventListener("input", (event) => {
  if (!movie?.duration) return;
  movie.currentTime =
    (Number(event.target.value) / 100) * movie.duration;
});

$("seek")?.addEventListener("change", () => {
  if (!movie) return;

  socket.emit("playback", {
    roomId,
    action: "seek",
    time: movie.currentTime
  });
});

socket.on("playback", async (data) => {
  if (!data || !movie) return;

  if (
    Number.isFinite(data.time) &&
    Math.abs(movie.currentTime - data.time) > 0.8
  ) {
    movie.currentTime = data.time;
  }

  if (data.action === "play") {
    await movie.play().catch(() => {});
  }

  if (data.action === "pause") {
    movie.pause();
  }
});

socket.on("movie-meta", (data) => {
  if (!data) return;

  if ($("movieName")) $("movieName").textContent = data.name;
  if ($("movieTitle")) $("movieTitle").textContent = data.name;
});

/* CHAT */

$("chatForm")?.addEventListener("submit", (event) => {
  event.preventDefault();

  const input = $("chatInput");
  const text = input?.value.trim();

  if (!text) return;

  addMessage(text, true);

  socket.emit("chat", {
    roomId,
    text
  });

  input.value = "";
});

socket.on("chat", (data) => {
  if (!data) return;
  addMessage(data.text, false);
});

/* REACTIONS */

$("reactionRow")?.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const emoji = button.dataset.reaction;
  if (!emoji) return;

  reactionEmoji(emoji);

  socket.emit("reaction", {
    roomId,
    emoji
  });
});

socket.on("reaction", (data) => {
  if (!data) return;
  reactionEmoji(data.emoji);
});

/* MIC */

$("micBtn")?.addEventListener("click", () => {
  const track = localStream?.getAudioTracks()[0];

  if (!track) {
    toast("Microphone unavailable");
    return;
  }

  track.enabled = !track.enabled;

  const button = $("micBtn");

  if (button.firstChild) {
    button.firstChild.textContent = track.enabled ? "🎙 " : "🔇 ";
  }

  toast(track.enabled ? "Mic on" : "Mic off");
});

/* CAMERA */

$("cameraBtn")?.addEventListener("click", () => {
  const track = localStream?.getVideoTracks()[0];

  if (!track) {
    toast("Camera unavailable");
    return;
  }

  track.enabled = !track.enabled;

  if ($("localPlaceholder")) {
    $("localPlaceholder").style.display = track.enabled ? "none" : "grid";
  }

  toast(track.enabled ? "Camera on" : "Camera off");
});

/* MOVIE AUDIO */

$("muteBtn")?.addEventListener("click", () => {
  if (!movie) return;

  movie.muted = !movie.muted;
  $("muteBtn").textContent = movie.muted ? "🔇" : "🔊";
});

/* FULLSCREEN */

$("fullscreenBtn")?.addEventListener("click", () => {
  $("videoWrap")?.requestFullscreen?.();
});

/* SHARE */

async function copyRoomLink() {
  const url = window.location.href;

  try {
    await navigator.clipboard.writeText(url);
    toast("Room link copied");
  } catch {
    window.prompt("Copy this room link:", url);
  }
}

$("shareBtn")?.addEventListener("click", copyRoomLink);
$("copyRoom")?.addEventListener("click", copyRoomLink);

/* NEW ROOM */

$("newRoom")?.addEventListener("click", createRoom);

$("hostBtn")?.addEventListener("click", () => {
  if (!roomId) {
    createRoom();
  } else {
    copyRoomLink();
  }
});

/* MORE */

$("moreBtn")?.addEventListener("click", () => {
  toast("Room: " + (roomId || "not created"));
});

/* INITIAL LOAD */

if (roomId) {
  $("roomCode").textContent = roomId;
} else {
  $("roomCode").textContent = "—";
}
