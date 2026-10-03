const BACKEND_URL = "https://moviedate-backend-production.up.railway.app";

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 700,
  reconnectionDelayMax: 5000
});

const params = new URLSearchParams(location.search);

let roomId = params.get("room")?.trim().toUpperCase() || null;
let isHost = false;
let joinedOnServer = false;
let localStream = null;
let peer = null;
let partnerSocketId = null;
let pendingIce = [];
let ignorePlayback = false;
let movieObjectUrl = null;
let controlsTimer = null;

const $ = id => document.getElementById(id);

const movie = $("movie");
const movieFile = $("movieFile");
const localVideo = $("localVideo");
const remoteVideo = $("remoteVideo");


/* ---------------- BASIC UI ---------------- */

function toast(message) {
  const el = $("toast");
  if (!el) return;

  el.textContent = message;
  el.classList.add("show");

  clearTimeout(window.__toastTimer);

  window.__toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 1800);
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

  if ($("syncBadge")) {
    $("syncBadge").textContent = connected ? "online" : "offline";
  }
}


function setPartnerStatus(text) {
  if ($("partnerStatus")) {
    $("partnerStatus").textContent = text;
  }
}


function showGate(show) {
  $("roomGate")?.classList.toggle("show", show);
}


function updateHostUI() {
  const changeMovie = $("changeMovie");
  const seek = $("seek");

  if (changeMovie) {
    changeMovie.style.display = isHost ? "" : "none";
  }

  if (seek) {
    seek.style.display = isHost ? "" : "none";
  }
}


function showMovieControls() {
  $("videoWrap")?.classList.add("controls-visible");

  clearTimeout(controlsTimer);

  controlsTimer = setTimeout(() => {
    if (!movie?.paused) {
      $("videoWrap")?.classList.remove("controls-visible");
    }
  }, 2200);
}


/* ---------------- CAMERA ---------------- */

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
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 15, max: 20 }
      },
      audio: true
    });

    localVideo.srcObject = localStream;

    localVideo.muted = true;
    localVideo.autoplay = true;
    localVideo.playsInline = true;

    localVideo.play().catch(() => {});

    $("localPlaceholder")?.style.setProperty("display", "none");

    if ($("youStatus")) {
      $("youStatus").textContent = "●";
    }

    return true;

  } catch (error) {

    console.error("Camera:", error);

    if ($("youStatus")) {
      $("youStatus").textContent = "○";
    }

    toast("Camera permission needed");

    return false;
  }
}


/* ---------------- ROOM ---------------- */

async function joinRoom(id) {

  const normalized = String(id || "").trim().toUpperCase();

  if (!normalized) return;

  roomId = normalized;

  history.replaceState(
    {},
    "",
    `?room=${encodeURIComponent(roomId)}`
  );

  $("roomCode").textContent = roomId;

  showGate(false);

  updateHostUI();

  await startCamera();

  if (socket.connected) {

    socket.emit("join-room", {
      roomId
    });

  }
}


async function createRoom() {

  const id = randomRoom();

  roomId = id;
  isHost = true;

  joinedOnServer = false;

  await joinRoom(id);

  toast("Room created");

}


function leaveRoom() {

  if (roomId && socket.connected) {

    socket.emit("leave-room", {
      roomId
    });

  }

  peer?.close();

  peer = null;

  partnerSocketId = null;

  pendingIce = [];

  localStream?.getTracks().forEach(track => {
    track.stop();
  });

  localStream = null;

  if (localVideo) {
    localVideo.srcObject = null;
  }

  if (remoteVideo) {
    remoteVideo.srcObject = null;
  }

  if (movie) {

    movie.pause();

    movie.src = "";

    movie.load();

  }

  if (movieObjectUrl) {

    URL.revokeObjectURL(movieObjectUrl);

    movieObjectUrl = null;

  }

  joinedOnServer = false;

  roomId = null;

  isHost = false;

  history.replaceState(
    {},
    "",
    location.pathname
  );

  $("roomCode").textContent = "—";

  setPartnerStatus("○");

  $("localPlaceholder")?.style.setProperty(
    "display",
    "grid"
  );

  $("remotePlaceholder")?.style.setProperty(
    "display",
    "grid"
  );

  updateHostUI();

  showGate(true);

}


/* ---------------- SOCKET ---------------- */

socket.on("connect", () => {

  console.log("Connected:", socket.id);

  setConnected(true);

  if (roomId && !joinedOnServer) {

    socket.emit("join-room", {
      roomId
    });

  }

});


socket.on("disconnect", () => {

  console.log("Disconnected");

  setConnected(false);

  joinedOnServer = false;

  setPartnerStatus("○");

});


socket.on("room-state", data => {

  console.log("ROOM STATE:", data);

  if (!data) return;

  joinedOnServer = true;

  if (data.hostSocketId === socket.id) {
    isHost = true;
  }

  $("roomCode").textContent = roomId || "—";

  updateHostUI();

  showGate(false);

  if (data.participants > 1) {

    setPartnerStatus("●");

  } else {

    setPartnerStatus("○");

  }

  if (data.movie?.name) {

    setMovieMeta(data.movie);

  }

});


socket.on("peer-joined", async ({ socketId, hostSocketId }) => {

  console.log("Peer joined:", socketId);

  partnerSocketId = socketId;

  setPartnerStatus("◌");

  /*
    Host creates the WebRTC offer.
  */

  if (socket.id === hostSocketId) {

    await createPeer(true);

  }

});


socket.on("peer-left", () => {

  partnerSocketId = null;

  peer?.close();

  peer = null;

  pendingIce = [];

  if (remoteVideo) {
    remoteVideo.srcObject = null;
  }

  setPartnerStatus("○");

  $("remotePlaceholder")?.style.setProperty(
    "display",
    "grid"
  );

});


/* ---------------- WEBRTC CAMERA ---------------- */

async function createPeer(offerer) {

  if (peer) {
    peer.close();
  }

  peer = new RTCPeerConnection({

    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302"
      },
      {
        urls: "stun:stun.cloudflare.com:3478"
      }
    ]

  });


  if (localStream) {

    localStream.getTracks().forEach(track => {

      peer.addTrack(
        track,
        localStream
      );

    });

  }


  peer.ontrack = event => {

    if (!event.streams?.[0]) return;

    remoteVideo.srcObject =
      event.streams[0];

    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;

    remoteVideo.play().catch(() => {});

    $("remotePlaceholder")?.style.setProperty(
      "display",
      "none"
    );

    setPartnerStatus("●");

  };


  peer.onicecandidate = event => {

    if (!event.candidate) return;

    socket.emit("webrtc", {

      roomId,

      type: "ice",

      candidate: event.candidate

    });

  };


  peer.onconnectionstatechange = () => {

    console.log(
      "WebRTC:",
      peer.connectionState
    );

    if (peer.connectionState === "connected") {

      setPartnerStatus("●");

    }

    if (
      peer.connectionState === "failed" ||
      peer.connectionState === "disconnected"
    ) {

      setPartnerStatus("○");

    }

  };


  if (offerer) {

    const offer =
      await peer.createOffer();

    await peer.setLocalDescription(
      offer
    );

    socket.emit("webrtc", {

      roomId,

      type: "offer",

      sdp: offer

    });

  }

}


socket.on("webrtc", async message => {

  if (!message) return;

  try {

    if (!peer) {

      await createPeer(false);

    }


    if (message.type === "offer") {

      await peer.setRemoteDescription(
        new RTCSessionDescription(
          message.sdp
        )
      );


      const answer =
        await peer.createAnswer();


      await peer.setLocalDescription(
        answer
      );


      socket.emit("webrtc", {

        roomId,

        type: "answer",

        sdp: answer

      });


      while (pendingIce.length) {

        const candidate =
          pendingIce.shift();

        await peer.addIceCandidate(
          candidate
        );

      }

    }


    if (message.type === "answer") {

      await peer.setRemoteDescription(
        new RTCSessionDescription(
          message.sdp
        )
      );


      while (pendingIce.length) {

        const candidate =
          pendingIce.shift();

        await peer.addIceCandidate(
          candidate
        );

      }

    }


    if (
      message.type === "ice" &&
      message.candidate
    ) {

      const candidate =
        new RTCIceCandidate(
          message.candidate
        );


      if (peer.remoteDescription) {

        await peer.addIceCandidate(
          candidate
        );

      } else {

        pendingIce.push(candidate);

      }

    }

  } catch (error) {

    console.error(
      "WebRTC error:",
      error
    );

  }

});


/* ---------------- MOVIE ---------------- */

async function loadLocalMovie(file) {

  if (!file || !isHost || !movie) return;

  if (movieObjectUrl) {

    URL.revokeObjectURL(
      movieObjectUrl
    );

  }

  movieObjectUrl =
    URL.createObjectURL(file);

  movie.srcObject = null;

  movie.src = movieObjectUrl;

  movie.load();

  $("emptyState")?.classList.add(
    "hidden"
  );

  await new Promise(resolve => {

    if (movie.readyState >= 1) {

      resolve();

    } else {

      movie.addEventListener(
        "loadedmetadata",
        resolve,
        { once: true }
      );

    }

  });


  $("duration").textContent =
    formatTime(movie.duration);

  $("movieTap")?.style.setProperty(
    "display",
    "none"
  );


  movie.play().catch(() => {});

  socket.emit("movie-meta", {

    roomId,

    name: file.name,

    duration: movie.duration

  });

  toast("Movie loaded");

}


movieFile?.addEventListener(
  "change",
  event => {

    const file =
      event.target.files?.[0];

    if (file) {

      loadLocalMovie(file);

    }

  }
);


$("chooseMovieBtn")?.addEventListener(
  "click",
  () => movieFile?.click()
);


$("changeMovie")?.addEventListener(
  "click",
  () => movieFile?.click()
);


function setMovieMeta(data) {

  if ($("movieTitle")) {

    $("movieTitle").textContent =
      data.name || "";

  }

  if ($("movieName")) {

    $("movieName").textContent =
      data.name || "";

  }

  if (
    $("duration") &&
    Number(data.duration) > 0
  ) {

    $("duration").textContent =
      formatTime(
        Number(data.duration)
      );

  }

}


socket.on(
  "movie-meta",
  setMovieMeta
);


/* ---------------- PLAYBACK ---------------- */

async function togglePlay() {

  if (!movie) return;

  if (movie.paused) {

    await movie.play().catch(() => {});

  } else {

    movie.pause();

  }

}


$("playBtn")?.addEventListener(
  "click",
  togglePlay
);


$("movieTap")?.addEventListener(
  "click",
  togglePlay
);


movie?.addEventListener(
  "play",
  () => {

    $("movieTap")?.style.setProperty(
      "display",
      "none"
    );

    if (!isHost || !roomId) return;

    socket.emit("playback", {

      roomId,

      action: "play",

      time: movie.currentTime

    });

  }
);


movie?.addEventListener(
  "pause",
  () => {

    if ($("movieTap")) {

      $("movieTap").style.display =
        "flex";

    }

    if (!isHost || !roomId) return;

    socket.emit("playback", {

      roomId,

      action: "pause",

      time: movie.currentTime

    });

  }
);


movie?.addEventListener(
  "timeupdate",
  () => {

    if ($("currentTime")) {

      $("currentTime").textContent =
        formatTime(movie.currentTime);

    }

    if (
      $("seek") &&
      isHost &&
      Number.isFinite(movie.duration)
    ) {

      $("seek").value =
        (movie.currentTime /
          movie.duration) *
        100;

    }

  }
);


movie?.addEventListener(
  "loadedmetadata",
  () => {

    if ($("duration")) {

      $("duration").textContent =
        formatTime(movie.duration);

    }

  }
);


$("seek")?.addEventListener(
  "input",
  event => {

    if (!isHost || !movie.duration) return;

    movie.currentTime =
      (Number(event.target.value) / 100) *
      movie.duration;

  }
);


$("seek")?.addEventListener(
  "change",
  () => {

    if (!isHost) return;

    socket.emit("playback", {

      roomId,

      action: "seek",

      time: movie.currentTime

    });

  }
);


socket.on(
  "playback",
  data => {

    if (isHost || !data) return;

    ignorePlayback = true;

    if (
      Math.abs(
        movie.currentTime -
        Number(data.time || 0)
      ) > 0.5
    ) {

      movie.currentTime =
        Number(data.time || 0);

    }

    if (data.action === "play") {

      movie.play().catch(() => {});

    }

    if (data.action === "pause") {

      movie.pause();

    }

    setTimeout(
      () => {
        ignorePlayback = false;
      },
      100
    );

  }
);


/* ---------------- CHAT ---------------- */

function addMessage(text, mine = false) {

  const list =
    $("messages");

  if (!list) return;

  $("messageEmpty")?.remove();

  const item =
    document.createElement("div");

  item.className =
    `bubble${mine ? " me" : ""}`;

  item.textContent =
    text;

  list.appendChild(item);

  list.scrollTop =
    list.scrollHeight;

}


$("chatForm")?.addEventListener(
  "submit",
  event => {

    event.preventDefault();

    const input =
      $("chatInput");

    const text =
      input?.value.trim();

    if (!text || !roomId) return;

    addMessage(
      text,
      true
    );

    socket.emit(
      "chat",
      {
        roomId,
        text
      }
    );

    input.value = "";

  }
);


socket.on(
  "chat",
  data => {

    if (data?.text) {

      addMessage(
        data.text,
        false
      );

    }

  }
);


/* ---------------- REACTIONS ---------------- */

function showReaction(emoji) {

  const el =
    document.createElement("div");

  el.className =
    "float-reaction";

  el.textContent =
    emoji;

  el.style.left =
    `${25 + Math.random() * 60}vw`;

  el.style.top =
    `${55 + Math.random() * 25}vh`;

  document.body.appendChild(el);

  setTimeout(
    () => el.remove(),
    1500
  );

}


$("reactionRow")?.addEventListener(
  "click",
  event => {

    const button =
      event.target.closest("button");

    if (!button) return;

    const emoji =
      button.dataset.reaction;

    if (!emoji || !roomId) return;

    showReaction(emoji);

    socket.emit(
      "reaction",
      {
        roomId,
        emoji
      }
    );

  }
);


socket.on(
  "reaction",
  data => {

    if (data?.emoji) {

      showReaction(
        data.emoji
      );

    }

  }
);


/* ---------------- CAMERA CONTROLS ---------------- */

$("micBtn")?.addEventListener(
  "click",
  async () => {

    await startCamera();

    const track =
      localStream?.getAudioTracks()[0];

    if (!track) return;

    track.enabled =
      !track.enabled;

    toast(
      track.enabled
        ? "Mic on"
        : "Mic off"
    );

  }
);


$("cameraBtn")?.addEventListener(
  "click",
  async () => {

    await startCamera();

    const track =
      localStream?.getVideoTracks()[0];

    if (!track) return;

    track.enabled =
      !track.enabled;

    $("localPlaceholder")?.style.setProperty(
      "display",
      track.enabled
        ? "none"
        : "grid"
    );

  }
);


/* ---------------- SHARING ---------------- */

async function shareRoom() {

  if (!roomId) {

    toast("Create a room first");

    return;

  }

  const url =
    location.href;

  try {

    if (navigator.share) {

      await navigator.share({
        title: "MovieDate",
        text: "Join our MovieDate room",
        url
      });

    } else {

      await navigator.clipboard.writeText(
        url
      );

      toast("Link copied");

    }

  } catch {}

}


$("shareBtn")?.addEventListener(
  "click",
  shareRoom
);


$("roomPill")?.addEventListener(
  "click",
  shareRoom
);


/* ---------------- FULLSCREEN ---------------- */

$("fullscreenBtn")?.addEventListener(
  "click",
  () => {

    $("videoWrap")
      ?.requestFullscreen?.();

  }
);


/* ---------------- LEAVE ---------------- */

$("exitBtn")?.addEventListener(
  "click",
  leaveRoom
);


/* ---------------- ROOM GATE ---------------- */

$("createRoomBtn")?.addEventListener(
  "click",
  createRoom
);


$("joinPromptBtn")?.addEventListener(
  "click",
  () => {

    $("joinSheet").hidden =
      false;

    setTimeout(
      () =>
        $("roomCodeInput")?.focus(),
      50
    );

  }
);


$("closeJoinBtn")?.addEventListener(
  "click",
  () => {

    $("joinSheet").hidden =
      true;

  }
);


$("joinRoomBtn")?.addEventListener(
  "click",
  async () => {

    const code =
      $("roomCodeInput")
        ?.value
        .trim()
        .toUpperCase();

    if (!code) return;

    isHost = false;

    $("joinSheet").hidden =
      true;

    await joinRoom(code);

  }
);


$("roomCodeInput")?.addEventListener(
  "keydown",
  event => {

    if (event.key === "Enter") {

      $("joinRoomBtn")?.click();

    }

  }
);


/* ---------------- INITIAL ---------------- */

if (roomId) {

  $("roomCode").textContent =
    roomId;

  showGate(false);

  if (socket.connected) {

    socket.emit(
      "join-room",
      { roomId }
    );

  }

} else {

  $("roomCode").textContent =
    "—";

  showGate(true);

}

console.log(
  "MovieDate frontend loaded"
);
