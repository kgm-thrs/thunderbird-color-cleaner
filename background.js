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
  global_aktiv: true,        // Funktion grundsätzlich an?
  gesamt_korrekturen: 0,     // Lebenszeit-Zähler
  letzte_korrekturen: 0,     // Anzahl in der zuletzt gesendeten E-Mail
  vorschau_vor_senden: false // Optional: vor dem Senden Vorschau zeigen (Default aus)
};

// Offene Vorschau-Daten: id -> { original, html, count, tabId }
// Nur zum Befüllen des Vorschau-Fensters beim Öffnen. Es wird KEIN
// onBeforeSend-Promise offen gehalten (Event-Page kann suspendieren); die
// Vorschau hält ihre Daten selbst und schickt sie bei der Entscheidung zurück.
const wartendeVorschauen = new Map();

// Vorgemerkte, bereits bestätigte Bodies: tabId -> { html, count }
// Wird gesetzt, wenn der Nutzer im Vorschau-Fenster "Senden" klickt; der dann
// programmatisch ausgelöste Versand feuert onBeforeSend erneut und liefert hier
// den bereinigten Body, ohne erneut eine Vorschau zu zeigen.
const freigegeben = new Map();

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
  if (details.isPlainText || typeof details.body !== "string") return {};

  // Bereits in der Vorschau bestätigter Versand: vorgemerkten Body liefern,
  // ohne erneut eine Vorschau zu zeigen.
  if (freigegeben.has(tab.id)) {
    const { html, count } = freigegeben.get(tab.id);
    freigegeben.delete(tab.id);
    await zaehleKorrekturen(count);
    return count > 0 ? { details: { body: html } } : {};
  }

  if (!(await istAktivFuerTab(tab.id))) return {}; // nichts ändern

  const { html, count } = ColorCleaner.cleanHtml(details.body);
  const zustand = await ladeZustand();

  // Stiller Standardmodus (send and forget): direkt bereinigen.
  if (!zustand.vorschau_vor_senden) {
    await zaehleKorrekturen(count);
    return count > 0 ? { details: { body: html } } : {};
  }

  // Vorschau-Modus: Bei nichts zu tun normal senden, ohne zu stören.
  if (count === 0) {
    await zaehleKorrekturen(0);
    return {};
  }

  // Sonst: diesen Sendevorgang abbrechen und die Vorschau öffnen. Der Versand
  // wird erst durch Klick auf "Senden" im Vorschau-Fenster (programmatisch)
  // erneut ausgelöst. So hängt nichts an der Lebensdauer der Event-Page.
  oeffneVorschau(tab.id, details.body, html, count);
  return { cancel: true };
});

// Öffnet das Vorschau-Fenster und hinterlegt die anzuzeigenden Daten.
async function oeffneVorschau(tabId, original, html, count) {
  const id = crypto.randomUUID(); // nicht erratbare ID
  wartendeVorschauen.set(id, { original, html, count, tabId });
  try {
    const fenster = await browser.windows.create({
      url: browser.runtime.getURL("preview/preview.html") + "?id=" + id,
      type: "popup",
      width: 620,
      height: 620
    });
    // Manche Thunderbird-/Betterbird-Versionen ignorieren width/height beim
    // Erstellen und öffnen das Fenster zu groß – Größe daher erzwingen.
    try {
      await browser.windows.update(fenster.id, { width: 620, height: 620, state: "normal" });
    } catch (e2) { /* egal, falls nicht unterstützt */ }
  } catch (e) {
    wartendeVorschauen.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Aufräumen / Initialisierung
// ---------------------------------------------------------------------------

// Wenn ein Compose-Tab geschlossen wird, Per-Fenster-Zustände verwerfen.
browser.tabs.onRemoved.addListener((tabId) => {
  proFensterDeaktiviert.delete(tabId);
  freigegeben.delete(tabId);
});

browser.runtime.onMessage.addListener((nachricht, sender) => {
  if (!nachricht || !nachricht.typ) return false;

  // Härtung: nur Nachrichten von den eigenen Add-on-Seiten (popup/preview)
  // akzeptieren. In Thunderbird gibt es zwar keine fremden Webseiten, die hier
  // hereinfunken könnten, aber als Defense-in-depth (und zukunftssicher) schaden
  // tut es nicht.
  if (!sender || !sender.url || !sender.url.startsWith(browser.runtime.getURL(""))) {
    return false;
  }

  // a) Test-Vorschau aus dem Toolbar-Popup (manuell eingefügtes HTML).
  if (nachricht.typ === "vorschau" && typeof nachricht.html === "string") {
    return Promise.resolve(ColorCleaner.cleanHtml(nachricht.html));
  }

  // b) Das Vorschau-Fenster fragt die anzuzeigenden Daten ab. Es behält sie
  //    selbst und schickt sie bei der Entscheidung zurück (Suspend-sicher).
  if (nachricht.typ === "vorschau_daten") {
    const eintrag = wartendeVorschauen.get(nachricht.id);
    if (!eintrag) return Promise.resolve(null);
    wartendeVorschauen.delete(nachricht.id); // wird nicht mehr gebraucht
    return Promise.resolve({
      original: eintrag.original,
      html: eintrag.html,
      count: eintrag.count,
      tabId: eintrag.tabId
    });
  }

  // c) Entscheidung "Senden": bereinigten Body vormerken, Vorschau-Fenster
  //    schließen und den Versand programmatisch auslösen (feuert onBeforeSend,
  //    das dann den vorgemerkten Body liefert).
  if (nachricht.typ === "vorschau_senden") {
    freigegeben.set(nachricht.tabId, { html: nachricht.html, count: nachricht.count });
    if (nachricht.fensterId != null) {
      browser.windows.remove(nachricht.fensterId).catch(() => {});
    }
    return browser.compose.sendMessage(nachricht.tabId).catch(() => {
      freigegeben.delete(nachricht.tabId); // bei Fehler nicht hängen lassen
      return false;
    });
  }

  // d) Vorschau-Fenster schließen (Abbrechen / "Zurück zum Bearbeiten").
  if (nachricht.typ === "vorschau_schliessen") {
    if (nachricht.fensterId != null) {
      browser.windows.remove(nachricht.fensterId).catch(() => {});
    }
    return Promise.resolve(true);
  }

  return false;
});
