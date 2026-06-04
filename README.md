# UFL Community Liga — Draft System

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Haupt-App (alle Screens) |
| `app.js` | Gesamte Draft-Logik |
| `style.css` | Design + Responsive |
| `players.js` | Spieler-Pool + Karten-Daten |
| `obs.html` | OBS Stream Overlay |
| `firebase-config.js` | Firebase Zugangsdaten |

---

## Features

- 🏠 **Lobby & Ready Up** — Teams müssen sich bereit melden bevor der Draft startet
- 🔒 **Secure Pick** — Jedes Team wählt gleichzeitig und geheim einen Spieler
- 🚫 **Ban Phase** — Jedes Team bannt einen Spieler
- 🏆 **Draft Phase** — Snake Draft mit konfigurierbaren Runden
- 📋 **Pick Queue** — Spieler vormerken für Auto-Pick bei Timer-Ablauf
- 🃏 **Spielerkarten** — UFL-Style Karten mit Foto, Nation, Liga, Position
- 📺 **OBS Overlay** — Live Stream Overlay mit allen Picks, Bans und Timer
- 🔊 **Sprachansage** — NFL-Style Ansage bei jedem Pick (OBS)
- 📱 **Responsive** — Desktop, Tablet und Mobile optimiert

---

## SCHRITT 1 — Firebase einrichten

1. [firebase.google.com](https://firebase.google.com) → Neues Projekt
2. Realtime Database aktivieren → **Testmodus**
3. Web App hinzufügen → Config kopieren → in `firebase-config.js` einfügen
4. Regeln in der Firebase Console:
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

---

## SCHRITT 2 — GitHub Pages einrichten

1. Repository erstellen → alle Dateien hochladen
2. Settings → Pages → Branch: main → Save
3. URL: `https://DEINNAME.github.io/REPOSITORY`

---

## SCHRITT 3 — Commissioner Passwort ändern


---

## SCHRITT 4 — Draft konfigurieren

1. Website öffnen → **Commissioner Login**
2. Passwort eingeben
3. Im Commissioner Panel einstellen:
   - **Picks pro Team** (Runden) — z.B. 3 für Snake Draft
   - **Timer** in Sekunden
   - **Snake Draft** an/aus
   - **Teams** mit Namen und Passwörtern
   - **Spieler-Pool** (wird automatisch aus `players.js` geladen)
4. **„Konfiguration speichern"** klicken

---

## ABLAUF — So läuft ein Draft

### 🏠 Phase 0 — Lobby & Ready Up

**Teams:**
1. Website öffnen → Team-Namen + Passwort eingeben → Einloggen
2. Landen automatisch in der **Lobby**
3. Klicken auf **„✅ Ich bin bereit!"**
4. Warten bis alle Teams bereit sind

**Commissioner:**
- Sieht im Panel live welche Teams bereit sind
- Z.B. *„4 / 6 bereit"* mit Status pro Team
- Der **„🔒 Secure Pick starten"** Button ist gesperrt bis **alle** Teams ready sind
- Sobald alle grün → Button klicken → Secure Pick startet automatisch für alle

---

### 🔒 Phase 1 — Secure Pick

- Alle Teams sehen gleichzeitig die Spielerliste
- Jedes Team wählt **geheim** einen Spieler — andere sehen nur die Anzahl (*„4 / 6 haben gewählt"*)
- Wenn alle gewählt haben → Picks werden automatisch aufgedeckt
- **Konflikt** (zwei Teams wählen denselben Spieler) → betroffene Teams wählen erneut
- Dies wiederholt sich bis jeder einen **einzigartigen** Spieler hat
- Gesecurte Spieler können **nicht** gebannt oder gedraftet werden

**Commissioner kann:**
- „👁️ Secure Picks aufdecken" — manuell aufdecken
- „🔒 Secure Pick starten" — Phase neu starten

---

### 🚫 Phase 2 — Ban Phase

- Teams bannen **reihum** je einen Spieler (mit Timer)
- Gesecurte Spieler sind **nicht** bannbar
- Gebannte Spieler erscheinen im Draft **nicht** mehr
- Nach dem letzten Ban startet die Draft Phase **automatisch**

**Commissioner kann:**
- Aktuellen Ban überspringen
- Ban Phase manuell starten

---

### 🏆 Phase 3 — Draft Phase

- **Snake Draft** — Reihenfolge dreht sich jede Runde um
- Timer pro Pick (konfigurierbar)
- **Pick Queue** — Spieler per ★ vormerken → bei Timer-Ablauf wird automatisch der erste verfügbare Queue-Spieler gedraftet
- Gesecurte und gebannte Spieler sind **nicht** draftbar
- Bereits gedraftete Spieler sind **nicht** draftbar
- **🃏 Button** neben jedem Spieler öffnet die UFL-Style Spielerkarte

**Draft Board** zeigt:
- Tab **„🔒 Secure"** — alle Secure Picks
- Tab **„R1, R2, R3..."** — Draft Picks je Runde

---

## OBS Overlay einrichten

1. OBS → Quellen → **Browser** hinzufügen
2. URL: `https://DEINNAME.github.io/REPOSITORY/obs.html`
3. Breite: **1920**, Höhe: **1080**
4. ✅ **„Transparenten Hintergrund erzwingen"** aktivieren
5. Nach dem Laden: **einmal ins Overlay klicken** um Audio zu aktivieren

**Das Overlay zeigt:**
- Top Bar: aktuelle Phase, Timer, wer dran ist
- Rechts: Team-Übersicht mit Secure Pick / Ban / Draft Pick pro Team
- Links: Letzte 7 Aktionen
- Unten: Ticker mit allen Picks
- **Sprachansage** bei jedem Pick: *„Mit dem ersten Pick — Team Alpha — Mbappe"*

---

## Commissioner Panel — Übersicht

| Funktion | Beschreibung |
|---|---|
| Konfiguration speichern | Draft aufsetzen, Teams + Spieler definieren |
| Lobby zurücksetzen | Ready-Status aller Teams löschen |
| Secure Pick starten | Phase 1 starten (nur wenn alle ready) |
| Secure Picks aufdecken | Picks manuell aufdecken |
| Ban Phase starten | Phase 2 manuell starten |
| Draft Phase starten | Phase 3 manuell starten |
| Pick überspringen | Aktuellen Pick/Ban überspringen |
| Draft zurücksetzen | Alles löschen, von vorne starten |
| ⚙️ Panel Button | Jederzeit zurück zum Commissioner Panel |

---

## Spielerkarten

136 Spieler haben vollständige Karten mit:
- Spielerfoto (futwiz CDN)
- Nationalflagge
- UFL Liga (England 1, Spanien 1, etc.)
- Position

**Spieler ohne Kartendaten** zeigen ein Platzhalter-Foto.

**Weitere Spieler hinzufügen** — in `players.js` unter `PLAYER_DATA`:
```js
"Spielername": {
  pos: "ST",
  nation: "Deutschland",
  liga: "England 1",
  club: "Man City",
  eaId: 239085
},
```

---

## Responsive Design

| Gerät | Breakpoint |
|---|---|
| Desktop | > 1024px — 2-spaltig |
| Tablet | ≤ 1024px — 1-spaltig |
| Mobile | ≤ 640px — kompakt, alles gestapelt |
| Sehr klein | ≤ 380px — iPhone SE optimiert |

---

## Mögliche weitere Upgrades

- 🔁 Trade System
- 🔊 Sound Effects
- 🏷️ Team Logos
- 🎮 Discord Integration
- 💰 Salary Cap
- 📊 Draft Statistiken
