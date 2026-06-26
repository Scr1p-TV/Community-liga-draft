import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, push, set, get, update, remove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { DEFAULT_PLAYERS, PLAYER_DATA } from "./players.js";

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

const COMMISSIONER_PASSWORD = "admin1234";

let currentUser     = null;
let draftConfig     = null;
let pickQueue       = [];
let timerValue      = 90;
let timerInterval   = null;
let allPicks        = [];
let allBans         = [];
let allSecurePicks  = [];   // [{ team, player }]
let activeRound     = 1;
let lastPickCount   = 0;
let lastBanCount    = 0;
let mySecurePick    = null;
let phaseSubscribed = false;

// ─────────────────────────────────────────────────────────────
// SCREENS
// ─────────────────────────────────────────────────────────────
window.showScreen = function(id) {
  // After login, only commissioner can navigate freely
  // Teams are locked to their current phase screen
  var freeScreens = ["loginScreen", "commissionerScreen"];
  if (currentUser && !currentUser.isCommissioner && !freeScreens.includes(id)) {
    // Teams can only be sent to phase screens by the system, not manually
    return;
  }
  document.querySelectorAll(".screen").forEach(function(s) { s.classList.remove("active"); });
  document.getElementById(id).classList.add("active");
};

// Internal navigation — bypasses lock, used by system only
function goToScreen(id) {
  document.querySelectorAll(".screen").forEach(function(s) { s.classList.remove("active"); });
  document.getElementById(id).classList.add("active");
}

// Commissioner back button — goes back to commissioner panel
window.commGoBack = function() {
  if (!currentUser || !currentUser.isCommissioner) return;
  goToScreen("commissionerScreen");
};

// Show/hide commissioner buttons and logout button based on role
function applyRoleUI() {
  var isComm = currentUser && currentUser.isCommissioner;
  // Commissioner back buttons
  ["commBackSecure", "commBackBan", "commBackDraft"].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = isComm ? "inline-flex" : "none";
  });
  // Logout button only for teams, not commissioner
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
  if (!name) { err.textContent = "Bitte Team-Namen eingeben."; return; }

  var snap   = await get(ref(db, "draftConfig"));
  var config = snap.val();
  if (!config) { err.textContent = "Kein Draft konfiguriert."; return; }

  var team = null;
  (config.teams || []).forEach(function(t) {
    if (t.name.toLowerCase() === name.toLowerCase()) team = t;
  });
  if (!team) { err.textContent = "Team nicht gefunden."; return; }
  if (team.password && team.password !== pw) { err.textContent = "Falsches Passwort."; return; }

  currentUser = { team: team.name, isCommissioner: false };
  enterAppInternal();
};

window.showCommissionerLogin = function() { showScreen("commissionerScreen"); };

window.commLogin = function() {
  var pw  = document.getElementById("commPassword").value;
  var err = document.getElementById("commError");
  if (pw !== COMMISSIONER_PASSWORD) { err.textContent = "Falsches Passwort."; return; }
  document.getElementById("commPanel").style.display = "block";
  currentUser = { team: "Commissioner", isCommissioner: true };
  loadCommissionerPanel();
  // Start ready listener immediately so commissioner sees team status in panel
  initLobby();
};

// ─────────────────────────────────────────────────────────────
// COMMISSIONER PANEL
// ─────────────────────────────────────────────────────────────
function loadCommissionerPanel() {
  get(ref(db, "draftConfig")).then(function(snap) {
    var c = snap.val();
    if (!c) {
      addTeamRow(); addTeamRow(); addTeamRow(); addTeamRow();
      document.getElementById("playerPool").value = DEFAULT_PLAYERS.join("\n");
      return;
    }
    document.getElementById("numRounds").value     = c.numRounds    || 1;
    document.getElementById("timerSeconds").value  = c.timerSeconds || 90;
    document.getElementById("snakeToggle").checked = c.snake !== false;
    var pool = (c.playerPool && c.playerPool.length > 20) ? c.playerPool : DEFAULT_PLAYERS;
    document.getElementById("playerPool").value = pool.join("\n");
    var list = document.getElementById("teamList");
    list.innerHTML = "";
    (c.teams || []).forEach(function(t) { addTeamRow(t.name, t.password); });
  });
}

window.addTeamRow = function(name, pw) {
  name = name || ""; pw = pw || "";
  var list = document.getElementById("teamList");
  var row  = document.createElement("div");
  row.className = "team-row";
  var inp1 = document.createElement("input");
  inp1.type = "text"; inp1.placeholder = "Team Name"; inp1.value = name; inp1.className = "team-name-input";
  var inp2 = document.createElement("input");
  inp2.type = "text"; inp2.placeholder = "Passwort (optional)"; inp2.value = pw; inp2.className = "team-pw-input";
  var btn = document.createElement("button");
  btn.className = "remove-team"; btn.textContent = "×";
  btn.onclick = function() { row.remove(); };
  row.appendChild(inp1); row.appendChild(inp2); row.appendChild(btn);
  list.appendChild(row);
};

window.saveDraftConfig = async function() {
  var numRounds    = parseInt(document.getElementById("numRounds").value)    || 1;
  var timerSeconds = parseInt(document.getElementById("timerSeconds").value) || 90;
  var snake        = document.getElementById("snakeToggle").checked;
  var playerPool   = document.getElementById("playerPool").value.split("\n").map(function(s) { return s.trim(); }).filter(Boolean);
  var teamRows     = document.querySelectorAll(".team-row");
  var teams        = [];
  teamRows.forEach(function(row) {
    var n = row.querySelector(".team-name-input").value.trim();
    var p = row.querySelector(".team-pw-input").value.trim();
    if (n) teams.push({ name: n, password: p });
  });
  if (teams.length < 2) { alert("Mindestens 2 Teams erforderlich."); return; }

  await set(ref(db, "draftConfig"), { numTeams: teams.length, numRounds: numRounds, timerSeconds: timerSeconds, snake: snake, playerPool: playerPool, teams: teams });
  await set(ref(db, "draftState"), {
    phase: "securePick", timerValue: timerSeconds,
    numTeams: teams.length, numRounds: numRounds, snake: snake,
    teamNames: teams.map(function(t) { return t.name; })
  });
  await remove(ref(db, "securePicks"));
  await remove(ref(db, "draftPicks"));
  await remove(ref(db, "banPicks"));
  await set(ref(db, "readyTeams"), null);
  // Set phase to lobby so teams see the ready screen
  await update(ref(db, "draftState"), { phase: "lobby" });
  alert("Konfiguration gespeichert! Teams können sich jetzt einloggen und bereit machen.");
};

window.resetDraft = async function() {
  if (!confirm("Alles zurücksetzen?")) return;
  await remove(ref(db, "securePicks"));
  await remove(ref(db, "draftPicks"));
  await remove(ref(db, "banPicks"));
  var snap = await get(ref(db, "draftConfig"));
  var c    = snap.val();
  if (!c) return;
  await set(ref(db, "draftState"), {
    phase: "securePick", timerValue: c.timerSeconds,
    numTeams: c.numTeams, numRounds: c.numRounds, snake: c.snake,
    teamNames: c.teams.map(function(t) { return t.name; })
  });
  await set(ref(db, "readyTeams"), null);
  await update(ref(db, "draftState"), { phase: "lobby" });
  mySecurePick = null;
  alert("Zurückgesetzt.");
};

window.skipCurrentAction = async function() {
  var snap = await get(ref(db, "draftState"));
  var state = snap.val();
  if (!state) return;
  if (state.phase === "ban") await advanceBan();
  else if (state.phase === "draft") await advancePick();
  else alert("In dieser Phase nicht möglich.");
};

window.commForcePhase = async function(phase) {
  var snap = await get(ref(db, "draftConfig"));
  var c    = snap.val();
  if (!c) { alert("Erst Konfiguration speichern."); return; }
  var teamNames = c.teams.map(function(t) { return t.name; });

  if (phase === "securePick") {
    await set(ref(db, "readyTeams"), null);
    await remove(ref(db, "securePicks"));
    await update(ref(db, "draftState"), { phase: "securePick", timerValue: c.timerSeconds, secureRevealed: false, secureConflicts: [] });
  } else if (phase === "ban") {
    var banOrder = teamNames.slice();
    await update(ref(db, "draftState"), { phase: "ban", timerValue: c.timerSeconds, banOrder: banOrder, currentBan: 1, onTheClock: banOrder[0] });
  } else if (phase === "draft") {
    var pickOrder = buildSnakeOrder(teamNames, c.numRounds, c.snake);
    await update(ref(db, "draftState"), {
      phase: "draft", timerValue: c.timerSeconds,
      order: pickOrder, currentPick: 1, totalPicks: teamNames.length * c.numRounds, onTheClock: pickOrder[0]
    });
  }
  enterAppInternal();
};

window.revealSecurePicks = async function() {
  var snap   = await get(ref(db, "securePicks"));
  var data   = snap.val() || {};
  var picks  = Object.values(data);
  var count  = {};
  picks.forEach(function(p) { count[p.player] = (count[p.player] || 0) + 1; });
  var conflicts = Object.keys(count).filter(function(pl) { return count[pl] > 1; });
  await update(ref(db, "draftState"), { secureRevealed: true, secureConflicts: conflicts });
  if (conflicts.length === 0) {
    alert("Keine Konflikte! Starte jetzt die Ban Phase.");
  } else {
    alert("Konflikte: " + conflicts.join(", ") + " — betroffene Teams wählen neu.");
  }
};

// ─────────────────────────────────────────────────────────────
// ORDER BUILDERS
// ─────────────────────────────────────────────────────────────
function buildSnakeOrder(teamNames, rounds, snake) {
  var order = [];
  for (var r = 0; r < rounds; r++) {
    var round = (snake && r % 2 === 1) ? teamNames.slice().reverse() : teamNames.slice();
    order = order.concat(round);
  }
  return order;
}

// ─────────────────────────────────────────────────────────────
// ENTER APP
// ─────────────────────────────────────────────────────────────
function enterApp() {
  get(ref(db, "draftState")).then(function(snap) {
    var state = snap.val();
    var phase = state ? state.phase : "lobby";
    var label = currentUser.isCommissioner ? "<strong>Commissioner</strong>" : "Eingeloggt als <strong>" + currentUser.team + "</strong>";
    ["secureUserInfo", "banUserInfo", "userInfo"].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = label;
    });
    applyRoleUI();

    // Route based on phase
    routeToPhase(phase);

    subscribeToPhaseChanges();
    subscribeAllSecurePicks();
  });
}

function enterAppInternal() {
  if (!currentUser) return;
  enterApp();
}

function routeToPhase(phase) {
  if (phase === "lobby")      { goToScreen("lobbyScreen");      initLobby(); }
  else if (phase === "securePick") { goToScreen("securePickScreen"); initSecurePick(); }
  else if (phase === "ban")   { goToScreen("banScreen");        initBan(); }
  else                        { goToScreen("draftScreen");      initDraft(); }
}

function subscribeToPhaseChanges() {
  if (phaseSubscribed) return;
  phaseSubscribed = true;
  onValue(ref(db, "draftState/phase"), function(snap) {
    var phase = snap.val();
    if (!phase) return;
    var screens = { securePick: "securePickScreen", ban: "banScreen", draft: "draftScreen" };
    var target  = screens[phase];
    if (target && !document.getElementById(target).classList.contains("active")) {
      routeToPhase(phase);
    }
  });
}

// Keep allSecurePicks always up to date (needed by draft phase)
function subscribeAllSecurePicks() {
  onValue(ref(db, "securePicks"), function(snap) {
    var data = snap.val() || {};
    allSecurePicks = Object.values(data);
  });
}

// ─────────────────────────────────────────────────────────────
// TIMER
// ─────────────────────────────────────────────────────────────
function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function startTimer(displayId, onExpire) {
  stopTimer();
  timerInterval = setInterval(function() {
    timerValue--;
    if (timerValue < 0) { timerValue = 0; onExpire(); }
    var el = document.getElementById(displayId);
    if (el) { el.textContent = timerValue; el.classList.toggle("urgent", timerValue <= 10); }
    if (timerValue % 5 === 0) update(ref(db, "draftState"), { timerValue: timerValue });
  }, 1000);
}

// ─────────────────────────────────────────────────────────────
// LOBBY — Ready Up
// ─────────────────────────────────────────────────────────────
var lobbyUnsubscribe = null;

function initLobby() {
  // Show correct view on lobby screen
  var commView = document.getElementById("lobbyCommView");
  var teamView = document.getElementById("lobbyTeamView");
  if (commView) commView.style.display = currentUser.isCommissioner ? "block" : "none";
  if (teamView) teamView.style.display = currentUser.isCommissioner ? "none"  : "block";

  // Unsubscribe previous listener to avoid duplicates
  if (lobbyUnsubscribe) { lobbyUnsubscribe(); lobbyUnsubscribe = null; }

  // Load teams from Firebase fresh, then subscribe to readyTeams
  get(ref(db, "draftConfig")).then(function(cSnap) {
    var c     = cSnap.val();
    var teams = c ? c.teams.map(function(t) { return t.name; }) : [];

    lobbyUnsubscribe = onValue(ref(db, "readyTeams"), function(snap) {
      var data     = snap.val() || {};
      var ready    = Object.values(data).map(function(r) { return r.team; });
      var total    = teams.length;
      var allReady = total > 0 && ready.length >= total;

      // Helper: build ready list HTML into any container element
      function buildReadyList(listEl, countEl) {
        if (countEl) countEl.textContent = ready.length + " / " + total + " bereit";
        if (!listEl) return;
        listEl.innerHTML = "";
        teams.forEach(function(team) {
          var isReady  = ready.includes(team);
          var item     = document.createElement("div");
          item.className = "ready-item" + (isReady ? " is-ready" : "");
          var nameEl   = document.createElement("span"); nameEl.className = "ri-name"; nameEl.textContent = team;
          var statusEl = document.createElement("span"); statusEl.className = "ri-status";
          statusEl.textContent = isReady ? "✅ Bereit" : "⏳ Wartet...";
          item.appendChild(nameEl); item.appendChild(statusEl);
          listEl.appendChild(item);
        });
      }

      // Write to lobby screen elements
      buildReadyList(
        document.getElementById("readyList"),
        document.getElementById("readyCount")
      );

      // ALSO write to commissioner panel elements (always visible to commissioner)
      buildReadyList(
        document.getElementById("commReadyList"),
        document.getElementById("commReadyCount")
      );

      // Commissioner panel start button
      var commStartBtn = document.getElementById("commStartBtn");
      if (commStartBtn) commStartBtn.disabled = !allReady;

      // Lobby screen commissioner controls
      var startBtn  = document.getElementById("startDraftBtn");
      var startHint = document.getElementById("startHint");
      if (startBtn)  startBtn.disabled = !allReady;
      if (startHint) {
        startHint.textContent = allReady
          ? "Alle Teams sind bereit — Draft kann starten!"
          : (total - ready.length) + " Team(s) noch nicht bereit.";
        startHint.style.color = allReady ? "#22c55e" : "";
      }

      // Team: toggle ready button
      if (!currentUser.isCommissioner) {
        var myReady      = ready.includes(currentUser.team);
        var readyBtn     = document.getElementById("readyBtn");
        var readyConfirm = document.getElementById("readyConfirm");
        if (readyBtn)     readyBtn.style.display     = myReady ? "none"  : "block";
        if (readyConfirm) readyConfirm.style.display = myReady ? "block" : "none";
      }
    });
  });
}

window.setReady = async function() {
  if (!currentUser || currentUser.isCommissioner) return;

  // Check not already ready
  var snap = await get(ref(db, "readyTeams"));
  var data = snap.val() || {};
  var already = Object.values(data).find(function(r) { return r.team === currentUser.team; });
  if (already) return;

  await push(ref(db, "readyTeams"), { team: currentUser.team });
};

window.goToLobby = function() {
  // Reset ready teams and navigate to lobby
  set(ref(db, "readyTeams"), null).then(function() {
    update(ref(db, "draftState"), { phase: "lobby" }).then(function() {
      goToScreen("lobbyScreen");
      initLobby();
    });
  });
};

// Also allow commissioner to see lobby without resetting
window.viewLobby = function() {
  goToScreen("lobbyScreen");
  initLobby();
};

// readyTeams reset is now handled directly inside commForcePhase

// ─────────────────────────────────────────────────────────────
// PHASE 1 — SECURE PICK
// ─────────────────────────────────────────────────────────────
function initSecurePick() {
  stopTimer();
  mySecurePick = null;
  document.getElementById("secureMyPick").style.display = "none";
  document.getElementById("secureResultsPanel").style.display = "none";
  get(ref(db, "draftState")).then(function(snap) {
    var state = snap.val() || {};
    timerValue = state.timerValue || 90;
    document.getElementById("secureTimer").textContent = timerValue;
    renderSecurePlayers([]);
    startTimer("secureTimer", handleSecureTimerExpired);
    subscribeSecureStatus();
    subscribeSecureReveal();
  });
}

function subscribeSecureStatus() {
  var lastSecureCount = 0;
  onValue(ref(db, "securePicks"), function(snap) {
    var data  = snap.val() || {};
    var picks = Object.values(data);

    // Only update allSecurePicks — DON'T expose names to teams before reveal
    allSecurePicks = picks;

    get(ref(db, "draftConfig")).then(function(cSnap) {
      var c = cSnap.val();
      if (!c) return;
      var total = c.teams.length;
      var el    = document.getElementById("secureStatus");

      // Show only COUNT, never names
      if (el) el.textContent = picks.length + " / " + total + " Teams haben gewählt";
    });

    // Show my own pick confirmation — but nothing about others
    if (mySecurePick) {
      document.getElementById("secureMyPick").style.display = "block";
      document.getElementById("secureMyPickName").textContent = mySecurePick;
    }

    // Animation only for commissioner (they see everything)
    if (picks.length > lastSecureCount && lastSecureCount >= 0 && currentUser && currentUser.isCommissioner) {
      var newest = picks[picks.length - 1];
      if (newest) showPickAnimation({ pickNumber: picks.length, team: newest.team, player: newest.player, round: "" }, "SECURE");
    }
    lastSecureCount = picks.length;
  });
}

function subscribeSecureReveal() {
  onValue(ref(db, "draftState/secureRevealed"), function(snap) {
    if (!snap.val()) return;
    get(ref(db, "draftState")).then(function(snap2) {
      var state     = snap2.val() || {};
      var conflicts = state.secureConflicts || [];
      showSecureResults(conflicts);
    });
  });
}

function renderSecurePlayers(lockedPlayers) {
  if (mySecurePick) return;
  if (!draftConfig) {
    get(ref(db, "draftConfig")).then(function(snap) { draftConfig = snap.val(); renderSecurePlayers(lockedPlayers); });
    return;
  }
  var search = document.getElementById("secureSearch") ? document.getElementById("secureSearch").value.toLowerCase() : "";
  var el = document.getElementById("securePlayers");
  if (!el) return;
  el.innerHTML = "";
  (draftConfig.playerPool || []).filter(function(p) {
    return !lockedPlayers.includes(p) && p.toLowerCase().includes(search);
  }).forEach(function(player) {
    var div = document.createElement("div");
    div.className = "player";
    var nameSpan = document.createElement("span");
    nameSpan.className = "player-name"; nameSpan.textContent = player;
    var secureActions = document.createElement("div"); secureActions.className = "player-actions";
    var cBtnS = document.createElement("button"); cBtnS.className = "btn-card"; cBtnS.textContent = "🃏";
    cBtnS.onclick = (function(p) { return function(e) { e.stopPropagation(); window.showCard(p); }; })(player);
    var btn = document.createElement("button");
    btn.className = "btn-draft"; btn.textContent = "Wählen";
    btn.onclick = (function(p) { return function() { securePickPlayer(p); }; })(player);
    secureActions.appendChild(cBtnS); secureActions.appendChild(btn);
    div.appendChild(nameSpan); div.appendChild(secureActions);
    el.appendChild(div);
  });
}

window.filterSecurePlayers = function() { renderSecurePlayers([]); };

window.securePickPlayer = async function(player) {
  if (mySecurePick) { alert("Du hast bereits gewählt."); return; }
  if (currentUser.isCommissioner) { alert("Commissioner kann nicht picken."); return; }
  var snap = await get(ref(db, "securePicks"));
  var data = snap.val() || {};
  var existing = Object.values(data).find(function(p) { return p.team === currentUser.team; });
  if (existing) { alert("Du hast bereits gewählt: " + existing.player); return; }

  await push(ref(db, "securePicks"), { team: currentUser.team, player: player });
  mySecurePick = player;
  document.getElementById("secureMyPick").style.display = "block";
  document.getElementById("secureMyPickName").textContent = player;
  renderSecurePlayers([]);

  // Auto-reveal when all teams picked
  var configSnap  = await get(ref(db, "draftConfig"));
  var config      = configSnap.val();
  var newSnap     = await get(ref(db, "securePicks"));
  var newData     = newSnap.val() || {};
  if (config && Object.keys(newData).length >= config.teams.length) {
    await window.revealSecurePicks();
  }
};

function showSecureResults(conflicts) {
  stopTimer();
  document.getElementById("secureResultsPanel").style.display = "block";
  get(ref(db, "securePicks")).then(function(snap) {
    var data  = snap.val() || {};
    var picks = Object.values(data);
    var el    = document.getElementById("secureResults");
    el.innerHTML = "";
    picks.forEach(function(p) {
      var isConflict = conflicts.includes(p.player);
      var row = document.createElement("div");
      row.className = "secure-result-row " + (isConflict ? "conflict" : "safe");
      var teamSpan   = document.createElement("span"); teamSpan.className = "sr-team"; teamSpan.textContent = p.team;
      var arrow      = document.createElement("span"); arrow.className = "sr-arrow"; arrow.textContent = "→";
      var playerSpan = document.createElement("span"); playerSpan.className = "sr-player"; playerSpan.textContent = p.player;
      var badge      = document.createElement("span"); badge.className = "sr-badge " + (isConflict ? "conflict-badge" : "safe-badge");
      badge.textContent = isConflict ? "⚠️ KONFLIKT" : "✅ SICHER";
      row.appendChild(teamSpan); row.appendChild(arrow); row.appendChild(playerSpan); row.appendChild(badge);
      el.appendChild(row);
    });

    var conflictEl = document.getElementById("secureConflict");
    if (conflicts.length > 0) {
      conflictEl.style.display = "block";
      document.getElementById("conflictMsg").textContent = "Konflikte bei: " + conflicts.join(", ");
      // Let conflicted teams re-pick
      if (!currentUser.isCommissioner) {
        var myEntry = picks.find(function(p) { return p.team === currentUser.team && conflicts.includes(p.player); });
        if (myEntry) {
          // Remove old pick
          get(ref(db, "securePicks")).then(function(s) {
            var d = s.val() || {};
            Object.entries(d).forEach(function(pair) {
              if (pair[1].team === currentUser.team) remove(ref(db, "securePicks/" + pair[0]));
            });
          });
          mySecurePick = null;
          document.getElementById("secureMyPick").style.display = "none";
          // Reset reveal for re-pick round
          update(ref(db, "draftState"), { secureRevealed: false, secureConflicts: [] });
          timerValue = draftConfig ? draftConfig.timerSeconds : 90;
          startTimer("secureTimer", handleSecureTimerExpired);
          var nonConflict = picks.filter(function(p) { return !conflicts.includes(p.player); }).map(function(p) { return p.player; });
          renderSecurePlayers(nonConflict);
        }
      }
    } else {
      conflictEl.style.display = "none";
    }
  });
}

async function handleSecureTimerExpired() {
  if (currentUser.isCommissioner || mySecurePick) return;
  var snap   = await get(ref(db, "draftConfig"));
  var config = snap.val();
  if (!config) return;
  var takenSnap = await get(ref(db, "securePicks"));
  var taken     = Object.values(takenSnap.val() || {}).map(function(p) { return p.player; });
  var available = (config.playerPool || []).filter(function(p) { return !taken.includes(p); });
  if (available.length > 0) await window.securePickPlayer(available[0]);
}

// ─────────────────────────────────────────────────────────────
// PHASE 2 — BAN PHASE
// ─────────────────────────────────────────────────────────────
function initBan() {
  stopTimer();
  get(ref(db, "draftState")).then(function(snap) {
    var state  = snap.val() || {};
    timerValue = state.timerValue || 90;
    document.getElementById("banTimer").textContent = timerValue;
    startTimer("banTimer", handleBanTimerExpired);
    subscribeBanState();
    subscribeBanPicks();
  });
}

function subscribeBanState() {
  onValue(ref(db, "draftState"), function(snap) {
    var state = snap.val();
    if (!state || state.phase !== "ban") return;
    timerValue = state.timerValue || 90;
    var el = document.getElementById("banPickInfo");
    if (el) el.innerHTML = "Ban " + state.currentBan + "<br><strong>On the Clock: " + (state.onTheClock || "—") + "</strong>";
    var banTeamEl = document.getElementById("banCurrentTeam");
    if (banTeamEl) {
      if (state.onTheClock === currentUser.team) {
        banTeamEl.innerHTML = "<span class='your-turn'>🔴 Du bist dran!</span>";
      } else {
        banTeamEl.innerHTML = "Wartet auf: <strong>" + state.onTheClock + "</strong>";
      }
    }
    renderBanOrder(state);
  });
}

function subscribeBanPicks() {
  onValue(ref(db, "banPicks"), function(snap) {
    var data = snap.val() || {};
    var bans = Object.values(data).map(function(b, i) { return Object.assign({}, b, { num: i + 1 }); });
    if (bans.length > lastBanCount && lastBanCount >= 0) showPickAnimation(bans[bans.length - 1], "BAN");
    lastBanCount = bans.length;
    allBans = bans;
    var tbody = document.getElementById("banBoard");
    if (tbody) {
      tbody.innerHTML = "";
      bans.forEach(function(b) {
        var row = document.createElement("tr");
        var td1 = document.createElement("td"); td1.textContent = b.num;
        var td2 = document.createElement("td"); td2.textContent = b.team;
        var td3 = document.createElement("td"); td3.className = "banned-player"; td3.textContent = b.player;
        row.appendChild(td1); row.appendChild(td2); row.appendChild(td3);
        tbody.appendChild(row);
      });
    }
    renderBanPlayers(bans.map(function(b) { return b.player; }));
  });
}

function renderBanOrder(state) {
  var el = document.getElementById("banOrder");
  if (!el || !state.banOrder) return;
  el.innerHTML = "";
  var idx = state.currentBan - 1;
  state.banOrder.slice(idx, idx + 6).forEach(function(team, i) {
    var item = document.createElement("div");
    item.className = "order-item" + (i === 0 ? " on-clock" : "");
    var dot  = document.createElement("div"); dot.className = "order-dot";
    var name = document.createElement("div"); name.className = "order-name"; name.textContent = team;
    var num  = document.createElement("div"); num.className = "order-pick-num"; num.textContent = "Ban " + (state.currentBan + i);
    item.appendChild(dot); item.appendChild(name); item.appendChild(num);
    el.appendChild(item);
  });
}

function renderBanPlayers(bannedPlayers) {
  if (!draftConfig) return;
  var search = document.getElementById("banSearch") ? document.getElementById("banSearch").value.toLowerCase() : "";
  var el = document.getElementById("banPlayers");
  if (!el) return;
  el.innerHTML = "";

  // Always reload secure picks fresh from Firebase to avoid timing issues
  get(ref(db, "securePicks")).then(function(snap) {
    var secureData = snap.val() || {};
    var secured    = Object.values(secureData).map(function(s) { return s.player; });
    // Update global too
    allSecurePicks = Object.values(secureData);

    var excluded = bannedPlayers.concat(secured);
    (draftConfig.playerPool || []).filter(function(p) {
      return !excluded.includes(p) && p.toLowerCase().includes(search);
    }).forEach(function(player) {
      var div = document.createElement("div");
      div.className = "player";
      var nameSpan = document.createElement("span"); nameSpan.className = "player-name"; nameSpan.textContent = player;
      var btn = document.createElement("button"); btn.className = "btn-ban"; btn.textContent = "Bannen";
      btn.onclick = (function(p) { return function() { window.handleBanClick(p); }; })(player);
      div.appendChild(nameSpan); div.appendChild(btn);
      el.appendChild(div);
    });
  });
}

window.filterBanPlayers = function() { renderBanPlayers(allBans.map(function(b) { return b.player; })); };

window.handleBanClick = async function(player) {
  var snap  = await get(ref(db, "draftState"));
  var state = snap.val();
  if (!state || state.phase !== "ban") return;
  if (!currentUser.isCommissioner && state.onTheClock !== currentUser.team) { alert("Du bist nicht dran!"); return; }

  // Server-side validation: reload secure picks fresh from Firebase
  var secureSnap   = await get(ref(db, "securePicks"));
  var secureData   = secureSnap.val() || {};
  var securedList  = Object.values(secureData).map(function(s) { return s.player; });

  // Server-side validation: already banned
  var banSnap      = await get(ref(db, "banPicks"));
  var banData      = banSnap.val() || {};
  var bannedList   = Object.values(banData).map(function(b) { return b.player; });

  if (securedList.includes(player)) {
    alert("'" + player + "' ist ein Secure Pick und kann nicht gebannt werden!");
    return;
  }
  if (bannedList.includes(player)) {
    alert("'" + player + "' wurde bereits gebannt!");
    return;
  }

  await push(ref(db, "banPicks"), { team: state.onTheClock, player: player });
  await advanceBan();
};

async function advanceBan() {
  var snap  = await get(ref(db, "draftState"));
  var state = snap.val();
  if (!state) return;
  var nextBan  = state.currentBan + 1;
  var nextTeam = state.banOrder[nextBan - 1] || null;
  timerValue = draftConfig ? draftConfig.timerSeconds : 90;
  if (!nextTeam) { await window.commForcePhase("draft"); return; }
  await update(ref(db, "draftState"), { currentBan: nextBan, onTheClock: nextTeam, timerValue: timerValue });
}

async function handleBanTimerExpired() {
  var snap  = await get(ref(db, "draftState"));
  var state = snap.val();
  if (!state || state.onTheClock !== currentUser.team) return;
  var bansSnap  = await get(ref(db, "banPicks"));
  var banned    = Object.values(bansSnap.val() || {}).map(function(b) { return b.player; });
  var secured   = allSecurePicks.map(function(s) { return s.player; });
  var excluded  = banned.concat(secured);
  var available = (draftConfig.playerPool || []).filter(function(p) { return !excluded.includes(p); });
  if (available.length > 0) await window.handleBanClick(available[0]);
}

// ─────────────────────────────────────────────────────────────
// PHASE 3 — DRAFT PHASE
// ─────────────────────────────────────────────────────────────
function initDraft() {
  stopTimer();
  get(ref(db, "draftState")).then(function(snap) {
    var state  = snap.val() || {};
    timerValue = state.timerValue || 90;
    document.getElementById("timer").textContent = timerValue;
    startTimer("timer", handleDraftTimerExpired);
    subscribeDraftState();
    subscribeDraftPicks();
  });
}

function subscribeDraftState() {
  onValue(ref(db, "draftState"), function(snap) {
    var state = snap.val();
    if (!state || state.phase !== "draft") return;
    timerValue = state.timerValue || 90;
    var numTeams = state.numTeams || 1;
    var round    = Math.ceil(state.currentPick / numTeams);
    document.getElementById("currentPickInfo").innerHTML =
      "Runde " + round + " &middot; Pick " + state.currentPick +
      "<br><strong>On the Clock: " + (state.onTheClock || "—") + "</strong>";
    renderDraftOrder(state);
  });
}

function subscribeDraftPicks() {
  onValue(ref(db, "draftPicks"), function(snap) {
    var data  = snap.val() || {};
    var picks = Object.values(data).map(function(p, i) { return Object.assign({}, p, { pickNumber: i + 1 }); });
    if (picks.length > lastPickCount && lastPickCount > 0) showPickAnimation(picks[picks.length - 1], "PICK");
    lastPickCount = picks.length;
    allPicks = picks;
    renderDraftBoard(picks);
    renderDraftPlayers(picks.map(function(p) { return p.player; }));
    renderPickQueue();
  });
}

// ── DRAFT BOARD — shows Secure Pick row per team + draft picks ──
function renderDraftBoard(picks) {
  var tbody = document.getElementById("draftBoard");
  if (!tbody) return;
  tbody.innerHTML = "";

  var numRounds = draftConfig ? draftConfig.numRounds : 1;
  var tabsEl    = document.getElementById("roundTabs");

  // Tabs: "Secure" + rounds
  var totalTabs = numRounds + 1;
  if (tabsEl && tabsEl.children.length !== totalTabs) {
    tabsEl.innerHTML = "";
    // Secure tab
    (function() {
      var tab = document.createElement("div");
      tab.className = "round-tab" + (activeRound === 0 ? " active secure-tab" : "");
      tab.textContent = "🔒 Secure";
      tab.onclick = function() {
        activeRound = 0;
        document.querySelectorAll(".round-tab").forEach(function(t, i) { t.classList.toggle("active", i === 0); });
        renderDraftBoard(allPicks);
      };
      tabsEl.appendChild(tab);
    })();
    for (var r = 1; r <= numRounds; r++) {
      (function(round) {
        var tab = document.createElement("div");
        tab.className = "round-tab" + (round === activeRound ? " active" : "");
        tab.textContent = "R" + round;
        tab.onclick = function() {
          activeRound = round;
          document.querySelectorAll(".round-tab").forEach(function(t, i) { t.classList.toggle("active", i === round); });
          renderDraftBoard(allPicks);
        };
        tabsEl.appendChild(tab);
      })(r);
    }
  }

  if (activeRound === 0) {
    // Show secure picks
    allSecurePicks.forEach(function(sp) {
      var row = document.createElement("tr");
      row.className = "secure-pick-row" + (sp.team === currentUser.team ? " my-pick" : "");
      var td1 = document.createElement("td"); td1.textContent = "🔒";
      var td2 = document.createElement("td"); td2.textContent = sp.team;
      var td3 = document.createElement("td"); td3.textContent = sp.player;
      row.appendChild(td1); row.appendChild(td2); row.appendChild(td3);
      tbody.appendChild(row);
    });
  } else {
    // Show draft picks for active round
    picks.filter(function(p) { return p.round === activeRound; }).forEach(function(pick) {
      var row = document.createElement("tr");
      if (pick.team === currentUser.team) row.className = "my-pick";
      if (pick.pickNumber === picks.length) row.classList.add("new-pick");
      var td1 = document.createElement("td"); td1.textContent = pick.pickNumber;
      var td2 = document.createElement("td"); td2.textContent = pick.team;
      var td3 = document.createElement("td"); td3.textContent = pick.player;
      row.appendChild(td1); row.appendChild(td2); row.appendChild(td3);
      tbody.appendChild(row);
    });
  }
}

// ── DRAFT PLAYERS — exclude secured + banned + drafted from pool ──
function renderDraftPlayers(draftedPlayers) {
  if (!draftConfig) return;
  var search = document.getElementById("playerSearch") ? document.getElementById("playerSearch").value.toLowerCase() : "";
  var el     = document.getElementById("players");
  if (!el) return;
  el.innerHTML = "";

  // Always reload all exclusion lists fresh from Firebase
  Promise.all([
    get(ref(db, "securePicks")),
    get(ref(db, "banPicks")),
    get(ref(db, "draftPicks"))
  ]).then(function(results) {
    var securedList = Object.values(results[0].val() || {}).map(function(s) { return s.player; });
    var bannedList  = Object.values(results[1].val() || {}).map(function(b) { return b.player; });
    var draftedList = Object.values(results[2].val() || {}).map(function(p) { return p.player; });

    // Update globals
    allSecurePicks = Object.values(results[0].val() || {});
    allBans        = Object.values(results[1].val() || {}).map(function(b, i) { return Object.assign({}, b, { num: i + 1 }); });

    // Pool = all MINUS secured MINUS banned MINUS drafted
    (draftConfig.playerPool || []).filter(function(p) {
      return !securedList.includes(p) &&
             !bannedList.includes(p)  &&
             !draftedList.includes(p) &&
             p.toLowerCase().includes(search);
    }).forEach(function(player) {
      var inQueue  = pickQueue.includes(player);
      var div      = document.createElement("div");
      div.className = "player";
      var nameSpan = document.createElement("span"); nameSpan.className = "player-name"; nameSpan.textContent = player;
      var actions  = document.createElement("div"); actions.className = "player-actions";
      var qBtn = document.createElement("button");
      qBtn.className = "btn-queue" + (inQueue ? " queued" : "");
      qBtn.textContent = "★";
      qBtn.onclick = (function(p) { return function() { window.toggleQueue(p); }; })(player);
      var dBtn = document.createElement("button");
      dBtn.className = "btn-draft"; dBtn.textContent = "Draften";
      dBtn.onclick = (function(p) { return function() { window.handleDraftClick(p); }; })(player);
      actions.appendChild(qBtn); actions.appendChild(dBtn);
      div.appendChild(nameSpan); div.appendChild(actions);
      el.appendChild(div);
    });
  });
}

window.filterPlayers    = function() { renderDraftPlayers(allPicks.map(function(p) { return p.player; })); };
window.handleDraftClick = async function(player) { await executePick(player); };

async function executePick(player) {
  var snap  = await get(ref(db, "draftState"));
  var state = snap.val();
  if (!state || state.phase !== "draft") return;
  if (!currentUser.isCommissioner && state.onTheClock !== currentUser.team) { alert("Du bist nicht dran!"); return; }

  // Server-side validation: reload all exclusion lists fresh from Firebase
  var secureSnap  = await get(ref(db, "securePicks"));
  var securedList = Object.values(secureSnap.val() || {}).map(function(s) { return s.player; });

  var banSnap     = await get(ref(db, "banPicks"));
  var bannedList  = Object.values(banSnap.val() || {}).map(function(b) { return b.player; });

  var draftSnap   = await get(ref(db, "draftPicks"));
  var draftedList = Object.values(draftSnap.val() || {}).map(function(p) { return p.player; });

  if (securedList.includes(player)) {
    alert("'" + player + "' ist ein Secure Pick und kann nicht gedraftet werden!");
    return;
  }
  if (bannedList.includes(player)) {
    alert("'" + player + "' wurde gebannt und kann nicht gedraftet werden!");
    return;
  }
  if (draftedList.includes(player)) {
    alert("'" + player + "' wurde bereits gedraftet!");
    return;
  }

  await push(ref(db, "draftPicks"), {
    team: state.onTheClock, player: player,
    pick: state.currentPick, round: Math.ceil(state.currentPick / state.numTeams)
  });
  await advancePick();
}

async function advancePick() {
  var snap  = await get(ref(db, "draftState"));
  var state = snap.val();
  if (!state) return;
  var nextPick = state.currentPick + 1;
  var nextTeam = state.order[nextPick - 1] || null;
  timerValue = draftConfig ? draftConfig.timerSeconds : 90;
  await update(ref(db, "draftState"), { currentPick: nextPick, onTheClock: nextTeam, timerValue: timerValue });
}

async function handleDraftTimerExpired() {
  var snap  = await get(ref(db, "draftState"));
  var state = snap.val();
  if (!state || state.onTheClock !== currentUser.team) return;
  if (pickQueue.length > 0) {
    var dSnap   = await get(ref(db, "draftPicks"));
    var drafted = Object.values(dSnap.val() || {}).map(function(p) { return p.player; });
    var secured = allSecurePicks.map(function(s) { return s.player; });
    var banned  = allBans.map(function(b) { return b.player; });
    for (var i = 0; i < pickQueue.length; i++) {
      if (!drafted.includes(pickQueue[i]) && !secured.includes(pickQueue[i]) && !banned.includes(pickQueue[i])) {
        var next = pickQueue[i];
        await executePick(next);
        pickQueue = pickQueue.filter(function(p) { return p !== next; });
        renderPickQueue();
        return;
      }
    }
  }
  if (currentUser.isCommissioner) await advancePick();
}

// ── DRAFT ORDER ──
function renderDraftOrder(state) {
  var el = document.getElementById("draftOrder");
  if (!el || !state.order) return;
  el.innerHTML = "";
  var idx = state.currentPick - 1;
  state.order.slice(idx, idx + 6).forEach(function(team, i) {
    var item = document.createElement("div");
    item.className = "order-item" + (i === 0 ? " on-clock" : "");
    var dot  = document.createElement("div"); dot.className = "order-dot";
    var name = document.createElement("div"); name.className = "order-name"; name.textContent = team;
    var num  = document.createElement("div"); num.className = "order-pick-num"; num.textContent = "Pick " + (state.currentPick + i);
    item.appendChild(dot); item.appendChild(name); item.appendChild(num);
    el.appendChild(item);
  });
}

// ── PICK QUEUE ──
window.toggleQueue = function(player) {
  if (pickQueue.includes(player)) {
    pickQueue = pickQueue.filter(function(p) { return p !== player; });
  } else {
    pickQueue.push(player);
  }
  renderDraftPlayers(allPicks.map(function(p) { return p.player; }));
  renderPickQueue();
};

function renderPickQueue() {
  var el      = document.getElementById("pickQueue");
  var emptyEl = document.getElementById("queueEmpty");
  if (!el) return;
  el.innerHTML = "";
  var drafted = allPicks.map(function(p) { return p.player; });
  var secured = allSecurePicks.map(function(s) { return s.player; });
  var banned  = allBans.map(function(b) { return b.player; });
  pickQueue   = pickQueue.filter(function(p) { return !drafted.includes(p) && !secured.includes(p) && !banned.includes(p); });
  if (pickQueue.length === 0) { if (emptyEl) emptyEl.style.display = "block"; return; }
  if (emptyEl) emptyEl.style.display = "none";
  pickQueue.forEach(function(player, i) {
    var item = document.createElement("div"); item.className = "queue-item";
    var pos  = document.createElement("div"); pos.className = "queue-pos"; pos.textContent = i + 1;
    var name = document.createElement("div"); name.className = "queue-name"; name.textContent = player;
    var rm   = document.createElement("button"); rm.className = "queue-remove"; rm.textContent = "×";
    rm.onclick = (function(p) { return function() { window.removeFromQueue(p); }; })(player);
    item.appendChild(pos); item.appendChild(name); item.appendChild(rm);
    el.appendChild(item);
  });
}

window.removeFromQueue = function(player) {
  pickQueue = pickQueue.filter(function(p) { return p !== player; });
  renderDraftPlayers(allPicks.map(function(p) { return p.player; }));
  renderPickQueue();
};

// ── ANIMATION ──
function showPickAnimation(pick, type) {
  var overlay = document.getElementById("pickOverlay");
  var card    = overlay.querySelector(".pick-card");

  // Badge text
  var badgeText = type === "SECURE" ? "🔒 SECURE PICK" : type === "BAN" ? "🚫 BAN " + (pick.num || "") : "PICK " + (pick.pickNumber || "");
  document.getElementById("overlayBadge").textContent  = badgeText;
  document.getElementById("overlayTeam").textContent   = pick.team;
  document.getElementById("overlayPlayer").textContent = pick.player;
  document.getElementById("overlayRound").textContent  =
    type === "BAN"    ? "Ban Phase" :
    type === "SECURE" ? "Secure Pick" :
    "Runde " + (pick.round || "");

  // Color per type
  card.classList.remove("card-secure", "card-ban", "card-draft");
  if (type === "SECURE") card.classList.add("card-secure");
  else if (type === "BAN") card.classList.add("card-ban");
  else card.classList.add("card-draft");

  overlay.classList.add("active");
  setTimeout(function() { overlay.classList.remove("active"); }, 3500);
  overlay.onclick = function() { overlay.classList.remove("active"); };
}

// ── Global config subscription ──
onValue(ref(db, "draftConfig"), function(snap) { draftConfig = snap.val(); });

// ─────────────────────────────────────────────────────────────
// PLAYER CARD
// ─────────────────────────────────────────────────────────────

// Nation code map for flag images (flagcdn.com uses ISO 3166-1 alpha-2)
var NATION_CODE = {
  "Frankreich": "fr", "England": "gb-eng", "Spanien": "es", "Deutschland": "de",
  "Brasilien": "br", "Argentinien": "ar", "Portugal": "pt", "Niederlande": "nl",
  "Belgien": "be", "Norwegen": "no", "Polen": "pl", "Kroatien": "hr",
  "Dänemark": "dk", "Uruguay": "uy", "Kolumbien": "co", "Schweiz": "ch",
  "Österreich": "at", "Türkei": "tr", "Ungarn": "hu", "Schottland": "gb-sct",
  "Ägypten": "eg", "Marokko": "ma", "Senegal": "sn", "Nigeria": "ng",
  "Kamerun": "cm", "Ghana": "gh", "Elfenbeinküste": "ci", "Georgien": "ge",
  "Südkorea": "kr", "Japan": "jp", "USA": "us", "Kanada": "ca",
  "Mexiko": "mx", "Ecuador": "ec", "Guinea": "gn", "Serbien": "rs",
  "Slowenien": "si", "Slowakei": "sk", "Armenien": "am", "Ukraine": "ua",
  "Italien": "it", "Schweden": "se", "Finnland": "fi", "Norwegen": "no",
  "Russland": "ru", "Tschechien": "cz", "Rumänien": "ro", "Griechenland": "gr",
};

var LIGA_FLAG = {
  "England 1": "gb-eng",
  "England 2": "gb-eng",
  "Spanien 1": "es",
  "Spanien 2": "es",
  "Italien 1": "it",
  "Italien 2": "it",
  "Niederlande 1": "nl",
  "Portugal 1": "pt",
  "Österreich 1": "at",
  "Belgien 1": "be",
  "Frankreich 1": "fr",
  "Polen 1": "pl",
  "Schweiz 1": "ch",
  "Rest der Welt": "un",
};

window.showCard = function(playerName) {
  var data  = PLAYER_DATA[playerName];
  var modal = document.getElementById("cardModal");
  if (!modal) return;

  document.getElementById("cardPlayerName").textContent = playerName.toUpperCase();

  if (data) {
    // Player photo
    document.getElementById("cardPlayerImg").src =
      "https://cdn.futwiz.com/assets/img/fc25/players/" + data.eaId + ".png";

    // Nation flag (w80 for bigger display)
    var nationCode = NATION_CODE[data.nation] || "un";
    document.getElementById("cardNationImg").src = "https://flagcdn.com/w80/" + nationCode + ".png";
    document.getElementById("cardNationText").textContent = data.nation.toUpperCase();

    // Liga flag
    var ligaCode = LIGA_FLAG[data.liga] || "un";
    document.getElementById("cardLigaImg").src = "https://flagcdn.com/w80/" + ligaCode + ".png";
    document.getElementById("cardLigaText").textContent = data.liga.toUpperCase();

    // Position
    document.getElementById("cardPosBadge").textContent = data.pos;

  } else {
    document.getElementById("cardPlayerImg").src = "https://cdn.sofifa.net/players/notfound_0_120.png";
    document.getElementById("cardNationImg").src = "";
    document.getElementById("cardNationText").textContent = "—";
    document.getElementById("cardLigaImg").src = "";
    document.getElementById("cardLigaText").textContent = "—";
    document.getElementById("cardPosBadge").textContent = "?";
  }

  modal.classList.add("active");
};

window.closeCard = function() {
  var modal = document.getElementById("cardModal");
  if (modal) modal.classList.remove("active");
};
