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

  // Zustand laden und Oberfläche füllen.
  if (hatBrowserApi) {
    const z = await browser.storage.local.get({
      global_aktiv: true,
      gesamt_korrekturen: 0,
      letzte_korrekturen: 0
    });
    globalToggle.checked = z.global_aktiv;
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

  // Vorschau ein-/ausblenden.
  document.getElementById("vorschauBtn").addEventListener("click", () => {
    document.getElementById("vorschauBereich").classList.toggle("versteckt");
  });

  // Live-Vorschau bei jeder Eingabe.
  document.getElementById("vorschauEingabe").addEventListener("input", (e) => {
    const { html, count } = ColorCleaner.cleanHtml(e.target.value);
    document.getElementById("vorschauAusgabe").textContent = html;
    document.getElementById("vorschauCount").textContent = count;
  });
}

function setzeLabel(el, aktiv) {
  el.textContent = aktiv ? "Farbbereinigung aktiv" : "Farbbereinigung deaktiviert";
}
