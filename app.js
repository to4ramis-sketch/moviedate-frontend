/* =====================================================
   MOVIEDATE
   ROOM SYSTEM
===================================================== */

const BACKEND_URL =
  "https://moviedate-backend-production.up.railway.app";


/* SOCKET */

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
  reconnection: true
});


/* HELPER */

const $ = (id) => {
  return document.getElementById(id);
};


/* ELEMENTS */

const roomGate = $("roomGate");
const app = $("app");

const createRoomBtn = $("createRoomBtn");
const joinPromptBtn = $("joinPromptBtn");

const joinSheet = $("joinSheet");
const closeJoinBtn = $("closeJoinBtn");
const joinRoomBtn = $("joinRoomBtn");
const roomCodeInput = $("roomCodeInput");

const roomCodeDisplay = $("roomCode");


/* STATE */

let currentRoom = null;
let isHost = false;


/* =====================================================
   SHOW ROOM SCREEN
===================================================== */

function showRoomGate() {

  console.log("SHOW ROOM GATE");

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


/* =====================================================
   SHOW WATCH APP
===================================================== */

function showApp() {

  console.log("SHOW WATCH APP");

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


/* =====================================================
   CREATE ROOM
===================================================== */

createRoomBtn?.addEventListener("click", () => {

  const roomCode = generateRoomCode();

  console.log(
    "CREATING ROOM:",
    roomCode
  );

  currentRoom = roomCode;

  isHost = true;

  socket.emit(
    "join-room",
    roomCode
  );

});


/* =====================================================
   OPEN JOIN
===================================================== */

joinPromptBtn?.addEventListener("click", () => {

  console.log("OPEN JOIN");

  if (!joinSheet) return;

  joinSheet.classList.remove("hidden");

  joinSheet.style.display = "flex";


  setTimeout(() => {

    roomCodeInput?.focus();

  }, 100);

});


/* =====================================================
   CLOSE JOIN
===================================================== */

closeJoinBtn?.addEventListener("click", () => {

  if (!joinSheet) return;

  joinSheet.classList.add("hidden");

  joinSheet.style.display = "none";

});


/* =====================================================
   JOIN ROOM
===================================================== */

joinRoomBtn?.addEventListener("click", () => {

  const code =
    roomCodeInput?.value
      ?.trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");


  if (!code) {

    alert("Please enter a room code.");

    return;
  }


  console.log(
    "JOINING ROOM:",
    code
  );


  currentRoom = code;

  isHost = false;


  socket.emit(
    "join-room",
    code
  );

});


/* =====================================================
   ENTER KEY
===================================================== */

roomCodeInput?.addEventListener(
  "keydown",
  (event) => {

    if (event.key === "Enter") {

      event.preventDefault();

      joinRoomBtn?.click();

    }

  }
);


/* =====================================================
   ROOM JOINED
===================================================== */

socket.on(
  "room-joined",
  (data) => {

    console.log(
      "ROOM JOINED:",
      data
    );


    currentRoom =
      data.roomId;


    isHost =
      data.isHost;


    if (roomCodeDisplay) {

      roomCodeDisplay.textContent =
        currentRoom;

    }


    /*
      ONLY NOW DO WE SHOW THE PLAYER
    */

    showApp();


    /*
      If you already have camera/movie
      initialization functions in your
      existing app.js, call them here.
    */

    if (
      typeof startCamera === "function"
    ) {

      startCamera();

    }

  }
);


/* =====================================================
   ROOM STATE
===================================================== */

socket.on(
  "room-state",
  (data) => {

    console.log(
      "ROOM STATE:",
      data
    );


    if (data.roomId) {

      currentRoom =
        data.roomId;

    }


    /*
      IMPORTANT:

      Do NOT call showApp()
      here.

      The player should only appear
      after room-joined.
    */

  }
);


/* =====================================================
   ROOM ERROR
===================================================== */

socket.on(
  "room-error",
  (data) => {

    console.error(
      "ROOM ERROR:",
      data
    );


    alert(
      data?.message ||
      "Could not join the room."
    );


    showRoomGate();

  }
);


/* =====================================================
   ROOM FULL
===================================================== */

socket.on(
  "room-full",
  () => {

    alert(
      "This room already has two people."
    );


    showRoomGate();

  }
);


/* =====================================================
   SOCKET ERROR
===================================================== */

socket.on(
  "connect_error",
  (error) => {

    console.error(
      "SOCKET ERROR:",
      error
    );

  }
);


/* =====================================================
   GENERATE ROOM CODE
===================================================== */

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


/* =====================================================
   INITIAL PAGE STATE
===================================================== */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    console.log(
      "MOVIEDATE LOADED"
    );


    /*
      THIS IS CRITICAL.

      Every fresh visit starts
      at the room screen.
    */

    showRoomGate();

  }
);
