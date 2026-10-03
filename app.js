const BACKEND_URL =
  "https://moviedate-backend-production.up.railway.app";

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
  reconnection: true
});


// =====================================================
// ELEMENTS
// =====================================================

const movie =
  document.getElementById("movie");

const movieInput =
  document.getElementById("movieFile");

const localVideo =
  document.getElementById("localVideo");

const remoteVideo =
  document.getElementById("remoteVideo");

const chooseMovie =
  document.getElementById("chooseMovieBtn");

const createRoomBtn =
  document.getElementById("createRoomBtn");

const joinPromptBtn =
  document.getElementById("joinPromptBtn");

const joinRoomBtn =
  document.getElementById("joinRoomBtn");

const roomInput =
  document.getElementById("roomCodeInput");

const roomGate =
  document.getElementById("roomGate");

const joinSheet =
  document.getElementById("joinSheet");

const closeJoinBtn =
  document.getElementById("closeJoinBtn");

const app =
  document.getElementById("app");

const exitRoom =
  document.getElementById("exitBtn");


// =====================================================
// STATE
// =====================================================

let roomId = "";

let isHost = false;

let partnerSocketId = null;

let localStream = null;

let peer = null;


// =====================================================
// MOVIE WEBRTC STATE
// =====================================================

let moviePeer = null;

let movieVideoSender = null;

let movieAudioSender = null;

let movieCaptureStream = null;

let localMovieURL = null;

let hasMovie = false;

let movieOfferSent = false;

let movieRemoteDescriptionSet = false;

let pendingMovieIce = [];


// =====================================================
// ICE
// =====================================================

const ICE_SERVERS = {

  iceServers: [

    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun.cloudflare.com:3478"
      ]
    }

  ]

};


// =====================================================
// HELPERS
// =====================================================

function toast(message) {

  console.log(
    "[MovieDate]",
    message
  );

  const toastEl =
    document.getElementById("toast");

  if (!toastEl) {

    console.log(message);

    return;

  }

  toastEl.textContent =
    message;

  toastEl.classList.add(
    "show"
  );

  clearTimeout(
    window.__toastTimer
  );

  window.__toastTimer =
    setTimeout(() => {

      toastEl.classList.remove(
        "show"
      );

    }, 2500);

}


function cleanRoomId(value) {

  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      ""
    )
    .slice(0, 12);

}


function generateRoomCode() {

  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let result = "";

  for (
    let i = 0;
    i < 6;
    i++
  ) {

    result +=
      chars[
        Math.floor(
          Math.random() *
          chars.length
        )
      ];

  }

  return result;

}


function showApp() {

  if (roomGate) {

    roomGate.classList.add(
      "hidden"
    );

  }

  if (joinSheet) {

    joinSheet.hidden =
      true;

  }

  if (app) {

    app.classList.remove(
      "hidden"
    );

  }

}


function showRoomGate() {

  if (app) {

    app.classList.add(
      "hidden"
    );

  }

  if (roomGate) {

    roomGate.classList.remove(
      "hidden"
    );

  }

}


function updateRoomDisplay() {

  document
    .querySelectorAll(
      "[data-room-id]"
    )
    .forEach(el => {

      el.textContent =
        roomId || "----";

    });

  const roomPill =
    document.getElementById(
      "roomCode"
    );

  if (roomPill) {

    roomPill.textContent =
      roomId || "—";

  }

}


// =====================================================
// CAMERA
// =====================================================

async function startCamera() {

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

      await localVideo
        .play()
        .catch(() => {});

    }


    const youStatus =
      document.getElementById(
        "youStatus"
      );

    if (youStatus) {

      youStatus.textContent =
        "● online";

    }


    const localPlaceholder =
      document.getElementById(
        "localPlaceholder"
      );

    if (localPlaceholder) {

      localPlaceholder.style.display =
        "none";

    }


    console.log(
      "Camera ready"
    );

  } catch (error) {

    console.error(
      "Camera error:",
      error
    );

    toast(
      "Camera or microphone permission is required."
    );

  }

}


// =====================================================
// CREATE CAMERA PEER
// =====================================================

async function createCameraPeer(
  makeOffer = false
) {

  if (peer) {

    try {
      peer.close();
    } catch {}

  }


  peer =
    new RTCPeerConnection(
      ICE_SERVERS
    );


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


  peer.onicecandidate =
    event => {

      if (!event.candidate)
        return;

      socket.emit(
        "webrtc",
        {
          channel: "camera",
          type: "ice",
          candidate:
            event.candidate
        }
      );

    };


  peer.ontrack =
    event => {

      if (!remoteVideo)
        return;

      if (
        event.streams &&
        event.streams[0]
      ) {

        remoteVideo.srcObject =
          event.streams[0];

        remoteVideo.autoplay =
          true;

        remoteVideo.playsInline =
          true;

        remoteVideo
          .play()
          .catch(() => {});


        const partnerStatus =
          document.getElementById(
            "partnerStatus"
          );

        if (partnerStatus) {

          partnerStatus.textContent =
            "● online";

        }


        const remotePlaceholder =
          document.getElementById(
            "remotePlaceholder"
          );

        if (remotePlaceholder) {

          remotePlaceholder.style.display =
            "none";

        }

      }

    };


  peer.onconnectionstatechange =
    () => {

      if (!peer)
        return;

      console.log(
        "Camera:",
        peer.connectionState
      );

    };


  if (makeOffer) {

    const offer =
      await peer.createOffer();

    await peer.setLocalDescription(
      offer
    );

    socket.emit(
      "webrtc",
      {
        channel: "camera",
        type: "offer",
        sdp:
          peer.localDescription
      }
    );

  }

}


// =====================================================
// MOVIE CAPTURE
// =====================================================

function getMovieCapture() {

  if (!movie)
    return null;


  if (
    typeof movie.captureStream ===
    "function"
  ) {

    return movie.captureStream();

  }


  if (
    typeof movie.mozCaptureStream ===
    "function"
  ) {

    return movie.mozCaptureStream();

  }


  return null;

}


// =====================================================
// CREATE MOVIE PEER
// IMPORTANT: DO NOT RECREATE ACTIVE PEER
// =====================================================

function createMoviePeer() {

  if (
    moviePeer &&
    moviePeer.connectionState !==
      "closed" &&
    moviePeer.connectionState !==
      "failed"
  ) {

    return moviePeer;

  }


  moviePeer =
    new RTCPeerConnection(
      ICE_SERVERS
    );


  movieOfferSent =
    false;

  movieRemoteDescriptionSet =
    false;

  pendingMovieIce = [];


  moviePeer.onicecandidate =
    event => {

      if (!event.candidate)
        return;

      socket.emit(
        "webrtc",
        {
          channel: "movie",
          type: "ice",
          candidate:
            event.candidate
        }
      );

    };


  moviePeer.ontrack =
    event => {

      console.log(
        "Movie track received:",
        event.track.kind
      );


      if (isHost)
        return;


      const stream =
        event.streams &&
        event.streams[0];

      if (!stream)
        return;


      if (!movie)
        return;


      // Remove local movie source

      movie.pause();

      movie.removeAttribute(
        "src"
      );

      movie.srcObject =
        stream;

      movie.controls =
        true;

      movie.playsInline =
        true;

      movie.muted =
        false;


      showMovie();


      const syncBadge =
        document.getElementById(
          "syncBadge"
        );

      if (syncBadge) {

        syncBadge.textContent =
          "Partner movie";

      }


      movie
        .play()
        .catch(() => {

          toast(
            "Tap the movie to start it."
          );

        });

    };


  moviePeer.onconnectionstatechange =
    () => {

      if (!moviePeer)
        return;

      console.log(
        "Movie:",
        moviePeer.connectionState
      );

    };


  return moviePeer;

}


// =====================================================
// FLUSH MOVIE ICE
// =====================================================

async function flushMovieIce() {

  if (!moviePeer)
    return;

  if (
    !moviePeer.remoteDescription
  ) {

    return;

  }


  const candidates =
    pendingMovieIce;

  pendingMovieIce = [];


  for (
    const candidate
    of candidates
  ) {

    try {

      await moviePeer
        .addIceCandidate(
          candidate
        );

    } catch (error) {

      console.warn(
        "Queued movie ICE:",
        error
      );

    }

  }

}


// =====================================================
// START MOVIE STREAM
// =====================================================

async function startMovieStream() {

  if (!isHost)
    return;


  if (!partnerSocketId) {

    console.log(
      "Movie waiting for partner."
    );

    return;

  }


  if (!hasMovie)
    return;


  if (!movie)
    return;


  // Create capture only once

  if (!movieCaptureStream) {

    movieCaptureStream =
      getMovieCapture();

  }


  const stream =
    movieCaptureStream;


  if (!stream) {

    toast(
      "Chrome cannot stream this video. Use MP4 H.264."
    );

    return;

  }


  const videoTrack =
    stream.getVideoTracks()[0];

  const audioTrack =
    stream.getAudioTracks()[0];


  if (!videoTrack) {

    toast(
      "Movie video could not be captured."
    );

    return;

  }


  // Reuse movie peer

  if (!moviePeer) {

    createMoviePeer();

  }


  // Video sender

  if (movieVideoSender) {

    await movieVideoSender
      .replaceTrack(
        videoTrack
      );

  } else {

    movieVideoSender =
      moviePeer.addTrack(
        videoTrack,
        stream
      );

  }


  // Audio sender

  if (audioTrack) {

    if (movieAudioSender) {

      await movieAudioSender
        .replaceTrack(
          audioTrack
        );

    } else {

      movieAudioSender =
        moviePeer.addTrack(
          audioTrack,
          stream
        );

    }

  }


  // Only send one initial offer

  if (
    moviePeer.signalingState ===
      "stable" &&
    !movieOfferSent
  ) {

    movieOfferSent =
      true;


    const offer =
      await moviePeer.createOffer();


    await moviePeer.setLocalDescription(
      offer
    );


    socket.emit(
      "webrtc",
      {
        channel: "movie",
        type: "offer",
        sdp:
          moviePeer.localDescription
      }
    );


    console.log(
      "Movie offer sent"
    );

  }

}


// =====================================================
// SHOW MOVIE
// =====================================================

function showMovie() {

  hasMovie =
    true;


  const empty =
    document.getElementById(
      "emptyState"
    );

  if (empty) {

    empty.classList.add(
      "hidden"
    );

  }


  const videoWrap =
    document.getElementById(
      "videoWrap"
    );

  if (videoWrap) {

    videoWrap.classList.remove(
      "no-movie"
    );

  }


  const tap =
    document.getElementById(
      "movieTap"
    );

  if (tap) {

    tap.classList.add(
      "show"
    );

  }


  if (movie) {

    movie.classList.add(
      "has-movie"
    );

  }

}


// =====================================================
// LOAD MOVIE
// =====================================================

function loadMovie(file) {

  if (!file)
    return;


  if (!isHost) {

    toast(
      "Only the host can choose the movie."
    );

    return;

  }


  if (localMovieURL) {

    URL.revokeObjectURL(
      localMovieURL
    );

  }


  // Reset capture from previous movie

  movieCaptureStream =
    null;


  if (movieVideoSender) {

    try {

      movieVideoSender
        .replaceTrack(null);

    } catch {}

  }


  if (movieAudioSender) {

    try {

      movieAudioSender
        .replaceTrack(null);

    } catch {}

  }


  if (movie) {

    movie.pause();

    movie.srcObject =
      null;


    localMovieURL =
      URL.createObjectURL(
        file
      );


    movie.src =
      localMovieURL;

    movie.controls =
      true;

    movie.playsInline =
      true;

    movie.muted =
      false;

  }


  showMovie();


  socket.emit(
    "movie-meta",
    {
      name: file.name
    }
  );


  movie.onloadedmetadata =
    async () => {

      console.log(
        "Movie loaded:",
        file.name
      );


      if (isHost) {

        try {

          await movie.play()
            .catch(() => {});


          movieCaptureStream =
            getMovieCapture();


          await startMovieStream();

        } catch (error) {

          console.error(
            "Movie stream:",
            error
          );

        }

      }

    };


  movie.onerror =
    () => {

      toast(
        "This video can't be played. Use MP4 H.264."
      );

    };

}


// =====================================================
// MOVIE FILE BUTTON
// =====================================================

if (chooseMovie) {

  chooseMovie.addEventListener(
    "click",
    () => {

      if (!isHost) {

        toast(
          "Only the host can choose the movie."
        );

        return;

      }


      if (movieInput) {

        movieInput.click();

      }

    }
  );

}


if (movieInput) {

  movieInput.addEventListener(
    "change",
    event => {

      const file =
        event.target.files &&
        event.target.files[0];


      if (!file)
        return;


      loadMovie(file);

    }
  );

}


// =====================================================
// MOVIE CONTROLS
// =====================================================

const playBtn =
  document.getElementById(
    "playBtn"
  );

const muteBtn =
  document.getElementById(
    "muteBtn"
  );

const seek =
  document.getElementById(
    "seek"
  );

const currentTime =
  document.getElementById(
    "currentTime"
  );

const duration =
  document.getElementById(
    "duration"
  );

const movieTap =
  document.getElementById(
    "movieTap"
  );

const changeMovie =
  document.getElementById(
    "changeMovie"
  );

const fullscreenBtn =
  document.getElementById(
    "fullscreenBtn"
  );


function formatTime(seconds) {

  if (!Number.isFinite(seconds))
    return "00:00";


  const mins =
    Math.floor(
      seconds / 60
    );

  const secs =
    Math.floor(
      seconds % 60
    );


  return (
    String(mins).padStart(2, "0") +
    ":" +
    String(secs).padStart(2, "0")
  );

}


if (movie) {

  movie.addEventListener(
    "play",
    () => {

      if (!isHost)
        return;


      socket.emit(
        "playback",
        {
          action: "play",
          time:
            movie.currentTime
        }
      );

    }
  );


  movie.addEventListener(
    "pause",
    () => {

      if (!isHost)
        return;


      socket.emit(
        "playback",
        {
          action: "pause",
          time:
            movie.currentTime
        }
      );

    }
  );


  movie.addEventListener(
    "timeupdate",
    () => {

      if (currentTime) {

        currentTime.textContent =
          formatTime(
            movie.currentTime
          );

      }


      if (
        seek &&
        Number.isFinite(
          movie.duration
        )
      ) {

        seek.value =
          movie.currentTime;

      }

    }
  );


  movie.addEventListener(
    "loadedmetadata",
    () => {

      if (duration) {

        duration.textContent =
          formatTime(
            movie.duration
          );

      }


      if (seek) {

        seek.max =
          Number.isFinite(
            movie.duration
          )
            ? movie.duration
            : 100;

      }

    }
  );


  movie.addEventListener(
    "seeked",
    () => {

      if (!isHost)
        return;


      socket.emit(
        "playback",
        {
          action: "seek",
          time:
            movie.currentTime
        }
      );

    }
  );

}


if (playBtn) {

  playBtn.addEventListener(
    "click",
    () => {

      if (!movie)
        return;


      if (movie.paused) {

        movie.play()
          .catch(() => {});

      } else {

        movie.pause();

      }

    }
  );

}


if (movieTap) {

  movieTap.addEventListener(
    "click",
    () => {

      if (!movie)
        return;


      if (movie.paused) {

        movie.play()
          .catch(() => {});

      } else {

        movie.pause();

      }

    }
  );

}


if (seek) {

  seek.addEventListener(
    "input",
    () => {

      if (!movie)
        return;

      movie.currentTime =
        Number(
          seek.value
        );

    }
  );

}


if (muteBtn) {

  muteBtn.addEventListener(
    "click",
    () => {

      if (!movie)
        return;

      movie.muted =
        !movie.muted;

    }
  );

}


if (changeMovie) {

  changeMovie.addEventListener(
    "click",
    () => {

      if (!isHost) {

        toast(
          "Only the host can change the movie."
        );

        return;

      }


      if (movieInput) {

        movieInput.click();

      }

    }
  );

}


if (fullscreenBtn) {

  fullscreenBtn.addEventListener(
    "click",
    async () => {

      const videoWrap =
        document.getElementById(
          "videoWrap"
        );


      try {

        if (
          document.fullscreenElement
        ) {

          await document.exitFullscreen();

        } else if (
          videoWrap &&
          videoWrap.requestFullscreen
        ) {

          await videoWrap
            .requestFullscreen();

        } else if (
          movie &&
          movie.webkitEnterFullscreen
        ) {

          movie.webkitEnterFullscreen();

        }

      } catch (error) {

        console.warn(
          "Fullscreen:",
          error
        );

      }

    }
  );

}


// =====================================================
// SOCKET CONNECT
// =====================================================

socket.on(
  "connect",
  () => {

    console.log(
      "Connected:",
      socket.id
    );

  }
);


// =====================================================
// CREATE ROOM
// =====================================================

if (createRoomBtn) {

  createRoomBtn.addEventListener(
    "click",
    async () => {

      roomId =
        generateRoomCode();

      isHost =
        true;

      updateRoomDisplay();

      showApp();


      await startCamera();


      socket.emit(
        "join-room",
        roomId
      );


      console.log(
        "Created room:",
        roomId
      );

      toast(
        "Room created: " +
        roomId
      );

    }
  );

}


// =====================================================
// JOIN PROMPT
// =====================================================

if (joinPromptBtn) {

  joinPromptBtn.addEventListener(
    "click",
    () => {

      if (joinSheet) {

        joinSheet.hidden =
          false;

      }


      if (roomInput) {

        setTimeout(
          () => {
            roomInput.focus();
          },
          100
        );

      }

    }
  );

}


// =====================================================
// CLOSE JOIN
// =====================================================

if (closeJoinBtn) {

  closeJoinBtn.addEventListener(
    "click",
    () => {

      if (joinSheet) {

        joinSheet.hidden =
          true;

      }

    }
  );

}


// =====================================================
// JOIN ROOM
// =====================================================

if (joinRoomBtn) {

  joinRoomBtn.addEventListener(
    "click",
    async () => {

      const value =
        roomInput
          ? roomInput.value
          : "";


      roomId =
        cleanRoomId(
          value
        );


      if (!roomId) {

        toast(
          "Enter a room code."
        );

        return;

      }


      isHost =
        false;


      updateRoomDisplay();

      showApp();


      await startCamera();


      socket.emit(
        "join-room",
        roomId
      );


      console.log(
        "Joining:",
        roomId
      );

    }
  );

}


// =====================================================
// ROOM JOINED
// =====================================================

socket.on(
  "room-joined",
  data => {

    roomId =
      data.roomId;

    isHost =
      data.isHost;


    updateRoomDisplay();

    showApp();


    console.log(
      "Room joined:",
      roomId,
      "host:",
      isHost
    );

  }
);


// =====================================================
// ROOM STATE
// =====================================================

socket.on(
  "room-state",
  data => {

    roomId =
      data.roomId ||
      roomId;


    updateRoomDisplay();


    if (
      data.movie &&
      data.movie.name
    ) {

      console.log(
        "Room movie:",
        data.movie.name
      );

    }


    if (
      data.playback &&
      !isHost &&
      movie &&
      movie.srcObject
    ) {

      if (
        data.playback.action ===
        "play"
      ) {

        movie.play()
          .catch(() => {});

      }


      if (
        data.playback.action ===
        "pause"
      ) {

        movie.pause();

      }

    }

  }
);


// =====================================================
// PARTNER JOINED
// =====================================================

socket.on(
  "peer-joined",
  async data => {

    partnerSocketId =
      data.socketId;


    console.log(
      "Partner joined:",
      partnerSocketId
    );


    const partnerStatus =
      document.getElementById(
        "partnerStatus"
      );

    if (partnerStatus) {

      partnerStatus.textContent =
        "● connecting";

    }


    if (isHost) {

      await createCameraPeer(
        true
      );

    }


    if (
      isHost &&
      hasMovie
    ) {

      setTimeout(
        () => {

          startMovieStream()
            .catch(error => {

              console.error(
                "Movie start:",
                error
              );

            });

        },
        1000
      );

    }

  }
);


// =====================================================
// PEER READY
// =====================================================

socket.on(
  "peer-ready",
  async data => {

    partnerSocketId =
      data.socketId;


    if (!peer) {

      await createCameraPeer(
        isHost
      );

    }


    if (
      isHost &&
      hasMovie
    ) {

      setTimeout(
        () => {

          startMovieStream()
            .catch(error => {

              console.error(
                "Movie start:",
                error
              );

            });

        },
        1000
      );

    }

  }
);


// =====================================================
// WEBRTC SIGNALING
// =====================================================

socket.on(
  "webrtc",
  async data => {


    // =================================================
    // MOVIE WEBRTC
    // =================================================

    if (
      data.channel ===
      "movie"
    ) {

      try {


        // OFFER

        if (
          data.type ===
          "offer"
        ) {

          if (!moviePeer) {

            createMoviePeer();

          }


          await moviePeer
            .setRemoteDescription(
              new RTCSessionDescription(
                data.sdp
              )
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
              channel: "movie",
              type: "answer",
              sdp:
                moviePeer.localDescription
            }
          );


          console.log(
            "Movie answer sent"
          );


          return;

        }


        // ANSWER

        if (
          data.type ===
          "answer"
        ) {

          if (!moviePeer)
            return;


          await moviePeer
            .setRemoteDescription(
              new RTCSessionDescription(
                data.sdp
              )
            );


          movieRemoteDescriptionSet =
            true;


          await flushMovieIce();


          console.log(
            "Movie answer received"
          );


          return;

        }


        // ICE

        if (
          data.type ===
          "ice"
        ) {

          if (!moviePeer) {

            createMoviePeer();

          }


          const candidate =
            new RTCIceCandidate(
              data.candidate
            );


          if (
            !movieRemoteDescriptionSet &&
            !moviePeer.remoteDescription
          ) {

            pendingMovieIce.push(
              candidate
            );

            console.log(
              "Movie ICE queued"
            );

            return;

          }


          try {

            await moviePeer
              .addIceCandidate(
                candidate
              );

          } catch (error) {

            console.warn(
              "Movie ICE:",
              error
            );

          }

        }

      } catch (error) {

        console.error(
          "Movie WebRTC:",
          error
        );

        toast(
          "Movie connection failed. Try again."
        );

      }


      return;

    }


    // =================================================
    // CAMERA WEBRTC
    // =================================================

    try {

      if (
        data.type ===
        "offer"
      ) {

        if (!peer) {

          await createCameraPeer(
            false
          );

        }


        await peer
          .setRemoteDescription(
            new RTCSessionDescription(
              data.sdp
            )
          );


        const answer =
          await peer
            .createAnswer();


        await peer
          .setLocalDescription(
            answer
          );


        socket.emit(
          "webrtc",
          {
            channel: "camera",
            type: "answer",
            sdp:
              peer.localDescription
          }
        );


        return;

      }


      if (
        data.type ===
        "answer"
      ) {

        if (!peer)
          return;


        await peer
          .setRemoteDescription(
            new RTCSessionDescription(
              data.sdp
            )
          );


        return;

      }


      if (
        data.type ===
        "ice"
      ) {

        if (!peer)
          return;


        try {

          await peer
            .addIceCandidate(
              new RTCIceCandidate(
                data.candidate
              )
            );

        } catch (error) {

          console.warn(
            "Camera ICE:",
            error
          );

        }

      }

    } catch (error) {

      console.error(
        "Camera WebRTC:",
        error
      );

    }

  }
);


// =====================================================
// PLAYBACK SYNC
// =====================================================

socket.on(
  "playback",
  data => {

    if (!movie)
      return;


    if (isHost)
      return;


    if (
      data.action ===
      "play"
    ) {

      movie.play()
        .catch(() => {

          toast(
            "Tap the movie to start it."
          );

        });

    }


    if (
      data.action ===
      "pause"
    ) {

      movie.pause();

    }

  }
);


// =====================================================
// MOVIE META
// =====================================================

socket.on(
  "movie-meta",
  data => {

    console.log(
      "Partner selected:",
      data.name
    );

  }
);


// =====================================================
// PARTNER LEFT
// =====================================================

socket.on(
  "peer-left",
  () => {

    partnerSocketId =
      null;


    if (moviePeer) {

      try {
        moviePeer.close();
      } catch {}

    }


    moviePeer =
      null;

    movieVideoSender =
      null;

    movieAudioSender =
      null;

    movieCaptureStream =
      null;

    movieOfferSent =
      false;

    movieRemoteDescriptionSet =
      false;

    pendingMovieIce =
      [];


    const partnerStatus =
      document.getElementById(
        "partnerStatus"
      );

    if (partnerStatus) {

      partnerStatus.textContent =
        "○ waiting";

    }


    const remotePlaceholder =
      document.getElementById(
        "remotePlaceholder"
      );

    if (remotePlaceholder) {

      remotePlaceholder.style.display =
        "";

    }


    console.log(
      "Partner left"
    );

  }
);


// =====================================================
// ROOM FULL
// =====================================================

socket.on(
  "room-full",
  () => {

    toast(
      "This room already has two people."
    );

    showRoomGate();

  }
);


// =====================================================
// ROOM ERROR
// =====================================================

socket.on(
  "room-error",
  data => {

    toast(
      data.message ||
      "Room error."
    );

    showRoomGate();

  }
);


// =====================================================
// CHAT
// =====================================================

const chatInput =
  document.getElementById(
    "chatInput"
  );

const sendChat =
  document.getElementById(
    "sendChat"
  );

const chat =
  document.getElementById(
    "messages"
  );


function addChatMessage(
  text,
  mine = false
) {

  if (!chat)
    return;


  const empty =
    document.getElementById(
      "messageEmpty"
    );

  if (empty) {

    empty.remove();

  }


  const message =
    document.createElement(
      "div"
    );


  message.className =
    mine
      ? "chat-message mine"
      : "chat-message";


  message.textContent =
    text;


  chat.appendChild(
    message
  );


  chat.scrollTop =
    chat.scrollHeight;

}


function sendMessage() {

  if (!chatInput)
    return;


  const text =
    chatInput.value.trim();


  if (!text)
    return;


  socket.emit(
    "chat",
    {
      text
    }
  );


  addChatMessage(
    text,
    true
  );


  chatInput.value =
    "";

}


if (sendChat) {

  sendChat.addEventListener(
    "click",
    event => {

      event.preventDefault();

      sendMessage();

    }
  );

}


const chatForm =
  document.getElementById(
    "chatForm"
  );


if (chatForm) {

  chatForm.addEventListener(
    "submit",
    event => {

      event.preventDefault();

      sendMessage();

    }
  );

}


if (chatInput) {

  chatInput.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
        "Enter"
      ) {

        event.preventDefault();

        sendMessage();

      }

    }
  );

}


socket.on(
  "chat",
  data => {

    addChatMessage(
      data.text,
      false
    );

  }
);


// =====================================================
// REACTIONS
// =====================================================

document
  .querySelectorAll(
    "[data-reaction]"
  )
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        const emoji =
          button.dataset.reaction;


        socket.emit(
          "reaction",
          {
            emoji
          }
        );


        showReaction(
          emoji
        );

      }
    );

  });


socket.on(
  "reaction",
  data => {

    showReaction(
      data.emoji
    );

  }
);


function showReaction(
  emoji
) {

  const el =
    document.createElement(
      "div"
    );


  el.className =
    "floating-reaction";


  el.textContent =
    emoji;


  document.body.appendChild(
    el
  );


  setTimeout(
    () => {

      el.remove();

    },
    1800
  );

}


// =====================================================
// MIC
// =====================================================

const micButton =
  document.getElementById(
    "micButton"
  );


if (micButton) {

  micButton.addEventListener(
    "click",
    () => {

      if (!localStream)
        return;


      localStream
        .getAudioTracks()
        .forEach(track => {

          track.enabled =
            !track.enabled;

        });

    }
  );

}


// =====================================================
// CAMERA BUTTON
// =====================================================

const cameraButton =
  document.getElementById(
    "cameraButton"
  );


if (cameraButton) {

  cameraButton.addEventListener(
    "click",
    () => {

      if (!localStream)
        return;


      localStream
        .getVideoTracks()
        .forEach(track => {

          track.enabled =
            !track.enabled;

        });

    }
  );

}


// =====================================================
// SHARE ROOM
// =====================================================

const shareBtn =
  document.getElementById(
    "shareBtn"
  );


if (shareBtn) {

  shareBtn.addEventListener(
    "click",
    async () => {

      const text =
        `Join my MovieDate room: ${roomId}`;


      if (
        navigator.share
      ) {

        try {

          await navigator.share({
            title: "MovieDate",
            text
          });

          return;

        } catch {}

      }


      try {

        await navigator.clipboard.writeText(
          roomId
        );

        toast(
          "Room code copied: " +
          roomId
        );

      } catch {

        toast(
          "Room code: " +
          roomId
        );

      }

    }
  );

}


// =====================================================
// ROOM PILL
// =====================================================

const roomPill =
  document.getElementById(
    "roomPill"
  );


if (roomPill) {

  roomPill.addEventListener(
    "click",
    async () => {

      try {

        await navigator.clipboard.writeText(
          roomId
        );

        toast(
          "Room code copied: " +
          roomId
        );

      } catch {

        toast(
          "Room code: " +
          roomId
        );

      }

    }
  );

}


// =====================================================
// EXIT
// =====================================================

if (exitRoom) {

  exitRoom.addEventListener(
    "click",
    () => {

      socket.emit(
        "leave-room"
      );


      if (peer) {

        try {
          peer.close();
        } catch {}

      }


      if (moviePeer) {

        try {
          moviePeer.close();
        } catch {}

      }


      if (localStream) {

        localStream
          .getTracks()
          .forEach(
            track =>
              track.stop()
          );

      }


      if (localMovieURL) {

        URL.revokeObjectURL(
          localMovieURL
        );

      }


      window.location.reload();

    }
  );

}


// =====================================================
// INITIAL STATE
// =====================================================

showRoomGate();

console.log(
  "MovieDate client loaded."
);
