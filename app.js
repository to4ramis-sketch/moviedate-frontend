const BACKEND_URL =
  "https://moviedate-backend-production.up.railway.app";

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
});

const params = new URLSearchParams(window.location.search);

let roomId = params.get("room");
let isHost = false;
let hasJoinedRoom = false;

let localStream = null;
let peer = null;
let partnerSocketId = null;

let movieCaptureStream = null;
let movieStreamId = null;
let movieVideoSender = null;
let movieAudioSender = null;

let remoteMovieStreamId = null;
let remoteMovieStream = null;

let pendingIceCandidates = [];
let pendingPlayback = null;

let makingOffer = false;
let queuedRenegotiation = false;

const $ = (id) => document.getElementById(id);

const movie = $("movie");
const movieFile = $("movieFile");
const localVideo = $("localVideo");
const remoteVideo = $("remoteVideo");

/* ---------------------------------------------------------
   BASIC HELPERS
--------------------------------------------------------- */

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

/* ---------------------------------------------------------
   ROOM
--------------------------------------------------------- */

async function joinRoom(id) {
  if (!id || hasJoinedRoom) return;

  roomId = id.trim().toUpperCase();
  hasJoinedRoom = true;

  if ($("roomCode")) {
    $("roomCode").textContent = roomId;
  }

  if ($("hostBtn")) {
    $("hostBtn").textContent = isHost ? "Host" : "Joined";
  }

  // Get camera/mic before WebRTC negotiation.
  await startCamera();

  socket.emit("join-room", {
    roomId,
  });
}

async function createRoom() {
  const id = randomRoom();

  isHost = true;
  hasJoinedRoom = false;

  history.replaceState({}, "", `?room=${id}`);

  if ($("roomCode")) {
    $("roomCode").textContent = id;
  }

  if ($("hostBtn")) {
    $("hostBtn").textContent = "Host";
  }

  if ($("hostNote")) {
    $("hostNote").textContent =
      "You are the host. Choose a local movie.";
  }

  await joinRoom(id);

  toast("Room created — share the link");
}

async function joinExistingRoom() {
  if (!roomId) return;
  await joinRoom(roomId);
}

/* ---------------------------------------------------------
   CAMERA + MICROPHONE
--------------------------------------------------------- */

async function startCamera() {
  if (localStream) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Camera is not supported in this browser");
    return;
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

    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true;
      localVideo.autoplay = true;
      localVideo.playsInline = true;
      localVideo.play().catch(() => {});
    }

    if ($("localPlaceholder")) {
      $("localPlaceholder").style.display = "none";
    }

    if ($("youStatus")) {
      $("youStatus").textContent = "● live";
    }

    // This is mainly for reconnect/recovery.
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
    console.error("Camera/mic error:", error);

    if ($("youStatus")) {
      $("youStatus").textContent = "○ camera off";
    }

    toast("Camera/mic permission not granted");
  }
}

/* ---------------------------------------------------------
   CONNECTION UI
--------------------------------------------------------- */

function setConnected(on) {
  $("roomStatus")?.classList.toggle("on", on);

  if ($("connectionText")) {
    $("connectionText").textContent = on ? "Connected" : "Offline";
  }

  if ($("syncBadge")) {
    $("syncBadge").textContent = on
      ? "Synced room"
      : "Not connected";
  }
}

socket.on("connect", async () => {
  console.log("MovieDate connected to Railway:", socket.id);

  setConnected(true);

  if (roomId && !hasJoinedRoom) {
    await joinExistingRoom();
  }
});

socket.on("disconnect", () => {
  console.log("MovieDate Socket.IO disconnected");

  setConnected(false);
  hasJoinedRoom = false;

  if ($("partnerStatus")) {
    $("partnerStatus").textContent = "○ offline";
  }
});

socket.on("connect_error", (error) => {
  console.error("Socket connection error:", error);
  setConnected(false);
});

/* ---------------------------------------------------------
   ROOM STATE
--------------------------------------------------------- */

socket.on("room-state", (data) => {
  console.log("Room state:", data);

  if (!data) return;

  if (data.roomId) {
    roomId = data.roomId;

    if ($("roomCode")) {
      $("roomCode").textContent = roomId;
    }
  }

  isHost = data.hostSocketId === socket.id;

  if ($("hostBtn")) {
    $("hostBtn").textContent = isHost ? "Host" : "Joined";
  }

  if (isHost && $("hostNote")) {
    $("hostNote").textContent =
      "You are the host. Choose a local movie.";
  }

  if (data.participants > 1) {
    $("partnerStatus").textContent = "● connected";
  } else {
    $("partnerStatus").textContent = "○ waiting";
  }

  if (data.movie?.name) {
    setMovieMeta(data.movie);
  }
});

/* ---------------------------------------------------------
   PARTNER JOIN / LEAVE
--------------------------------------------------------- */

socket.on("peer-joined", async ({ socketId, hostSocketId }) => {
  console.log("Peer joined:", socketId);

  partnerSocketId = socketId;

  if ($("partnerStatus")) {
    $("partnerStatus").textContent = "● connecting";
  }

  // Only the host creates the initial WebRTC offer.
  if (socket.id === hostSocketId) {
    isHost = true;
    await ensurePeer();
    await sendOffer();
  }
});

socket.on("peer-left", () => {
  console.log("Partner left");

  if ($("partnerStatus")) {
    $("partnerStatus").textContent = "○ waiting";
  }

  if (peer) {
    peer.close();
    peer = null;
  }

  partnerSocketId = null;
  pendingIceCandidates = [];
  makingOffer = false;
  queuedRenegotiation = false;

  if (remoteVideo) {
    remoteVideo.srcObject = null;
  }

  remoteMovieStream = null;
  remoteMovieStreamId = null;

  if (!isHost && movie) {
    movie.srcObject = null;
  }

  if ($("remotePlaceholder")) {
    $("remotePlaceholder").style.display = "grid";
  }
});

/* ---------------------------------------------------------
   WEBRTC PEER
--------------------------------------------------------- */

async function ensurePeer() {
  if (peer) return peer;

  peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
    ],
  });

  // Camera + mic.
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peer.addTrack(track, localStream);
    });
  }

  // If the host selected a movie before the partner joined,
  // include that movie in the initial offer.
  if (isHost && movieCaptureStream) {
    attachMovieTracksToPeer();
  }

  peer.ontrack = (event) => {
    handleRemoteTrack(event);
  };

  peer.onicecandidate = (event) => {
    if (!event.candidate) return;

    socket.emit("webrtc", {
      roomId,
      type: "ice",
      candidate: event.candidate,
    });
  };

  peer.onconnectionstatechange = () => {
    if (!peer) return;

    const state = peer.connectionState;

    console.log("WebRTC state:", state);

    if (!$("partnerStatus")) return;

    if (state === "connected") {
      $("partnerStatus").textContent = "● live";
    } else if (
      state === "new" ||
      state === "connecting"
    ) {
      $("partnerStatus").textContent = "○ connecting";
    } else {
      $("partnerStatus").textContent = "○ " + state;
    }
  };

  peer.oniceconnectionstatechange = () => {
    console.log(
      "ICE state:",
      peer?.iceConnectionState
    );
  };

  return peer;
}

function attachMovieTracksToPeer() {
  if (!peer || !movieCaptureStream || !isHost) return;

  const videoTrack =
    movieCaptureStream.getVideoTracks()[0];

  const audioTrack =
    movieCaptureStream.getAudioTracks()[0];

  if (videoTrack && !movieVideoSender) {
    movieVideoSender = peer.addTrack(
      videoTrack,
      movieCaptureStream
    );
  }

  if (audioTrack && !movieAudioSender) {
    movieAudioSender = peer.addTrack(
      audioTrack,
      movieCaptureStream
    );
  }

  /*
    Keep the ID of the first negotiated movie stream so the
    receiving phone can distinguish movie tracks from camera.
  */
  if (!movieStreamId) {
    movieStreamId = movieCaptureStream.id;
  }
}

async function replaceMovieTracks() {
  if (!peer || !movieCaptureStream || !isHost) {
    return;
  }

  const videoTrack =
    movieCaptureStream.getVideoTracks()[0];

  const audioTrack =
    movieCaptureStream.getAudioTracks()[0];

  /*
    Replacing an existing sender avoids creating extra
    video/audio tracks every time the host changes movies.
  */
  if (movieVideoSender && videoTrack) {
    await movieVideoSender.replaceTrack(videoTrack);
  } else if (videoTrack) {
    movieVideoSender = peer.addTrack(
      videoTrack,
      movieCaptureStream
    );
  }

  if (movieAudioSender && audioTrack) {
    await movieAudioSender.replaceTrack(audioTrack);
  } else if (audioTrack) {
    movieAudioSender = peer.addTrack(
      audioTrack,
      movieCaptureStream
    );
  }

  if (!movieStreamId) {
    movieStreamId = movieCaptureStream.id;
  }
}

/* ---------------------------------------------------------
   WEBRTC OFFER / ANSWER
--------------------------------------------------------- */

async function sendOffer() {
  if (!isHost || !peer) return;

  /*
    Only the host makes offers. The guest only answers.
    This avoids the common offer-collision problem.
  */
  if (makingOffer) {
    queuedRenegotiation = true;
    return;
  }

  if (peer.signalingState !== "stable") {
    queuedRenegotiation = true;
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
    console.error("Create offer error:", error);
  } finally {
    makingOffer = false;
  }
}

async function flushIceCandidates() {
  if (!peer?.remoteDescription) return;

  while (pendingIceCandidates.length) {
    const candidate = pendingIceCandidates.shift();

    try {
      await peer.addIceCandidate(candidate);
    } catch (error) {
      console.warn("ICE candidate error:", error);
    }
  }
}

/* ---------------------------------------------------------
   REMOTE MEDIA
--------------------------------------------------------- */

function handleRemoteTrack(event) {
  const track = event.track;
  const incomingStream = event.streams?.[0];

  console.log(
    "Remote track:",
    track.kind,
    incomingStream?.id
  );

  /*
    Host receives the partner camera/mic.
  */
  if (isHost) {
    if (incomingStream) {
      if (track.kind === "video" && remoteVideo) {
        remoteVideo.srcObject = incomingStream;
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.play().catch(() => {});
        $("remotePlaceholder")?.style.setProperty(
          "display",
          "none"
        );
      }
    }

    return;
  }

  /*
    Guest receives:
      - partner camera stream
      - movie stream

    The offer carries movieStreamId so we can distinguish them.
  */
  if (
    incomingStream &&
    remoteMovieStreamId &&
    incomingStream.id === remoteMovieStreamId
  ) {
    if (!remoteMovieStream) {
      remoteMovieStream = new MediaStream();
    }

    if (!remoteMovieStream.getTrackById(track.id)) {
      remoteMovieStream.addTrack(track);
    }

    if (movie && movie.srcObject !== remoteMovieStream) {
      movie.pause();
      movie.removeAttribute("src");
      movie.srcObject = remoteMovieStream;
      movie.autoplay = true;
      movie.playsInline = true;
      movie.muted = false;
    }

    $("emptyState")?.classList.add("hidden");

    if (pendingPlayback) {
      applyRemotePlayback(pendingPlayback);
      pendingPlayback = null;
    } else {
      movie?.play().catch(() => {
        toast("Tap the movie once to enable sound");
      });
    }

    return;
  }

  /*
    Anything else is the partner camera stream.
  */
  if (
    incomingStream &&
    track.kind === "video" &&
    remoteVideo
  ) {
    remoteVideo.srcObject = incomingStream;
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    remoteVideo.play().catch(() => {});

    $("remotePlaceholder")?.style.setProperty(
      "display",
      "none"
    );

    return;
  }

  /*
    If no stream was supplied, use a fallback MediaStream
    for the partner camera.
  */
  if (
    !incomingStream &&
    track.kind === "video" &&
    remoteVideo
  ) {
    const fallback =
      remoteVideo.srcObject instanceof MediaStream
        ? remoteVideo.srcObject
        : new MediaStream();

    fallback.addTrack(track);

    remoteVideo.srcObject = fallback;
    remoteVideo.play().catch(() => {});

    $("remotePlaceholder")?.style.setProperty(
      "display",
      "none"
    );
  }
}

socket.on("webrtc", async (message) => {
  if (!message) return;

  console.log("WebRTC signal:", message.type);

  try {
    if (message.type === "offer") {
      /*
        This information comes before setRemoteDescription,
        so ontrack can immediately recognize movie tracks.
      */
      if (message.movieStreamId) {
        remoteMovieStreamId = message.movieStreamId;
      }

      await ensurePeer();

      await peer.setRemoteDescription(
        new RTCSessionDescription(message.sdp)
      );

      await flushIceCandidates();

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

      await peer.setRemoteDescription(
        new RTCSessionDescription(message.sdp)
      );

      await flushIceCandidates();

      if (queuedRenegotiation) {
        queuedRenegotiation = false;
        setTimeout(() => sendOffer(), 0);
      }

      return;
    }

    if (message.type === "ice" && message.candidate) {
      const candidate = new RTCIceCandidate(
        message.candidate
      );

      if (peer?.remoteDescription) {
        await peer.addIceCandidate(candidate);
      } else {
        pendingIceCandidates.push(candidate);
      }
    }
  } catch (error) {
    console.error("WebRTC signaling error:", error);
  }
});

/* ---------------------------------------------------------
   MOVIE STREAMING
--------------------------------------------------------- */

async function captureAndStreamMovie() {
  if (!movie || !movieCaptureStream) return;

  if (typeof movie.captureStream !== "function") {
    toast(
      "This browser cannot live-stream local videos. Use Chrome."
    );
    return;
  }

  /*
    First time:
    capture the video element's rendered video/audio.
  */
  if (!movieCaptureStream) {
    movieCaptureStream = movie.captureStream();
  }

  if (!isHost || !peer) return;

  /*
    Add or replace the host's movie tracks.
  */
  if (!movieVideoSender && !movieAudioSender) {
    attachMovieTracksToPeer();
  } else {
    await replaceMovieTracks();
  }

  /*
    Adding a movie track changes the WebRTC session and requires
    a new offer. RTCPeerConnection.addTrack() triggers
    negotiationneeded; here the host controls renegotiation
    explicitly to avoid offer collisions.
  */
  if (peer.signalingState === "stable") {
    await sendOffer();
  } else {
    queuedRenegotiation = true;
  }
}

async function loadLocalMovie(file) {
  if (!file || !movie) return;

  if (!isHost) {
    toast("Only the host can choose the movie");
    return;
  }

  const movieURL = URL.createObjectURL(file);

  /*
    Stop old local capture tracks.
  */
  if (movieCaptureStream) {
    movieCaptureStream.getTracks().forEach((track) => {
      track.stop();
    });
  }

  movieCaptureStream = null;

  /*
    We keep the existing sender references when possible;
    replaceTrack() will update the remote movie without
    adding unnecessary extra transceivers.
  */
  movie.srcObject = null;
  movie.src = movieURL;
  movie.load();

  $("emptyState")?.classList.add("hidden");

  if ($("movieName")) {
    $("movieName").textContent = file.name;
  }

  if ($("movieTitle")) {
    $("movieTitle").textContent = file.name;
  }

  await new Promise((resolve) => {
    if (movie.readyState >= 1) {
      resolve();
      return;
    }

    movie.addEventListener(
      "loadedmetadata",
      resolve,
      { once: true }
    );
  });

  try {
    await movie.play();
  } catch {
    toast("Tap play to start the movie");
  }

  /*
    Chrome requires the media element to be able to play
    before captureStream() is called.
  */
  try {
    movieCaptureStream = movie.captureStream();

    if (!movieStreamId) {
      movieStreamId = movieCaptureStream.id;
    }

    if (!peer) {
      await ensurePeer();
    }

    await replaceMovieTracks();

    if (peer.signalingState === "stable") {
      await sendOffer();
    } else {
      queuedRenegotiation = true;
    }
  } catch (error) {
    console.error("Movie capture error:", error);
    toast("Could not stream this movie in this browser");
    return;
  }

  socket.emit("movie-meta", {
    roomId,
    name: file.name,
    duration: Number.isFinite(movie.duration)
      ? movie.duration
      : 0,
  });

  toast("Movie is streaming to your partner");
}

movieFile?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];

  if (!file) return;

  await loadLocalMovie(file);
});

$("changeMovie")?.addEventListener("click", () => {
  if (!isHost) {
    toast("Only the host can choose the movie");
    return;
  }

  movieFile?.click();
});

/* ---------------------------------------------------------
   MOVIE PLAYBACK
--------------------------------------------------------- */

$("playBtn")?.addEventListener("click", async () => {
  if (!isHost) {
    toast("The host controls playback");
    return;
  }

  await togglePlay(true);
});

movie?.addEventListener("click", async () => {
  if (!isHost) {
    await movie.play().catch(() => {});
    return;
  }

  await togglePlay(true);
});

async function togglePlay(send = true) {
  if (!movie) return;

  if (movie.paused) {
    await movie.play().catch(() => {});
  } else {
    movie.pause();
  }

  if ($("playBtn")) {
    $("playBtn").textContent = movie.paused
      ? "▶"
      : "Ⅱ";
  }

  if (send && isHost && roomId) {
    socket.emit("playback", {
      roomId,
      action: movie.paused ? "pause" : "play",
      time: movie.currentTime,
    });
  }
}

movie?.addEventListener("play", () => {
  if ($("playBtn")) {
    $("playBtn").textContent = "Ⅱ";
  }

  if (isHost && roomId) {
    socket.emit("playback", {
      roomId,
      action: "play",
      time: movie.currentTime,
    });
  }
});

movie?.addEventListener("pause", () => {
  if ($("playBtn")) {
    $("playBtn").textContent = "▶";
  }
});

movie?.addEventListener("timeupdate", () => {
  if ($("currentTime")) {
    $("currentTime").textContent =
      formatTime(movie.currentTime);
  }

  if ($("seek") && isHost) {
    $("seek").value = movie.duration
      ? (movie.currentTime / movie.duration) * 100
      : 0;
  }

  /*
    On the guest device, the remote MediaStream itself is live.
    We don't use the seek bar as a control.
  */
});

movie?.addEventListener("loadedmetadata", () => {
  if ($("duration") && Number.isFinite(movie.duration)) {
    $("duration").textContent = formatTime(
      movie.duration
    );
  }
});

$("seek")?.addEventListener("input", (event) => {
  if (!isHost || !movie?.duration) return;

  movie.currentTime =
    (Number(event.target.value) / 100) *
    movie.duration;
});

$("seek")?.addEventListener("change", () => {
  if (!isHost || !movie) return;

  socket.emit("playback", {
    roomId,
    action: "seek",
    time: movie.currentTime,
  });
});

/* ---------------------------------------------------------
   PLAYBACK FROM HOST
--------------------------------------------------------- */

function applyRemotePlayback(data) {
  if (!movie || !data) return;

  if (
    Number.isFinite(data.time) &&
    Number.isFinite(movie.currentTime) &&
    Math.abs(movie.currentTime - data.time) > 1
  ) {
    /*
      With a captured MediaStream the guest is following the
      host's live stream, so large seeks are informational.
    */
    try {
      movie.currentTime = data.time;
    } catch {
      // MediaStream playback can be non-seekable.
    }
  }

  if (data.action === "play") {
    movie.play().catch(() => {
      toast("Tap the movie once to enable playback");
    });
  }

  if (data.action === "pause") {
    movie.pause();
  }
}

socket.on("playback", (data) => {
  if (!isHost) {
    if (!movie?.srcObject) {
      pendingPlayback = data;
      return;
    }

    applyRemotePlayback(data);
  }
});

socket.on("movie-meta", (data) => {
  if (!data) return;

  if ($("movieName")) {
    $("movieName").textContent = data.name || "Movie";
  }

  if ($("movieTitle")) {
    $("movieTitle").textContent = data.name || "Movie";
  }

  if (
    !isHost &&
    $("duration") &&
    Number.isFinite(data.duration) &&
    data.duration > 0
  ) {
    $("duration").textContent =
      formatTime(data.duration);
  }

  if (!isHost) {
    toast("Partner selected a movie");
  }
});

/* ---------------------------------------------------------
   CHAT
--------------------------------------------------------- */

$("chatForm")?.addEventListener("submit", (event) => {
  event.preventDefault();

  const input = $("chatInput");
  const text = input?.value.trim();

  if (!text) return;

  addMessage(text, true);

  socket.emit("chat", {
    roomId,
    text,
  });

  input.value = "";
});

function addMessage(text, me = false) {
  const messages = $("messages");
  if (!messages) return;

  const el = document.createElement("div");

  el.className = "bubble" + (me ? " me" : "");
  el.textContent = text;

  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

socket.on("chat", (data) => {
  if (!data) return;
  addMessage(data.text, false);
});

/* ---------------------------------------------------------
   REACTIONS
--------------------------------------------------------- */

function reactionEmoji(emoji) {
  const el = document.createElement("div");

  el.className = "float-reaction";
  el.textContent = emoji;

  el.style.left = 25 + Math.random() * 60 + "vw";
  el.style.top = 55 + Math.random() * 25 + "vh";

  document.body.appendChild(el);

  setTimeout(() => el.remove(), 1500);
}

$("reactionRow")?.addEventListener("click", (event) => {
  const button = event.target.closest("button");

  if (!button) return;

  const emoji = button.dataset.reaction;

  if (!emoji) return;

  reactionEmoji(emoji);

  socket.emit("reaction", {
    roomId,
    emoji,
  });
});

socket.on("reaction", (data) => {
  if (!data) return;
  reactionEmoji(data.emoji);
});

/* ---------------------------------------------------------
   MIC
--------------------------------------------------------- */

$("micBtn")?.addEventListener("click", () => {
  const track = localStream?.getAudioTracks()[0];

  if (!track) {
    toast("Microphone unavailable");
    return;
  }

  track.enabled = !track.enabled;

  const button = $("micBtn");

  if (button.firstChild) {
    button.firstChild.textContent = track.enabled
      ? "🎙 "
      : "🔇 ";
  }

  toast(track.enabled ? "Mic on" : "Mic off");
});

/* ---------------------------------------------------------
   CAMERA
--------------------------------------------------------- */

$("cameraBtn")?.addEventListener("click", () => {
  const track = localStream?.getVideoTracks()[0];

  if (!track) {
    toast("Camera unavailable");
    return;
  }

  track.enabled = !track.enabled;

  if ($("localPlaceholder")) {
    $("localPlaceholder").style.display =
      track.enabled ? "none" : "grid";
  }

  toast(track.enabled ? "Camera on" : "Camera off");
});

/* ---------------------------------------------------------
   MOVIE AUDIO
--------------------------------------------------------- */

$("muteBtn")?.addEventListener("click", () => {
  if (!movie) return;

  movie.muted = !movie.muted;

  $("muteBtn").textContent = movie.muted
    ? "🔇"
    : "🔊";
});

/* ---------------------------------------------------------
   FULLSCREEN
--------------------------------------------------------- */

$("fullscreenBtn")?.addEventListener("click", () => {
  $("videoWrap")?.requestFullscreen?.();
});

/* ---------------------------------------------------------
   ROOM LINK
--------------------------------------------------------- */

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

/* ---------------------------------------------------------
   NEW ROOM
--------------------------------------------------------- */

$("newRoom")?.addEventListener("click", () => {
  createRoom();
});

/* ---------------------------------------------------------
   HOST / JOIN BUTTON
--------------------------------------------------------- */

$("hostBtn")?.addEventListener("click", () => {
  if (!roomId) {
    createRoom();
  } else {
    copyRoomLink();
  }
});

/* ---------------------------------------------------------
   MORE
--------------------------------------------------------- */

$("moreBtn")?.addEventListener("click", () => {
  toast("Room: " + (roomId || "not created"));
});

/* ---------------------------------------------------------
   INITIAL LOAD
--------------------------------------------------------- */

if (roomId) {
  $("roomCode").textContent = roomId;
} else {
  $("roomCode").textContent = "—";
}
