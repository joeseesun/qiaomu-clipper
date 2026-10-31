/* Adapted from xPoster (MIT). X DOM compatibility boundary for the page side; main-world.js carries its own copy. */
/* X DOM compatibility boundary: update this module when editor markup changes. */
  const VERSION = "2026-10-09.1";
  const SELECTORS = Object.freeze([
    ".public-DraftEditor-content[contenteditable='true']",
    "[data-testid='twitterArticleRichTextView'] [contenteditable='true']",
    "[data-contents='true'] [contenteditable='true']",
    "[contenteditable='true'][role='textbox']"
  ]);
  function isComposeRoute(location) {
    return /^(x|twitter)\.com$/.test(location?.hostname || "") && /^\/compose\/articles(?:\/|$)/.test(location?.pathname || "");
  }
  function candidates(doc, location) {
    if (!isComposeRoute(location)) return [];
    const result = [], seen = new Set();
    for (const selector of SELECTORS) {
      for (const node of doc.querySelectorAll(selector)) {
        if (seen.has(node)) continue;
        seen.add(node);
        const rect = node.getBoundingClientRect();
        if (rect.width <= 200 || rect.height <= 80 || node.getAttribute("aria-hidden") === "true") continue;
        result.push({ node, selector });
      }
    }
    return result;
  }
  function findEditor(doc, location) {
    const found = candidates(doc, location);
    // Fail closed when X changes to multiple plausible editors; never write into a reply box.
    return found.length === 1 ? found[0].node : null;
  }
  function inspect(doc, location) {
    const found = candidates(doc, location);
    return { version: VERSION, route: isComposeRoute(location), editorCount: found.length,
      selector: found.length === 1 ? found[0].selector : null,
      compatible: found.length === 1, reason: !isComposeRoute(location) ? "not-article-composer" : found.length > 1 ? "ambiguous-editor" : found.length ? "ready" : "editor-not-found" };
  }
  export { VERSION, SELECTORS, isComposeRoute, findEditor, inspect };
