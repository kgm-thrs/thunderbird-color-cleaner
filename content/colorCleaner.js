/*
 * SPDX-License-Identifier: CC0-1.0
 * colorCleaner.js
 * -----------------------------------------------------------------------------
 * Reiner Parsing-/Cleaning-Algorithmus – ohne jede Thunderbird-Abhängigkeit.
 *
 * Aufgabe: Aus einem HTML-String alle EXPLIZITEN Text- und Hintergrundfarben
 * entfernen (color, background-color sowie das background-Shorthand). Damit
 * bestimmt am Ende der E-Mail-Client des Empfängers die Farbe – egal ob er im
 * Dark- oder Light-Mode arbeitet. Es werden ALLE Farben entfernt (auch bunte),
 * weil der Nutzer pro E-Mail über den Kill-Switch abschalten kann.
 *
 * Alle anderen Styles (font-size, font-weight, margin, text-align …) bleiben
 * unangetastet.
 *
 * Das Modul funktioniert in zwei Welten:
 *   - im Add-on (background.js / content script) via globalem DOMParser
 *   - in test.html im Browser
 * Es exportiert sich sowohl als globale Funktion (window.ColorCleaner) als auch
 * – falls vorhanden – via module.exports.
 */

(function (root) {
  "use strict";

  // CSS-Eigenschaften, die eine FARBE setzen und daher entfernt werden.
  // "background" (Shorthand) wird separat behandelt, weil dort die Farbe nur
  // ein Teil unter mehreren sein kann (z. B. "background: #fff url(x) no-repeat").
  const COLOR_PROPERTIES = ["color", "background-color"];

  /**
   * Prüft, ob ein einzelner CSS-Wert eine Farbe darstellt.
   * Erkennt Schlüsselwörter (red, white, transparent …), #hex, rgb()/rgba(),
   * hsl()/hsla(). "inherit", "initial", "unset", "currentcolor" gelten NICHT als
   * harte Farbe und bleiben erhalten.
   */
  function istFarbwert(wert) {
    if (!wert) return false;
    // "!important" abstreifen, sonst werden z. B. "#fff !important" übersehen.
    const v = wert.replace(/!important/i, "").trim().toLowerCase();
    if (!v) return false;
    if (["inherit", "initial", "unset", "revert", "currentcolor", "none", "transparent"].includes(v)) {
      return false;
    }
    if (/^#[0-9a-f]{3,8}$/.test(v)) return true;
    // Funktions-Farben inkl. moderner Farbräume (Space- und Komma-Syntax).
    if (/^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/.test(v)) return true;
    // Benannte CSS-Farben – vollständige Liste der 148 CSS-Color-Keywords.
    return BENANNTE_FARBEN.has(v);
  }

  // Vollständige Liste der benannten CSS-Farben (148 Keywords).
  const BENANNTE_FARBEN = new Set([
    "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige",
    "bisque", "black", "blanchedalmond", "blue", "blueviolet", "brown",
    "burlywood", "cadetblue", "chartreuse", "chocolate", "coral",
    "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan",
    "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki",
    "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred",
    "darksalmon", "darkseagreen", "darkslateblue", "darkslategray",
    "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue",
    "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite",
    "forestgreen", "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod",
    "gray", "green", "greenyellow", "grey", "honeydew", "hotpink", "indianred",
    "indigo", "ivory", "khaki", "lavender", "lavenderblush", "lawngreen",
    "lemonchiffon", "lightblue", "lightcoral", "lightcyan",
    "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink",
    "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray",
    "lightslategrey", "lightsteelblue", "lightyellow", "lime", "limegreen",
    "linen", "magenta", "maroon", "mediumaquamarine", "mediumblue",
    "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue",
    "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue",
    "mintcream", "mistyrose", "moccasin", "navajowhite", "navy", "oldlace",
    "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod",
    "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff",
    "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple", "red",
    "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen",
    "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray",
    "slategrey", "snow", "springgreen", "steelblue", "tan", "teal", "thistle",
    "tomato", "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow",
    "yellowgreen"
  ]);

  /**
   * Bereinigt einen einzelnen style-Attribut-String (z. B. das, was in
   * style="…" steht). Gibt ein Objekt zurück:
   *   { style: "bereinigter String", entfernt: Anzahl entfernter Farbangaben }
   */
  function bereinigeStyleString(styleString) {
    if (!styleString) return { style: styleString || "", entfernt: 0 };

    let entfernt = 0;
    const deklarationen = styleString.split(";");
    const behalten = [];

    for (let deklaration of deklarationen) {
      if (!deklaration.trim()) continue;

      const doppelpunkt = deklaration.indexOf(":");
      if (doppelpunkt === -1) {
        behalten.push(deklaration.trim());
        continue;
      }

      const eigenschaft = deklaration.slice(0, doppelpunkt).trim().toLowerCase();
      const wert = deklaration.slice(doppelpunkt + 1).trim();

      // 1) Reine Farb-Eigenschaften: ganz weg, wenn der Wert eine Farbe ist.
      if (COLOR_PROPERTIES.includes(eigenschaft)) {
        if (istFarbwert(wert)) {
          entfernt++;
          continue; // Deklaration wird verworfen
        }
        behalten.push(eigenschaft + ": " + wert);
        continue;
      }

      // 2) background-Shorthand: nur den Farb-Token herauslösen, Rest behalten.
      if (eigenschaft === "background") {
        const ergebnis = entferneFarbeAusBackground(wert);
        entfernt += ergebnis.entfernt;
        if (ergebnis.wert.trim()) {
          behalten.push("background: " + ergebnis.wert.trim());
        }
        continue;
      }

      // 3) Alles andere unverändert übernehmen.
      behalten.push(eigenschaft + ": " + wert);
    }

    // Ursprüngliche Endung (Semikolon) grob nachbilden für saubere Optik.
    const neu = behalten.join("; ");
    return { style: neu, entfernt };
  }

  /**
   * Entfernt einen Farb-Token aus einem background-Shorthand, behält aber
   * url(), Positionsangaben, repeat etc. Tokenisierung berücksichtigt
   * Klammern, damit "rgb(0, 0, 0)" nicht zerrissen wird.
   */
  function entferneFarbeAusBackground(wert) {
    // Tiefenbewusster Tokenizer: an Leerzeichen UND Kommas trennen – aber nur
    // auf der äußeren Ebene (tiefe === 0). So bleiben Funktionen mit eigenen
    // Kommas unangetastet, z. B. linear-gradient(red, blue) oder url(a,b)
    // (Data-URIs). Das Komma wird als eigenes Token erhalten.
    const tokens = [];
    let aktuell = "";
    let tiefe = 0;
    for (const zeichen of wert) {
      if (zeichen === "(") tiefe++;
      if (zeichen === ")") tiefe--;
      if ((zeichen === " " || zeichen === ",") && tiefe === 0) {
        if (aktuell.trim()) tokens.push(aktuell.trim());
        if (zeichen === ",") tokens.push(",");
        aktuell = "";
      } else {
        aktuell += zeichen;
      }
    }
    if (aktuell.trim()) tokens.push(aktuell.trim());

    let entfernt = 0;
    const behalten = tokens.filter((t) => {
      if (t === ",") return true; // Kommas zunächst behalten, später säubern
      if (istFarbwert(t)) {
        entfernt++;
        return false;
      }
      return true;
    });

    // Aus den Tokens layer-weise neu zusammensetzen (Komma = Layer-Grenze).
    // Layer, die durch die Farb-Entfernung leer geworden sind, fallen dabei
    // automatisch weg – ohne verwaiste Kommas. Token-Inhalte (z. B. url(a,b))
    // bleiben unangetastet.
    const layers = [];
    let aktuellerLayer = [];
    for (const tk of behalten) {
      if (tk === ",") {
        if (aktuellerLayer.length) {
          layers.push(aktuellerLayer.join(" "));
          aktuellerLayer = [];
        }
      } else {
        aktuellerLayer.push(tk);
      }
    }
    if (aktuellerLayer.length) layers.push(aktuellerLayer.join(" "));

    return { wert: layers.join(", "), entfernt };
  }

  /**
   * Hauptfunktion: nimmt einen kompletten HTML-Body-String entgegen, bereinigt
   *   - alle style="…"-Attribute an Elementen
   *   - alle <style>-Blöcke (inkl. im <head>)
   * und liefert { html, count } zurück (count = Summe entfernter Farbangaben).
   */
  function cleanHtml(htmlString) {
    if (!htmlString) return { html: htmlString || "", count: 0 };

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, "text/html");
    let count = 0;

    // a) Inline-style-Attribute aller Elemente.
    const mitStyle = doc.querySelectorAll("[style]");
    for (const el of mitStyle) {
      const original = el.getAttribute("style");
      const { style, entfernt } = bereinigeStyleString(original);
      count += entfernt;
      if (entfernt > 0) {
        if (style.trim()) {
          el.setAttribute("style", style);
        } else {
          el.removeAttribute("style");
        }
      }
    }

    // b) Veraltete HTML-Attribute color/bgcolor (Word/Outlook exportiert sie gern).
    for (const el of doc.querySelectorAll("[color]")) {
      el.removeAttribute("color");
      count++;
    }
    for (const el of doc.querySelectorAll("[bgcolor]")) {
      el.removeAttribute("bgcolor");
      count++;
    }

    // c) <style>-Blöcke: jede Regel nach Farb-Deklarationen durchsuchen.
    for (const styleEl of doc.querySelectorAll("style")) {
      const { css, entfernt } = bereinigeCssBlock(styleEl.textContent);
      count += entfernt;
      if (entfernt > 0) styleEl.textContent = css;
    }

    // Wieder serialisieren. Wir geben nur den Body-Inhalt zurück, falls der
    // Eingangsstring ein Fragment war; sonst das ganze Dokument.
    const html = serialisiere(htmlString, doc);
    return { html, count };
  }

  /**
   * Bereinigt einen kompletten <style>-Block. Sehr simpler Regel-Parser:
   * trennt an "}" in Regelblöcke, nimmt den Deklarationsteil zwischen "{" "}"
   * und schickt ihn durch bereinigeStyleString().
   */
  function bereinigeCssBlock(css) {
    if (!css) return { css: css || "", entfernt: 0 };

    // 1) CSS-Kommentare entfernen, damit sie keine Fehl-Matches verursachen.
    const ohneKommentare = css.replace(/\/\*[\s\S]*?\*\//g, "");

    // 2) At-Rules (@media, @keyframes, @supports …) und verschachtelte Regeln
    //    NICHT mit der simplen { }-Regex zerlegen – das würde die Syntax
    //    korrumpieren. In dem Fall den Block unverändert lassen. Inline-Styles
    //    (der Praxisfall in E-Mails) bleiben davon unberührt.
    const hatAtRule = /@[a-z-]+/i.test(ohneKommentare);
    const hatVerschachtelung = /\{[^}]*\{/.test(ohneKommentare);
    if (hatAtRule || hatVerschachtelung) {
      return { css: css, entfernt: 0 };
    }

    let entfernt = 0;
    const neu = ohneKommentare.replace(/\{([^}]*)\}/g, function (_, deklarationen) {
      const ergebnis = bereinigeStyleString(deklarationen);
      entfernt += ergebnis.entfernt;
      return "{" + ergebnis.style + (ergebnis.style.trim() ? ";" : "") + "}";
    });

    return { css: neu, entfernt };
  }

  /**
   * Entscheidet, ob wir den vollen Dokument-String oder nur den Body-Inhalt
   * zurückgeben. Heuristik: Enthielt das Original ein <html>/<head>-Gerüst,
   * geben wir das ganze Dokument zurück; sonst nur innerHTML des Body, damit
   * wir kein künstliches Gerüst hinzufügen.
   */
  function serialisiere(original, doc) {
    const hatGeruest = /<html[\s>]/i.test(original) || /<head[\s>]/i.test(original) || /<!doctype/i.test(original);
    if (hatGeruest) {
      return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
    }
    return doc.body.innerHTML;
  }

  // Öffentliche API.
  const ColorCleaner = {
    cleanHtml,
    bereinigeStyleString,
    istFarbwert
  };

  root.ColorCleaner = ColorCleaner;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = ColorCleaner;
  }
})(typeof window !== "undefined" ? window : this);
