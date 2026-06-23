/*
 * SPDX-License-Identifier: CC0-1.0
 * background.js
 * -----------------------------------------------------------------------------
 * Haupt-Logik des Add-ons. Verantwortlich für:
 *   - Abfangen ausgehender E-Mails via compose.onBeforeSend
 *   - Aufruf des Cleaners (ColorCleaner.cleanHtml aus content/colorCleaner.js,
 *     wird über manifest "background.scripts" als globales Objekt geladen)
 *   - Zurückschreiben des bereinigten Bodys VOR dem Versand
 *   - Zählen der Korrekturen (global + letzte E-Mail) für das Popup
 *   - Verwaltung von zwei Schaltern:
 *       1. GLOBAL aktiviert/deaktiviert (persistiert via storage.local)
 *       2. PRO COMPOSE-FENSTER per composeAction-Button (nur im Speicher,
 *          beim nächsten neuen Fenster wieder automatisch aktiv)
 */

"use strict";

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

// Per-Fenster-Override: Map<tabId, false>. Fehlt ein Eintrag, gilt "aktiv".
const proFensterDeaktiviert = new Map();

// In-Memory-Cache des Gesamtzählers. Verhindert "Lost Updates", wenn mehrere
// Sendevorgänge kurz hintereinander laufen (load-modify-store wäre sonst
// anfällig). Bei null wird der Wert aus storage.local nachgeladen.
let gesamtCache = null;

// Standardwerte für den persistenten Zustand.
const STANDARD = {
  global_aktiv: true,    // Funktion grundsätzlich an?
  gesamt_korrekturen: 0, // Lebenszeit-Zähler
  letzte_korrekturen: 0  // Anzahl in der zuletzt gesendeten E-Mail
};

// ---------------------------------------------------------------------------
// Hilfsfunktionen für den Zustand
// ---------------------------------------------------------------------------

async function ladeZustand() {
  const gespeichert = await browser.storage.local.get(STANDARD);
  return { ...STANDARD, ...gespeichert };
}

async function setzeZustand(teil) {
  await browser.storage.local.set(teil);
}

// Erhöht den Gesamtzähler kollisionssicher und merkt sich die letzte Anzahl.
async function zaehleKorrekturen(neue) {
  if (gesamtCache === null) {
    const zustand = await ladeZustand();
    gesamtCache = zustand.gesamt_korrekturen;
  }
  gesamtCache += neue;
  await setzeZustand({
    gesamt_korrekturen: gesamtCache,
    letzte_korrekturen: neue
  });
}

// Ist der Cleaner für diesen konkreten Tab gerade aktiv?
async function istAktivFuerTab(tabId) {
  const zustand = await ladeZustand();
  if (!zustand.global_aktiv) return false;
  if (proFensterDeaktiviert.get(tabId) === true) return false;
  return true;
}

// ---------------------------------------------------------------------------
// composeAction-Button (Per-Fenster-Toggle direkt im Schreib-Fenster)
// ---------------------------------------------------------------------------

// Aktualisiert Icon/Titel des Buttons passend zum Zustand für diesen Tab.
async function aktualisiereButton(tabId) {
  const deaktiviert = proFensterDeaktiviert.get(tabId) === true;

  const titel = deaktiviert
    ? "Farbbereinigung deaktiviert – klicken zum Aktivieren"
    : "Farbbereinigung aktiv – klicken zum Deaktivieren für diese E-Mail";

  await browser.composeAction.setTitle({ tabId, title: titel });

  // Graues Icon bei deaktiviert, farbiges (Standard) bei aktiv.
  if (deaktiviert) {
    await browser.composeAction.setIcon({
      tabId,
      path: { 48: "icons/icon-48-grau.png", 96: "icons/icon-96-grau.png" }
    });
  } else {
    await browser.composeAction.setIcon({
      tabId,
      path: { 48: "icons/icon-48.png", 96: "icons/icon-96.png" }
    });
  }
}

// Klick auf den Button im Compose-Fenster: Per-Fenster-Zustand umschalten.
browser.composeAction.onClicked.addListener(async (tab) => {
  const aktuellDeaktiviert = proFensterDeaktiviert.get(tab.id) === true;
  if (aktuellDeaktiviert) {
    proFensterDeaktiviert.delete(tab.id); // wieder aktiv
  } else {
    proFensterDeaktiviert.set(tab.id, true); // für dieses Fenster aus
  }
  await aktualisiereButton(tab.id);
});

// ---------------------------------------------------------------------------
// Kern: onBeforeSend
// ---------------------------------------------------------------------------

browser.compose.onBeforeSend.addListener(async (tab, details) => {
  // Nur HTML-Mails behandeln; reine Text-Mails haben keine Inline-Farben.
  if (!details.isPlainText && typeof details.body === "string") {
    if (!(await istAktivFuerTab(tab.id))) {
      return {}; // nichts ändern
    }

    const { html, count } = ColorCleaner.cleanHtml(details.body);

    // Zähler kollisionssicher aktualisieren (auch bei 0 – für "letzte E-Mail").
    await zaehleKorrekturen(count);

    if (count > 0) {
      // Body NUR im gesendeten Objekt ersetzen – der Editor bleibt unberührt.
      return { details: { body: html } };
    }
  }

  return {};
});

// ---------------------------------------------------------------------------
// Aufräumen / Initialisierung
// ---------------------------------------------------------------------------

// Wenn ein Compose-Tab geschlossen wird, Per-Fenster-Override verwerfen.
browser.tabs.onRemoved.addListener((tabId) => {
  proFensterDeaktiviert.delete(tabId);
});

// Wird vom Popup genutzt, um Vorschau/Test ohne echten Versand zu erzeugen.
browser.runtime.onMessage.addListener((nachricht) => {
  if (nachricht && nachricht.typ === "vorschau" && typeof nachricht.html === "string") {
    return Promise.resolve(ColorCleaner.cleanHtml(nachricht.html));
  }
  return false;
});
