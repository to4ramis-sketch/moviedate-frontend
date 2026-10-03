const BACKEND_URL =
  "https://moviedate-backend-production.up.railway.app";

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
  reconnection: true
});

const movie = document.getElementById("movie");
const movieInput = document.getElementById("movieInput");

let roomId = "";
let isHost = false;

let localMovieURL = null;
let hasMovie = false;

let partnerSocketId = null;

// CAMERA WEBRTC
let peer = null;

// MOVIE WEBRTC
let moviePeer = null;
let movieVideoSender = null;
let movieAudioSender = null;
let movieCaptureStream = null;

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


// --------------------------------------------------
// BASIC HELPERS
// --------------------------------------------------

function toast(message) {
  console.log("[MovieDate]", message);

  const el = document.getElementById("toast");

  if (!el) {
    alert(message);
    return;
  }

  el.textContent = message;
  el.classList.add("show");

  clearTimeout(window.__toastTimer);

  window.__toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 2500);
}


function showMovieUI() {
  hasMovie = true;

  const empty = document.getElementById("movieEmpty");
  const tap = document.getElementById("movieTap");

  if (empty) empty.classList.add("hidden");

  if (tap) tap.classList.add("show");

  movie.classList.add("has-movie");
}


function hideMovieUI() {
  hasMovie = false;

  const empty = document.getElementById("movieEmpty");
  const tap = document.getElementById("movieTap");

  if (empty) empty.classList.remove("hidden");

  if (tap) tap.classList.remove("show");

  movie.classList.remove("has-movie");
}


// --------------------------------------------------
// CAMERA
// --------------------------------------------------

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user"
      },
      audio: true
    });

    const localVideo = document.getElementById("localVideo");

    if (localVideo) {
      localVideo.srcObject = stream;
      localVideo.muted = true;
      localVideo.playsInline = true;

      await localVideo.play().catch(() => {});
    }

    window.localStream = stream;

    console.log("Camera ready");

  } catch (error) {
    console.error("Camera error:", error);
    toast("Camera or microphone permission was denied.");
  }
}


// --------------------------------------------------
// CAMERA WEBRTC
// --------------------------------------------------

async function createPeer(offerer = false) {

  if (peer) {
    try {
      peer.close();
    } catch {}
  }

  peer = new RTCPeerConnection(ICE_SERVERS);

  const localStream = window.localStream;

  if (localStream) {
    localStream.getTracks().forEach(track => {
      peer.addTrack(track, localStream);
    });
  }

  peer.onicecandidate = event => {
    if (!event.candidate) return;

    socket.emit("webrtc", {
      channel: "camera",
      type: "ice",
      candidate: event.candidate
    });
  };

  peer.ontrack = event => {

    const remoteVideo =
      document.getElementById("remoteVideo");

    if (!remoteVideo) return;

    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.autoplay = true;
      remoteVideo.playsInline = true;

      remoteVideo.play().catch(() => {});
    }
  };

  peer.onconnectionstatechange = () => {
    console.log(
      "Camera connection:",
      peer.connectionState
    );
  };

  if (offerer) {

    const offer = await peer.createOffer();

    await peer.setLocalDescription(offer);

    socket.emit("webrtc", {
      channel: "camera",
      type: "offer",
      sdp: peer.localDescription
    });
  }
}


// --------------------------------------------------
// MOVIE WEBRTC
// --------------------------------------------------

function getMovieCaptureStream() {

  if (!movie) return null;

  if (typeof movie.captureStream === "function") {
    return movie.captureStream();
  }

  if (typeof movie.mozCaptureStream === "function") {
    return movie.mozCaptureStream();
  }

  return null;
}


// Create the movie peer connection.

function createMoviePeer() {

  if (moviePeer) {
    try {
      moviePeer.close();
    } catch {}
  }

  moviePeer = new RTCPeerConnection(ICE_SERVERS);

  moviePeer.onicecandidate = event => {

    if (!event.candidate) return;

    socket.emit("webrtc", {
      channel: "movie",
      type: "ice",
      candidate: event.candidate
    });
  };


  // Partner receives the movie here.

  moviePeer.ontrack = event => {

    console.log(
      "MOVIE TRACK RECEIVED",
      event.track.kind
    );

    const stream =
      event.streams && event.streams[0]
        ? event.streams[0]
        : null;

    if (!stream) return;


    // Only the partner should replace
    // the movie element with the remote stream.

    if (!isHost) {

      movie.src = "";
      movie.removeAttribute("src");

      movie.srcObject = stream;

      movie.controls = true;

      showMovieUI();

      movie.muted = false;
      movie.playsInline = true;

      movie.play().catch(() => {

        toast(
          "Tap the movie to start playback."
        );

      });

      console.log("REMOTE MOVIE CONNECTED");
    }
  };


  moviePeer.onconnectionstatechange = () => {

    if (!moviePeer) return;

    console.log(
      "Movie connection:",
      moviePeer.connectionState
    );

    if (
      moviePeer.connectionState === "failed" ||
      moviePeer.connectionState === "closed"
    ) {
      movieVideoSender = null;
      movieAudioSender = null;
    }
  };

  return moviePeer;
}


// --------------------------------------------------
// START MOVIE STREAMING
// --------------------------------------------------

async function startMovieStreaming() {

  // Only the person who selected the movie
  // sends it.

  if (!isHost) return;

  if (!partnerSocketId) {
    console.log(
      "Waiting for partner before streaming movie."
    );
    return;
  }

  if (!hasMovie) return;

  if (!movie) return;


  // captureStream is the important part.

  const stream = getMovieCaptureStream();

  if (!stream) {

    toast(
      "Your Chrome browser cannot stream this video."
    );

    console.error(
      "captureStream() is not supported."
    );

    return;
  }


  movieCaptureStream = stream;

  const videoTrack =
    stream.getVideoTracks()[0];

  const audioTrack =
    stream.getAudioTracks()[0];


  if (!videoTrack) {

    toast(
      "Could not capture the movie video."
    );

    return;
  }


  // Create movie peer if needed.

  if (!moviePeer) {
    createMoviePeer();
  }


  // If we already have senders,
  // replace the movie tracks.

  if (movieVideoSender) {

    await movieVideoSender.replaceTrack(
      videoTrack
    );

  } else {

    movieVideoSender =
      moviePeer.addTrack(
        videoTrack,
        stream
      );
  }


  if (audioTrack) {

    if (movieAudioSender) {

      await movieAudioSender.replaceTrack(
        audioTrack
      );

    } else {

      movieAudioSender =
        moviePeer.addTrack(
          audioTrack,
          stream
        );
    }

  } else if (movieAudioSender) {

    await movieAudioSender.replaceTrack(null);
  }


  // If this is the first movie connection,
  // create the offer.

  if (
    moviePeer.signalingState === "stable" &&
    !moviePeer.localDescription
  ) {

    const offer =
      await moviePeer.createOffer();

    await moviePeer.setLocalDescription(
      offer
    );

    socket.emit("webrtc", {
      channel: "movie",
      type: "offer",
      sdp: moviePeer.localDescription
    });

    console.log(
      "MOVIE OFFER SENT"
    );
  }

}


// --------------------------------------------------
// LOAD LOCAL MOVIE
// --------------------------------------------------

function loadMovieFile(file) {

  if (!file) return;


  // Remove previous remote stream.

  movie.srcObject = null;


  // Revoke old blob URL.

  if (localMovieURL) {
    URL.revokeObjectURL(localMovieURL);
  }


  localMovieURL =
    URL.createObjectURL(file);


  movie.src = localMovieURL;

  movie.controls = true;

  movie.muted = false;

  movie.playsInline = true;


  showMovieUI();


  // Tell partner the filename.

  socket.emit("movie-meta", {
    name: file.name
  });


  // Wait until the video is ready
  // before capturing it.

  movie.onloadedmetadata = async () => {

    console.log(
      "Movie metadata loaded:",
      file.name
    );

    // Host is the sender.

    if (isHost) {

      // Give Chrome a moment to create
      // the media pipeline.

      setTimeout(() => {

        startMovieStreaming()
          .catch(error => {
            console.error(
              "Movie streaming error:",
              error
            );
          });

      }, 300);
    }
  };


  movie.oncanplay = () => {

    if (isHost) {

      startMovieStreaming()
        .catch(error => {
          console.error(error);
        });
    }

  };


  movie.onerror = () => {

    toast(
      "This video can't be played. Try MP4 H.264."
    );

  };


  console.log(
    "LOCAL MOVIE LOADED:",
    file.name
  );
}


// --------------------------------------------------
// MOVIE INPUT
// --------------------------------------------------

if (movieInput) {

  movieInput.addEventListener(
    "change",
    event => {

      const file =
        event.target.files &&
        event.target.files[0];

      if (!file) return;

      loadMovieFile(file);

    }
  );
}


// --------------------------------------------------
// MOVIE PLAY / PAUSE
// --------------------------------------------------

movie.addEventListener(
  "play",
  () => {

    if (!isHost) return;

    socket.emit("playback", {
      action: "play",
      time: movie.currentTime
    });

  }
);


movie.addEventListener(
  "pause",
  () => {

    if (!isHost) return;

    socket.emit("playback", {
      action: "pause",
      time: movie.currentTime
    });

  }
);


movie.addEventListener(
  "seeked",
  () => {

    if (!isHost) return;

    socket.emit("playback", {
      action: "seek",
      time: movie.currentTime
    });

  }
);


// --------------------------------------------------
// MOVIE TAP
// --------------------------------------------------

const movieTap =
  document.getElementById("movieTap");

if (movieTap) {

  movieTap.addEventListener(
    "click",
    async () => {

      if (!hasMovie) return;

      if (movie.paused) {

        await movie.play()
          .catch(() => {});

      } else {

        movie.pause();

      }

    }
  );
}


// --------------------------------------------------
// SOCKET CONNECTION
// --------------------------------------------------

socket.on("connect", () => {

  console.log(
    "Connected to MovieDate server:",
    socket.id
  );

});


// --------------------------------------------------
// ROOM JOINED
// --------------------------------------------------

socket.on(
  "room-joined",
  data => {

    roomId = data.roomId;
    isHost = data.isHost;

    console.log(
      "Joined room:",
      roomId,
      "Host:",
      isHost
    );

  }
);


// --------------------------------------------------
// ROOM STATE
// --------------------------------------------------

socket.on(
  "room-state",
  data => {

    roomId =
      data.roomId || roomId;

    console.log(
      "Room state:",
      data
    );

    if (
      data.movie &&
      data.movie.name
    ) {

      console.log(
        "Partner has movie:",
        data.movie.name
      );

    }

  }
);


// --------------------------------------------------
// PARTNER JOINED
// --------------------------------------------------

socket.on(
  "peer-joined",
  async data => {

    partnerSocketId =
      data.socketId;

    console.log(
      "PARTNER JOINED:",
      partnerSocketId
    );


    // Camera connection.

    if (isHost) {

      await createPeer(true);

    } else {

      await createPeer(false);

    }


    // If host already selected a movie,
    // immediately start movie streaming.

    if (isHost && hasMovie) {

      setTimeout(() => {

        startMovieStreaming()
          .catch(error => {
            console.error(
              "Movie stream start error:",
              error
            );
          });

      }, 500);
    }

  }
);


// --------------------------------------------------
// PEER READY
// --------------------------------------------------

socket.on(
  "peer-ready",
  async data => {

    partnerSocketId =
      data.socketId;

    console.log(
      "PEER READY:",
      partnerSocketId
    );


    if (!peer) {

      await createPeer(
        isHost
      );

    }


    // Host sends movie if already loaded.

    if (isHost && hasMovie) {

      setTimeout(() => {

        startMovieStreaming()
          .catch(error => {
            console.error(error);
          });

      }, 500);
    }

  }
);


// --------------------------------------------------
// WEBRTC SIGNALING
// --------------------------------------------------

socket.on(
  "webrtc",
  async data => {

    // -------------------------------
    // MOVIE SIGNALING
    // -------------------------------

    if (data.channel === "movie") {

      try {

        if (
          data.type === "offer"
        ) {

          console.log(
            "MOVIE OFFER RECEIVED"
          );


          if (!moviePeer) {
            createMoviePeer();
          }


          await moviePeer.setRemoteDescription(
            new RTCSessionDescription(
              data.sdp
            )
          );


          const answer =
            await moviePeer.createAnswer();


          await moviePeer.setLocalDescription(
            answer
          );


          socket.emit("webrtc", {
            channel: "movie",
            type: "answer",
            sdp: moviePeer.localDescription
          });


          console.log(
            "MOVIE ANSWER SENT"
          );

          return;
        }


        if (
          data.type === "answer"
        ) {

          console.log(
            "MOVIE ANSWER RECEIVED"
          );


          if (!moviePeer) return;


          await moviePeer.setRemoteDescription(
            new RTCSessionDescription(
              data.sdp
            )
          );


          return;
        }


        if (
          data.type === "ice"
        ) {

          if (!moviePeer) return;


          try {

            await moviePeer.addIceCandidate(
              new RTCIceCandidate(
                data.candidate
              )
            );

          } catch (error) {

            console.warn(
              "Movie ICE error:",
              error
            );

          }

          return;
        }

      } catch (error) {

        console.error(
          "Movie WebRTC error:",
          error
        );

      }

      return;
    }


    // -------------------------------
    // CAMERA SIGNALING
    // -------------------------------

    try {

      if (
        data.type === "offer"
      ) {

        if (!peer) {
          await createPeer(false);
        }


        await peer.setRemoteDescription(
          new RTCSessionDescription(
            data.sdp
          )
        );


        const answer =
          await peer.createAnswer();


        await peer.setLocalDescription(
          answer
        );


        socket.emit("webrtc", {
          channel: "camera",
          type: "answer",
          sdp: peer.localDescription
        });


        return;
      }


      if (
        data.type === "answer"
      ) {

        if (!peer) return;


        await peer.setRemoteDescription(
          new RTCSessionDescription(
            data.sdp
          )
        );


        return;
      }


      if (
        data.type === "ice"
      ) {

        if (!peer) return;


        try {

          await peer.addIceCandidate(
            new RTCIceCandidate(
              data.candidate
            )
          );

        } catch (error) {

          console.warn(
            "Camera ICE error:",
            error
          );

        }

      }

    } catch (error) {

      console.error(
        "Camera WebRTC error:",
        error
      );

    }

  }
);


// --------------------------------------------------
// MOVIE METADATA
// --------------------------------------------------

socket.on(
  "movie-meta",
  data => {

    console.log(
      "Partner movie:",
      data.name
    );

  }
);


// --------------------------------------------------
// PARTNER LEFT
// --------------------------------------------------

socket.on(
  "peer-left",
  () => {

    partnerSocketId = null;


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
      "Partner left."
    );

  }
);


// --------------------------------------------------
// FILE BUTTON
// --------------------------------------------------

const chooseMovie =
  document.getElementById("chooseMovie");

if (chooseMovie && movieInput) {

  chooseMovie.addEventListener(
    "click",
    () => {
      movieInput.click();
    }
  );

}


// --------------------------------------------------
// EXIT ROOM
// --------------------------------------------------

const exitRoom =
  document.getElementById("exitRoom");

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


      peer = null;
      moviePeer = null;

      partnerSocketId = null;

      window.location.reload();

    }
  );

}


// --------------------------------------------------
// CHAT
// --------------------------------------------------

const chatInput =
  document.getElementById("chatInput");

const sendChat =
  document.getElementById("sendChat");


function sendChatMessage() {

  if (!chatInput) return;

  const text =
    chatInput.value.trim();

  if (!text) return;


  socket.emit(
    "chat",
    { text }
  );


  addChatMessage(
    text,
    true
  );


  chatInput.value = "";

}


if (sendChat) {

  sendChat.addEventListener(
    "click",
    sendChatMessage
  );

}


if (chatInput) {

  chatInput.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter"
      ) {

        sendChatMessage();

      }

    }
  );

}


function addChatMessage(
  text,
  mine = false
) {

  const chat =
    document.getElementById("chat");

  if (!chat) return;


  const message =
    document.createElement("div");

  message.className =
    mine
      ? "chat-message mine"
      : "chat-message";


  message.textContent = text;


  chat.appendChild(
    message
  );


  chat.scrollTop =
    chat.scrollHeight;

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


// --------------------------------------------------
// REACTIONS
// --------------------------------------------------

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
          { emoji }
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
    document.createElement("div");

  el.className =
    "floating-reaction";

  el.textContent =
    emoji;

  document.body.appendChild(
    el
  );


  setTimeout(() => {

    el.remove();

  }, 1800);

}


// --------------------------------------------------
// CAMERA / MIC CONTROLS
// --------------------------------------------------

const micButton =
  document.getElementById("micButton");

const cameraButton =
  document.getElementById("cameraButton");


if (micButton) {

  micButton.addEventListener(
    "click",
    () => {

      if (!window.localStream)
        return;


      const tracks =
        window.localStream
          .getAudioTracks();


      tracks.forEach(
        track => {
          track.enabled =
            !track.enabled;
        }
      );

    }
  );

}


if (cameraButton) {

  cameraButton.addEventListener(
    "click",
    () => {

      if (!window.localStream)
        return;


      const tracks =
        window.localStream
          .getVideoTracks();


      tracks.forEach(
        track => {
          track.enabled =
            !track.enabled;
        }
      );

    }
  );

}


// --------------------------------------------------
// INITIAL CAMERA
// --------------------------------------------------

startCamera();
