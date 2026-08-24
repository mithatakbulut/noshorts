// ==UserScript==
// @name         No Shorts
// @namespace    com.local.noshorts
// @version      0.1.0
// @description  Keeps normal YouTube, removes YouTube Shorts.
// @match        *://youtube.com/*
// @match        *://*.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const css = `
a[href^="/shorts"],
a[href*="youtube.com/shorts"],
ytd-reel-shelf-renderer,
ytm-reel-shelf-renderer,
ytd-reel-video-renderer,
ytm-shorts-lockup-view-model,
ytd-shorts,
ytd-rich-shelf-renderer[is-shorts] {
  display: none !important;
}
`;

  const style = document.createElement("style");
  style.textContent = css;
  (document.documentElement || document.head || document).appendChild(style);

  const isShortsPath = () =>
    location.pathname === "/shorts" ||
    location.pathname.startsWith("/shorts/");

  const escapeShorts = () => {
    if (!isShortsPath()) return false;
    location.replace(`${location.origin}/`);
    return true;
  };

  const removeShortsUI = () => {
    const selectors = [
      "ytd-reel-shelf-renderer",
      "ytm-reel-shelf-renderer",
      "ytd-reel-video-renderer",
      "ytm-shorts-lockup-view-model",
      "ytd-shorts",
      "ytd-rich-shelf-renderer[is-shorts]",
      'a[href^="/shorts"]',
      'a[href*="youtube.com/shorts"]'
    ];

    for (const element of document.querySelectorAll(selectors.join(","))) {
      if (element.tagName === "A") {
        const card = element.closest(
          [
            "ytd-rich-item-renderer",
            "ytd-video-renderer",
            "ytd-grid-video-renderer",
            "ytm-video-with-context-renderer",
            "ytm-compact-video-renderer",
            "ytm-shorts-lockup-view-model"
          ].join(",")
        );

        (card || element).remove();
      } else {
        element.remove();
      }
    }
  };

  const clean = () => {
    if (escapeShorts()) return;
    removeShortsUI();
  };

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a[href]");
      if (!anchor) return;

      let url;
      try {
        url = new URL(anchor.href, location.href);
      } catch {
        return;
      }

      if (
        /(^|\.)youtube\.com$/.test(url.hostname) &&
        (url.pathname === "/shorts" || url.pathname.startsWith("/shorts/"))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        location.assign(`${location.origin}/`);
      }
    },
    true
  );

  const observer = new MutationObserver(clean);

  const start = () => {
    clean();

    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  };

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  }

  window.addEventListener("popstate", clean);
  window.addEventListener("pageshow", clean);
  document.addEventListener("visibilitychange", clean);

  setInterval(() => {
    if (isShortsPath()) escapeShorts();
  }, 500);
})();
