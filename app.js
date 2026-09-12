import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, push, set, get, update, remove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { PLAYER_DATA } from "./players.js";

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// Eigener Firebase-Zweig, damit das alte Draft-Tool (draftConfig/draftState/...)
// unberührt bleibt und beide Tools parallel im selben Projekt laufen können.
const ROOT = "final6";

const COMMISSIONER_PASSWORD = "admin1234";
const NUM_TEAMS      = 6;
const STARTELF_ROUNDS = 11;
const RESERVE_ROUNDS  = 7;
const BACKUP_ROUNDS   = 6;
const TOTAL_ROUNDS    = STARTELF_ROUNDS + RESERVE_ROUNDS + BACKUP_ROUNDS; // 24

let currentUser   = null;
let draftConfig   = null;
let timerValue    = 90;
let timerInterval = null;
let allPicks      = [];
let pickOrder     = [];       // flattened, length = NUM_TEAMS * TOTAL_ROUNDS
let lobbyUnsubscribe = null;

// ─────────────────────────────────────────────────────────────
// CATEGORY / ROUND HELPERS
// ─────────────────────────────────────────────────────────────
function categoryForRound(round) {
  if (round <= STARTELF_ROUNDS) return "Startelf";
  if (round <= STARTELF_ROUNDS + RESERVE_ROUNDS) return "Reserve";
  return "Backup";
}

// Rotierende Order: pro Runde rotiert die Startposition um 1.
// Nach 6 Runden (= Anzahl Teilnehmer) ist die Rotation komplett und beginnt wieder von vorn.
// So hat jeder Teilnehmer innerhalb jedes 6-Runden-Zyklus genau 1x Platz 1.
function buildRotatingOrder(teamNames, totalRounds) {
  var order = [];
  var n = teamNames.length;
  for (var r = 0; r < totalRounds; r++) {
    var shift = r % n;
    var round = teamNames.slice(shift).concat(teamNames.slice(0, shift));
    order = order.concat(round);
  }
  return order;
}

// ─────────────────────────────────────────────────────────────
// SCREENS
// ─────────────────────────────────────────────────────────────
window.showScreen = function(id) {
  var freeScreens = ["loginScreen", "commissionerScreen"];
  if (currentUser && !currentUser.isCommissioner && !freeScreens.includes(id)) return;
  document.querySelectorAll(".screen").forEach(function(s) { s.classList.remove("active"); });
  document.getElementById(id).classList.add("active");
};

function goToScreen(id) {
  document.querySelectorAll(".screen").forEach(function(s) { s.classList.remove("active"); });
  document.getElementById(id).classList.add("active");
}

function applyRoleUI() {
  var isComm = currentUser && currentUser.isCommissioner;
  var back = document.getElementById("commBackDraft");
  if (back) back.style.display = isComm ? "inline-flex" : "none";
  var logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.style.display = (!isComm && currentUser) ? "inline-flex" : "none";
}

// ─────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────
window.handleLogin = async function() {
  var name = document.getElementById("loginTeamName").value.trim();
  var pw   = document.getElementById("loginPassword").value.trim();
  var err  = document.getElementById("loginError");
  if (!name) { err.textContent = "Bitte Namen eingeben."; return; }

  var snap   = await get(ref(db, ROOT + "/config"));
  var config = snap.val();
  if (!config) { err.textContent = "Kein Draft konfiguriert."; return; }

  var team = null;
  (config.teams || []).forEach(function(t) {
    if (t.name.toLowerCase() === name.toLowerCase()) team = t;
  });
  if (!team) { err.textContent = "Teilnehmer nicht gefunden."; return; }
  if (team.password && team.password !== pw) { err.textContent = "Falsches Passwort."; return; }

  currentUser = { team: team.name, isCommissioner: false };
  enterApp();
};

window.showCommissionerLogin = function() { showScreen("commissionerScreen"); };

window.commLogin = function() {
  var pw  = document.getElementById("commPassword").value;
  var err = document.getElementById("commError");
  if (pw !== COMMISSIONER_PASSWORD) { err.textContent = "Falsches Passwort."; return; }
  document.getElementById("commPanel").style.display = "block";
  currentUser = { team: "Commissioner", isCommissioner: true };
  loadCommissionerPanel().then(function() { initLobby(); }).catch(function(e) {
    console.error(e);
    alert("Firebase-Fehler beim Laden: " + e.message + "\n\nWahrscheinlich erlauben deine Firebase-Regeln den Pfad 'final6/' noch nicht. Siehe Hinweis in der README bzw. Firebase Console → Realtime Database → Regeln.");
  });
};

// ─────────────────────────────────────────────────────────────
// COMMISSIONER PANEL
// ─────────────────────────────────────────────────────────────
function loadCommissionerPanel() {
  return get(ref(db, ROOT + "/config")).then(function(snap) {
    var c = snap.val();
    var list = document.getElementById("teamList");
    list.innerHTML = "";
    if (!c) {
      for (var i = 0; i < NUM_TEAMS; i++) addTeamRow("", "");
      return;
    }
    document.getElementById("timerSeconds").value = c.timerSeconds || 90;
    (c.teams || []).forEach(function(t) { addTeamRow(t.name, t.password); });
  }).catch(function(e) {
    var list = document.getElementById("teamList");
    list.innerHTML = "";
    for (var i = 0; i < NUM_TEAMS; i++) addTeamRow("", "");
    throw e; // weiterreichen an .catch in commLogin für den Alert
  });
}

function addTeamRow(name, pw) {
  name = name || ""; pw = pw || "";
  var list = document.getElementById("teamList");
  var row  = document.createElement("div");
  row.className = "team-row";
  var inp1 = document.createElement("input");
  inp1.type = "text"; inp1.placeholder = "Teilnehmer Name"; inp1.value = name; inp1.className = "team-name-input";
  var inp2 = document.createElement("input");
  inp2.type = "text"; inp2.placeholder = "Passwort (optional)"; inp2.value = pw; inp2.className = "team-pw-input";
  row.appendChild(inp1); row.appendChild(inp2);
  list.appendChild(row);
}

window.saveDraftConfig = async function() {
  var timerSeconds = parseInt(document.getElementById("timerSeconds").value) || 90;
  var teamRows     = document.querySelectorAll(".team-row");
  var teams        = [];
  teamRows.forEach(function(row) {
    var n = row.querySelector(".team-name-input").value.trim();
    var p = row.querySelector(".team-pw-input").value.trim();
    if (n) teams.push({ name: n, password: p });
  });
  if (teams.length !== NUM_TEAMS) { alert("Es müssen genau " + NUM_TEAMS + " Teilnehmer eingetragen werden."); return; }

  try {
    await set(ref(db, ROOT + "/config"), { timerSeconds: timerSeconds, teams: teams });
    await set(ref(db, ROOT + "/state"), { phase: "lobby", timerValue: timerSeconds, teamNames: teams.map(function(t) { return t.name; }) });
    await remove(ref(db, ROOT + "/picks"));
    await set(ref(db, ROOT + "/ready"), null);
    alert("Konfiguration gespeichert! Teilnehmer können sich jetzt einloggen und bereit machen.");
  } catch (e) {
    console.error(e);
    alert("Firebase-Fehler beim Speichern: " + e.message + "\n\nWahrscheinlich erlauben deine Firebase-Regeln den Pfad 'final6/' noch nicht.");
  }
};

window.resetDraft = async function() {
  if (!confirm("Alles zurücksetzen?")) return;
  await remove(ref(db, ROOT + "/picks"));
  var snap = await get(ref(db, ROOT + "/config"));
  var c    = snap.val();
  if (!c) return;
  await set(ref(db, ROOT + "/state"), { phase: "lobby", timerValue: c.timerSeconds, teamNames: c.teams.map(function(t) { return t.name; }) });
  await set(ref(db, ROOT + "/ready"), null);
  alert("Zurückgesetzt.");
};

window.skipCurrentPick = async function() {
  var snap = await get(ref(db, ROOT + "/state"));
  var state = snap.val();
  if (!state || state.phase !== "draft") { alert("Draft läuft gerade nicht."); return; }
  await advancePick();
};

window.commStartDraft = async function() {
  var snap = await get(ref(db, ROOT + "/config"));
  var c = snap.val();
  if (!c) { alert("Erst Konfiguration speichern."); return; }
  var teamNames = c.teams.map(function(t) { return t.name; });
  pickOrder = buildRotatingOrder(teamNames, TOTAL_ROUNDS);
  await update(ref(db, ROOT + "/state"), {
    phase: "draft", timerValue: c.timerSeconds,
    order: pickOrder, currentPick: 1,
    totalPicks: teamNames.length * TOTAL_ROUNDS, onTheClock: pickOrder[0]
  });
  enterApp();
};

window.goToLobby = function() {
  set(ref(db, ROOT + "/ready"), null).then(function() {
    update(ref(db, ROOT + "/state"), { phase: "lobby" }).then(function() {
      goToScreen("lobbyScreen"); initLobby();
    });
  });
};

// ─────────────────────────────────────────────────────────────
// ENTER APP / ROUTING
// ─────────────────────────────────────────────────────────────
function enterApp() {
  get(ref(db, ROOT + "/state")).then(function(snap) {
    var state = snap.val();
    var phase = state ? state.phase : "lobby";
    var label = currentUser.isCommissioner ? "<strong>Commissioner</strong>" : "Eingeloggt als <strong>" + currentUser.team + "</strong>";
    var userInfo = document.getElementById("userInfo");
    if (userInfo) userInfo.innerHTML = label;
    applyRoleUI();
    routeToPhase(phase);
    subscribeToPhaseChanges();
  });
}

function routeToPhase(phase) {
  if (phase === "draft") { goToScreen("draftScreen"); initDraft(); }
  else                   { goToScreen("lobbyScreen"); initLobby(); }
}

var phaseSubscribed = false;
function subscribeToPhaseChanges() {
  if (phaseSubscribed) return;
  phaseSubscribed = true;
  onValue(ref(db, ROOT + "/state/phase"), function(snap) {
    var phase = snap.val();
    if (!phase) return;
    var target = phase === "draft" ? "draftScreen" : "lobbyScreen";
    if (!document.getElementById(target).classList.contains("active")) routeToPhase(phase);
  });
}

// ─────────────────────────────────────────────────────────────
// TIMER
// ─────────────────────────────────────────────────────────────
function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

function startTimer(displayId, onExpire) {
  stopTimer();
  timerInterval = setInterval(function() {
    timerValue--;
    if (timerValue < 0) { timerValue = 0; onExpire(); }
    var el = document.getElementById(displayId);
    if (el) { el.textContent = timerValue; el.classList.toggle("urgent", timerValue <= 10); }
    if (timerValue % 5 === 0) update(ref(db, ROOT + "/state"), { timerValue: timerValue });
  }, 1000);
}

// ─────────────────────────────────────────────────────────────
// LOBBY
// ─────────────────────────────────────────────────────────────
function initLobby() {
  var commView = document.getElementById("lobbyCommView");
  var teamView = document.getElementById("lobbyTeamView");
  if (commView) commView.style.display = currentUser.isCommissioner ? "block" : "none";
  if (teamView) teamView.style.display = currentUser.isCommissioner ? "none"  : "block";
  if (lobbyUnsubscribe) { lobbyUnsubscribe(); lobbyUnsubscribe = null; }

  get(ref(db, ROOT + "/config")).then(function(cSnap) {
    var c     = cSnap.val();
    var teams = c ? c.teams.map(function(t) { return t.name; }) : [];

    lobbyUnsubscribe = onValue(ref(db, ROOT + "/ready"), function(snap) {
      var data     = snap.val() || {};
      var ready    = Object.values(data).map(function(r) { return r.team; });
      var total    = teams.length;
      var allReady = total > 0 && ready.length >= total;

      function buildReadyList(listEl, countEl) {
        if (countEl) countEl.textContent = ready.length + " / " + total + " bereit";
        if (!listEl) return;
        listEl.innerHTML = "";
        teams.forEach(function(team) {
          var isReady = ready.includes(team);
          var item = document.createElement("div");
          item.className = "ready-item" + (isReady ? " is-ready" : "");
          item.innerHTML = "<span>" + team + "</span><span>" + (isReady ? "✅ Bereit" : "⏳ Wartet...") + "</span>";
          listEl.appendChild(item);
        });
      }

      buildReadyList(document.getElementById("readyList"), document.getElementById("readyCount"));
      buildReadyList(document.getElementById("commReadyList"), document.getElementById("commReadyCount"));

      var commStartBtn = document.getElementById("commStartBtn");
      if (commStartBtn) commStartBtn.disabled = !allReady;
      var startBtn  = document.getElementById("startDraftBtn");
      var startHint = document.getElementById("startHint");
      if (startBtn)  startBtn.disabled = !allReady;
      if (startHint) {
        startHint.textContent = allReady ? "Alle bereit — Draft kann starten!" : (total - ready.length) + " Teilnehmer noch nicht bereit.";
        startHint.style.color = allReady ? "#00e676" : "";
      }

      if (!currentUser.isCommissioner) {
        var myReady = ready.includes(currentUser.team);
        var readyBtn = document.getElementById("readyBtn");
        var readyConfirm = document.getElementById("readyConfirm");
        if (readyBtn) readyBtn.style.display = myReady ? "none" : "block";
        if (readyConfirm) readyConfirm.style.display = myReady ? "block" : "none";
      }
    });
  });
}

window.setReady = async function() {
  if (!currentUser || currentUser.isCommissioner) return;
  var snap = await get(ref(db, ROOT + "/ready"));
  var data = snap.val() || {};
  var already = Object.values(data).find(function(r) { return r.team === currentUser.team; });
  if (already) return;
  await push(ref(db, ROOT + "/ready"), { team: currentUser.team });
};

// ─────────────────────────────────────────────────────────────
// DRAFT PHASE
// ─────────────────────────────────────────────────────────────
function initDraft() {
  stopTimer();
  get(ref(db, ROOT + "/state")).then(function(snap) {
    var state = snap.val() || {};
    pickOrder = state.order || [];
    timerValue = state.timerValue || 90;
    document.getElementById("timer").textContent = timerValue;
    startTimer("timer", handleTimerExpired);
    subscribeDraftState();
    subscribePicks();
    renderCatTabs();
  });
}

function renderCatTabs() {
  var el = document.getElementById("catTabs");
  if (!el) return;
  el.innerHTML = "";
  ["Startelf", "Reserve", "Backup"].forEach(function(cat) {
    var tab = document.createElement("div");
    tab.className = "cat-tab";
    tab.textContent = cat + " (" + (cat === "Startelf" ? STARTELF_ROUNDS : cat === "Reserve" ? RESERVE_ROUNDS : BACKUP_ROUNDS) + " Runden)";
    el.appendChild(tab);
  });
}

function subscribeDraftState() {
  onValue(ref(db, ROOT + "/state"), function(snap) {
    var state = snap.val() || {};
    if (state.phase !== "draft") return;
    pickOrder = state.order || pickOrder;
    var currentPick = state.currentPick || 1;
    var totalPicks  = state.totalPicks || (NUM_TEAMS * TOTAL_ROUNDS);
    var round = Math.ceil(currentPick / NUM_TEAMS);
    var category = categoryForRound(round);
    var onClock = state.onTheClock || pickOrder[currentPick - 1];

    document.getElementById("categoryBadge").textContent = category.toUpperCase();
    document.getElementById("currentPickInfo").textContent =
      "Runde " + round + "/" + TOTAL_ROUNDS + " · Pick " + currentPick + "/" + totalPicks + " · Am Zug: " + onClock;

    if (currentPick > totalPicks) {
      document.getElementById("currentPickInfo").textContent = "🏁 Draft abgeschlossen!";
    }

    renderDraftOrder(currentPick);
    renderPlayers(onClock, currentPick <= totalPicks);
  });
}

function renderDraftOrder(currentPick) {
  var round = Math.ceil(currentPick / NUM_TEAMS);
  var startIdx = (round - 1) * NUM_TEAMS;
  var el = document.getElementById("draftOrder");
  if (!el) return;
  el.innerHTML = "";
  for (var i = 0; i < NUM_TEAMS; i++) {
    var pickNum = startIdx + i + 1;
    var team = pickOrder[pickNum - 1];
    if (!team) continue;
    var item = document.createElement("div");
    item.className = "order-item" + (pickNum < currentPick ? " done" : "") + (pickNum === currentPick ? " current" : "");
    item.innerHTML = "<span>#" + pickNum + " " + team + "</span>";
    el.appendChild(item);
  }
}

function subscribePicks() {
  onValue(ref(db, ROOT + "/picks"), function(snap) {
    var data = snap.val() || {};
    allPicks = Object.values(data).sort(function(a, b) { return a.pickNumber - b.pickNumber; });
    renderBoard();
  });
}

function renderBoard() {
  var tbody = document.getElementById("draftBoard");
  if (!tbody) return;
  tbody.innerHTML = "";
  allPicks.forEach(function(p) {
    var tr = document.createElement("tr");
    tr.innerHTML = "<td>" + p.pickNumber + " (" + p.category + ")</td><td>" + p.team + "</td><td>" + p.player + "</td>";
    tbody.appendChild(tr);
  });
}

var currentOnClock = null;
function renderPlayers(onClock, draftActive) {
  currentOnClock = onClock;
  var search = document.getElementById("playerSearch") ? document.getElementById("playerSearch").value.toLowerCase() : "";
  var pickedNames = allPicks.map(function(p) { return p.player; });
  var el = document.getElementById("players");
  if (!el) return;
  el.innerHTML = "";
  var isMyTurn = draftActive && currentUser && !currentUser.isCommissioner && currentUser.team === onClock;

  Object.keys(PLAYER_DATA).forEach(function(name) {
    if (pickedNames.includes(name)) return;
    if (search && !name.toLowerCase().includes(search)) return;
    var data = PLAYER_DATA[name];
    var row = document.createElement("div");
    row.className = "player-row";
    var left = document.createElement("div");
    left.innerHTML = "<div class='player-name'>" + name + "</div><div class='player-meta'>" + data.pos + " · " + data.club + "</div>";
    row.appendChild(left);
    if (isMyTurn) {
      var btn = document.createElement("button");
      btn.className = "pick-btn";
      btn.textContent = "Picken";
      btn.onclick = function(e) { e.stopPropagation(); makePick(name); };
      row.appendChild(btn);
    }
    el.appendChild(row);
  });
}

window.filterPlayers = function() { renderPlayers(currentOnClock, true); };

async function makePick(playerName) {
  var snap = await get(ref(db, ROOT + "/state"));
  var state = snap.val();
  if (!state || state.phase !== "draft") return;
  var currentPick = state.currentPick;
  var onClock = state.onTheClock;
  if (!currentUser || currentUser.team !== onClock) { alert("Du bist nicht am Zug."); return; }

  var picksSnap = await get(ref(db, ROOT + "/picks"));
  var picks = picksSnap.val() || {};
  var taken = Object.values(picks).some(function(p) { return p.player === playerName; });
  if (taken) { alert("Spieler bereits vergeben."); return; }

  var round = Math.ceil(currentPick / NUM_TEAMS);
  await push(ref(db, ROOT + "/picks"), {
    pickNumber: currentPick, round: round, category: categoryForRound(round),
    team: currentUser.team, player: playerName
  });
  await advancePick();
}

async function advancePick() {
  var snap = await get(ref(db, ROOT + "/state"));
  var state = snap.val();
  if (!state) return;
  var totalPicks = state.totalPicks;
  var nextPick = (state.currentPick || 1) + 1;
  var order = state.order || pickOrder;
  timerValue = state.timerValue0 || (draftConfig ? draftConfig.timerSeconds : 90);

  var cfgSnap = await get(ref(db, ROOT + "/config"));
  var cfg = cfgSnap.val();
  var freshTimer = cfg ? cfg.timerSeconds : 90;

  if (nextPick > totalPicks) {
    await update(ref(db, ROOT + "/state"), { currentPick: nextPick, onTheClock: null, timerValue: freshTimer });
  } else {
    await update(ref(db, ROOT + "/state"), { currentPick: nextPick, onTheClock: order[nextPick - 1], timerValue: freshTimer });
  }
  timerValue = freshTimer;
}

function handleTimerExpired() {
  stopTimer();
  if (currentUser && currentUser.isCommissioner) {
    advancePick();
  }
}

// ─────────────────────────────────────────────────────────────
// GLOBAL CONFIG SUBSCRIPTION
// ─────────────────────────────────────────────────────────────
onValue(ref(db, ROOT + "/config"), function(snap) { draftConfig = snap.val(); });
