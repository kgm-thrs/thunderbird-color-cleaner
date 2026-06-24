/*
 * preview.js
 * -----------------------------------------------------------------------------
 * Logik des Vorschau-Fensters (nur aktiv, wenn die Option "Vorschau vor dem
 * Senden" eingeschaltet ist). Holt die vom background.js zwischengespeicherten
 * Daten beim Öffnen, behält sie selbst und löst bei "Senden" den Versand aus.
 *
 * Wichtig: Das Fenster hält die Daten selbst, damit es nicht von der Lebensdauer
 * der (nicht-persistenten) Hintergrund-Event-Page abhängt. Geschlossen wird es
 * vom Hintergrund (window.close() ist in solchen Fenstern oft blockiert).
 */

"use strict";

const params = new URLSearchParams(location.search);
const id = params.get("id");

let daten = null;     // { original, html, count, tabId }
let fensterId = null; // eigene Fenster-ID, zum Schließen durch den Hintergrund

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    const eigenes = await browser.windows.getCurrent();
    fensterId = eigenes.id;
  } catch (e) { /* ohne ID schließt notfalls der X-Button */ }

  daten = await browser.runtime.sendMessage({ typ: "vorschau_daten", id });

  if (!daten) {
    document.body.textContent = "Keine Vorschaudaten gefunden.";
    return;
  }

  document.getElementById("count").textContent = daten.count;
  // srcdoc rendert das HTML; sandbox (ohne allow-scripts) verhindert jede
  // Skriptausführung. Das color-scheme-Meta lässt die (farblose) Mail dem
  // Tag-/Nacht-Modus folgen – nur für die Anzeige, der gesendete Body bleibt
  // unberührt.
  const schema = '<meta name="color-scheme" content="light dark">';
  document.getElementById("bereinigt").srcdoc = schema + daten.html;
  document.getElementById("original").srcdoc = schema + daten.original;

  document.getElementById("sendenBtn").addEventListener("click", senden);
  document.getElementById("abbrechenBtn").addEventListener("click", abbrechen);
}

// "Senden": Hintergrund den bereinigten Body vormerken lassen, den Versand
// auslösen und das Fenster schließen. Der ursprüngliche Sendevorgang wurde
// bereits abgebrochen, daher gibt es nichts zu "bestätigen".
function senden() {
  if (!daten) { schliessen(); return; }
  // Fire-and-forget: Der Hintergrund schließt anschließend dieses Fenster, daher
  // kommt die Antwort nicht mehr an – die Ablehnung bewusst verschlucken.
  browser.runtime.sendMessage({
    typ: "vorschau_senden",
    tabId: daten.tabId,
    html: daten.html,
    count: daten.count,
    fensterId
  }).catch(() => {});
}

// "Zurück zum Bearbeiten": nur Fenster schließen (Versand ist schon abgebrochen).
function abbrechen() {
  schliessen();
}

function schliessen() {
  browser.runtime.sendMessage({ typ: "vorschau_schliessen", fensterId }).catch(() => {});
}
