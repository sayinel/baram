// Baram HTML preview bridge (§5.1). Injected by the `baramhtml:` URI scheme
// handler (html_preview.rs) into every HTML document the preview serves.
//
// The preview frame is sandboxed WITHOUT allow-same-origin, so it sits in an
// opaque origin: the host cannot reach into this document, and this document's
// key/wheel events never reach the host's window listeners. Everything the
// preview needs therefore travels over postMessage -- and nothing else does.
// The host re-validates every message; treat nothing sent from here as trusted.
//
// ASCII ONLY. The handler serves `text/html` with no charset so the document's
// own <meta charset> still decides, and this text is spliced in as raw bytes --
// a non-ASCII byte here would be mojibake in a EUC-KR or Shift_JIS document.
(function () {
  "use strict";

  var TAG = "baram:html-preview";

  function post(message) {
    message.__baram = TAG;
    try {
      window.parent.postMessage(message, "*");
    } catch (err) {
      /* no parent to bridge to -- document opened standalone */
    }
  }

  // --- external links ------------------------------------------------------
  // http/https anchors leave through the host's system opener instead of
  // navigating this frame: remote content must never load inside the preview.
  // Every other scheme keeps its default behaviour untouched -- fragments and
  // `baramhtml:` links to sibling files are how in-document and page-to-page
  // navigation already work, and taking those over would break them.

  function anchorFor(node) {
    for (var el = node; el; el = el.parentNode) {
      if (el.nodeType === 1 && String(el.tagName).toLowerCase() === "a") {
        // getAttribute, not .href: on an SVG <a> the property is an
        // SVGAnimatedString rather than the resolved URL string.
        return el.getAttribute("href") === null ? null : el;
      }
    }
    return null;
  }

  function externalUrl(rawHref) {
    // Leading/trailing whitespace is stripped before a browser parses an href, so
    // strip it here too -- otherwise " //example.com" misses the check below and
    // resolves to a `baramhtml:` URL that can only 403.
    var href = String(rawHref).trim();
    var url;
    try {
      // A protocol-relative `//host/path` means "the network, over whatever scheme
      // this page came in on" -- but this page came in over `baramhtml:`, where
      // resolving it that way produces a URL the handler can only 403. The author
      // meant the network, so read it as https.
      url =
        href.slice(0, 2) === "//"
          ? new URL("https:" + href)
          : new URL(href, document.baseURI);
    } catch (err) {
      return null;
    }
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  }

  document.addEventListener(
    "click",
    function (event) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      var anchor = anchorFor(event.target);
      if (!anchor) return;
      var url = externalUrl(anchor.getAttribute("href"));
      if (!url) return;
      event.preventDefault();
      post({ type: "open-external", url: url });
    },
    true,
  );

  var nativeOpen = window.open;
  window.open = function (href) {
    var url = href == null ? null : externalUrl(String(href));
    if (url) {
      post({ type: "open-external", url: url });
      return null;
    }
    return nativeOpen.apply(window, arguments);
  };

  // --- zoom input ----------------------------------------------------------
  // Input only. The host's zoom shortcuts listen on ITS window, which these
  // keystrokes stop reaching the moment focus lands inside this frame, so they are
  // forwarded -- but the host then paints by scaling the frame from the outside and
  // never sends a level back. Restyling the document instead (`zoom` on the root)
  // was the first cut and it made every step read as less than it was: shrinking the
  // layout viewport just reflows a fluid page to fill the frame again.

  document.addEventListener(
    "keydown",
    function (event) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      var action = null;
      if (event.key === "=" || event.key === "+") action = "in";
      else if (event.key === "-" || event.key === "_") action = "out";
      else if (event.key === "0") action = "reset";
      if (!action) return;
      event.preventDefault();
      post({ type: "zoom", action: action, delta: 0 });
    },
    true,
  );

  window.addEventListener(
    "wheel",
    function (event) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      post({ type: "zoom", action: "delta", delta: event.deltaY });
    },
    { capture: true, passive: false },
  );

  // Nothing is received from the host, deliberately: this frame paints nothing, so
  // there is no state to hand it and no handshake to miss. A document that loses this
  // bridge (`document.write` replacing the document mid-parse) loses input forwarding
  // and its links -- but zoom keeps working, because zoom never depended on it.
})();
