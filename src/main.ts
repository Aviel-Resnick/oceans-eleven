import "./style.css";
import type { Action, GameState, Side } from "./game";
import { applyAction, newGame, whoMustAct } from "./game";
import type { NetGuest, NetHost } from "./net";
import { hostGame, joinGame, roomIdFromUrl } from "./net";
import type { AppState, Handlers, UiFlags } from "./ui";
import { render, tickCountdown } from "./ui";

const root = document.querySelector<HTMLDivElement>("#app")!;

let app: AppState = { screen: "home" };
let flags: UiFlags = { rulesOpen: false, rematchPending: false };
let currentNet: NetHost | NetGuest | null = null;
let sendAction: ((action: Action) => void) | null = null;
/** True for the host (and, eventually, local single-player) — the side allowed to enforce the act-timer by auto-drawing on behalf of whoever is late. A guest only ever displays the countdown; the host's broadcast is what actually moves the game forward. */
let isAuthoritative = true;
/** Set only while hosting, so "PLAY AGAIN" can restart in place without a network round trip. */
let hostRematch: (() => void) | null = null;

function paint() {
  render(root, app, flags, handlers);
}

function setApp(next: AppState) {
  app = next;
  paint();
}

function gameScreen(state: GameState, mySide: Side): AppState {
  return { screen: "game", state, mySide };
}

function leaveNet() {
  currentNet?.leave();
  currentNet = null;
  sendAction = null;
  hostRematch = null;
}

function startHosting() {
  leaveNet();
  isAuthoritative = true;
  const net = hostGame();
  currentNet = net;
  setApp({ screen: "hosting", link: net.link });

  function beginMatch() {
    let state = newGame();
    net.broadcastState(state);

    sendAction = (action) => {
      state = applyAction(state, action);
      net.broadcastState(state);
      setApp(gameScreen(state, "you"));
    };
    net.onGuestAction((action) => {
      state = applyAction(state, action);
      net.broadcastState(state);
      setApp(gameScreen(state, "you"));
    });

    flags = { ...flags, rematchPending: false };
    setApp(gameScreen(state, "you"));
  }

  hostRematch = beginMatch;
  net.onPeerJoined(() => beginMatch());
  net.onRematchRequest(() => beginMatch());
}

function joinAsGuest(roomId: string) {
  leaveNet();
  isAuthoritative = false;
  const net = joinGame(roomId);
  currentNet = net;
  setApp({ screen: "joining" });

  sendAction = (action) => net.sendAction(action);
  net.onState((state) => {
    flags = { ...flags, rematchPending: false };
    setApp(gameScreen(state, "opponent"));
  });
}

function goHome() {
  leaveNet();
  flags = { rulesOpen: false, rematchPending: false };
  history.replaceState(null, "", window.location.pathname);
  setApp({ screen: "home" });
}

// A single clock drives both the visible countdown and, on whichever client is authoritative,
// the 60s auto-draw when nobody acts in time. The countdown updates via a direct text-node
// write (tickCountdown), not a full paint() — a full root.innerHTML rebuild every 500ms was
// real, measurable jank, and could even swallow a DRAW/CONCEDE click if the rebuild landed
// between that button's mousedown and mouseup.
setInterval(() => {
  if (app.screen !== "game" || app.state.phase !== "playing") return;
  const deadline = app.state.actDeadline;
  if (isAuthoritative && deadline !== null && Date.now() >= deadline) {
    const side = whoMustAct(app.state);
    if (side) sendAction?.({ type: "draw", side });
    return;
  }
  tickCountdown(root, app);
}, 500);

const handlers: Handlers = {
  onPlayHouse: () => {
    alert("Playing against the house is coming soon — for now, try Invite a Friend.");
  },
  onInviteFriend: startHosting,
  onCopyLink: (link) => {
    navigator.clipboard?.writeText(link).catch(() => {});
  },
  onDraw: () => {
    if (app.screen === "game") sendAction?.({ type: "draw", side: app.mySide });
  },
  onConcede: () => {
    if (app.screen === "game") sendAction?.({ type: "concede", side: app.mySide });
  },
  onPlayAgain: () => {
    if (hostRematch) {
      hostRematch();
    } else if (currentNet?.role === "guest") {
      currentNet.requestRematch();
      flags = { ...flags, rematchPending: true };
      paint();
    }
  },
  onHome: goHome,
  onOpenRules: () => {
    flags = { ...flags, rulesOpen: true };
    paint();
  },
  onCloseRules: () => {
    flags = { ...flags, rulesOpen: false };
    paint();
  },
};

const initialRoom = roomIdFromUrl();
if (initialRoom) {
  joinAsGuest(initialRoom);
} else {
  paint();
}
