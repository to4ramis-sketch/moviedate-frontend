const BACKEND_URL = "https://moviedate-backend-production.up.railway.app";

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000
});

const params = new URLSearchParams(location.search);
let roomId = (params.get("room") || "").trim().toUpperCase();
let isHost = false;
let localStream = null;
let peer = null;
let moviePeer = null;
let partnerSocketId = null;
let joinedOnServer = false;
let joinRequested = false;
let pendingCameraIce = [];
let pendingMovieIce = [];
let movieCaptureStream = null;
let remoteMovieStream = null;
let movieStreamStarted = false;

const $ = id => document.getElementById(id);
const movie = $("movie");
const movieFile = $("movieFile");
const localVideo = $("localVideo");
const remoteVideo = $("remoteVideo");

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "00:00";
  seconds = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function randomRoom() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function setServerStatus(connected) {
  const dot = $("roomStatus");
  const text = $("connectionText");
  if (dot) dot.classList.toggle("on", connected);
  if (text) text.textContent = connected ? "Connected" : "Offline";
}

function setSyncStatus(text) {
  const badge = $("syncBadge");
  if (badge) badge.textContent = text;
}

function setPartnerStatus(text, connected = false) {
  const el = $("partnerStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("connected", connected);
}

function updateRoomUI() {
  if ($("roomCode")) $("roomCode").textContent = roomId || "—";
  if ($("roomGate")) $("roomGate").classList.toggle("hidden", Boolean(roomId));
}

function updateRoomURL() {
  if (roomId) history.replaceState({}, "", `?room=${roomId}`);
}

function requestJoin() {
  if (!roomId) return;
  if (!socket.connected) {
    setSyncStatus("Connecting server…");
    return;
  }
  if (joinedOnServer || joinRequested) return;

  joinRequested = true;
  setSyncStatus("Joining room…");
  setPartnerStatus("○ joining…");

  console.log("JOINING ROOM:", roomId);
  socket.emit("join-room", roomId);
}

async function createRoom() {
  roomId = randomRoom();
  isHost = true;
  joinedOnServer = false;
  joinRequested = false;
  partnerSocketId = null;

  updateRoomURL();
  updateRoomUI();

  if ($("hostBtn")) $("hostBtn").textContent = "Host";
  if ($("hostNote")) $("hostNote").textContent = "Waiting for your partner…";

  setPartnerStatus("○ waiting for partner");
  setSyncStatus("Waiting for partner");

  await startCamera();
  requestJoin();
  toast("Room created — share the link");
}

function joinExistingRoom() {
  if (!roomId) return;
  roomId = roomId.trim().toUpperCase();
  updateRoomURL();
  updateRoomUI();

  if ($("hostBtn")) $("hostBtn").textContent = "Joined";
  if ($("hostNote")) $("hostNote").textContent = "Joining your room…";

  startCamera();
  requestJoin();
}

socket.on("connect", () => {
  console.log("SOCKET CONNECTED:", socket.id);
  setServerStatus(true);
  joinedOnServer = false;
  joinRequested = false;
  if (roomId) requestJoin();
});

socket.on("disconnect", () => {
  console.log("SOCKET DISCONNECTED");
  setServerStatus(false);
  setSyncStatus("Reconnecting…");
  setPartnerStatus("○ reconnecting…");
});

socket.on("room-joined", data => {
  console.log("ROOM JOINED:", data);
  roomId = data.roomId.toUpperCase();
  isHost = data.isHost;
  joinedOnServer = true;
  joinRequested = false;
  updateRoomURL();
  updateRoomUI();

  if (data.participants >= 2) {
    setSyncStatus("Connecting…");
    setPartnerStatus("◌ connecting…");
  } else {
    setSyncStatus("Waiting for partner");
    setPartnerStatus("○ waiting for partner");
  }

  if ($("hostNote")) {
    $("hostNote").textContent = data.participants >= 2
      ? "Partner found. Connecting…"
      : "Share the room link with your partner.";
  }
});

socket.on("room-state", data => {
  console.log("ROOM STATE:", data);

  if (data.roomId) {
    roomId = data.roomId.toUpperCase();
    updateRoomURL();
    updateRoomUI();
  }

  isHost = data.hostSocketId === socket.id;

  if (data.participants === 1) {
    setSyncStatus("Waiting for partner");
    setPartnerStatus("○ waiting for partner");
  }

  if (data.participants === 2) {
    setSyncStatus("Connecting…");
    setPartnerStatus("◌ connecting…");
  }

  if (data.movie) {
    if ($("movieName")) $("movieName").textContent = data.movie;
    if ($("movieTitle")) $("movieTitle").textContent = data.movie;
  }
});

socket.on("peer-joined", data => {
  console.log("PARTNER JOINED:", data);
  partnerSocketId = data.socketId;
  if (data.hostSocketId === socket.id) isHost = true;
  setPartnerStatus("◌ connecting…");
  setSyncStatus("Connecting…");
});

socket.on("peer-ready", async data => {
  console.log("PEER READY:", data);
  partnerSocketId = data.socketId || partnerSocketId;
  setPartnerStatus("◌ connecting…");
  if (isHost) {
    await createPeer(true);
    if (!movie.paused && movie.readyState >= 2) await startMovieStream();
  }
});

socket.on("peer-left", () => {
  console.log("PARTNER LEFT");
  partnerSocketId = null;
  if (peer) {
    peer.close();
    peer = null;
  }
  if (moviePeer) {
    moviePeer.close();
    moviePeer = null;
  }
  pendingCameraIce = [];
  pendingMovieIce = [];
  remoteMovieStream = null;
  movieCaptureStream = null;
  movieStreamStarted = false;
  remoteVideo.srcObject = null;
  if ($("remotePlaceholder")) $("remotePlaceholder").style.display = "grid";
  setPartnerStatus("○ waiting for partner");
  setSyncStatus("Waiting for partner");
});

socket.on("room-full", () => {
  joinedOnServer = false;
  joinRequested = false;
  setSyncStatus("Room full");
  toast("This room already has two people.");
});

socket.on("room-error", data => {
  joinedOnServer = false;
  joinRequested = false;
  console.error("ROOM ERROR:", data);
  setSyncStatus("Room error");
  toast(data.message || "Could not join room.");
});

async function startCamera() {
  if (localStream) return localStream;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    localVideo.srcObject = localStream;
    $("localPlaceholder").style.display = "none";
    $("youStatus").textContent = "● live";
    console.log("CAMERA READY");
    return localStream;
  } catch (error) {
    console.error("CAMERA ERROR:", error);
    $("youStatus").textContent = "○ camera off";
    toast("Camera/mic permission is needed for video chat.");
    return null;
  }
}

async function createPeer(offerer) {
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

  const remoteStream = new MediaStream();

  if (localStream) {
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
  } else {
    peer.addTransceiver("audio", { direction: "recvonly" });
    peer.addTransceiver("video", { direction: "recvonly" });
  }

  peer.ontrack = event => {
    console.log("CAMERA REMOTE TRACK RECEIVED:", event.track.kind);
    if (!remoteStream.getTracks().some(track => track.id === event.track.id)) {
      remoteStream.addTrack(event.track);
    }
    remoteVideo.srcObject = remoteStream;
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    remoteVideo.muted = false;
    $("remotePlaceholder").style.display = "none";
    remoteVideo.play().catch(() => {});
  };

  peer.onicecandidate = event => {
    if (!event.candidate) return;
    socket.emit("webrtc", {
      roomId,
      channel: "camera",
      type: "ice",
      candidate: event.candidate
    });
  };

  peer.onconnectionstatechange = () => {
    if (!peer) return;
    const state = peer.connectionState;
    console.log("CAMERA CONNECTION:", state);

    if (state === "connecting") {
      setPartnerStatus("◌ connecting…");
      setSyncStatus("Connecting…");
    }

    if (state === "connected") {
      setPartnerStatus("● connected", true);
      setSyncStatus("Synced room");
    }

    if (state === "failed" || state === "disconnected") {
      setPartnerStatus("○ connection failed");
      setSyncStatus("Connection failed");
    }
  };

  peer.oniceconnectionstatechange = () => {
    console.log("CAMERA ICE:", peer?.iceConnectionState);
  };

  if (offerer) {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    socket.emit("webrtc", {
      roomId,
      channel: "camera",
      type: "offer",
      sdp: offer
    });

    console.log("CAMERA OFFER SENT");
  }

  return peer;
}

async function createMoviePeer(offerer = false) {
  if (moviePeer) {
    moviePeer.close();
    moviePeer = null;
  }

  moviePeer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" }
    ]
  });

  if (!offerer) {
    moviePeer.addTransceiver("video", { direction: "recvonly" });
    moviePeer.addTransceiver("audio", { direction: "recvonly" });
  }

  moviePeer.ontrack = event => {
    console.log("MOVIE REMOTE TRACK RECEIVED:", event.track.kind);
    if (!remoteMovieStream) remoteMovieStream = new MediaStream();
    if (!remoteMovieStream.getTracks().some(track => track.id === event.track.id)) {
      remoteMovieStream.addTrack(event.track);
    }

    movie.srcObject = remoteMovieStream;
    movie.removeAttribute("src");
    movie.autoplay = true;
    movie.playsInline = true;
    movie.muted = false;
    $("emptyState").classList.add("hidden");
    movieStreamStarted = true;
    movie.play().catch(() => {});
  };

  moviePeer.onicecandidate = event => {
    if (!event.candidate) return;
    socket.emit("webrtc", {
      roomId,
      channel: "movie",
      type: "ice",
      candidate: event.candidate
    });
  };

  moviePeer.onconnectionstatechange = () => {
    if (!moviePeer) return;
    console.log("MOVIE CONNECTION:", moviePeer.connectionState);
  };

  moviePeer.oniceconnectionstatechange = () => {
    console.log("MOVIE ICE:", moviePeer?.iceConnectionState);
  };

  if (offerer && movieCaptureStream) {
    movieCaptureStream.getTracks().forEach(track => moviePeer.addTrack(track, movieCaptureStream));

    const offer = await moviePeer.createOffer();
    await moviePeer.setLocalDescription(offer);

    socket.emit("webrtc", {
      roomId,
      channel: "movie",
      type: "offer",
      sdp: offer
    });

    console.log("MOVIE OFFER SENT");
  }

  return moviePeer;
}

async function startMovieStream() {
  if (!isHost || !movie.src || movieStreamStarted) return;
  if (movie.readyState < 2) return;
  if (!movie.captureStream) {
    console.error("captureStream() is not supported by this browser");
    toast("This browser cannot share the movie.");
    return;
  }

  try {
    movieCaptureStream = movie.captureStream();
    const tracks = movieCaptureStream.getTracks();
    if (!tracks.length) return;

    await createMoviePeer(true);
    movieStreamStarted = true;
    console.log("MOVIE STREAM STARTED", tracks.map(t => t.kind));
  } catch (error) {
    console.error("MOVIE STREAM ERROR:", error);
    movieStreamStarted = false;
  }
}

socket.on("webrtc", async message => {
  const channel = message.channel || "camera";
  console.log("WEBRTC MESSAGE:", channel, message.type);

  if (channel === "camera") {
    if (message.type === "offer") {
      if (!peer) await createPeer(false);

      await peer.setRemoteDescription(new RTCSessionDescription(message.sdp));

      for (const candidate of pendingCameraIce) {
        try { await peer.addIceCandidate(candidate); } catch {}
      }
      pendingCameraIce = [];

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      socket.emit("webrtc", {
        roomId,
        channel: "camera",
        type: "answer",
        sdp: answer
      });
    }

    if (message.type === "answer") {
      if (!peer) return;
      await peer.setRemoteDescription(new RTCSessionDescription(message.sdp));

      for (const candidate of pendingCameraIce) {
        try { await peer.addIceCandidate(candidate); } catch {}
      }
      pendingCameraIce = [];
    }

    if (message.type === "ice") {
      const ice = new RTCIceCandidate(message.candidate);
      if (peer && peer.remoteDescription) {
        try { await peer.addIceCandidate(ice); } catch {}
      } else {
        pendingCameraIce.push(ice);
      }
    }
  }

  if (channel === "movie") {
    if (message.type === "offer") {
      if (!moviePeer) await createMoviePeer(false);

      await moviePeer.setRemoteDescription(new RTCSessionDescription(message.sdp));

      for (const candidate of pendingMovieIce) {
        try { await moviePeer.addIceCandidate(candidate); } catch {}
      }
      pendingMovieIce = [];

      const answer = await moviePeer.createAnswer();
      await moviePeer.setLocalDescription(answer);

      socket.emit("webrtc", {
        roomId,
        channel: "movie",
        type: "answer",
        sdp: answer
      });
    }

    if (message.type === "answer") {
      if (!moviePeer) return;
      await moviePeer.setRemoteDescription(new RTCSessionDescription(message.sdp));

      for (const candidate of pendingMovieIce) {
        try { await moviePeer.addIceCandidate(candidate); } catch {}
      }
      pendingMovieIce = [];
    }

    if (message.type === "ice") {
      const ice = new RTCIceCandidate(message.candidate);
      if (moviePeer && moviePeer.remoteDescription) {
        try { await moviePeer.addIceCandidate(ice); } catch {}
      } else {
        pendingMovieIce.push(ice);
      }
    }
  }
});

movieFile.addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) return;

  if (moviePeer) {
    moviePeer.close();
    moviePeer = null;
  }
  remoteMovieStream = null;
  movieCaptureStream = null;
  movieStreamStarted = false;
  movie.srcObject = null;
  movie.src = URL.createObjectURL(file);
  movie.load();
  $("emptyState").classList.add("hidden");

  if ($("movieName")) $("movieName").textContent = file.name;
  if ($("movieTitle")) $("movieTitle").textContent = file.name;

  socket.emit("movie-meta", { roomId, name: file.name });
});

movie.addEventListener("play", async () => {
  if (isHost) await startMovieStream();
});

async function togglePlay(send = true) {
  if (movie.paused) await movie.play().catch(() => {});
  else movie.pause();

  if (send) {
    socket.emit("playback", {
      roomId,
      action: movie.paused ? "pause" : "play",
      time: movie.currentTime
    });
  }
}

movie.addEventListener("timeupdate", () => {
  if ($("currentTime")) $("currentTime").textContent = formatTime(movie.currentTime);
  if ($("seek")) {
    $("seek").value = movie.duration
      ? (movie.currentTime / movie.duration) * 100
      : 0;
  }
});

movie.addEventListener("loadedmetadata", () => {
  if ($("duration")) $("duration").textContent = formatTime(movie.duration);
});

if ($("seek")) {
  $("seek").oninput = event => {
    if (movie.duration) {
      movie.currentTime = (Number(event.target.value) / 100) * movie.duration;
    }
  };

  $("seek").onchange = () => {
    socket.emit("playback", {
      roomId,
      action: "seek",
      time: movie.currentTime
    });
  };
}

socket.on("playback", async data => {
  if (Math.abs(movie.currentTime - data.time) > 0.8) movie.currentTime = data.time;
  if (data.action === "play") await movie.play().catch(() => {});
  if (data.action === "pause") movie.pause();
});

socket.on("movie-meta", data => {
  if ($("movieName")) $("movieName").textContent = data.name;
  if ($("movieTitle")) $("movieTitle").textContent = data.name;
  if (!isHost) $("emptyState").classList.add("hidden");
});

function addMessage(text, me = false) {
  const empty = $("messageEmpty");
  if (empty) empty.remove();

  const el = document.createElement("div");
  el.className = "bubble" + (me ? " me" : "");
  el.textContent = text;
  $("messages").appendChild(el);
  $("messages").scrollTop = $("messages").scrollHeight;
}

$("chatForm").onsubmit = event => {
  event.preventDefault();
  const input = $("chatInput");
  const text = input.value.trim();
  if (!text) return;

  addMessage(text, true);
  socket.emit("chat", { roomId, text });
  input.value = "";
};

socket.on("chat", data => addMessage(data.text, false));

function reactionEmoji(emoji) {
  const el = document.createElement("div");
  el.className = "float-reaction";
  el.textContent = emoji;
  el.style.left = 25 + Math.random() * 60 + "vw";
  el.style.top = 55 + Math.random() * 25 + "vh";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

if ($("reactionRow")) {
  $("reactionRow").onclick = event => {
    const button = event.target.closest("button");
    if (!button) return;

    const emoji = button.dataset.reaction;
    reactionEmoji(emoji);
    socket.emit("reaction", { roomId, emoji });
  };
}

socket.on("reaction", data => reactionEmoji(data.emoji));

if ($("micBtn")) {
  $("micBtn").onclick = () => {
    const track = localStream?.getAudioTracks()[0];
    if (!track) return toast("Microphone not available");
    track.enabled = !track.enabled;
    toast(track.enabled ? "Mic on" : "Mic off");
  };
}

if ($("cameraBtn")) {
  $("cameraBtn").onclick = () => {
    const track = localStream?.getVideoTracks()[0];
    if (!track) return toast("Camera not available");
    track.enabled = !track.enabled;
    $("localPlaceholder").style.display = track.enabled ? "none" : "grid";
    toast(track.enabled ? "Camera on" : "Camera off");
  };
}

async function shareRoom() {
  if (!roomId) return toast("Create a room first");

  const url = `${location.origin}${location.pathname}?room=${roomId}`;

  try {
    if (navigator.share) {
      await navigator.share({
        title: "MovieDate",
        text: "Join my MovieDate room",
        url
      });
      return;
    }
  } catch {}

  try {
    await navigator.clipboard.writeText(url);
    toast("Room link copied");
  } catch {
    prompt("Copy this room link:", url);
  }
}

if ($("shareBtn")) $("shareBtn").onclick = shareRoom;
if ($("roomPill")) $("roomPill").onclick = shareRoom;
if ($("copyRoom")) $("copyRoom").onclick = shareRoom;
if ($("playBtn")) $("playBtn").onclick = () => togglePlay(true);
if ($("movieTap")) $("movieTap").onclick = () => togglePlay(true);
movie.onclick = () => togglePlay(true);
if ($("chooseMovieBtn")) $("chooseMovieBtn").onclick = () => movieFile.click();
if ($("changeMovie")) $("changeMovie").onclick = () => movieFile.click();

if ($("fullscreenBtn")) {
  $("fullscreenBtn").onclick = () => $("videoWrap").requestFullscreen?.();
}

if ($("muteBtn")) {
  $("muteBtn").onclick = () => {
    movie.muted = !movie.muted;
    $("muteBtn").textContent = movie.muted ? "🔇" : "🔊";
  };
}

if ($("createRoomBtn")) $("createRoomBtn").onclick = createRoom;
if ($("newRoom")) $("newRoom").onclick = createRoom;

if ($("hostBtn")) {
  $("hostBtn").onclick = () => roomId ? shareRoom() : createRoom();
}

if ($("joinPromptBtn")) {
  $("joinPromptBtn").onclick = () => {
    $("joinSheet").hidden = false;
    $("roomCodeInput").focus();
  };
}

if ($("closeJoinBtn")) {
  $("closeJoinBtn").onclick = () => $("joinSheet").hidden = true;
}

if ($("joinRoomBtn")) {
  $("joinRoomBtn").onclick = () => {
    const code = $("roomCodeInput").value.trim().toUpperCase();
    if (!code) return toast("Enter a room code");

    roomId = code;
    isHost = false;
    joinedOnServer = false;
    joinRequested = false;

    $("joinSheet").hidden = true;
    updateRoomURL();
    updateRoomUI();
    joinExistingRoom();
  };
}

if ($("roomCodeInput")) {
  $("roomCodeInput").addEventListener("keydown", event => {
    if (event.key === "Enter") $("joinRoomBtn").click();
  });
}

if ($("exitBtn")) {
  $("exitBtn").onclick = () => {
    socket.emit("leave-room");
    if (peer) peer.close();
    if (moviePeer) moviePeer.close();

    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    location.href = location.pathname;
  };
}

updateRoomUI();

if (roomId) {
  setSyncStatus("Connecting…");
  setPartnerStatus("○ joining…");
} else {
  setSyncStatus("Offline");
  setPartnerStatus("○ waiting");
}
