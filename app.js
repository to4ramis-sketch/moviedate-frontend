const BACKEND_URL =
  "https://moviedate-backend-production.up.railway.app";

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
  reconnection: true
});

// =====================================================
// ELEMENTS
// =====================================================

const movie = document.getElementById("movie");
const movieInput = document.getElementById("movieInput");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

const chooseMovie = document.getElementById("chooseMovie");

const createRoomBtn =
  document.getElementById("createRoom");

const joinRoomBtn =
  document.getElementById("joinRoom");

const roomInput =
  document.getElementById("roomInput");

const roomGate =
  document.getElementById("roomGate");

const app =
  document.getElementById("app");

const exitRoom =
  document.getElementById("exitRoom");


// =====================================================
// STATE
// =====================================================

let roomId = "";
let isHost = false;

let partnerSocketId = null;

let localStream = null;

let peer = null;

// Movie WebRTC connection
let moviePeer = null;

let movieVideoSender = null;
let movieAudioSender = null;

let movieCaptureStream = null;

let localMovieURL = null;

let hasMovie = false;


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

  console.log("[MovieDate]", message);

  const toastEl =
    document.getElementById("toast");

  if (!toastEl) {
    console.log(message);
    return;
  }

  toastEl.textContent = message;

  toastEl.classList.add("show");

  clearTimeout(window.__toastTimer);

  window.__toastTimer =
    setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2500);
}


function cleanRoomId(value) {

  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);

}


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


function showApp() {

  if (roomGate) {
    roomGate.classList.add("hidden");
  }

  if (app) {
    app.classList.remove("hidden");
  }

}


function showRoomGate() {

  if (app) {
    app.classList.add("hidden");
  }

  if (roomGate) {
    roomGate.classList.remove("hidden");
  }

}


function updateRoomDisplay() {

  const roomLabels =
    document.querySelectorAll(
      "[data-room-id]"
    );

  roomLabels.forEach(el => {
    el.textContent = roomId || "----";
  });

  const roomPill =
    document.getElementById("roomCode");

  if (roomPill) {
    roomPill.textContent =
      roomId || "----";
  }

}


// =====================================================
// CAMERA
// =====================================================

async function startCamera() {

  try {

    localStream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user"
        },
        audio: true
      });


    if (localVideo) {

      localVideo.srcObject =
        localStream;

      localVideo.muted = true;

      localVideo.playsInline = true;

      await localVideo
        .play()
        .catch(() => {});

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

      }

    };


  peer.onconnectionstatechange =
    () => {

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
// =====================================================

function createMoviePeer() {

  if (moviePeer) {

    try {
      moviePeer.close();
    } catch {}

  }


  moviePeer =
    new RTCPeerConnection(
      ICE_SERVERS
    );


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


      // IMPORTANT:
      // Partner receives movie directly
      // into the movie player.

      if (movie) {

        movie.src = "";

        movie.removeAttribute(
          "src"
        );

        movie.srcObject =
          stream;

        movie.controls = true;

        movie.playsInline = true;

        movie.muted = false;

        showMovie();

        movie
          .play()
          .catch(() => {

            toast(
              "Tap the movie to start it."
            );

          });

      }

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
// START MOVIE STREAM
// =====================================================

async function startMovieStream() {

  if (!isHost)
    return;


  if (!partnerSocketId) {

    console.log(
      "Waiting for partner."
    );

    return;

  }


  if (!hasMovie)
    return;


  const stream =
    getMovieCapture();


  if (!stream) {

    toast(
      "Chrome cannot stream this video. Try MP4 H.264."
    );

    return;

  }


  movieCaptureStream =
    stream;


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


  if (!moviePeer) {

    createMoviePeer();

  }


  // Replace old movie track

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


  // Movie audio

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


  // First connection = send offer

  if (
    moviePeer.signalingState ===
      "stable" &&
    !moviePeer.localDescription
  ) {

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

  hasMovie = true;


  const empty =
    document.getElementById(
      "movieEmpty"
    );

  if (empty) {
    empty.classList.add(
      "hidden"
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
// LOAD MOVIE FILE
// =====================================================

function loadMovie(file) {

  if (!file)
    return;


  if (localMovieURL) {

    URL.revokeObjectURL(
      localMovieURL
    );

  }


  // Host uses local file

  if (movie) {

    movie.srcObject = null;

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


  // Tell partner the filename

  socket.emit(
    "movie-meta",
    {
      name: file.name
    }
  );


  movie.onloadedmetadata =
    () => {

      console.log(
        "Movie loaded:",
        file.name
      );


      if (isHost) {

        setTimeout(
          () => {

            startMovieStream()
              .catch(error => {

                console.error(
                  "Movie stream:",
                  error
                );

              });

          },
          300
        );

      }

    };


  movie.oncanplay =
    () => {

      if (isHost) {

        startMovieStream()
          .catch(error => {

            console.error(error);

          });

      }

    };


  movie.onerror =
    () => {

      toast(
        "This video can't be played. Try MP4 H.264."
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
// MOVIE PLAYBACK
// =====================================================

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

      isHost = true;

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
        cleanRoomId(value);


      if (!roomId) {

        toast(
          "Enter a room code."
        );

        return;

      }


      isHost = false;

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
                error
              );

            });

        },
        700
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
                error
              );

            });

        },
        700
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


        // PARTNER RECEIVES OFFER

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


        // HOST RECEIVES ANSWER

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


          console.log(
            "Movie answer received"
          );

          return;

        }


        // MOVIE ICE

        if (
          data.type ===
          "ice"
        ) {

          if (!moviePeer)
            return;


          try {

            await moviePeer
              .addIceCandidate(
                new RTCIceCandidate(
                  data.candidate
                )
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
          await peer.createAnswer();


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


        await peer
          .addIceCandidate(
            new RTCIceCandidate(
              data.candidate
            )
          );

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
        .catch(() => {});

    }


    if (
      data.action ===
      "pause"
    ) {

      movie.pause();

    }


    // Remote MediaStream is not normally
    // seekable, so don't set currentTime
    // on the partner device.

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


    moviePeer = null;

    movieVideoSender = null;
    movieAudioSender = null;
    movieCaptureStream = null;


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
    "chat"
  );


function addChatMessage(
  text,
  mine = false
) {

  if (!chat)
    return;


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
    sendMessage
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
            track => track.stop()
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
  "MovieDate latest client loaded."
);
