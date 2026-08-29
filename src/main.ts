import "./style.css";
import type { Action, GameState, Side } from "./game";
import { applyAction, newGame } from "./game";
import type { NetGuest, NetHost } from "./net";
import { hostGame, joinGame, roomIdFromUrl } from "./net";
import type { AppState, Handlers } from "./ui";
import { render } from "./ui";

const root = document.querySelector<HTMLDivElement>("#app")!;

let app: AppState = { screen: "home" };
let rulesOpen = false;
let currentNet: NetHost | NetGuest | null = null;
let sendAction: ((action: Action) => void) | null = null;

function paint() {
  render(root, app, rulesOpen, handlers);
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
}

function startHosting() {
  leaveNet();
  const net = hostGame();
  currentNet = net;
  setApp({ screen: "hosting", link: net.link });

  net.onPeerJoined(() => {
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

    setApp(gameScreen(state, "you"));
  });
}

function joinAsGuest(roomId: string) {
  leaveNet();
  const net = joinGame(roomId);
  currentNet = net;
  setApp({ screen: "joining" });

  sendAction = (action) => net.sendAction(action);
  net.onState((state) => setApp(gameScreen(state, "opponent")));
}

function goHome() {
  leaveNet();
  rulesOpen = false;
  history.replaceState(null, "", window.location.pathname);
  setApp({ screen: "home" });
}

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
  onHome: goHome,
  onOpenRules: () => {
    rulesOpen = true;
    paint();
  },
  onCloseRules: () => {
    rulesOpen = false;
    paint();
  },
};

const initialRoom = roomIdFromUrl();
if (initialRoom) {
  joinAsGuest(initialRoom);
} else {
  paint();
}
