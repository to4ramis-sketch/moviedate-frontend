/* =========================================================
   MOVIEDATE — COMPLETE APP.JS
   CAMERA + MOVIE WEBRTC FIX
   ========================================================= */

const BACKEND_URL =
  "https://moviedate-backend-production.up.railway.app";

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
  reconnection: true
});


/* =========================================================
   HELPERS
   ========================================================= */

const $ = (id) => document.getElementById(id);

function log(...args) {
  console.log("[MovieDate]", ...args);
}


/* =========================================================
   ELEMENTS
   ========================================================= */

/* Room */

const roomGate = $("roomGate");
const app = $("app");

const createRoomBtn = $("createRoomBtn");
const joinPromptBtn = $("joinPromptBtn");

const joinSheet = $("joinSheet");
const closeJoinBtn = $("closeJoinBtn");
const joinRoomBtn = $("joinRoomBtn");
const roomCodeInput = $("roomCodeInput");

const roomCodeDisplay = $("roomCode");
const shareRoomBtn = $("shareRoomBtn");
const exitBtn = $("exitBtn");

const toast = $("toast");


/* Movie */

const movie = $("movie");
const movieFile = $("movieFile");
const chooseMovieBtn = $("chooseMovieBtn");
const movieTap = $("movieTap");
const emptyState = $("emptyState");

const playBtn = $("playBtn");
const seekBar = $("seekBar");
const movieTime = $("movieTime");
const muteBtn = $("muteBtn");
const fullscreenBtn = $("fullscreenBtn");


/* Camera */

const localVideo = $("localVideo");
const remoteVideo = $("remoteVideo");

const micBtn = $("micBtn");
const cameraBtn = $("cameraBtn");


/* Chat */

const chatForm = $("chatForm");
const chatInput = $("chatInput");
const messages = $("messages");


/* Reactions */

const reactionButtons =
  document.querySelectorAll(".reaction-btn");


/* =========================================================
   ROOM STATE
   ========================================================= */

let currentRoom = null;
let isHost = false;


/* =========================================================
   CAMERA STATE
   ========================================================= */

let localStream = null;
let cameraPeer = null;

let pendingCameraIce = [];
let cameraRemoteDescriptionSet = false;

let cameraOfferSent = false;


/* =========================================================
   MOVIE STATE
   ========================================================= */

let hasMovie = false;

let localMovieURL = null;
let movieCaptureStream = null;

let moviePeer = null;

let movieVideoSender = null;
let movieAudioSender = null;

let pendingMovieIce = [];
let movieRemoteDescriptionSet = false;

let movieOfferSent = false;


/* =========================================================
   GENERAL STATE
   ========================================================= */

let suppressMovieEvents = false;
let lastRemotePlayback = 0;


/* =========================================================
   TOAST
   ========================================================= */

function showToast(message) {

  if (!toast) return;

  toast.textContent = message;

  toast.classList.add("show");

  clearTimeout(
    showToast.timer
  );

  showToast.timer =
    setTimeout(() => {

      toast.classList.remove("show");

    }, 2500);
}


/* =========================================================
   ROOM SCREEN
   ========================================================= */

function showRoomGate() {

  log("Showing room gate");

  if (roomGate) {

    roomGate.classList.remove("hidden");

    roomGate.style.display = "flex";
  }


  if (app) {

    app.classList.add("hidden");

    app.style.display = "none";
  }


  if (joinSheet) {

    joinSheet.classList.add("hidden");

    joinSheet.style.display = "none";
  }

}


function showApp() {

  log("Showing watch app");

  if (roomGate) {

    roomGate.classList.add("hidden");

    roomGate.style.display = "none";
  }


  if (joinSheet) {

    joinSheet.classList.add("hidden");

    joinSheet.style.display = "none";
  }


  if (app) {

    app.classList.remove("hidden");

    app.style.display = "";
  }

}


/* =========================================================
   ROOM CODE
   ========================================================= */

function generateRoomCode() {

  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let result = "";

  for (let i = 0; i < 6; i++) {

    result +=
      chars[
        Math.floor(
          Math.random() * chars.length
        )
      ];

  }

  return result;
}


/* =========================================================
   CREATE ROOM
   ========================================================= */

createRoomBtn?.addEventListener(
  "click",
  () => {

    const roomCode =
      generateRoomCode();

    log(
      "Creating room:",
      roomCode
    );

    currentRoom =
      roomCode;

    isHost = true;

    socket.emit(
      "join-room",
      roomCode
    );

  }
);


/* =========================================================
   OPEN JOIN SHEET
   ========================================================= */

joinPromptBtn?.addEventListener(
  "click",
  () => {

    if (!joinSheet) return;

    joinSheet.classList.remove(
      "hidden"
    );

    joinSheet.style.display =
      "flex";

    setTimeout(() => {

      roomCodeInput?.focus();

    }, 100);

  }
);


/* =========================================================
   CLOSE JOIN SHEET
   ========================================================= */

closeJoinBtn?.addEventListener(
  "click",
  () => {

    if (!joinSheet) return;

    joinSheet.classList.add(
      "hidden"
    );

    joinSheet.style.display =
      "none";

  }
);


/* =========================================================
   JOIN ROOM
   ========================================================= */

joinRoomBtn?.addEventListener(
  "click",
  () => {

    const code =
      roomCodeInput?.value
        ?.trim()
        .toUpperCase()
        .replace(
          /[^A-Z0-9]/g,
          ""
        );


    if (!code) {

      showToast(
        "Enter a room code"
      );

      return;
    }


    log(
      "Joining room:",
      code
    );


    currentRoom =
      code;

    isHost = false;


    socket.emit(
      "join-room",
      code
    );

  }
);


/* =========================================================
   ENTER KEY JOIN
   ========================================================= */

roomCodeInput?.addEventListener(
  "keydown",
  (event) => {

    if (
      event.key === "Enter"
    ) {

      event.preventDefault();

      joinRoomBtn?.click();

    }

  }
);


/* =========================================================
   ROOM JOINED
   ========================================================= */

socket.on(
  "room-joined",
  async (data) => {

    log(
      "Room joined:",
      data
    );


    currentRoom =
      data.roomId;

    isHost =
      !!data.isHost;


    if (roomCodeDisplay) {

      roomCodeDisplay.textContent =
        currentRoom;

    }


    showApp();


    /*
      Start camera after successfully
      entering a room.
    */

    await startCamera();


    /*
      Tell backend that we are ready.
    */

    socket.emit(
      "peer-ready"
    );

  }
);


/* =========================================================
   ROOM STATE
   ========================================================= */

socket.on(
  "room-state",
  (data) => {

    log(
      "Room state:",
      data
    );


    if (data.roomId) {

      currentRoom =
        data.roomId;

    }


    /*
      DO NOT call showApp() here.
    */


    if (
      data.movie &&
      data.movie.name
    ) {

      log(
        "Partner has movie:",
        data.movie.name
      );

    }


    if (data.playback) {

      applyRemotePlayback(
        data.playback
      );

    }

  }
);


/* =========================================================
   ROOM FULL
   ========================================================= */

socket.on(
  "room-full",
  () => {

    showToast(
      "This room already has two people."
    );

    showRoomGate();

  }
);


/* =========================================================
   ROOM ERROR
   ========================================================= */

socket.on(
  "room-error",
  (data) => {

    console.error(
      "Room error:",
      data
    );

    showToast(
      data?.message ||
      "Could not join room."
    );

    showRoomGate();

  }
);


/* =========================================================
   SOCKET CONNECTION
   ========================================================= */

socket.on(
  "connect",
  () => {

    log(
      "Connected:",
      socket.id
    );

  }
);


socket.on(
  "disconnect",
  () => {

    log(
      "Disconnected"
    );

  }
);


socket.on(
  "connect_error",
  (error) => {

    console.error(
      "Socket connection error:",
      error
    );

  }
);


/* =========================================================
   CAMERA — START
   ========================================================= */

async function startCamera() {

  if (localStream) {

    return localStream;

  }


  try {

    localStream =
      await navigator.mediaDevices
        .getUserMedia({
          video: {
            facingMode: "user"
          },
          audio: true
        });


    if (localVideo) {

      localVideo.srcObject =
        localStream;

      localVideo.muted =
        true;

      localVideo.playsInline =
        true;

      localVideo.play()
        .catch(() => {});

    }


    log(
      "Camera started"
    );


    /*
      Create the camera peer immediately.
      Tracks are added before negotiation.
    */

    if (
      !cameraPeer ||
      cameraPeer.connectionState ===
        "closed"
    ) {

      createCameraPeer();

    }


    return localStream;

  } catch (error) {

    console.error(
      "Camera error:",
      error
    );

    showToast(
      "Camera or microphone permission denied."
    );

    return null;

  }

}


/* =========================================================
   CAMERA — CREATE PEER
   ========================================================= */

function createCameraPeer() {

  if (
    cameraPeer &&
    cameraPeer.signalingState !==
      "closed"
  ) {

    return cameraPeer;

  }


  cameraRemoteDescriptionSet =
    false;

  pendingCameraIce = [];


  cameraPeer =
    new RTCPeerConnection({
      iceServers: [
        {
          urls:
            "stun:stun.l.google.com:19302"
        }
      ]
    });


  /*
    Add local camera + microphone.
  */

  if (localStream) {

    localStream
      .getTracks()
      .forEach((track) => {

        try {

          cameraPeer.addTrack(
            track,
            localStream
          );

        } catch (error) {

          console.warn(
            "Could not add camera track:",
            error
          );

        }

      });

  }


  /*
    ICE candidates.
  */

  cameraPeer.onicecandidate =
    (event) => {

      if (
        event.candidate
      ) {

        socket.emit(
          "webrtc",
          {
            type:
              "camera-ice",
            candidate:
              event.candidate
          }
        );

      }

    };


  /*
    IMPORTANT FIX:
    Always build a remote MediaStream.

    Some browsers provide event.streams[0].
    Some situations can deliver the track
    without the stream array.
  */

  let remoteCameraStream =
    null;


  cameraPeer.ontrack =
    (event) => {

      log(
        "Remote camera track:",
        event.track?.kind
      );


      if (!remoteCameraStream) {

        remoteCameraStream =
          event.streams &&
          event.streams[0]
            ? event.streams[0]
            : new MediaStream();

      }


      /*
        If Chrome did not provide a stream,
        manually add the incoming track.
      */

      if (
        !event.streams ||
        !event.streams[0]
      ) {

        const exists =
          remoteCameraStream
            .getTracks()
            .some(
              track =>
                track.id ===
                event.track.id
            );

        if (!exists) {

          remoteCameraStream.addTrack(
            event.track
          );

        }

      }


      if (remoteVideo) {

        remoteVideo.srcObject =
          remoteCameraStream;

        remoteVideo.autoplay =
          true;

        remoteVideo.playsInline =
          true;

        remoteVideo.muted =
          true;

        remoteVideo.play()
          .catch(() => {});

      }

    };


  cameraPeer.onconnectionstatechange =
    () => {

      if (!cameraPeer) return;

      log(
        "Camera state:",
        cameraPeer.connectionState
      );


      if (
        cameraPeer.connectionState ===
        "connected"
      ) {

        log(
          "CAMERA CONNECTED"
        );

      }


      if (
        cameraPeer.connectionState ===
        "failed"
      ) {

        console.warn(
          "Camera connection failed"
        );

        try {

          cameraPeer.restartIce();

        } catch (error) {}

      }

    };


  cameraPeer.oniceconnectionstatechange =
    () => {

      if (!cameraPeer) return;

      log(
        "Camera ICE:",
        cameraPeer.iceConnectionState
      );

    };


  return cameraPeer;

}


/* =========================================================
   CAMERA — OFFER
   ========================================================= */

async function createCameraOffer() {

  if (
    cameraOfferSent
  ) {

    return;

  }


  if (!cameraPeer) {

    createCameraPeer();

  }


  if (
    !cameraPeer
  ) {

    return;

  }


  if (
    cameraPeer.signalingState !==
      "stable"
  ) {

    return;

  }


  try {

    const offer =
      await cameraPeer.createOffer();


    await cameraPeer.setLocalDescription(
      offer
    );


    socket.emit(
      "webrtc",
      {
        type:
          "camera-offer",
        sdp:
          cameraPeer.localDescription
      }
    );


    cameraOfferSent =
      true;


    log(
      "Camera offer sent"
    );

  } catch (error) {

    console.error(
      "Camera offer error:",
      error
    );

  }

}


/* =========================================================
   CAMERA — FLUSH ICE
   ========================================================= */

async function flushCameraIce() {

  if (
    !cameraPeer ||
    !cameraRemoteDescriptionSet
  ) {

    return;

  }


  while (
    pendingCameraIce.length
  ) {

    const candidate =
      pendingCameraIce.shift();


    try {

      await cameraPeer
        .addIceCandidate(
          candidate
        );

    } catch (error) {

      console.warn(
        "Camera ICE error:",
        error
      );

    }

  }

}


/* =========================================================
   CAMERA / MOVIE WEBRTC SIGNALING
   ========================================================= */

socket.on(
  "peer-ready",
  async (data) => {

    log(
      "Peer ready:",
      data
    );


    /*
      HOST creates the camera offer.
    */

    if (isHost) {

      await createCameraOffer();


      /*
        If host already selected a movie,
        start its movie WebRTC connection.
      */

      if (hasMovie) {

        await startMovieStream();

      }

    }

  }
);


socket.on(
  "peer-joined",
  async (data) => {

    log(
      "Peer joined:",
      data
    );

  }
);


/* =========================================================
   WEBRTC MESSAGE HANDLER
   ========================================================= */

socket.on(
  "webrtc",
  async (data) => {

    if (!data) return;


    if (
      data.type ===
      "camera-offer"
    ) {

      await handleCameraOffer(
        data
      );

      return;

    }


    if (
      data.type ===
      "camera-answer"
    ) {

      await handleCameraAnswer(
        data
      );

      return;

    }


    if (
      data.type ===
      "camera-ice"
    ) {

      await handleCameraIce(
        data
      );

      return;

    }


    if (
      data.type ===
      "movie-offer"
    ) {

      await handleMovieOffer(
        data
      );

      return;

    }


    if (
      data.type ===
      "movie-answer"
    ) {

      await handleMovieAnswer(
        data
      );

      return;

    }


    if (
      data.type ===
      "movie-ice"
    ) {

      await handleMovieIce(
        data
      );

      return;

    }

  }
);


/* =========================================================
   HANDLE CAMERA OFFER
   ========================================================= */

async function handleCameraOffer(
  data
) {

  try {

    if (!cameraPeer) {

      /*
        Receiver should already have
        created this after startCamera(),
        but keep this as a safety fallback.
      */

      createCameraPeer();

    }


    if (!cameraPeer) {

      return;

    }


    /*
      Ignore duplicate offers while another
      negotiation is still being processed.
    */

    if (
      cameraPeer.signalingState !==
      "stable"
    ) {

      log(
        "Ignoring camera offer in state:",
        cameraPeer.signalingState
      );

      return;

    }


    await cameraPeer
      .setRemoteDescription(
        data.sdp
      );


    cameraRemoteDescriptionSet =
      true;


    await flushCameraIce();


    const answer =
      await cameraPeer
        .createAnswer();


    await cameraPeer
      .setLocalDescription(
        answer
      );


    socket.emit(
      "webrtc",
      {
        type:
          "camera-answer",
        sdp:
          cameraPeer.localDescription
      }
    );


    log(
      "Camera answer sent"
    );

  } catch (error) {

    console.error(
      "Camera offer handling error:",
      error
    );

  }

}


/* =========================================================
   HANDLE CAMERA ANSWER
   ========================================================= */

async function handleCameraAnswer(
  data
) {

  if (!cameraPeer) {

    return;

  }


  try {

    if (
      cameraPeer.signalingState !==
      "have-local-offer"
    ) {

      log(
        "Ignoring camera answer in state:",
        cameraPeer.signalingState
      );

      return;

    }


    await cameraPeer
      .setRemoteDescription(
        data.sdp
      );


    cameraRemoteDescriptionSet =
      true;


    await flushCameraIce();


    log(
      "Camera answer received"
    );

  } catch (error) {

    console.error(
      "Camera answer error:",
      error
    );

  }

}


/* =========================================================
   HANDLE CAMERA ICE
   ========================================================= */

async function handleCameraIce(
  data
) {

  if (!data.candidate) {

    return;

  }


  if (!cameraPeer) {

    createCameraPeer();

  }


  if (
    !cameraPeer
  ) {

    return;

  }


  if (
    !cameraRemoteDescriptionSet
  ) {

    pendingCameraIce.push(
      data.candidate
    );

    return;

  }


  try {

    await cameraPeer
      .addIceCandidate(
        data.candidate
      );

  } catch (error) {

    console.warn(
      "Camera ICE failed:",
      error
    );

  }

}


/* =========================================================
   MOVIE — FILE SELECTION
   ========================================================= */

chooseMovieBtn?.addEventListener(
  "click",
  () => {

    movieFile?.click();

  }
);


movieFile?.addEventListener(
  "change",
  async () => {

    const file =
      movieFile.files?.[0];


    if (!file) {

      return;

    }


    log(
      "Movie selected:",
      file.name,
      file.type,
      file.size
    );


    await loadMovie(
      file
    );

  }
);


/* =========================================================
   MOVIE — LOAD
   ========================================================= */

async function loadMovie(
  file
) {

  hasMovie =
    false;


  /*
    Close previous movie peer.
  */

  if (moviePeer) {

    moviePeer.close();

    moviePeer =
      null;

  }


  movieVideoSender =
    null;

  movieAudioSender =
    null;

  movieOfferSent =
    false;

  movieRemoteDescriptionSet =
    false;

  pendingMovieIce =
    [];


  /*
    Stop previous captured tracks.
  */

  if (
    movieCaptureStream
  ) {

    movieCaptureStream
      .getTracks()
      .forEach(
        track =>
          track.stop()
      );

    movieCaptureStream =
      null;

  }


  /*
    Remove previous URL.
  */

  if (localMovieURL) {

    URL.revokeObjectURL(
      localMovieURL
    );

  }


  localMovieURL =
    URL.createObjectURL(
      file
    );


  /*
    Load movie locally.
  */

  movie.src =
    localMovieURL;

  movie.srcObject =
    null;

  movie.controls =
    false;

  movie.muted =
    false;


  /*
    Tell partner the movie name.
  */

  socket.emit(
    "movie-meta",
    {
      name:
        file.name
    }
  );


  /*
    Show player.
  */

  if (emptyState) {

    emptyState.classList.add(
      "hidden"
    );

  }


  movie.onloadedmetadata =
    async () => {

      hasMovie =
        true;


      log(
        "Movie metadata loaded",
        movie.videoWidth,
        movie.videoHeight
      );


      /*
        Start the captured movie
        stream after metadata exists.
      */

      await startMovieStream();


      /*
        Host can start playback.
      */

      try {

        await movie.play();

      } catch (error) {

        log(
          "Autoplay prevented"
        );

      }

    };

}


/* =========================================================
   MOVIE — CAPTURE STREAM
   ========================================================= */

function getMovieCaptureStream() {

  if (
    movieCaptureStream
  ) {

    return movieCaptureStream;

  }


  if (
    typeof movie.captureStream !==
    "function"
  ) {

    showToast(
      "This browser does not support movie sharing."
    );

    return null;

  }


  movieCaptureStream =
    movie.captureStream();


  log(
    "Movie capture stream:",
    movieCaptureStream.getTracks().map(
      track => track.kind
    )
  );


  return movieCaptureStream;

}


/* =========================================================
   MOVIE — CREATE PEER
   ========================================================= */

function createMoviePeer() {

  if (
    moviePeer &&
    moviePeer.signalingState !==
      "closed"
  ) {

    return moviePeer;

  }


  movieRemoteDescriptionSet =
    false;

  pendingMovieIce = [];


  moviePeer =
    new RTCPeerConnection({
      iceServers: [
        {
          urls:
            "stun:stun.l.google.com:19302"
        }
      ]
    });


  moviePeer.onicecandidate =
    (event) => {

      if (
        event.candidate
      ) {

        socket.emit(
          "webrtc",
          {
            type:
              "movie-ice",
            candidate:
              event.candidate
          }
        );

      }

    };


  /*
    =======================================================
    IMPORTANT FIX
    =======================================================

    The receiver previously had NO ontrack handler
    for the movie peer.

    That meant the movie stream could arrive successfully
    through WebRTC but was never assigned to <video id="movie">.
  */

  let remoteMovieStream =
    null;


  moviePeer.ontrack =
    (event) => {

      log(
        "REMOTE MOVIE TRACK:",
        event.track?.kind
      );


      if (!remoteMovieStream) {

        remoteMovieStream =
          event.streams &&
          event.streams[0]
            ? event.streams[0]
            : new MediaStream();

      }


      /*
        Fallback for browsers where
        event.streams is empty.
      */

      if (
        !event.streams ||
        !event.streams[0]
      ) {

        const exists =
          remoteMovieStream
            .getTracks()
            .some(
              track =>
                track.id ===
                event.track.id
            );

        if (!exists) {

          remoteMovieStream.addTrack(
            event.track
          );

        }

      }


      /*
        Attach incoming movie to the
        existing movie element.

        This is the critical receiver fix.
      */

      if (movie) {

        movie.srcObject =
          remoteMovieStream;

        movie.removeAttribute(
          "src"
        );

        movie.autoplay =
          false;

        movie.playsInline =
          true;


        /*
          Receiver video should not be
          muted by default because the
          movie audio is also being sent.
        */

        movie.muted =
          false;


        log(
          "Remote movie stream attached"
        );


        /*
          Try playback. Android Chrome may
          block this until the user taps.
        */

        movie.play()
          .then(() => {

            log(
              "Remote movie playback started"
            );

          })
          .catch(() => {

            log(
              "Remote movie waiting for user tap"
            );

            showToast(
              "Tap the movie to start playback."
            );

          });

      }

    };


  moviePeer.onconnectionstatechange =
    () => {

      if (!moviePeer) return;

      log(
        "Movie connection:",
        moviePeer.connectionState
      );


      if (
        moviePeer.connectionState ===
        "connected"
      ) {

        log(
          "MOVIE CONNECTED"
        );

      }


      if (
        moviePeer.connectionState ===
        "failed"
      ) {

        console.warn(
          "Movie connection failed"
        );

        try {

          moviePeer.restartIce();

        } catch (error) {}

      }

    };


  moviePeer.oniceconnectionstatechange =
    () => {

      if (!moviePeer) return;

      log(
        "Movie ICE:",
        moviePeer.iceConnectionState
      );

    };


  return moviePeer;

}


/* =========================================================
   MOVIE — START STREAM
   ========================================================= */

async function startMovieStream() {

  if (
    !hasMovie ||
    !movie
  ) {

    return;

  }


  /*
    Movie sharing is host -> receiver only.
  */

  if (!isHost) {

    return;

  }


  const stream =
    getMovieCaptureStream();


  if (!stream) {

    return;

  }


  if (!moviePeer) {

    createMoviePeer();

  }


  if (!moviePeer) {

    return;

  }


  /*
    Add video only once.
  */

  const videoTrack =
    stream.getVideoTracks()[0];


  if (
    videoTrack &&
    !movieVideoSender
  ) {

    movieVideoSender =
      moviePeer.addTrack(
        videoTrack,
        stream
      );

    log(
      "Movie video track added"
    );

  }


  /*
    Add audio only once.
  */

  const audioTrack =
    stream.getAudioTracks()[0];


  if (
    audioTrack &&
    !movieAudioSender
  ) {

    movieAudioSender =
      moviePeer.addTrack(
        audioTrack,
        stream
      );

    log(
      "Movie audio track added"
    );

  }


  /*
    Only send initial offer once.
  */

  if (
    !movieOfferSent &&
    moviePeer.signalingState ===
      "stable"
  ) {

    try {

      const offer =
        await moviePeer
          .createOffer();


      await moviePeer
        .setLocalDescription(
          offer
        );


      socket.emit(
        "webrtc",
        {
          type:
            "movie-offer",
          sdp:
            moviePeer.localDescription
        }
      );


      movieOfferSent =
        true;


      log(
        "Movie offer sent"
      );

    } catch (error) {

      console.error(
        "Movie offer error:",
        error
      );

    }

  }

}


/* =========================================================
   MOVIE — HANDLE OFFER
   ========================================================= */

async function handleMovieOffer(
  data
) {

  try {

    if (!moviePeer) {

      createMoviePeer();

    }


    if (!moviePeer) {

      return;

    }


    /*
      Receiver accepts the host offer.
    */

    if (
      moviePeer.signalingState !==
      "stable"
    ) {

      log(
        "Ignoring movie offer in state:",
        moviePeer.signalingState
      );

      return;

    }


    await moviePeer
      .setRemoteDescription(
        data.sdp
      );


    movieRemoteDescriptionSet =
      true;


    await flushMovieIce();


    const answer =
      await moviePeer
        .createAnswer();


    await moviePeer
      .setLocalDescription(
        answer
      );


    socket.emit(
      "webrtc",
      {
        type:
          "movie-answer",
        sdp:
          moviePeer.localDescription
      }
    );


    log(
      "Movie answer sent"
    );

  } catch (error) {

    console.error(
      "Movie offer error:",
      error
    );

  }

}


/* =========================================================
   MOVIE — HANDLE ANSWER
   ========================================================= */

async function handleMovieAnswer(
  data
) {

  if (!moviePeer) {

    return;

  }


  try {

    if (
      moviePeer.signalingState !==
      "have-local-offer"
    ) {

      log(
        "Ignoring movie answer in state:",
        moviePeer.signalingState
      );

      return;

    }


    await moviePeer
      .setRemoteDescription(
        data.sdp
      );


    movieRemoteDescriptionSet =
      true;


    await flushMovieIce();


    log(
      "Movie answer received"
    );

  } catch (error) {

    console.error(
      "Movie answer error:",
      error
    );

  }

}


/* =========================================================
   MOVIE — HANDLE ICE
   ========================================================= */

async function handleMovieIce(
  data
) {

  if (!data.candidate) {

    return;

  }


  if (!moviePeer) {

    createMoviePeer();

  }


  if (!moviePeer) {

    return;

  }


  if (
    !movieRemoteDescriptionSet
  ) {

    pendingMovieIce.push(
      data.candidate
    );

    return;

  }


  try {

    await moviePeer
      .addIceCandidate(
        data.candidate
      );

  } catch (error) {

    console.warn(
      "Movie ICE failed:",
      error
    );

  }

}


/* =========================================================
   MOVIE — FLUSH ICE
   ========================================================= */

async function flushMovieIce() {

  if (
    !moviePeer ||
    !movieRemoteDescriptionSet
  ) {

    return;

  }


  while (
    pendingMovieIce.length
  ) {

    const candidate =
      pendingMovieIce.shift();


    try {

      await moviePeer
        .addIceCandidate(
          candidate
        );

    } catch (error) {

      console.warn(
        "Movie ICE queue error:",
        error
      );

    }

  }

}


/* =========================================================
   MOVIE PLAY / PAUSE
   ========================================================= */

playBtn?.addEventListener(
  "click",
  async () => {

    if (!hasMovie) {

      showToast(
        "Choose a movie first."
      );

      return;

    }


    if (
      movie.paused
    ) {

      await playMovie(
        true
      );

    } else {

      pauseMovie(
        true
      );

    }

  }
);


/* Movie click */

movieTap?.addEventListener(
  "click",
  (event) => {

    if (
      event.target.closest(
        ".movie-controls"
      )
    ) {

      return;

    }


    if (!hasMovie) {

      return;

    }


    if (
      movie.paused
    ) {

      playMovie(
        true
      );

    } else {

      pauseMovie(
        true
      );

    }

  }
);


/* =========================================================
   PLAY MOVIE
   ========================================================= */

async function playMovie(
  broadcast
) {

  try {

    await movie.play();

  } catch (error) {

    showToast(
      "Tap the movie to start playback."
    );

    return;

  }


  updatePlayButton();


  if (broadcast) {

    socket.emit(
      "playback",
      {
        action:
          "play",
        time:
          movie.currentTime
      }
    );

  }

}


/* =========================================================
   PAUSE MOVIE
   ========================================================= */

function pauseMovie(
  broadcast
) {

  movie.pause();

  updatePlayButton();


  if (broadcast) {

    socket.emit(
      "playback",
      {
        action:
          "pause",
        time:
          movie.currentTime
      }
    );

  }

}


/* =========================================================
   PLAY BUTTON UI
   ========================================================= */

function updatePlayButton() {

  if (!playBtn) return;

  playBtn.textContent =
    movie.paused
      ? "▶"
      : "❚❚";

}


/* =========================================================
   REMOTE PLAYBACK
   ========================================================= */

async function applyRemotePlayback(
  data
) {

  if (!movie) return;


  if (
    typeof data.time ===
    "number"
  ) {

    lastRemotePlayback =
      data.time;


    if (
      Math.abs(
        movie.currentTime -
        data.time
      ) > 0.5
    ) {

      try {

        movie.currentTime =
          data.time;

      } catch (error) {}

    }

  }


  suppressMovieEvents =
    true;


  try {

    if (
      data.action ===
      "play"
    ) {

      await movie.play();

    } else {

      movie.pause();

    }

  } catch (error) {

    /*
      Android Chrome can block
      remote autoplay.
    */

  }


  suppressMovieEvents =
    false;


  updatePlayButton();

}


/* =========================================================
   MOVIE SEEK
   ========================================================= */

seekBar?.addEventListener(
  "input",
  () => {

    if (!movie.duration) {

      return;

    }


    const time =
      (
        Number(
          seekBar.value
        ) / 100
      ) *
      movie.duration;


    movie.currentTime =
      time;


    updateMovieTime();

  }
);


seekBar?.addEventListener(
  "change",
  () => {

    if (!movie.duration) {

      return;

    }


    socket.emit(
      "playback",
      {
        action:
          movie.paused
            ? "pause"
            : "play",
        time:
          movie.currentTime
      }
    );

  }
);


/* =========================================================
   MOVIE TIME UPDATE
   ========================================================= */

movie?.addEventListener(
  "timeupdate",
  () => {

    updateMovieTime();

  }
);


function updateMovieTime() {

  if (!movie) return;


  const current =
    movie.currentTime || 0;

  const duration =
    movie.duration || 0;


  if (seekBar) {

    seekBar.value =
      duration
        ? (
            current /
            duration *
            100
          )
        : 0;

  }


  if (movieTime) {

    movieTime.textContent =
      formatTime(current);

  }

}


function formatTime(
  seconds
) {

  seconds =
    Math.max(
      0,
      Math.floor(
        Number(seconds) || 0
      )
    );


  const minutes =
    Math.floor(
      seconds / 60
    );


  const secs =
    seconds % 60;


  return (
    String(minutes)
      .padStart(2, "0")
    +
    ":" +
    String(secs)
      .padStart(2, "0")
  );

}


/* =========================================================
   MOVIE METADATA
   ========================================================= */

socket.on(
  "movie-meta",
  (data) => {

    log(
      "Partner movie:",
      data?.name
    );

    if (data?.name) {

      showToast(
        `${data.name}`
      );

    }

  }
);


/* =========================================================
   MUTE
   ========================================================= */

muteBtn?.addEventListener(
  "click",
  () => {

    movie.muted =
      !movie.muted;


    muteBtn.textContent =
      movie.muted
        ? "🔇"
        : "🔊";

  }
);


/* =========================================================
   FULLSCREEN
   ========================================================= */

fullscreenBtn?.addEventListener(
  "click",
  async () => {

    try {

      if (
        !document.fullscreenElement
      ) {

        await movie.requestFullscreen();

      } else {

        await document.exitFullscreen();

      }

    } catch (error) {

      console.error(
        "Fullscreen error:",
        error
      );

    }

  }
);


/* =========================================================
   MIC
   ========================================================= */

micBtn?.addEventListener(
  "click",
  async () => {

    if (!localStream) {

      await startCamera();

    }


    const tracks =
      localStream?.getAudioTracks();


    if (!tracks?.length) {

      return;

    }


    const enabled =
      !tracks[0].enabled;


    tracks.forEach(
      track => {
        track.enabled =
          enabled;
      }
    );


    micBtn.textContent =
      enabled
        ? "🎙"
        : "🔇";

  }
);


/* =========================================================
   CAMERA TOGGLE
   ========================================================= */

cameraBtn?.addEventListener(
  "click",
  async () => {

    if (!localStream) {

      await startCamera();

    }


    const tracks =
      localStream?.getVideoTracks();


    if (!tracks?.length) {

      return;

    }


    const enabled =
      !tracks[0].enabled;


    tracks.forEach(
      track => {
        track.enabled =
          enabled;
      }
    );


    cameraBtn.textContent =
      enabled
        ? "📷"
        : "🚫";

  }
);


/* =========================================================
   CHAT
   ========================================================= */

chatForm?.addEventListener(
  "submit",
  (event) => {

    event.preventDefault();


    const text =
      chatInput?.value
        ?.trim();


    if (!text) {

      return;

    }


    addChatMessage(
      text,
      true
    );


    socket.emit(
      "chat",
      {
        text
      }
    );


    chatInput.value =
      "";

  }
);


/* =========================================================
   RECEIVE CHAT
   ========================================================= */

socket.on(
  "chat",
  (data) => {

    addChatMessage(
      data?.text || "",
      false
    );

  }
);


/* =========================================================
   ADD CHAT MESSAGE
   ========================================================= */

function addChatMessage(
  text,
  mine
) {

  if (!messages) {

    return;

  }


  const item =
    document.createElement(
      "div"
    );


  item.className =
    mine
      ? "message mine"
      : "message";


  item.textContent =
    text;


  messages.appendChild(
    item
  );


  messages.scrollTop =
    messages.scrollHeight;

}


/* =========================================================
   REACTIONS
   ========================================================= */

reactionButtons.forEach(
  (button) => {

    button.addEventListener(
      "click",
      () => {

        const emoji =
          button.dataset.emoji;


        if (!emoji) {

          return;

        }


        showReaction(
          emoji
        );


        socket.emit(
          "reaction",
          {
            emoji
          }
        );

      }
    );

  }
);


/* =========================================================
   RECEIVE REACTION
   ========================================================= */

socket.on(
  "reaction",
  (data) => {

    if (
      data?.emoji
    ) {

      showReaction(
        data.emoji
      );

    }

  }
);


/* =========================================================
   SHOW FLOATING REACTION
   ========================================================= */

function showReaction(
  emoji
) {

  const reaction =
    document.createElement(
      "div"
    );


  reaction.className =
    "floating-reaction";


  reaction.textContent =
    emoji;


  reaction.style.left =
    (
      20 +
      Math.random() *
      60
    ) + "%";


  reaction.style.bottom =
    "90px";


  document.body.appendChild(
    reaction
  );


  setTimeout(
    () => {

      reaction.remove();

    },
    2200
  );

}


/* =========================================================
   SHARE ROOM
   ========================================================= */

shareRoomBtn?.addEventListener(
  "click",
  async () => {

    if (!currentRoom) {

      return;

    }


    const url =
      window.location.origin +
      window.location.pathname +
      "?room=" +
      encodeURIComponent(
        currentRoom
      );


    const text =
      `Join my MovieDate room: ${currentRoom}`;


    try {

      if (
        navigator.share
      ) {

        await navigator.share({
          title:
            "MovieDate",
          text,
          url
        });

      } else if (
        navigator.clipboard
      ) {

        await navigator.clipboard
          .writeText(
            `${text}\n${url}`
          );


        showToast(
          "Room link copied"
        );

      }

    } catch (error) {

      log(
        "Share cancelled"
      );

    }

  }
);


/* =========================================================
   AUTO JOIN FROM URL
   ========================================================= */

function checkRoomURL() {

  const params =
    new URLSearchParams(
      window.location.search
    );


  const room =
    params.get("room");


  /*
    DO NOT automatically join.
  */

  if (
    room &&
    roomCodeInput
  ) {

    roomCodeInput.value =
      room
        .toUpperCase()
        .replace(
          /[^A-Z0-9]/g,
          ""
        );

  }

}


/* =========================================================
   EXIT ROOM
   ========================================================= */

exitBtn?.addEventListener(
  "click",
  () => {

    leaveRoom();

  }
);


function leaveRoom() {

  log(
    "Leaving room"
  );


  socket.emit(
    "leave-room"
  );


  /*
    Stop camera.
  */

  if (localStream) {

    localStream
      .getTracks()
      .forEach(
        track =>
          track.stop()
      );

    localStream =
      null;

  }


  /*
    Close camera peer.
  */

  if (cameraPeer) {

    cameraPeer.close();

    cameraPeer =
      null;

  }


  /*
    Close movie peer.
  */

  if (moviePeer) {

    moviePeer.close();

    moviePeer =
      null;

  }


  /*
    Stop movie capture.
  */

  if (movieCaptureStream) {

    movieCaptureStream
      .getTracks()
      .forEach(
        track =>
          track.stop()
      );

    movieCaptureStream =
      null;

  }


  /*
    Remove movie URL.
  */

  if (localMovieURL) {

    URL.revokeObjectURL(
      localMovieURL
    );

    localMovieURL =
      null;

  }


  /*
    Reset state.
  */

  currentRoom =
    null;

  isHost =
    false;

  hasMovie =
    false;

  movieOfferSent =
    false;

  movieRemoteDescriptionSet =
    false;

  pendingMovieIce =
    [];

  movieVideoSender =
    null;

  movieAudioSender =
    null;

  cameraOfferSent =
    false;

  cameraRemoteDescriptionSet =
    false;

  pendingCameraIce =
    [];


  /*
    Clear videos.
  */

  if (localVideo) {

    localVideo.srcObject =
      null;

  }


  if (remoteVideo) {

    remoteVideo.srcObject =
      null;

  }


  if (movie) {

    movie.pause();

    movie.srcObject =
      null;

    movie.removeAttribute(
      "src"
    );

    movie.load();

  }


  /*
    Clear room display.
  */

  if (roomCodeDisplay) {

    roomCodeDisplay.textContent =
      "----";

  }


  /*
    Clear URL.
  */

  window.history.replaceState(
    {},
    document.title,
    window.location.pathname
  );


  /*
    Back to room screen.
  */

  showRoomGate();

}


/* =========================================================
   PEER LEFT
   ========================================================= */

socket.on(
  "peer-left",
  () => {

    showToast(
      "Your partner left the room."
    );


    if (cameraPeer) {

      cameraPeer.close();

      cameraPeer =
        null;

    }


    if (moviePeer) {

      moviePeer.close();

      moviePeer =
        null;

    }


    cameraOfferSent =
      false;

    movieOfferSent =
      false;

    cameraRemoteDescriptionSet =
      false;

    movieRemoteDescriptionSet =
      false;

    pendingCameraIce =
      [];

    pendingMovieIce =
      [];

    movieVideoSender =
      null;

    movieAudioSender =
      null;

  }
);


/* =========================================================
   INITIAL PAGE LOAD
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    log(
      "MovieDate loaded"
    );


    /*
      ALWAYS start at room gate.
    */

    showRoomGate();


    checkRoomURL();

  }
);


/* =========================================================
   PREVENT ACCIDENTAL MOVIE
   PAGE NAVIGATION
   ========================================================= */

window.addEventListener(
  "beforeunload",
  () => {

    if (localStream) {

      localStream
        .getTracks()
        .forEach(
          track =>
            track.stop()
        );

    }

  }
);
