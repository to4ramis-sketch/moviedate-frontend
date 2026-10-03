const BACKEND_URL =
  "https://moviedate-backend-production.up.railway.app";


/* =========================================================
   SOCKET
========================================================= */

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000
});


/* =========================================================
   STATE
========================================================= */

const params = new URLSearchParams(location.search);

let roomId =
  (params.get("room") || "").trim().toUpperCase();

let isHost = false;

let localStream = null;
let peer = null;

let partnerSocketId = null;

let joinedOnServer = false;
let joinRequested = false;

let pendingIceCandidates = [];

let movieObjectURL = null;

let hasMovie = false;

let ignorePlaybackEvent = false;


/* =========================================================
   HELPERS
========================================================= */

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

  clearTimeout(el._timer);

  el._timer = setTimeout(() => {
    el.classList.remove("show");
  }, 2200);
}


function formatTime(seconds) {

  if (!Number.isFinite(seconds)) {
    return "00:00";
  }

  seconds = Math.max(0, Math.floor(seconds));

  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}


function randomRoom() {

  return Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase();
}


/* =========================================================
   UI STATUS
========================================================= */

function setServerStatus(connected) {

  const dot = $("roomStatus");

  if (dot) {
    dot.classList.toggle("on", connected);
  }
}


function setSyncStatus(text) {

  const badge = $("syncBadge");

  if (badge) {
    badge.textContent = text;
  }
}


function setPartnerStatus(text, connected = false) {

  const el = $("partnerStatus");

  if (!el) return;

  el.textContent = text;

  el.classList.toggle("connected", connected);
}


function updateRoomUI() {

  if ($("roomCode")) {
    $("roomCode").textContent = roomId || "—";
  }

  const gate = $("roomGate");

  if (!gate) return;

  gate.classList.toggle(
    "show",
    !roomId
  );
}


function updateRoomURL() {

  if (!roomId) return;

  history.replaceState(
    {},
    "",
    `?room=${encodeURIComponent(roomId)}`
  );
}


/* =========================================================
   CAMERA
========================================================= */

async function startCamera() {

  if (localStream) {
    return localStream;
  }

  if (!navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia) {

    toast("Camera is not supported here.");

    return null;
  }

  try {

    setSyncStatus("Starting camera…");

    localStream =
      await navigator.mediaDevices.getUserMedia({

        video: {
          facingMode: "user",
          width: {
            ideal: 640
          },
          height: {
            ideal: 360
          }
        },

        audio: true

      });


    localVideo.srcObject = localStream;

    localVideo.muted = true;

    await localVideo.play().catch(() => {});


    $("localPlaceholder").style.display =
      "none";


    $("youStatus").textContent =
      "● live";


    console.log("CAMERA READY");

    return localStream;

  } catch (error) {

    console.error(
      "CAMERA ERROR:",
      error
    );

    $("youStatus").textContent =
      "○ camera off";


    toast(
      "Allow camera and microphone access."
    );

    return null;
  }
}


/* =========================================================
   ROOM JOIN
========================================================= */

async function requestJoin() {

  if (!roomId) return;

  if (!socket.connected) {

    setSyncStatus(
      "Connecting server…"
    );

    return;
  }


  if (
    joinedOnServer ||
    joinRequested
  ) {
    return;
  }


  /*
    IMPORTANT FIX:

    Camera must be ready BEFORE
    joining the room.
  */

  const stream =
    await startCamera();


  if (!stream) {

    toast(
      "Camera access is needed for the watch room."
    );

    return;
  }


  joinRequested = true;

  setSyncStatus(
    "Joining room…"
  );

  setPartnerStatus(
    "○ joining…"
  );


  console.log(
    "JOINING ROOM:",
    roomId
  );


  socket.emit(
    "join-room",
    roomId
  );
}


async function createRoom() {

  roomId = randomRoom();

  isHost = true;

  joinedOnServer = false;

  joinRequested = false;

  partnerSocketId = null;


  updateRoomURL();

  updateRoomUI();


  setPartnerStatus(
    "○ waiting"
  );

  setSyncStatus(
    "Starting…"
  );


  await requestJoin();


  toast(
    "Room created — share the link"
  );
}


async function joinExistingRoom() {

  if (!roomId) return;

  roomId =
    roomId.trim().toUpperCase();


  updateRoomURL();

  updateRoomUI();


  await requestJoin();
}


/* =========================================================
   SOCKET EVENTS
========================================================= */

socket.on(
  "connect",
  async () => {

    console.log(
      "SOCKET CONNECTED:",
      socket.id
    );


    setServerStatus(true);


    joinedOnServer = false;

    joinRequested = false;


    if (roomId) {

      await requestJoin();

    } else {

      setSyncStatus(
        "Ready"
      );
    }

  }
);


socket.on(
  "disconnect",
  () => {

    console.log(
      "SOCKET DISCONNECTED"
    );


    setServerStatus(false);

    setSyncStatus(
      "Reconnecting…"
    );

    setPartnerStatus(
      "○ reconnecting…"
    );

  }
);


socket.on(
  "room-joined",
  data => {

    console.log(
      "ROOM JOINED:",
      data
    );


    roomId =
      String(data.roomId)
        .toUpperCase();


    isHost =
      Boolean(data.isHost);


    joinedOnServer = true;

    joinRequested = false;


    updateRoomURL();

    updateRoomUI();


    if (data.participants >= 2) {

      setSyncStatus(
        "Connecting…"
      );

      setPartnerStatus(
        "◌ connecting…"
      );

    } else {

      setSyncStatus(
        "Waiting for partner"
      );

      setPartnerStatus(
        "○ waiting"
      );
    }

  }
);


socket.on(
  "room-state",
  data => {

    console.log(
      "ROOM STATE:",
      data
    );


    if (data.roomId) {

      roomId =
        String(data.roomId)
          .toUpperCase();

      updateRoomURL();

      updateRoomUI();

    }


    isHost =
      data.hostSocketId ===
      socket.id;


    if (
      data.participants === 1
    ) {

      setSyncStatus(
        "Waiting for partner"
      );

      setPartnerStatus(
        "○ waiting"
      );

    }


    if (
      data.participants === 2
    ) {

      setSyncStatus(
        "Connecting…"
      );

      setPartnerStatus(
        "◌ connecting…"
      );

    }


    if (data.movie) {

      /*
        We intentionally don't try
        to load the partner's movie.

        Socket.IO currently sends
        only the filename.
      */

      console.log(
        "Partner movie:",
        data.movie
      );

    }

  }
);


/* =========================================================
   PARTNER JOINED
========================================================= */

socket.on(
  "peer-joined",
  data => {

    console.log(
      "PARTNER JOINED:",
      data
    );


    partnerSocketId =
      data.socketId ||
      partnerSocketId;


    setPartnerStatus(
      "◌ connecting…"
    );

    setSyncStatus(
      "Connecting…"
    );

  }
);


socket.on(
  "peer-ready",
  async data => {

    console.log(
      "PEER READY:",
      data
    );


    partnerSocketId =
      data.socketId ||
      partnerSocketId;


    setPartnerStatus(
      "◌ connecting…"
    );


    /*
      Host creates the offer.
    */

    if (isHost) {

      await createPeer(true);

    }

  }
);


socket.on(
  "peer-left",
  () => {

    console.log(
      "PARTNER LEFT"
    );


    partnerSocketId = null;


    if (peer) {

      peer.close();

      peer = null;

    }


    remoteVideo.srcObject =
      null;


    $("remotePlaceholder")
      .style.display =
      "grid";


    setPartnerStatus(
      "○ waiting"
    );


    setSyncStatus(
      "Waiting for partner"
    );

  }
);


socket.on(
  "room-full",
  () => {

    joinedOnServer = false;

    joinRequested = false;


    setSyncStatus(
      "Room full"
    );


    toast(
      "This room already has two people."
    );

  }
);


socket.on(
  "room-error",
  data => {

    joinedOnServer = false;

    joinRequested = false;


    console.error(
      "ROOM ERROR:",
      data
    );


    setSyncStatus(
      "Room error"
    );


    toast(
      data.message ||
      "Could not join room."
    );

  }
);


/* =========================================================
   WEBRTC
========================================================= */

async function createPeer(
  offerer = false
) {

  /*
    Close old connection.
  */

  if (peer) {

    peer.ontrack = null;

    peer.onicecandidate = null;

    peer.onconnectionstatechange = null;

    peer.close();

    peer = null;

  }


  pendingIceCandidates = [];


  peer =
    new RTCPeerConnection({

      iceServers: [

        {
          urls:
            "stun:stun.l.google.com:19302"
        },

        {
          urls:
            "stun:stun.cloudflare.com:3478"
        }

      ]

    });


  /*
    Add camera + microphone.
  */

  if (localStream) {

    localStream
      .getTracks()
      .forEach(track => {

        peer.addTrack(
          track,
          localStream
        );

      });

  }


  /*
    Receive partner.
  */

  peer.ontrack = async event => {

    console.log(
      "REMOTE TRACK RECEIVED"
    );


    const stream =
      event.streams &&
      event.streams[0];


    if (!stream) return;


    remoteVideo.srcObject =
      stream;


    $("remotePlaceholder")
      .style.display =
      "none";


    try {

      await remoteVideo.play();

    } catch (error) {

      console.log(
        "Remote autoplay waiting:",
        error
      );

    }

  };


  /*
    ICE candidates.
  */

  peer.onicecandidate =
    event => {

      if (!event.candidate) return;


      socket.emit(
        "webrtc",
        {

          roomId,

          type: "ice",

          candidate:
            event.candidate

        }
      );

    };


  /*
    Connection state.
  */

  peer.onconnectionstatechange =
    () => {

      if (!peer) return;


      const state =
        peer.connectionState;


      console.log(
        "WEBRTC:",
        state
      );


      if (
        state === "connecting"
      ) {

        setPartnerStatus(
          "◌ connecting…"
        );

        setSyncStatus(
          "Connecting…"
        );

      }


      if (
        state === "connected"
      ) {

        setPartnerStatus(
          "● connected",
          true
        );

        setSyncStatus(
          "Synced room"
        );

      }


      if (
        state === "disconnected"
      ) {

        setPartnerStatus(
          "○ reconnecting…"
        );

      }


      if (
        state === "failed"
      ) {

        setPartnerStatus(
          "○ connection failed"
        );

        setSyncStatus(
          "Connection failed"
        );

      }

    };


  /*
    Host creates offer.
  */

  if (offerer) {

    try {

      const offer =
        await peer.createOffer();


      await peer.setLocalDescription(
        offer
      );


      socket.emit(
        "webrtc",
        {

          roomId,

          type: "offer",

          sdp:
            peer.localDescription

        }
      );


      console.log(
        "OFFER SENT"
      );

    } catch (error) {

      console.error(
        "OFFER ERROR:",
        error
      );

    }

  }


  return peer;
}


/* =========================================================
   WEBRTC SIGNALING
========================================================= */

socket.on(
  "webrtc",
  async message => {

    console.log(
      "WEBRTC MESSAGE:",
      message.type
    );


    try {

      /*
        OFFER
      */

      if (
        message.type === "offer"
      ) {

        if (!peer) {

          await createPeer(false);

        }


        await peer.setRemoteDescription(
          new RTCSessionDescription(
            message.sdp
          )
        );


        for (
          const candidate
          of pendingIceCandidates
        ) {

          try {

            await peer.addIceCandidate(
              candidate
            );

          } catch {}

        }


        pendingIceCandidates = [];


        const answer =
          await peer.createAnswer();


        await peer.setLocalDescription(
          answer
        );


        socket.emit(
          "webrtc",
          {

            roomId,

            type: "answer",

            sdp:
              peer.localDescription

          }
        );


        return;
      }


      /*
        ANSWER
      */

      if (
        message.type === "answer"
      ) {

        if (!peer) return;


        await peer.setRemoteDescription(
          new RTCSessionDescription(
            message.sdp
          )
        );


        for (
          const candidate
          of pendingIceCandidates
        ) {

          try {

            await peer.addIceCandidate(
              candidate
            );

          } catch {}

        }


        pendingIceCandidates = [];


        return;
      }


      /*
        ICE
      */

      if (
        message.type === "ice"
      ) {

        const candidate =
          new RTCIceCandidate(
            message.candidate
          );


        if (
          peer &&
          peer.remoteDescription
        ) {

          try {

            await peer.addIceCandidate(
              candidate
            );

          } catch (error) {

            console.log(
              "ICE ERROR:",
              error
            );

          }

        } else {

          pendingIceCandidates.push(
            candidate
          );

        }

      }

    } catch (error) {

      console.error(
        "WEBRTC SIGNAL ERROR:",
        error
      );

    }

  }
);


/* =========================================================
   MOVIE
========================================================= */

function resetMovieUI() {

  hasMovie = false;


  $("videoWrap")
    .classList.add("no-movie");


  $("emptyState")
    .classList.remove("hidden");


  $("movieTap")
    .classList.remove("show");


  $("movieControls")
    .classList.remove("show");


  $("syncBadge").textContent =
    "Ready";


  $("currentTime").textContent =
    "00:00";


  $("duration").textContent =
    "00:00";


  $("seek").value = 0;

}


function loadMovie(file) {

  if (!file) return;


  /*
    Check that it is actually a video.
  */

  if (
    !file.type.startsWith("video/")
  ) {

    toast(
      "Please select a video file."
    );

    return;

  }


  /*
    Release previous object URL.
  */

  if (movieObjectURL) {

    URL.revokeObjectURL(
      movieObjectURL
    );

  }


  movieObjectURL =
    URL.createObjectURL(file);


  hasMovie = true;


  $("videoWrap")
    .classList.remove("no-movie");


  $("emptyState")
    .classList.add("hidden");


  $("movieTap")
    .classList.remove("show");


  $("syncBadge").textContent =
    "Loading…";


  movie.src =
    movieObjectURL;


  movie.load();


  console.log(
    "MOVIE SELECTED:",
    file.name
  );


  /*
    Send filename only for now.
  */

  if (roomId) {

    socket.emit(
      "movie-meta",
      {

        roomId,

        name:
          file.name

      }
    );

  }

}


movieFile.addEventListener(
  "change",
  event => {

    const file =
      event.target.files?.[0];


    if (!file) return;


    loadMovie(file);


    /*
      Reset value so selecting
      the same file again works.
    */

    movieFile.value = "";

  }
);


/*
  Movie loaded successfully.
*/

movie.addEventListener(
  "loadedmetadata",
  () => {

    $("duration").textContent =
      formatTime(movie.duration);


    $("syncBadge").textContent =
      "Ready";


    $("movieTap")
      .classList.add("show");


    toast(
      "Movie ready"
    );

  }
);


/*
  Movie can play.
*/

movie.addEventListener(
  "canplay",
  () => {

    $("syncBadge").textContent =
      "Ready";

  }
);


/*
  Movie error.
*/

movie.addEventListener(
  "error",
  () => {

    console.error(
      "VIDEO ERROR:",
      movie.error
    );


    $("syncBadge").textContent =
      "Unsupported";


    toast(
      "This video can't be played. Try MP4 H.264."
    );

  }
);


/* =========================================================
   MOVIE PLAYBACK
========================================================= */

async function togglePlay(
  send = true
) {

  if (!hasMovie) {

    movieFile.click();

    return;

  }


  if (movie.paused) {

    try {

      await movie.play();

    } catch (error) {

      console.error(
        "PLAY ERROR:",
        error
      );

      toast(
        "Tap play again."
      );

      return;

    }

  } else {

    movie.pause();

  }


  if (
    send &&
    roomId &&
    !ignorePlaybackEvent
  ) {

    socket.emit(
      "playback",
      {

        roomId,

        action:
          movie.paused
            ? "pause"
            : "play",

        time:
          movie.currentTime

      }
    );

  }

}


movie.addEventListener(
  "play",
  () => {

    $("movieTap")
      .classList.remove("show");

  }
);


movie.addEventListener(
  "pause",
  () => {

    if (hasMovie) {

      $("movieTap")
        .classList.add("show");

    }

  }
);


movie.addEventListener(
  "timeupdate",
  () => {

    $("currentTime").textContent =
      formatTime(
        movie.currentTime
      );


    if (
      movie.duration &&
      Number.isFinite(movie.duration)
    ) {

      $("seek").value =
        (
          movie.currentTime /
          movie.duration
        ) * 100;

    }

  }
);


/* =========================================================
   SEEK
========================================================= */

$("seek").addEventListener(
  "input",
  event => {

    if (!hasMovie) return;


    if (movie.duration) {

      movie.currentTime =
        (
          Number(event.target.value) /
          100
        ) * movie.duration;

    }

  }
);


$("seek").addEventListener(
  "change",
  () => {

    if (!hasMovie) return;


    if (
      roomId &&
      !ignorePlaybackEvent
    ) {

      socket.emit(
        "playback",
        {

          roomId,

          action: "seek",

          time:
            movie.currentTime

        }
      );

    }

  }
);


/* =========================================================
   REMOTE PLAYBACK
========================================================= */

socket.on(
  "playback",
  async data => {

    if (!hasMovie) return;


    ignorePlaybackEvent = true;


    try {

      if (
        Number.isFinite(
          Number(data.time)
        )
      ) {

        if (
          Math.abs(
            movie.currentTime -
            Number(data.time)
          ) > 0.5
        ) {

          movie.currentTime =
            Number(data.time);

        }

      }


      if (
        data.action === "play"
      ) {

        await movie.play()
          .catch(() => {});

      }


      if (
        data.action === "pause"
      ) {

        movie.pause();

      }

    } finally {

      setTimeout(() => {

        ignorePlaybackEvent = false;

      }, 50);

    }

  }
);


/* =========================================================
   MOVIE META
========================================================= */

socket.on(
  "movie-meta",
  data => {

    console.log(
      "PARTNER MOVIE:",
      data.name
    );

  }
);


/* =========================================================
   CHAT
========================================================= */

function addMessage(
  text,
  me = false
) {

  const empty =
    $("messageEmpty");


  if (empty) {
    empty.remove();
  }


  const el =
    document.createElement("div");


  el.className =
    "bubble" +
    (me ? " me" : "");


  el.textContent =
    text;


  $("messages")
    .appendChild(el);


  $("messages").scrollTop =
    $("messages").scrollHeight;

}


$("chatForm").addEventListener(
  "submit",
  event => {

    event.preventDefault();


    const input =
      $("chatInput");


    const text =
      input.value.trim();


    if (!text) return;


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

    addMessage(
      data.text,
      false
    );

  }
);


/* =========================================================
   REACTIONS
========================================================= */

function reactionEmoji(
  emoji,
  side = "remote"
) {

  const el =
    document.createElement("div");


  el.className =
    "float-reaction " +
    side;


  el.textContent =
    emoji;


  /*
    Partner reactions appear
    around partner camera.
  */

  if (side === "remote") {

    el.style.right =
      "12vw";

    el.style.bottom =
      "28vh";

  } else {

    el.style.left =
      "20vw";

    el.style.bottom =
      "28vh";

  }


  document.body.appendChild(
    el
  );


  setTimeout(
    () => el.remove(),
    1500
  );

}


$("reactionRow").addEventListener(
  "click",
  event => {

    const button =
      event.target.closest("button");


    if (!button) return;


    const emoji =
      button.dataset.reaction;


    reactionEmoji(
      emoji,
      "local"
    );


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

    reactionEmoji(
      data.emoji,
      "remote"
    );

  }
);


/* =========================================================
   MIC
========================================================= */

$("micBtn").addEventListener(
  "click",
  () => {

    const track =
      localStream?.getAudioTracks()[0];


    if (!track) {

      toast(
        "Microphone not available."
      );

      return;

    }


    track.enabled =
      !track.enabled;


    $("micBtn")
      .classList.toggle(
        "off",
        !track.enabled
      );


    toast(
      track.enabled
        ? "Microphone on"
        : "Microphone off"
    );

  }
);


/* =========================================================
   CAMERA
========================================================= */

$("cameraBtn").addEventListener(
  "click",
  () => {

    const track =
      localStream?.getVideoTracks()[0];


    if (!track) {

      toast(
        "Camera not available."
      );

      return;

    }


    track.enabled =
      !track.enabled;


    $("localPlaceholder")
      .style.display =
      track.enabled
        ? "none"
        : "grid";


    $("cameraBtn")
      .classList.toggle(
        "off",
        !track.enabled
      );


    $("youStatus").textContent =
      track.enabled
        ? "● live"
        : "○ camera off";

  }
);


/* =========================================================
   SHARE
========================================================= */

async function shareRoom() {

  if (!roomId) {

    toast(
      "Create a room first."
    );

    return;

  }


  const url =
    `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`;


  try {

    if (navigator.share) {

      await navigator.share({

        title: "MovieDate",

        text:
          "Join my MovieDate room ❤️",

        url

      });

      return;

    }

  } catch {}


  try {

    await navigator.clipboard
      .writeText(url);


    toast(
      "Room link copied"
    );

  } catch {

    prompt(
      "Copy this room link:",
      url
    );

  }

}


/* =========================================================
   BUTTONS
========================================================= */

$("shareBtn").onclick =
  shareRoom;


$("roomPill").onclick =
  shareRoom;


$("playBtn").onclick =
  () => togglePlay(true);


$("movieTap").onclick =
  () => togglePlay(true);


/*
  Clicking the movie itself
  only toggles if movie exists.
*/

movie.addEventListener(
  "click",
  () => {

    if (hasMovie) {

      togglePlay(true);

    }

  }
);


$("chooseMovieBtn").onclick =
  () => movieFile.click();


$("changeMovie").onclick =
  () => movieFile.click();


$("fullscreenBtn").onclick =
  async () => {

    try {

      if (
        document.fullscreenElement
      ) {

        await document.exitFullscreen();

      } else {

        await $("videoWrap")
          .requestFullscreen();

      }

    } catch {}

  };


$("muteBtn").onclick =
  () => {

    movie.muted =
      !movie.muted;


    $("muteBtn").classList.toggle(
      "off",
      movie.muted
    );

  };


/* =========================================================
   ROOM BUTTONS
========================================================= */

$("createRoomBtn").onclick =
  createRoom;


$("joinPromptBtn").onclick =
  () => {

    $("joinSheet").hidden =
      false;

    setTimeout(
      () => $("roomCodeInput").focus(),
      50
    );

  };


$("closeJoinBtn").onclick =
  () => {

    $("joinSheet").hidden =
      true;

  };


$("joinRoomBtn").onclick =
  async () => {

    const code =
      $("roomCodeInput")
        .value
        .trim()
        .toUpperCase();


    if (!code) {

      toast(
        "Enter a room code."
      );

      return;

    }


    roomId = code;

    isHost = false;

    joinedOnServer = false;

    joinRequested = false;


    $("joinSheet").hidden =
      true;


    updateRoomURL();

    updateRoomUI();


    await joinExistingRoom();

  };


$("roomCodeInput").addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter"
    ) {

      $("joinRoomBtn").click();

    }

  }
);


/* =========================================================
   EXIT
========================================================= */

$("exitBtn").onclick =
  () => {

    socket.emit(
      "leave-room"
    );


    if (peer) {

      peer.close();

      peer = null;

    }


    if (localStream) {

      localStream
        .getTracks()
        .forEach(track =>
          track.stop()
        );

      localStream = null;

    }


    if (movieObjectURL) {

      URL.revokeObjectURL(
        movieObjectURL
      );

    }


    location.href =
      location.pathname;

  };


/* =========================================================
   INITIAL STATE
========================================================= */

resetMovieUI();

updateRoomUI();


if (roomId) {

  setSyncStatus(
    "Connecting…"
  );

  setPartnerStatus(
    "○ joining…"
  );

} else {

  setSyncStatus(
    "Ready"
  );

  setPartnerStatus(
    "○ waiting"
  );

}
