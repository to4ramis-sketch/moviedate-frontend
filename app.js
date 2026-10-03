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
  (params.get("room") || "")
    .trim()
    .toUpperCase();

let isHost = false;

let localStream = null;

let peer = null;

let partnerSocketId = null;

let joinedOnServer = false;

let joinRequested = false;

let pendingIceCandidates = [];


/* =========================================================
   ELEMENT HELPER
========================================================= */

const $ = id => document.getElementById(id);


/* =========================================================
   MAIN ELEMENTS
========================================================= */

const movie = $("movie");

const movieFile = $("movieFile");

const localVideo = $("localVideo");

const remoteVideo = $("remoteVideo");


/* =========================================================
   TOAST
========================================================= */

function toast(message){

  const el = $("toast");

  if(!el) return;

  el.textContent = message;

  el.classList.add("show");

  setTimeout(() => {
    el.classList.remove("show");
  }, 2200);
}


/* =========================================================
   TIME
========================================================= */

function formatTime(seconds){

  if(!Number.isFinite(seconds)){
    return "00:00";
  }

  seconds = Math.max(
    0,
    Math.floor(seconds)
  );

  return `${String(
    Math.floor(seconds / 60)
  ).padStart(2,"0")}:${String(
    seconds % 60
  ).padStart(2,"0")}`;
}


/* =========================================================
   ROOM CODE
========================================================= */

function randomRoom(){

  return Math.random()
    .toString(36)
    .slice(2,7)
    .toUpperCase();
}


/* =========================================================
   SERVER STATUS
========================================================= */

function setServerStatus(connected){

  const dot = $("roomStatus");

  if(dot){
    dot.classList.toggle(
      "on",
      connected
    );
  }
}


/* =========================================================
   SYNC STATUS
========================================================= */

function setSyncStatus(text){

  const badge = $("syncBadge");

  if(badge){
    badge.textContent = text;
  }
}


/* =========================================================
   PARTNER STATUS
========================================================= */

function setPartnerStatus(
  text,
  connected = false
){

  const el = $("partnerStatus");

  if(!el) return;

  el.textContent = text;

  el.classList.toggle(
    "connected",
    connected
  );
}


/* =========================================================
   ROOM UI
========================================================= */

function updateRoomUI(){

  const roomCode =
    $("roomCode");

  const roomGate =
    $("roomGate");

  if(roomCode){

    roomCode.textContent =
      roomId || "—";
  }

  if(roomGate){

    roomGate.classList.toggle(
      "hidden",
      Boolean(roomId)
    );
  }
}


/* =========================================================
   URL
========================================================= */

function updateRoomURL(){

  if(roomId){

    history.replaceState(
      {},
      "",
      `?room=${encodeURIComponent(roomId)}`
    );

  }else{

    history.replaceState(
      {},
      "",
      location.pathname
    );

  }
}


/* =========================================================
   JOIN REQUEST
========================================================= */

function requestJoin(){

  if(!roomId) return;

  if(!socket.connected){

    setSyncStatus(
      "Connecting server…"
    );

    return;
  }

  if(
    joinedOnServer ||
    joinRequested
  ){

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
    {
      roomId
    }
  );
}


/* =========================================================
   CREATE ROOM
========================================================= */

async function createRoom(){

  console.log(
    "CREATE ROOM CLICKED"
  );

  roomId = randomRoom();

  isHost = true;

  joinedOnServer = false;

  joinRequested = false;

  partnerSocketId = null;

  updateRoomURL();

  updateRoomUI();

  setPartnerStatus(
    "○ waiting for partner"
  );

  setSyncStatus(
    "Connecting…"
  );

  toast(
    "Creating room…"
  );

  const stream =
    await startCamera();

  if(!stream){

    toast(
      "Camera permission is needed."
    );

  }

  requestJoin();

  setTimeout(() => {

    if(roomId){

      toast(
        `Room ${roomId} created`
      );

    }

  }, 500);
}


/* =========================================================
   JOIN EXISTING ROOM
========================================================= */

async function joinExistingRoom(){

  if(!roomId) return;

  roomId =
    roomId
      .trim()
      .toUpperCase();

  updateRoomURL();

  updateRoomUI();

  setSyncStatus(
    "Connecting…"
  );

  setPartnerStatus(
    "○ joining…"
  );

  await startCamera();

  requestJoin();
}


/* =========================================================
   SOCKET CONNECT
========================================================= */

socket.on(
  "connect",
  () => {

    console.log(
      "SOCKET CONNECTED:",
      socket.id
    );

    setServerStatus(true);

    if(roomId){

      joinedOnServer = false;

      joinRequested = false;

      requestJoin();

    }else{

      setSyncStatus(
        "Ready"
      );

    }

  }
);


/* =========================================================
   SOCKET DISCONNECT
========================================================= */

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


/* =========================================================
   ROOM JOINED
========================================================= */

socket.on(
  "room-joined",
  data => {

    console.log(
      "ROOM JOINED:",
      data
    );

    if(data.roomId){

      roomId =
        String(data.roomId)
          .toUpperCase();

    }

    isHost =
      Boolean(data.isHost);

    joinedOnServer = true;

    joinRequested = false;

    updateRoomURL();

    updateRoomUI();

    const participants =
      Number(data.participants || 1);

    if(participants >= 2){

      setSyncStatus(
        "Connecting…"
      );

      setPartnerStatus(
        "◌ connecting…"
      );

    }else{

      setSyncStatus(
        "Waiting for partner"
      );

      setPartnerStatus(
        "○ waiting for partner"
      );

    }

  }
);


/* =========================================================
   ROOM STATE
========================================================= */

socket.on(
  "room-state",
  data => {

    console.log(
      "ROOM STATE:",
      data
    );

    if(data.roomId){

      roomId =
        String(data.roomId)
          .toUpperCase();

      updateRoomURL();

      updateRoomUI();

    }

    if(data.hostSocketId){

      isHost =
        data.hostSocketId === socket.id;

    }

    const participants =
      Number(data.participants || 0);

    if(participants <= 1){

      setSyncStatus(
        "Waiting for partner"
      );

      setPartnerStatus(
        "○ waiting for partner"
      );

    }

    if(participants >= 2){

      setSyncStatus(
        "Connecting…"
      );

      setPartnerStatus(
        "◌ connecting…"
      );

    }

    if(data.movie){

      console.log(
        "Movie:",
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
      null;

    if(
      data.hostSocketId === socket.id
    ){

      isHost = true;

    }

    setPartnerStatus(
      "◌ connecting…"
    );

    setSyncStatus(
      "Connecting…"
    );

  }
);


/* =========================================================
   PEER READY
========================================================= */

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

    if(isHost){

      await createPeer(true);

    }

  }
);


/* =========================================================
   PARTNER LEFT
========================================================= */

socket.on(
  "peer-left",
  () => {

    console.log(
      "PARTNER LEFT"
    );

    partnerSocketId = null;

    if(peer){

      peer.close();

      peer = null;

    }

    if(remoteVideo){

      remoteVideo.srcObject =
        null;

    }

    const placeholder =
      $("remotePlaceholder");

    if(placeholder){

      placeholder.style.display =
        "grid";

    }

    setPartnerStatus(
      "○ waiting for partner"
    );

    setSyncStatus(
      "Waiting for partner"
    );

  }
);


/* =========================================================
   ROOM FULL
========================================================= */

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


/* =========================================================
   ROOM ERROR
========================================================= */

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
      data?.message ||
      "Could not join room."
    );

  }
);


/* =========================================================
   CAMERA
========================================================= */

async function startCamera(){

  if(localStream){

    return localStream;

  }

  if(
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ){

    console.error(
      "getUserMedia unavailable"
    );

    toast(
      "Camera is not available in this browser."
    );

    return null;

  }

  try{

    console.log(
      "REQUESTING CAMERA..."
    );

    localStream =
      await navigator.mediaDevices.getUserMedia({
        video:true,
        audio:true
      });

    if(localVideo){

      localVideo.srcObject =
        localStream;

    }

    const placeholder =
      $("localPlaceholder");

    if(placeholder){

      placeholder.style.display =
        "none";

    }

    const status =
      $("youStatus");

    if(status){

      status.textContent =
        "● live";

    }

    console.log(
      "CAMERA READY"
    );

    return localStream;

  }catch(error){

    console.error(
      "CAMERA ERROR:",
      error
    );

    const status =
      $("youStatus");

    if(status){

      status.textContent =
        "○ camera off";

    }

    toast(
      "Camera/mic permission was not granted."
    );

    return null;

  }

}


/* =========================================================
   WEBRTC
========================================================= */

async function createPeer(
  offerer
){

  if(peer){

    peer.close();

    peer = null;

  }

  pendingIceCandidates = [];

  peer =
    new RTCPeerConnection({

      iceServers:[
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


  if(localStream){

    localStream
      .getTracks()
      .forEach(track => {

        peer.addTrack(
          track,
          localStream
        );

      });

  }


  peer.ontrack =
    event => {

      console.log(
        "REMOTE TRACK RECEIVED"
      );

      if(
        event.streams &&
        event.streams[0]
      ){

        if(remoteVideo){

          remoteVideo.srcObject =
            event.streams[0];

        }

        const placeholder =
          $("remotePlaceholder");

        if(placeholder){

          placeholder.style.display =
            "none";

        }

      }

    };


  peer.onicecandidate =
    event => {

      if(!event.candidate) return;

      socket.emit(
        "webrtc",
        {
          roomId,
          type:"ice",
          candidate:event.candidate
        }
      );

    };


  peer.onconnectionstatechange =
    () => {

      if(!peer) return;

      const state =
        peer.connectionState;

      console.log(
        "WEBRTC:",
        state
      );

      if(state === "connecting"){

        setPartnerStatus(
          "◌ connecting…"
        );

        setSyncStatus(
          "Connecting…"
        );

      }

      if(state === "connected"){

        setPartnerStatus(
          "● connected",
          true
        );

        setSyncStatus(
          "Synced room"
        );

      }

      if(
        state === "failed" ||
        state === "disconnected"
      ){

        setPartnerStatus(
          "○ connection failed"
        );

        setSyncStatus(
          "Connection failed"
        );

      }

    };


  if(offerer){

    const offer =
      await peer.createOffer();

    await peer.setLocalDescription(
      offer
    );

    socket.emit(
      "webrtc",
      {
        roomId,
        type:"offer",
        sdp:offer
      }
    );

    console.log(
      "OFFER SENT"
    );

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

    try{

      if(message.type === "offer"){

        if(!peer){

          await createPeer(false);

        }

        await peer.setRemoteDescription(
          new RTCSessionDescription(
            message.sdp
          )
        );

        for(
          const candidate
          of pendingIceCandidates
        ){

          try{

            await peer.addIceCandidate(
              candidate
            );

          }catch{}

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
            type:"answer",
            sdp:answer
          }
        );

      }


      if(message.type === "answer"){

        if(!peer) return;

        await peer.setRemoteDescription(
          new RTCSessionDescription(
            message.sdp
          )
        );

        for(
          const candidate
          of pendingIceCandidates
        ){

          try{

            await peer.addIceCandidate(
              candidate
            );

          }catch{}

        }

        pendingIceCandidates = [];

      }


      if(message.type === "ice"){

        const ice =
          new RTCIceCandidate(
            message.candidate
          );

        if(
          peer &&
          peer.remoteDescription
        ){

          try{

            await peer.addIceCandidate(
              ice
            );

          }catch{}

        }else{

          pendingIceCandidates.push(
            ice
          );

        }

      }

    }catch(error){

      console.error(
        "WEBRTC ERROR:",
        error
      );

    }

  }
);


/* =========================================================
   MOVIE FILE
========================================================= */

if(movieFile){

  movieFile.addEventListener(
    "change",
    event => {

      const file =
        event.target.files?.[0];

      if(!file) return;

      const url =
        URL.createObjectURL(file);

      movie.src = url;

      movie.load();

      const empty =
        $("emptyState");

      if(empty){

        empty.classList.add(
          "hidden"
        );

      }

      socket.emit(
        "movie-meta",
        {
          roomId,
          name:file.name
        }
      );

      toast(
        "Movie loaded"
      );

    }
  );

}


/* =========================================================
   PLAYBACK
========================================================= */

async function togglePlay(
  send = true
){

  if(!movie) return;

  if(movie.paused){

    await movie
      .play()
      .catch(() => {});

  }else{

    movie.pause();

  }

  if(send && roomId){

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


if(movie){

  movie.addEventListener(
    "timeupdate",
    () => {

      const current =
        $("currentTime");

      if(current){

        current.textContent =
          formatTime(
            movie.currentTime
          );

      }

      const seek =
        $("seek");

      if(seek){

        seek.value =
          movie.duration
            ? (
                movie.currentTime /
                movie.duration
              ) * 100
            : 0;

      }

    }
  );


  movie.addEventListener(
    "loadedmetadata",
    () => {

      const duration =
        $("duration");

      if(duration){

        duration.textContent =
          formatTime(
            movie.duration
          );

      }

    }
  );

}


/* =========================================================
   SEEK
========================================================= */

if($("seek")){

  $("seek").oninput =
    event => {

      if(
        movie &&
        movie.duration
      ){

        movie.currentTime =
          (
            Number(event.target.value) /
            100
          ) * movie.duration;

      }

    };


  $("seek").onchange =
    () => {

      if(!roomId || !movie) return;

      socket.emit(
        "playback",
        {
          roomId,
          action:"seek",
          time:
            movie.currentTime
        }
      );

    };

}


/* =========================================================
   REMOTE PLAYBACK
========================================================= */

socket.on(
  "playback",
  async data => {

    if(!movie) return;

    if(
      Math.abs(
        movie.currentTime -
        Number(data.time || 0)
      ) > .8
    ){

      movie.currentTime =
        Number(data.time || 0);

    }

    if(data.action === "play"){

      await movie
        .play()
        .catch(() => {});

    }

    if(data.action === "pause"){

      movie.pause();

    }

  }
);


/* =========================================================
   CHAT
========================================================= */

function addMessage(
  text,
  me = false
){

  const messages =
    $("messages");

  if(!messages) return;

  const empty =
    $("messageEmpty");

  if(empty){

    empty.remove();

  }

  const el =
    document.createElement("div");

  el.className =
    "bubble" +
    (me ? " me" : "");

  el.textContent =
    text;

  messages.appendChild(
    el
  );

  messages.scrollTop =
    messages.scrollHeight;

}


if($("chatForm")){

  $("chatForm").onsubmit =
    event => {

      event.preventDefault();

      const input =
        $("chatInput");

      if(!input) return;

      const text =
        input.value.trim();

      if(!text) return;

      addMessage(
        text,
        true
      );

      if(roomId){

        socket.emit(
          "chat",
          {
            roomId,
            text
          }
        );

      }

      input.value = "";

    };

}


socket.on(
  "chat",
  data => {

    if(data?.text){

      addMessage(
        data.text,
        false
      );

    }

  }
);


/* =========================================================
   REACTIONS
========================================================= */

function reactionEmoji(
  emoji
){

  const el =
    document.createElement("div");

  el.className =
    "float-reaction";

  el.textContent =
    emoji;

  el.style.left =
    25 +
    Math.random() * 60 +
    "vw";

  el.style.top =
    55 +
    Math.random() * 25 +
    "vh";

  document.body.appendChild(
    el
  );

  setTimeout(
    () => el.remove(),
    1500
  );

}


if($("reactionRow")){

  $("reactionRow").onclick =
    event => {

      const button =
        event.target.closest(
          "button"
        );

      if(!button) return;

      const emoji =
        button.dataset.reaction;

      if(!emoji) return;

      reactionEmoji(
        emoji
      );

      if(roomId){

        socket.emit(
          "reaction",
          {
            roomId,
            emoji
          }
        );

      }

    };

}


socket.on(
  "reaction",
  data => {

    if(data?.emoji){

      reactionEmoji(
        data.emoji
      );

    }

  }
);


/* =========================================================
   MICROPHONE
========================================================= */

if($("micBtn")){

  $("micBtn").onclick =
    async () => {

      if(!localStream){

        await startCamera();

      }

      const track =
        localStream
          ?.getAudioTracks()
          ?. [0];

      if(!track){

        toast(
          "Microphone not available"
        );

        return;

      }

      track.enabled =
        !track.enabled;

      toast(
        track.enabled
          ? "Mic on"
          : "Mic off"
      );

    };

}


/* =========================================================
   CAMERA
========================================================= */

if($("cameraBtn")){

  $("cameraBtn").onclick =
    async () => {

      if(!localStream){

        await startCamera();

      }

      const track =
        localStream
          ?.getVideoTracks()
          ?. [0];

      if(!track){

        toast(
          "Camera not available"
        );

        return;

      }

      track.enabled =
        !track.enabled;

      const placeholder =
        $("localPlaceholder");

      if(placeholder){

        placeholder.style.display =
          track.enabled
            ? "none"
            : "grid";

      }

      toast(
        track.enabled
          ? "Camera on"
          : "Camera off"
      );

    };

}


/* =========================================================
   SHARE
========================================================= */

async function shareRoom(){

  if(!roomId){

    toast(
      "Create a room first"
    );

    return;

  }

  const url =
    `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`;

  try{

    if(navigator.share){

      await navigator.share({
        title:"MovieDate",
        text:"Join my MovieDate room",
        url
      });

      return;

    }

  }catch{}

  try{

    await navigator.clipboard.writeText(
      url
    );

    toast(
      "Room link copied"
    );

  }catch{

    prompt(
      "Copy this room link:",
      url
    );

  }

}


/* =========================================================
   BUTTONS
========================================================= */

if($("shareBtn")){

  $("shareBtn").onclick =
    shareRoom;

}


if($("roomPill")){

  $("roomPill").onclick =
    shareRoom;

}


if($("playBtn")){

  $("playBtn").onclick =
    () => togglePlay(true);

}


if($("movieTap")){

  $("movieTap").onclick =
    () => togglePlay(true);

}


if(movie){

  movie.onclick =
    () => togglePlay(true);

}


if($("chooseMovieBtn")){

  $("chooseMovieBtn").onclick =
    () => {

      if(movieFile){

        movieFile.click();

      }

    };

}


if($("changeMovie")){

  $("changeMovie").onclick =
    () => {

      if(movieFile){

        movieFile.click();

      }

    };

}


/* =========================================================
   FULLSCREEN
========================================================= */

if($("fullscreenBtn")){

  $("fullscreenBtn").onclick =
    async () => {

      const wrap =
        $("videoWrap");

      if(!wrap) return;

      try{

        if(
          document.fullscreenElement
        ){

          await document.exitFullscreen();

        }else{

          await wrap.requestFullscreen();

        }

      }catch(error){

        console.error(
          "FULLSCREEN ERROR:",
          error
        );

      }

    };

}


/* =========================================================
   MUTE MOVIE
========================================================= */

if($("muteBtn")){

  $("muteBtn").onclick =
    () => {

      if(!movie) return;

      movie.muted =
        !movie.muted;

      toast(
        movie.muted
          ? "Movie muted"
          : "Movie sound on"
      );

    };

}


/* =========================================================
   CREATE ROOM BUTTON
========================================================= */

if($("createRoomBtn")){

  $("createRoomBtn").onclick =
    createRoom;

}


/* =========================================================
   JOIN BUTTON
========================================================= */

if($("joinPromptBtn")){

  $("joinPromptBtn").onclick =
    () => {

      const sheet =
        $("joinSheet");

      if(!sheet) return;

      sheet.hidden = false;

      const input =
        $("roomCodeInput");

      if(input){

        setTimeout(
          () => input.focus(),
          50
        );

      }

    };

}


/* =========================================================
   CLOSE JOIN
========================================================= */

if($("closeJoinBtn")){

  $("closeJoinBtn").onclick =
    () => {

      const sheet =
        $("joinSheet");

      if(sheet){

        sheet.hidden = true;

      }

    };

}


/* =========================================================
   JOIN ROOM
========================================================= */

async function joinRoomFromCode(){

  const input =
    $("roomCodeInput");

  if(!input) return;

  const code =
    input.value
      .trim()
      .toUpperCase();

  if(!code){

    toast(
      "Enter a room code"
    );

    return;

  }

  if(code.length < 5){

    toast(
      "Room code must be 5 characters"
    );

    return;

  }

  roomId = code;

  isHost = false;

  joinedOnServer = false;

  joinRequested = false;

  const sheet =
    $("joinSheet");

  if(sheet){

    sheet.hidden = true;

  }

  updateRoomURL();

  updateRoomUI();

  await joinExistingRoom();

}


if($("joinRoomBtn")){

  $("joinRoomBtn").onclick =
    joinRoomFromCode;

}


if($("roomCodeInput")){

  $("roomCodeInput").addEventListener(
    "keydown",
    event => {

      if(
        event.key === "Enter"
      ){

        joinRoomFromCode();

      }

    }
  );

}


/* =========================================================
   EXIT
========================================================= */

if($("exitBtn")){

  $("exitBtn").onclick =
    () => {

      try{

        socket.emit(
          "leave-room"
        );

      }catch{}

      if(peer){

        peer.close();

        peer = null;

      }

      if(localStream){

        localStream
          .getTracks()
          .forEach(
            track => track.stop()
          );

        localStream = null;

      }

      roomId = "";

      joinedOnServer = false;

      joinRequested = false;

      updateRoomURL();

      updateRoomUI();

      setSyncStatus(
        "Ready"
      );

      setPartnerStatus(
        "○ waiting"
      );

    };

}


/* =========================================================
   INITIAL STATE
========================================================= */

updateRoomUI();

if(roomId){

  setSyncStatus(
    "Connecting…"
  );

  setPartnerStatus(
    "○ joining…"
  );

  console.log(
    "ROOM FROM URL:",
    roomId
  );

}else{

  setSyncStatus(
    "Ready"
  );

  setPartnerStatus(
    "○ waiting"
  );

}


/* =========================================================
   AUTOMATIC JOIN
========================================================= */

if(roomId){

  /*
    Wait for the Socket.IO connection.
    The socket "connect" event will call
    requestJoin() automatically.
  */

  console.log(
    "MovieDate ready to join room:",
    roomId
  );

}else{

  console.log(
    "MovieDate ready — waiting for room creation."
  );

}
