// Bilibili sends a server-rendered page and its front-end then takes it over. Adding nodes to that page before the
// takeover has finished can make the takeover redo or abandon parts of it (the header and the player go missing),
// so nothing is added until the player exists, which the app creates after it has taken over.
export const SETTLE_MS = 1500;
export const pageSettled = (doc: Document): boolean => doc.readyState === 'complete' && Boolean(doc.querySelector('.bpx-player-container, .bpx-player-video-wrap video'));
