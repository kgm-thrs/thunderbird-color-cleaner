/*
 * SPDX-License-Identifier: CC0-1.0
 * popup.js
 * -----------------------------------------------------------------------------
 * Steuert das Toolbar-Popup:
 *   - globaler Ein/Aus-Schalter (persistiert via storage.local)
 *   - Statusanzeige der Korrektur-Zähler
 *   - Vorschau-Funktion (nutzt ColorCleaner lokal, ohne echten Versand)
 *
 * Hinweis: browser.* existiert nur im Add-on-Kontext. Damit dieselbe Datei
 * notfalls auch in test.html/Browser nicht crasht, wird der Zugriff abgesichert.
 */

"use strict";

const hatBrowserApi = typeof browser !== "undefined" && browser.storage;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const globalToggle = document.getElementById("globalToggle");
  const globalLabel = document.getElementById("globalLabel");
  const letzte = document.getElementById("letzte");
  const gesamt = document.getElementById("gesamt");

  const vorschauToggle = document.getElementById("vorschauToggle");

  // Zustand laden und Oberfläche füllen.
  if (hatBrowserApi) {
    const z = await browser.storage.local.get({
      global_aktiv: true,
      gesamt_korrekturen: 0,
      letzte_korrekturen: 0,
      vorschau_vor_senden: false
    });
    globalToggle.checked = z.global_aktiv;
    vorschauToggle.checked = z.vorschau_vor_senden;
    letzte.textContent = z.letzte_korrekturen;
    gesamt.textContent = z.gesamt_korrekturen;
    setzeLabel(globalLabel, z.global_aktiv);
  }

  // Globaler Schalter.
  globalToggle.addEventListener("change", async () => {
    setzeLabel(globalLabel, globalToggle.checked);
    if (hatBrowserApi) {
      await browser.storage.local.set({ global_aktiv: globalToggle.checked });
    }
  });

  // Schalter „Vorschau vor dem Senden".
  vorschauToggle.addEventListener("change", async () => {
    if (hatBrowserApi) {
      await browser.storage.local.set({ vorschau_vor_senden: vorschauToggle.checked });
    }
  });

  // Vorschau ein-/ausblenden.
  document.getElementById("vorschauBtn").addEventListener("click", () => {
    document.getElementById("vorschauBereich").classList.toggle("versteckt");
  });

  // Live-Vorschau bei jeder Eingabe – entprellt (250 ms), damit das schwere
  // DOMParser-Parsing bei großem HTML die Eingabe nicht ruckeln lässt.
  document.getElementById("vorschauEingabe").addEventListener("input", debounce((e) => {
    const { html, count } = ColorCleaner.cleanHtml(e.target.value);
    document.getElementById("vorschauAusgabe").textContent = html;
    document.getElementById("vorschauCount").textContent = count;
  }, 250));
}

// Verzögert die Ausführung bis 'delay' ms nach dem letzten Aufruf.
function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}

function setzeLabel(el, aktiv) {
  el.textContent = aktiv ? "Farbbereinigung aktiv" : "Farbbereinigung deaktiviert";
}
