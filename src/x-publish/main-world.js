/*
 * Adapted from xPoster, MIT License, Copyright (c) 2026 xPoster contributors.
 * The Markdown -> X Article engine is kept close to the original so X compatibility fixes can be carried over.
 * See THIRD_PARTY_NOTICES.md for the licence text.
 */
/* X DOM compatibility boundary: update this module when editor markup changes. */
(() => {
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
  const api = { VERSION, SELECTORS, isComposeRoute, findEditor, inspect };
  if (typeof window !== "undefined") window.qiaomuWriteXAdapter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

;
(() => {
  const version = "2026-10-21.3";
  const previous = window.__qiaomuWriteXMainV2;
  if (previous?.version === version || previous?.busy?.()) return;
  previous?.dispose?.();
  // Retire an older importer before using the isolated v2 transport.
  window.postMessage({ source: "qiaomu-write-x", kind: "cancel" }, "*");
  const LOG = "[Qiaomu X]";
  const CHANNEL_TO_MAIN = "qiaomu-write-x-v2";
  const CHANNEL_FROM_MAIN = "qiaomu-write-x-main-v2";
  const MEDIA_UPLOAD_BASE_TIMEOUT_MS = 90000;
  const MEDIA_UPLOAD_PROGRESS_HEARTBEAT_MS = 15000;
  const MEDIA_UPLOAD_TIMEOUT_ERROR =
    "X did not confirm media completion. The media may already be in the draft; check it before writing again.";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let cancelRequested = false;
  let activeRunId = null;
  let recovery = null;
  const pendingFileCancels = new Set();
  const pendingNetworkCancels = new Set();

  function post(kind, payload = {}) {
    window.postMessage({ source: CHANNEL_FROM_MAIN, runId: activeRunId, kind, ...payload }, "*");
  }

  function progress(text, level = "work") {
    post("progress", { text, level });
  }

  function throwIfCancelled() {
    if (!cancelRequested) return;
    const error = new Error("Writing stopped by user.");
    error.cancelled = true;
    throw error;
  }

  function requestPreparedFile(operation, timeoutMs = 30000) {
    throwIfCancelled();
    const runId = activeRunId;
    const token = operation?.op?.file?.token || operation?.marker || "";
    if (operation?.op?.file?.base64) return Promise.resolve(operation.op.file);
    if (!token) return Promise.reject(new Error("Prepared image token is missing"));
    const requestId = `file_${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      let retry;
      const finish = () => {
        clearTimeout(timeout); clearTimeout(retry);
        window.removeEventListener("message", listener);
        pendingFileCancels.delete(cancel);
      };
      const cancel = () => { finish(); const error = new Error("Writing stopped by user."); error.cancelled = true; reject(error); };
      const timeout = setTimeout(() => {
        finish();
        reject(new Error("Prepared image data did not arrive"));
      }, timeoutMs);
      const listener = (event) => {
        if (event.source !== window || event.data?.source !== CHANNEL_TO_MAIN) return;
        const message = event.data;
        if (message.runId !== runId || message.kind !== "file-response" || message.requestId !== requestId) return;
        finish();
        if (message.ok && message.file?.base64) resolve(message.file);
        else reject(new Error(message.error || "Prepared image data was not available"));
      };
      window.addEventListener("message", listener);
      pendingFileCancels.add(cancel);
      // Retrying a data request is safe: it does not upload the picture twice.
      retry = setTimeout(() => post("file-request", { requestId, token, marker: operation.marker }), Math.min(10000, timeoutMs / 2));
      post("file-request", { requestId, token, marker: operation.marker });
    });
  }

  function imageSourcesMatch(left, right) {
    const leftRaw = String(left || "").trim();
    const rightRaw = String(right || "").trim();
    if (!leftRaw || !rightRaw) return false;
    if (leftRaw === rightRaw) return true;
    try {
      const leftUrl = new URL(leftRaw, location.href);
      const rightUrl = new URL(rightRaw, location.href);
      leftUrl.hash = "";
      rightUrl.hash = "";
      return decodeURIComponent(leftUrl.href) === decodeURIComponent(rightUrl.href);
    } catch {
      return leftRaw.split("#")[0] === rightRaw.split("#")[0];
    }
  }

  function findEditorElement() {
    return window.qiaomuWriteXAdapter.findEditor(document, location);
  }

  function currentEditorFiber(fiber) {
    let root = fiber;
    while (root?.return) root = root.return;
    const committedRoot = root?.stateNode?.current;
    // DOM nodes may retain the alternate from an older render. Its upload
    // callback closes over old article content and can replace the new body.
    return committedRoot && committedRoot !== root ? fiber?.alternate || null : fiber;
  }

  function findDraftStateNode() {
    const editor = findEditorElement();
    if (!editor) return null;
    const fiberKey = Object.keys(editor).find(
      (key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")
    );
    if (!fiberKey) return null;
    let fiber = currentEditorFiber(editor[fiberKey]);
    for (let depth = 0; depth < 80 && fiber; depth += 1) {
      const stateNode = fiber.stateNode;
      if (stateNode?.props?.editorState && typeof stateNode.props.onChange === "function") {
        return stateNode;
      }
      fiber = fiber.return;
    }
    return null;
  }

  function findOnFilesAdded() {
    const editor = findEditorElement();
    if (!editor) return null;
    const fiberKey = Object.keys(editor).find(
      (key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")
    );
    if (!fiberKey) return null;
    let fiber = currentEditorFiber(editor[fiberKey]);
    for (let depth = 0; depth < 160 && fiber; depth += 1) {
      const props = fiber.stateNode?.props || fiber.memoizedProps;
      if (typeof props?.onFilesAdded === "function") return props.onFilesAdded;
      const nested = findOnFilesAddedInFiberChildren(fiber.child, 0);
      if (nested) return nested;
      fiber = fiber.return;
    }
    return null;
  }

  function findOnFilesAddedInFiberChildren(fiber, depth) {
    if (!fiber || depth > 8) return null;
    const props = fiber.stateNode?.props || fiber.memoizedProps;
    if (typeof props?.onFilesAdded === "function") return props.onFilesAdded;
    return findOnFilesAddedInFiberChildren(fiber.child, depth + 1) || findOnFilesAddedInFiberChildren(fiber.sibling, depth);
  }

  function pasteHtml(html, plain) {
    const editor = findEditorElement();
    if (!editor) return false;
    editor.focus();
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData("text/plain", plain || html.replace(/<[^>]*>/g, ""));
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data
    });
    if (event.clipboardData !== data) {
      Object.defineProperty(event, "clipboardData", { value: data });
    }
    return editor.dispatchEvent(event);
  }

  function isDraftCharacterMetadata(character, requireStyle = true) {
    return Boolean(character?.set && (!requireStyle || character.getStyle));
  }

  function firstCharacterMetadata(block, requireStyle = true) {
    const characterList = block?.getCharacterList?.();
    if (!characterList) return null;
    if (typeof characterList.find === "function") {
      const found = characterList.find((character) => isDraftCharacterMetadata(character, requireStyle));
      if (found) return found;
    }
    const size =
      typeof characterList.size === "number"
        ? characterList.size
        : typeof characterList.count === "function"
          ? characterList.count()
          : 0;
    for (let index = 0; index < size; index += 1) {
      const character = characterList.get?.(index);
      if (isDraftCharacterMetadata(character, requireStyle)) return character;
    }
    const first = characterList.first?.() || characterList.get?.(0);
    return isDraftCharacterMetadata(first, requireStyle) ? first : null;
  }

  function findDraftCharacterSample(draftNode) {
    const blockMap = draftNode?.props?.editorState?.getCurrentContent?.()?.getBlockMap?.();
    if (!blockMap?.find) return null;
    const block = blockMap.find((candidate) => Boolean(firstCharacterMetadata(candidate))) || null;
    return block ? { block, character: firstCharacterMetadata(block) } : null;
  }

  function findDraftSampleBlock(draftNode) {
    return findDraftCharacterSample(draftNode)?.block || null;
  }

  async function ensureDraftCharacterSample(draftNode) {
    if (findDraftSampleBlock(draftNode)) return draftNode;
    const editor = findEditorElement();
    if (!editor) return draftNode;

    editor.focus();
    document.execCommand("insertText", false, "x");

    const deadline = Date.now() + 1600;
    while (Date.now() < deadline) {
      await sleep(80);
      const latestNode = findDraftStateNode() || draftNode;
      if (findDraftSampleBlock(latestNode)) return latestNode;
    }
    return findDraftStateNode() || draftNode;
  }

  function writeDraftBlocks(draftNode, blocks) {
    if (!Array.isArray(blocks) || !blocks.length) return { ok: false, error: "No structured blocks" };

    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const SelectionState = editorState.getSelection().constructor;
    const contentState = editorState.getCurrentContent();
    const blockMap = contentState.getBlockMap();
    const sample = findDraftCharacterSample(draftNode);
    const sampleBlock = sample?.block || null;
    const sampleCharacter = sample?.character || null;
    if (!sampleBlock || !sampleCharacter) return { ok: false, error: "No Draft.js character sample for structured write" };

    const BlockMap = blockMap.constructor;
    const CharacterList = sampleBlock.getCharacterList().constructor;
    if (!sampleCharacter?.set || !sampleCharacter.getStyle) return { ok: false, error: "No Draft.js character metadata sample for structured write" };

    let nextContent = contentState;
    let nextBlockMap = BlockMap();
    const createdKeys = [];

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index] || {};
      const text = String(block.text || "");
      const key = `${Math.random().toString(36).slice(2, 7)}${index.toString(36)}`;
      let characterList = CharacterList();
      const entityRanges = new Map();

      for (const link of block.links || []) {
        const offset = Number(link.offset) || 0;
        const length = Math.max(0, Number(link.length) || 0);
        if (!length || !link.url) continue;
        nextContent = nextContent.createEntity("LINK", "MUTABLE", { url: String(link.url) });
        entityRanges.set(`${offset}:${offset + length}`, nextContent.getLastCreatedEntityKey());
      }

      for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
        const styleNames = (block.inlineStyleRanges || [])
          .filter((range) => charIndex >= range.offset && charIndex < range.offset + range.length)
          .map((range) => draftInlineStyleName(range.style))
          .filter(Boolean);
        let entity = null;
        for (const [range, entityKey] of entityRanges.entries()) {
          const [start, end] = range.split(":").map(Number);
          if (charIndex >= start && charIndex < end) {
            entity = entityKey;
            break;
          }
        }
        let style = sampleCharacter.getStyle().clear();
        for (const styleName of styleNames) style = style.add(styleName);
        characterList = characterList.push(sampleCharacter.set("style", style).set("entity", entity));
      }

      const nextBlock = sampleBlock.merge({
        key,
        type: block.type || "unstyled",
        text,
        characterList,
        depth: block.type === "unordered-list-item" || block.type === "ordered-list-item" ? 0 : 0,
        data: sampleBlock.getData?.()?.clear?.() || sampleBlock.getData?.()
      });
      nextBlockMap = nextBlockMap.set(key, nextBlock);
      createdKeys.push(key);
    }

    if (!createdKeys.length) return { ok: false, error: "No Draft.js blocks created" };
    const lastKey = createdKeys[createdKeys.length - 1];
    const selection = SelectionState.createEmpty(lastKey);
    const nextState = nextContent
      .set("blockMap", nextBlockMap)
      .set("selectionBefore", selection)
      .set("selectionAfter", selection);
    let nextEditorState = EditorState.push(editorState, nextState, "insert-fragment");
    nextEditorState = EditorState.moveSelectionToEnd(nextEditorState);
    draftNode.props.onChange(nextEditorState);
    return { ok: true, blocks: createdKeys.length };
  }

  function draftInlineStyleName(style) {
    return (
      {
        Bold: "BOLD",
        Italic: "ITALIC",
        Strikethrough: "STRIKETHROUGH",
        Code: "CODE"
      }[style] || style
    );
  }

  function findMarkerLocation(contentState, marker, options = {}) {
    const needle = String(marker || "");
    if (!needle) return null;
    let exact = null;
    let partial = null;
    contentState.getBlockMap().forEach((block, key) => {
      if (block.getType() === "atomic") return;
      const text = block.getText() || "";
      const offset = text.indexOf(needle);
      if (offset < 0) return;
      const candidate = {
        blockKey: key,
        offset,
        length: needle.length,
        exact: text.trim() === needle
      };
      if (candidate.exact && !exact) exact = candidate;
      else if (!partial) partial = candidate;
    });
    if (exact) return exact;
    return options.exactOnly ? null : partial;
  }

  function findMarkerBlock(contentState, marker, options = {}) {
    return findMarkerLocation(contentState, marker, options)?.blockKey || null;
  }

  function countMarkerTokens(draftNode, prefix) {
    if (!draftNode || !prefix) return 0;
    let count = 0;
    const markerPattern = markerTokenPattern(prefix);
    draftNode.props.editorState
      .getCurrentContent()
      .getBlockMap()
      .forEach((block) => {
        const matches = (block.getText() || "").match(markerPattern);
        if (matches?.length) count += matches.length;
      });
    return count;
  }

  async function waitForDraftMarkers(markerPrefix, expectedCount, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const latestNode = findDraftStateNode();
      if (latestNode && countMarkerTokens(latestNode, markerPrefix) >= expectedCount) {
        return latestNode;
      }
      await sleep(100);
    }
    return findDraftStateNode();
  }

  function replaceMarkerWithAtomic(contentState, marker, entityType, data, mutability, sampleBlock) {
    const blockKey = findMarkerBlock(contentState, marker, { exactOnly: true });
    if (!blockKey) return { ok: false, error: `Marker not found: ${marker}`, contentState };

    const markerBlock = contentState.getBlockMap().get(blockKey);
    const blockTemplate = markerBlock || sampleBlock;
    const characterList = markerBlock.getCharacterList();
    const markerCharacter = firstCharacterMetadata(markerBlock, false);
    const fallbackCharacter = firstCharacterMetadata(sampleBlock, false);
    const sampleCharacter = markerCharacter?.set ? markerCharacter : fallbackCharacter;
    if (!sampleCharacter?.set) return { ok: false, error: `No Draft.js character sample for marker: ${marker}`, contentState };
    const CharacterList = characterList.constructor;

    const withEntity = contentState.createEntity(entityType, mutability || "IMMUTABLE", data || {});
    const entityKey = withEntity.getLastCreatedEntityKey();
    const character = sampleCharacter.set("entity", entityKey);
    const atomicBlock = blockTemplate.merge({
      key: blockKey,
      type: "atomic",
      text: " ",
      characterList: CharacterList([character]),
      depth: 0
    });
    const blockMap = withEntity.getBlockMap().set(blockKey, atomicBlock);
    return { ok: true, entityKey, contentState: withEntity.set("blockMap", blockMap) };
  }

  function insertAtomicBatch(draftNode, operations) {
    if (!operations.length) return { okCount: 0, failCount: 0, errors: [] };
    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const SelectionState = editorState.getSelection().constructor;
    let contentState = editorState.getCurrentContent();
    const sampleBlock = findDraftSampleBlock(draftNode);
    let okCount = 0;
    const errors = [];

    for (const item of operations) {
      const result = replaceMarkerWithAtomic(
        contentState,
        item.marker,
        item.op.entityType,
        item.op.data || {},
        item.op.mutability || "IMMUTABLE",
        sampleBlock
      );
      if (result.ok) {
        contentState = result.contentState;
        okCount += 1;
      } else {
        errors.push(result.error);
      }
    }

    if (okCount > 0) {
      const lastKey = contentState.getBlockMap().last().getKey();
      const selection = SelectionState.createEmpty(lastKey);
      const nextContent = contentState.set("selectionBefore", selection).set("selectionAfter", selection);
      let nextEditorState = EditorState.push(editorState, nextContent, "insert-fragment");
      nextEditorState = EditorState.moveSelectionToEnd(nextEditorState);
      draftNode.props.onChange(nextEditorState);
    }

    return { okCount, failCount: errors.length, errors };
  }

  function base64ToFile(base64, fileName, mime) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], fileName, { type: mime });
  }

  function uploadFilesToEditor(filePayloads = []) {
    const onFilesAdded = findOnFilesAdded();
    if (!onFilesAdded) return { ok: false, error: "X upload handler was not reachable" };
    const files = filePayloads
      .filter((file) => file?.base64)
      .map((file, index) =>
        base64ToFile(
          file.base64,
          file.fileName || `image-${index + 1}.png`,
          file.mime || "image/png"
        )
      );
    if (!files.length) return { ok: false, error: "No image file data was provided" };
    const editor = findEditorElement();
    editor?.focus?.();
    onFilesAdded(files);
    return {
      ok: true,
      count: files.length,
      files: files.map((file) => ({ name: file.name, type: file.type, size: file.size }))
    };
  }

  function existingMediaEntities(contentState) {
    const entities = new Set();
    entities.blockKeys = new Set();
    contentState.getBlockMap().forEach((block, blockKey) => {
      if (block.getType() !== "atomic") return;
      entities.blockKeys.add(blockKey);
      block.findEntityRanges(character => Boolean(character.getEntity()), start => {
        const key = block.getCharacterList().get(start)?.getEntity?.();
        if (key) entities.add(key);
      });
    });
    return entities;
  }

  // Draft data can be plain objects or Immutable/Map collections. Only named
  // identity fields count: duration, dimensions and progress are never IDs.
  function mediaEntries(value) {
    if (!value || typeof value !== "object") return [];
    try {
      if (typeof value.entrySeq === "function") return value.entrySeq().toArray();
      if (Object.prototype.toString.call(value) === "[object Map]") return Array.from(value.entries());
      return Object.entries(value);
    } catch { return []; }
  }

  function walkMediaData(data, visit, depth = 0, seen = new Set()) {
    if (!data || typeof data !== "object" || depth > 7 || seen.has(data)) return;
    seen.add(data);
    for (const [key, value] of mediaEntries(data)) {
      visit(String(key), value);
      walkMediaData(value, visit, depth + 1, seen);
    }
  }

  function normalizeMediaIdValue(value) {
    if (typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value))) return null;
    const text = String(value).trim();
    const match = text.match(/^(?:\d+_)?(\d{8,})$/);
    return match ? match[1] : null;
  }

  function mediaIdFromEntityData(data = {}) {
    const seen = new Set();
    function find(value, generic, depth) {
      if (!value || typeof value !== "object" || depth > 7 || seen.has(value)) return null;
      seen.add(value);
      const entries = mediaEntries(value);
      for (const [key, child] of entries) {
        if (/^(?:media_?id(?:_string)?|mediaID|mediaIdString|media_?key)$/i.test(String(key)) ||
            (generic && /^(?:id_str|rest_id|id)$/i.test(String(key)))) {
          const id = normalizeMediaIdValue(child); if (id) return id;
        }
      }
      for (const [key, child] of entries) {
        const id = find(child, (Array.isArray(value) || /^\d+$/.test(String(key))) ? generic : /^(?:mediaItems?|media_items?|media|upload|uploadResult|result|data)$/i.test(String(key)), depth + 1);
        if (id) return id;
      }
      return null;
    }
    return find(data, true, 0);
  }

  function mediaEntityState(data) {
    const mediaId = mediaIdFromEntityData(data);
    let processing = false, failed = false, error = "", progress = null, remoteAsset = false;
    walkMediaData(data, (key, value) => {
      if (typeof value === "string" && /^(?:url|src|media_url_https|media_url)$/i.test(key)) {
        try { const url = new URL(value); remoteAsset ||= url.protocol === "https:" &&
          ((url.hostname === "video.twimg.com" && /\/(?:tweet_video|ext_tw_video|amplify_video)\//.test(url.pathname)) ||
           (url.hostname === "pbs.twimg.com" && url.pathname.startsWith("/media/"))); } catch {}
      }
      if (/^(?:state|status|uploadStatus|uploadState|processingState)$/i.test(key) && typeof value === "string") {
        const state = value.toLowerCase();
        processing ||= ["pending", "in_progress", "uploading", "processing", "transcoding", "initializing"].includes(state);
        failed ||= ["failed", "error", "canceled", "cancelled"].includes(state);
      }
      if (/^(?:isUploading|isProcessing|uploading|processing)$/i.test(key) && value === true) processing = true;
      if (/^(?:processing_info|processingInfo)$/i.test(key) && value && typeof value === "object") {
        const state = mediaEntries(value).find(([name]) => name === "state")?.[1];
        if (state !== "succeeded" && state !== "failed") processing = true;
      }
      if (key === "errors" && Array.isArray(value) && value.length) { failed = true; error ||= String(value[0]?.message || "X media processing failed"); }
      if (/^(?:error|uploadError|processingError)$/i.test(key) && value) {
        const message = typeof value === "string" ? value : value.message || value.name || (value.code ? "X media processing failed" : "");
        if (message) { failed = true; error ||= String(message); }
      }
      if (/^(?:progress_percent|progressPercent|uploadProgress)$/i.test(key) && typeof value === "number" && Number.isFinite(value)) progress = value;
    });
    return { mediaId, state: failed ? "failed" : processing ? "processing" : mediaId || remoteAsset ? "ready" : "pending", error, progress };
  }

  function findNewMediaUpload(contentState, existingEntities) {
    const candidates = [];
    contentState.getBlockMap().forEach((block, blockKey) => {
      if (block.getType() !== "atomic" || existingEntities.blockKeys?.has(blockKey)) return;
      block.findEntityRanges(character => Boolean(character.getEntity()), start => {
        const entityKey = block.getCharacterList().get(start)?.getEntity?.();
        if (!entityKey || existingEntities.has(entityKey)) return;
        try {
          const entity = contentState.getEntity(entityKey), entityType = entity.getType();
          if (!["MEDIA", "VIDEO", "IMAGE", "GIF", "ANIMATED_GIF"].includes(entityType)) return;
          const data = entity.getData();
          candidates.push({ entityKey, blockKey, entityType, dataKeys: mediaEntries(data).map(([key]) => String(key)).slice(0, 12), ...mediaEntityState(data) });
        } catch {}
      });
    });
    // Never attribute an unrelated/new user upload to the current operation.
    const unique = new Map(candidates.map(item => [item.entityKey, item]));
    return unique.size === 1 ? unique.values().next().value : null;
  }

  // Observe only X's native media responses during this one import operation.
  // No requests, credentials, request bodies or original response objects leave
  // the page. INIT is not completion; FINALIZE/STATUS own that decision.
  function observeNativeMediaUpload(file) {
    let active = true, fileFailure = null;
    const sessions = new Map(), removers = [];
    const nativeFetch = window.fetch, xhr = window.XMLHttpRequest?.prototype;
    const nativeOpen = xhr?.open, nativeSend = xhr?.send;
    const requests = new WeakMap();
    function requestInfo(input, body) {
      try {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
        if (!["upload.twitter.com", "upload.x.com", "api.x.com", "api.twitter.com", "x.com"].includes(url.hostname) ||
            !/\/(?:i|1\.1|2)\/media\/upload(?:\.json|\/|$)/.test(url.pathname)) return null;
        const values = new URLSearchParams(url.search);
        if (typeof body === "string") {
          try { const json = JSON.parse(body); for (const key of ["command", "media_id", "total_bytes", "media_type"]) if (json[key] != null) values.set(key, String(json[key])); }
          catch { for (const [key, value] of new URLSearchParams(body)) if (["command", "media_id", "total_bytes", "media_type"].includes(key)) values.set(key, value); }
        } else if (body && typeof body.get === "function") {
          for (const key of ["command", "media_id", "total_bytes", "media_type"]) { const value = body.get(key); if (typeof value === "string") values.set(key, value); }
        }
        let command = (values.get("command") || "").toUpperCase();
        if (!command) command = /\/initialize$/.test(url.pathname) ? "INIT" : /\/finalize$/.test(url.pathname) ? "FINALIZE" : /\/append$/.test(url.pathname) ? "APPEND" : "STATUS";
        return { command, id: normalizeMediaIdValue(values.get("media_id") || url.pathname.match(/upload\/(\d+)/)?.[1]), matchesFile: Number(values.get("total_bytes")) === file.size && values.get("media_type") === file.type };
      } catch { return null; }
    }
    function record(info, body, httpStatus) {
      if (!active || !info) return;
      const data = body?.data || body || {}, id = mediaIdFromEntityData(data) || info.id;
      if (!id) {
        if (info.matchesFile && httpStatus >= 400) fileFailure = { state: "failed", error: `X media request failed (HTTP ${httpStatus})` };
        return;
      }
      const previous = sessions.get(id), state = mediaEntityState(data);
      const hasProcessing = state.state === "processing";
      const ready = state.state !== "failed" && httpStatus >= 200 && httpStatus < 300 && ["FINALIZE", "STATUS"].includes(info.command) && !hasProcessing;
      sessions.set(id, { mediaId: id, matchesFile: previous?.matchesFile || (info.command === "INIT" && info.matchesFile),
        state: httpStatus >= 400 || state.state === "failed" ? "failed" : ready ? "ready" : hasProcessing ? "processing" : "pending",
        progress: state.progress, error: state.error || (httpStatus >= 400 ? `X media request failed (HTTP ${httpStatus})` : "") });
    }
    function wrappedFetch(input, init) {
      const info = requestInfo(input, init?.body);
      const result = nativeFetch.apply(this, arguments);
      if (info) Promise.resolve(result).then(response => {
        if (active) response.clone().json().then(body => record(info, body, response.status)).catch(() => {});
      }, () => {});
      return result;
    }
    function wrappedOpen(method, url) { requests.set(this, { url: String(url) }); return nativeOpen.apply(this, arguments); }
    function wrappedSend(body) {
      const request = requests.get(this), info = request && requestInfo(request.url, body);
      if (info) {
        const loaded = () => {
          this.removeEventListener("loadend", loaded);
          if (!active) return;
          try { record(info, this.responseType === "json" ? this.response : JSON.parse(this.responseText), this.status); } catch {}
        };
        this.addEventListener("loadend", loaded);
        removers.push(() => this.removeEventListener("loadend", loaded));
      }
      return nativeSend.apply(this, arguments);
    }
    try { if (nativeFetch) window.fetch = wrappedFetch; } catch { /* Read-only host API: editor state remains the fallback. */ }
    try { if (nativeOpen && nativeSend) { xhr.open = wrappedOpen; xhr.send = wrappedSend; } } catch { /* A host may lock these methods. */ }
    return {
      status(mediaId) {
        if (fileFailure) return fileFailure;
        if (mediaId) return sessions.get(mediaId) || null;
        const matched = Array.from(sessions.values()).filter(item => item.matchesFile);
        return matched.length === 1 ? matched[0] : null;
      },
      dispose() {
        active = false;
        try { if (window.fetch === wrappedFetch) window.fetch = nativeFetch; } catch {}
        try { if (xhr?.open === wrappedOpen) xhr.open = nativeOpen; } catch {}
        try { if (xhr?.send === wrappedSend) xhr.send = nativeSend; } catch {}
        for (const remove of removers) remove();
      }
    };
  }

  function placeSelectionAtMarker(draftNode, marker) {
    const editorState = draftNode.props.editorState;
    const SelectionState = editorState.getSelection().constructor;
    const EditorState = editorState.constructor;
    const contentState = editorState.getCurrentContent();
    const location = findMarkerLocation(contentState, marker);
    if (!location) return null;
    const selection = SelectionState.createEmpty(location.blockKey).merge({
      anchorOffset: location.offset,
      focusOffset: location.offset
    });
    draftNode.props.onChange(EditorState.forceSelection(editorState, selection));
    return location;
  }

  async function uploadImageAtMarker(draftNode, imageOperation, existingAtomicBlocks, context = {}) {
    throwIfCancelled();
    const markerLocation = placeSelectionAtMarker(draftNode, imageOperation.marker);
    if (!markerLocation) {
      return { ok: false, error: "Image placeholder was not found in the X editor" };
    }
    await sleep(80);

    draftNode = findDraftStateNode() || draftNode;
    const before = existingMediaEntities(draftNode.props.editorState.getCurrentContent());
    // A stale render must never make a previously completed block look new.
    before.blockKeys ||= new Set();
    for (const key of existingAtomicBlocks) before.blockKeys.add(key);
    const preparedFile = await requestPreparedFile(imageOperation);
    throwIfCancelled();
    const file = base64ToFile(preparedFile.base64, preparedFile.fileName, preparedFile.mime);

    // Resolve after selection and file preparation, when React has committed
    // the current body and caret to the uploader's closure.
    const onFilesAdded = findOnFilesAdded();
    if (!onFilesAdded) return { ok: false, error: "X upload handler was not reachable" };
    let uploadError = null;
    const nativeUpload = observeNativeMediaUpload(file);
    const inflight = context.checkpoint?.inflight;
    if (inflight) Object.assign(inflight, { before, location: { markerBlock: markerLocation.blockKey, markerOffset: markerLocation.offset, markerLength: markerLocation.length, markerExact: markerLocation.exact } });
    // Videos and GIFs have an additional processing stage. A hard upper bound
    // still applies; ordinary images retain their existing 90-second budget.
    const animated = file.type === "image/gif" || file.type.startsWith("video/");
    const timeoutMs = animated ? 600000 : MEDIA_UPLOAD_BASE_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    let nextProgressAt = 0, pendingUpload = null;
    try {
      if (inflight) inflight.handedOff = true;
      Promise.resolve(onFilesAdded([file])).catch(error => { uploadError = error; if (inflight) inflight.failed = true; });
      while (Date.now() < deadline) {
        throwIfCancelled();
        if (context.articleId && articleIdFromUrl() !== context.articleId) throw new Error("The X draft changed during upload. Writing stopped.");
        await sleep(350);
        if (uploadError) return { ok: false, error: String(uploadError.message || uploadError) };
        draftNode = findDraftStateNode() || draftNode;
        const found = findNewMediaUpload(draftNode.props.editorState.getCurrentContent(), before);
        const native = nativeUpload.status(found?.mediaId);
        if (found) { pendingUpload = found; if (inflight) inflight.blockKey = found.blockKey; }
        if (inflight && native) inflight.native = { ...native };
        const state = native?.state === "failed" || found?.state === "failed" ? "failed" : native?.state || found?.state;
        if (state === "failed") return { ok: false, error: native?.error || found?.error || "X media processing failed" };
        if (found && state === "ready") {
          existingAtomicBlocks.add(found.blockKey);
          return { ok: true, ...found, mediaId: native?.mediaId || found.mediaId,
            markerBlock: markerLocation.blockKey, markerOffset: markerLocation.offset,
            markerLength: markerLocation.length, markerExact: markerLocation.exact };
        }
        if (Date.now() >= nextProgressAt) {
          const index = Number(context.index || 0), total = Number(context.total || 0);
          if (index && total) progress(`Uploading media ${index}/${total}... ${state === "processing" ? "X is processing" : "waiting for completion"}${native?.progress != null || found?.progress != null ? ` (${native?.progress ?? found.progress}%)` : ""}`);
          nextProgressAt = Date.now() + MEDIA_UPLOAD_PROGRESS_HEARTBEAT_MS;
        }
      }
      const detail = pendingUpload ? ` [${pendingUpload.entityType || "MEDIA"}; ${(pendingUpload.dataKeys || []).join(", ")}]` : "";
      return { ok: false, error: MEDIA_UPLOAD_TIMEOUT_ERROR + detail, timeout: true, timeoutMs, pendingEntity: Boolean(pendingUpload) };
    } finally {
      if (inflight) {
        const found = findNewMediaUpload((findDraftStateNode() || draftNode).props.editorState.getCurrentContent(), before);
        if (found) inflight.blockKey = found.blockKey;
        const native = nativeUpload.status(found?.mediaId); if (native) inflight.native = { ...native };
      }
      nativeUpload.dispose();
    }
  }

  function replaceMarkerText(draftNode, marker, text) {
    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const SelectionState = editorState.getSelection().constructor;
    const contentState = editorState.getCurrentContent();
    const blockMap = contentState.getBlockMap();
    const location = findMarkerLocation(contentState, marker);
    if (!location) return false;
    const blockKey = location.blockKey;
    const block = blockMap.get(blockKey);
    const replacement = String(text || "");
    const currentText = block.getText() || "";
    const nextText = location.exact
      ? replacement
      : `${currentText.slice(0, location.offset)}${replacement}${currentText.slice(location.offset + location.length)}`;
    if (!nextText.trim()) return deleteBlockByKey(draftNode, blockKey).ok;
    const characterFactory = block.getCharacterList().get(0)?.constructor;
    const character = characterFactory ? characterFactory.create({}) : null;
    const characterList = block.getCharacterList().clear().concat(Array.from({ length: nextText.length }, () => character));
    const nextBlock = block.merge({ text: nextText, characterList });
    const selection = SelectionState.createEmpty(blockKey);
    const nextContent = contentState
      .set("blockMap", blockMap.set(blockKey, nextBlock))
      .set("selectionBefore", selection)
      .set("selectionAfter", selection);
    draftNode.props.onChange(EditorState.push(editorState, nextContent, "change-block-data"));
    return true;
  }

  function markerTokenPattern(markerPrefix) {
    const prefix = String(markerPrefix || "__XPOSTER_").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`${prefix}[A-Z]+_\\d+__`, "g");
  }

  function allMarkerTokenPattern() {
    return /__XPOSTER_[A-Za-z0-9]+_[A-Z]+_\d+__/g;
  }

  function relocateImages(draftNode, uploads, protectedAtomicBlocks) {
    if (!uploads.length) return { moved: 0, missing: 0 };
    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const SelectionState = editorState.getSelection().constructor;
    const contentState = editorState.getCurrentContent();
    const blockMap = contentState.getBlockMap();
    const entityToBlock = new Map();
    const mediaBlocks = [];

    for (const upload of uploads) {
      if (upload.markerBlock && blockMap.has(upload.markerBlock)) continue;
      const location = findMarkerLocation(contentState, upload.marker);
      if (location) {
        upload.markerBlock = location.blockKey;
        upload.markerOffset = location.offset;
        upload.markerLength = location.length;
        upload.markerExact = location.exact;
      }
    }

    blockMap.forEach((block, blockKey) => {
      if (block.getType() === "atomic") {
        let firstEntity = null;
        block.findEntityRanges(
          (character) => Boolean(character.getEntity()),
          (start) => {
            const entityKey = block.getCharacterList().get(start)?.getEntity?.();
            if (entityKey) {
              firstEntity ||= entityKey;
              entityToBlock.set(entityKey, blockKey);
            }
          }
        );
        if (!protectedAtomicBlocks.has(blockKey) && firstEntity) {
          try {
            if (["MEDIA", "VIDEO", "IMAGE", "GIF", "ANIMATED_GIF"].includes(contentState.getEntity(firstEntity).getType())) {
              mediaBlocks.push({ blockKey, entityKey: firstEntity });
            }
          } catch {}
        }
      }
    });

    const moves = new Map();
    let missing = 0;
    let fallbackIndex = 0;

    for (const upload of uploads) {
      if (!upload.markerBlock || !blockMap.has(upload.markerBlock)) {
        missing += 1;
        continue;
      }
      let imageBlock = upload.entityKey ? entityToBlock.get(upload.entityKey) : null;
      if (!imageBlock) {
        while (fallbackIndex < mediaBlocks.length && moves.has(mediaBlocks[fallbackIndex].blockKey)) {
          fallbackIndex += 1;
        }
        imageBlock = mediaBlocks[fallbackIndex]?.blockKey || null;
        fallbackIndex += 1;
      }
      if (!imageBlock) {
        missing += 1;
        continue;
      }
      if (imageBlock !== upload.markerBlock) {
        moves.set(upload.markerBlock, {
          imageBlock,
          markerExact: upload.markerExact !== false
        });
      }
    }

    if (!moves.size) return { moved: 0, missing };
    const destinationBlocks = new Set(Array.from(moves.values()).map((move) => move.imageBlock));
    const orderedKeys = [];
    blockMap.forEach((block, key) => {
      if (moves.has(key)) {
        const move = moves.get(key);
        if (move.markerExact) orderedKeys.push(move.imageBlock);
        else {
          orderedKeys.push(move.imageBlock);
          orderedKeys.push(key);
        }
      } else if (!destinationBlocks.has(key)) orderedKeys.push(key);
    });

    let nextBlockMap = blockMap.constructor();
    for (const key of orderedKeys) nextBlockMap = nextBlockMap.set(key, blockMap.get(key));
    const selection = SelectionState.createEmpty(orderedKeys[orderedKeys.length - 1]);
    const nextContent = contentState
      .set("blockMap", nextBlockMap)
      .set("selectionBefore", selection)
      .set("selectionAfter", selection);
    let nextEditorState = EditorState.push(editorState, nextContent, "remove-range");
    nextEditorState = EditorState.moveSelectionToEnd(nextEditorState);
    draftNode.props.onChange(nextEditorState);
    return { moved: moves.size, missing };
  }

  function cleanupMarkers(draftNode, markerPrefix) {
    const resolvedPrefix = String(markerPrefix || "__XPOSTER_");
    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const SelectionState = editorState.getSelection().constructor;
    const contentState = editorState.getCurrentContent();
    let blockMap = contentState.getBlockMap();
    const toDelete = [];
    const replacements = [];
    const markerPattern = markerTokenPattern(resolvedPrefix);
    blockMap.forEach((block, key) => {
      if (block.getType() === "atomic") return;
      const text = block.getText() || "";
      if (!text.includes(resolvedPrefix)) return;
      const cleaned = text
        .replace(markerPattern, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (!cleaned) {
        toDelete.push(key);
      } else if (cleaned !== text) {
        replacements.push({ key, text: cleaned });
      }
    });
    if (!toDelete.length && !replacements.length) return 0;
    for (const replacement of replacements) {
      const block = blockMap.get(replacement.key);
      if (!block) continue;
      const characterFactory = block.getCharacterList().get(0)?.constructor;
      const character = characterFactory ? characterFactory.create({}) : null;
      const characterList = block.getCharacterList().clear().concat(
        Array.from({ length: replacement.text.length }, () => character)
      );
      blockMap = blockMap.set(replacement.key, block.merge({ text: replacement.text, characterList }));
    }
    for (const key of toDelete) blockMap = blockMap.delete(key);
    const lastKey = blockMap.last()?.getKey?.();
    const selection = lastKey ? SelectionState.createEmpty(lastKey) : editorState.getSelection();
    const nextContent = contentState
      .set("blockMap", blockMap)
      .set("selectionBefore", selection)
      .set("selectionAfter", selection);
    let nextEditorState = EditorState.push(editorState, nextContent, "remove-range");
    nextEditorState = EditorState.moveSelectionToEnd(nextEditorState);
    draftNode.props.onChange(nextEditorState);
    return toDelete.length + replacements.length;
  }

  function assertImportedMedia(content, uploads, markerPrefix) {
    const text = content.getPlainText ? content.getPlainText('\n') : '';
    if (markerTokenPattern(markerPrefix).test(text)) throw new Error('X still contains unfinished media placeholders. Your draft is preserved.');
    const blocks = content.getBlockMap();
    const unique = new Set();
    for (const upload of uploads) {
      if (!upload.coverOnly && unique.has(upload.blockKey)) throw new Error('Two uploads resolved to the same X media block. Your draft is preserved.');
      unique.add(upload.blockKey);
      if (!upload.coverOnly && (!blocks.has(upload.blockKey) || blocks.get(upload.blockKey).getType() !== 'atomic')) throw new Error('An uploaded media block is missing from the X draft. Your draft is preserved.');
    }
  }

  function kickRender(draftNode) {
    try {
      const EditorState = draftNode.props.editorState.constructor;
      draftNode.props.onChange(EditorState.moveSelectionToEnd(draftNode.props.editorState));
    } catch (error) {
      console.warn(LOG, "render kick failed", error);
    }
  }

  const GRAPHQL_FEATURES = {
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    rweb_tipjar_consumption_enabled: false,
    verified_phone_label_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true
  };

  const X_BEARER_TOKEN =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

  function articleIdFromUrl() {
    return location.href.match(/\/articles\/edit\/(\d+)/)?.[1] || null;
  }

  function csrfToken() {
    return document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1] || "";
  }

  async function xGraphql(queryId, operationName, body) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    pendingNetworkCancels.add(cancel);
    const timeout = setTimeout(cancel, 25000);
    try {
    const response = await fetch(`https://x.com/i/api/graphql/${queryId}/${operationName}`, {
      signal: controller.signal,
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${X_BEARER_TOKEN}`,
        "x-csrf-token": csrfToken(),
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session"
      },
      body: JSON.stringify(body)
    });
    let text = "";
    try {
      text = await response.text();
    } catch {}
    return { ok: response.ok, status: response.status, body: text.slice(0, 240) };
    } finally { clearTimeout(timeout); pendingNetworkCancels.delete(cancel); }
  }

  function updateTitleGraphql(articleId, title) {
    return xGraphql("x75E2ABzm8_mGTg1bz8hcA", "ArticleEntityUpdateTitle", {
      variables: { articleEntityId: articleId, title: String(title) },
      features: GRAPHQL_FEATURES,
      queryId: "x75E2ABzm8_mGTg1bz8hcA"
    });
  }

  function updateCoverGraphql(articleId, mediaId, category = "DraftTweetImage") {
    return xGraphql("Es8InPh7mEkK9PxclxFAVQ", "ArticleEntityUpdateCoverMedia", {
      variables: {
        articleEntityId: articleId,
        coverMedia: { media_id: String(mediaId), media_category: category }
      },
      features: GRAPHQL_FEATURES,
      queryId: "Es8InPh7mEkK9PxclxFAVQ"
    });
  }

  function deleteBlockByKey(draftNode, blockKey) {
    if (!blockKey) return { ok: false, error: "Missing block key" };
    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const SelectionState = editorState.getSelection().constructor;
    const contentState = editorState.getCurrentContent();
    const blockMap = contentState.getBlockMap();
    if (!blockMap.has(blockKey)) return { ok: false, error: "Block not found" };
    const nextBlockMap = blockMap.delete(blockKey);
    const lastKey = nextBlockMap.last()?.getKey?.();
    const selection = lastKey ? SelectionState.createEmpty(lastKey) : editorState.getSelection();
    const nextContent = contentState
      .set("blockMap", nextBlockMap)
      .set("selectionBefore", selection)
      .set("selectionAfter", selection);
    let nextEditorState = EditorState.push(editorState, nextContent, "remove-range");
    nextEditorState = EditorState.moveSelectionToEnd(nextEditorState);
    draftNode.props.onChange(nextEditorState);
    return { ok: true };
  }

  async function setTitleViaUi(title) {
    if (!title) return { ok: true, skipped: true };
    const editor = findEditorElement();
    const candidates = Array.from(document.querySelectorAll("input[type='text'], textarea, [contenteditable='true']")).filter(
      (element) => element !== editor && isVisible(element)
    );
    const titleWords = ["title", "标题", "add title", "输入标题"];
    let best = null;
    let score = -1;
    for (const element of candidates) {
      const haystack = [
        element.getAttribute("aria-label"),
        element.getAttribute("placeholder"),
        element.getAttribute("data-testid")
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const rect = element.getBoundingClientRect();
      let current = 0;
      if (titleWords.some((word) => haystack.includes(word))) current += 10;
      if (rect.top < 420) current += 3;
      if (rect.width > 240) current += 2;
      if (current > score) {
        score = current;
        best = element;
      }
    }
    if (!best || score <= 0) return { ok: false, error: "Title field not found" };
    if (best instanceof HTMLInputElement || best instanceof HTMLTextAreaElement) {
      const proto = best instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(best, String(title));
      best.dispatchEvent(new Event("input", { bubbles: true }));
      best.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      best.focus();
      await sleep(80);
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, String(title));
      best.dispatchEvent(new Event("input", { bubbles: true }));
      best.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: true };
  }

  async function applyTitleMetadata(title, articleId, summary) {
    if (!title) return false;
    throwIfCancelled();
    progress("Setting title...");
    summary.title.articleId = articleId || summary.title.articleId || null;
    const result = await setTitleViaUi(title);
    summary.title.ui = result;
    if (!result.ok) console.warn(LOG, "title failed", result.error);
    if (articleId && !summary.title.graphql?.ok) {
      const graphResult = await updateTitleGraphql(articleId, title).catch((error) => ({
        ok: false,
        error: error?.message || String(error)
      }));
      summary.title.graphql = graphResult;
      if (!graphResult.ok) console.warn(LOG, "title GraphQL failed", graphResult);
    } else if (!articleId) {
      summary.title.graphql = { ok: false, skipped: true, reason: "No article id in URL" };
    }
    return Boolean(result.ok || summary.title.graphql?.ok);
  }

  async function applyTitleGraphqlMetadata(title, articleId, summary) {
    if (!title || !articleId || summary.title.graphql?.ok) return false;
    throwIfCancelled();
    summary.title.articleId = articleId;
    const graphResult = await updateTitleGraphql(articleId, title).catch((error) => ({
      ok: false,
      error: error?.message || String(error)
    }));
    summary.title.graphql = graphResult;
    if (!graphResult.ok) console.warn(LOG, "title GraphQL failed", graphResult);
    return Boolean(graphResult.ok);
  }

  function uploadMatchesCover(upload, coverSource) {
    return Boolean(upload?.mediaId && coverSource && imageSourcesMatch(upload.source, coverSource));
  }

  function imageOperationKind(operation) {
    if (operation?.op?.coverOnly) return "cover";
    if (String(operation?.marker || "").includes("_TABLE_")) return "table";
    return "image";
  }

  async function applyCoverMetadata(coverSource, articleId, upload, summary) {
    if (!uploadMatchesCover(upload, coverSource) || summary.cover.graphql || summary.cover.skippedReason) return false;
    summary.cover.matchedUpload = true;
    summary.cover.mediaIdSuffix = upload.mediaId ? upload.mediaId.slice(-8) : null;
    if (!articleId) {
      summary.cover.skippedReason = "No article id in URL";
      console.warn(LOG, "cover update skipped: no article id");
      return false;
    }
    throwIfCancelled();
    progress("Setting cover...");
    const result = await updateCoverGraphql(articleId, upload.mediaId).catch((error) => ({
      ok: false,
      error: error?.message || String(error)
    }));
    summary.cover.graphql = result;
    if (!result.ok) console.warn(LOG, "cover update failed", result);
    return Boolean(result.ok);
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function articleTextBlocks(content) {
    const texts = [];
    content.getBlockMap().forEach(block => {
      const text = String(block.getText() || "").replace(allMarkerTokenPattern(), "").replace(/\s+/g, "");
      if (text) texts.push(text);
    });
    return texts;
  }

  function assertArticleTextPreserved(expected, content) {
    const actual = articleTextBlocks(content).join("");
    if (expected.some(text => !actual.includes(text))) {
      throw new Error("X changed the article body during media upload. Writing stopped; your original Markdown is preserved in local records.");
    }
  }

  // A checkpoint belongs to one exact source and one still-open X draft.
  // It stores immutable Draft blocks, not a second copy of the whole editor.
  function recoverySignature(content) {
    const rows = [];
    content.getBlockMap().forEach((block, key) => {
      if (block.getType() === "atomic") return;
      const characters = block.getCharacterList?.(), linked = [];
      characters?.forEach?.(character => { const entityKey = character.getEntity?.(); if(entityKey) { const entity = content.getEntity(entityKey); linked.push([entityKey,entity.getType(),entity.getData()]); } });
      rows.push([key, block.getType(), block.getText(), block.getData?.()?.toJS?.(), characters?.toJS?.(), linked]);
    });
    return JSON.stringify(rows);
  }

  function recoveryMedia(content) {
    const result = [];
    content.getBlockMap().forEach((block, blockKey) => {
      if (block.getType() !== "atomic") return;
      let first = null;
      block.findEntityRanges(character => Boolean(character.getEntity()), start => { first ||= block.getCharacterList().get(start)?.getEntity?.(); });
      if (!first) return;
      const entity = content.getEntity(first);
      if (["MEDIA", "VIDEO", "IMAGE", "GIF", "ANIMATED_GIF"].includes(entity.getType())) result.push({ blockKey, entityKey: first, ...mediaEntityState(entity.getData()) });
    });
    return result;
  }

  function validateRecovery(checkpoint, sourceMarkdown, articleId, content) {
    if (!checkpoint || !sourceMarkdown || checkpoint.payload.sourceMarkdown !== sourceMarkdown || checkpoint.articleId !== articleId) throw new Error("This draft has no matching upload checkpoint. Check the draft before starting again.");
    if (checkpoint.signature !== recoverySignature(content)) throw new Error("The draft was edited after stopping. Resume was stopped to preserve your changes.");
    const media = recoveryMedia(content), matched = new Set(), completed = checkpoint.uploads.map(upload => {
      const current = media.find(item => item.blockKey === upload.blockKey) || media.find(item => !matched.has(item.blockKey) && (item.entityKey === upload.entityKey || (upload.mediaId && item.mediaId === upload.mediaId)));
      if(current) { if(upload.mediaId && current.mediaId && current.mediaId!==upload.mediaId) throw new Error("An uploaded media item was removed or changed. Check the draft before resuming."); matched.add(current.blockKey); }
      if (!current && !(upload.coverOnly && checkpoint.summary.cover.bodyBlockDeleted?.ok)) throw new Error("An uploaded media item was removed or changed. Check the draft before resuming.");
      return current ? { ...upload, blockKey: current.blockKey, entityKey: current.entityKey } : upload;
    });
    const inflight = checkpoint.inflight;
    let resolved = null, failedBlockKey = null, candidate = null;
    if (inflight?.handedOff) {
      candidate = media.find(item => item.blockKey === inflight.blockKey) || media.find(item => !matched.has(item.blockKey) && inflight.native?.mediaId && item.mediaId === inflight.native.mediaId);
      if (!candidate) {
        const unexpected = media.filter(item => !inflight.before.blockKeys?.has(item.blockKey));
        if (unexpected.length) throw new Error("The current media status is uncertain. Check X before resuming to avoid duplicates.");
        if (!inflight.failed && inflight.native?.state !== "failed") throw new Error("The current media status is uncertain. Check X before resuming to avoid duplicates.");
      } else if (candidate.state === "ready" || inflight.native?.state === "ready") {
        resolved = { ...candidate, mediaId: inflight.native?.mediaId || candidate.mediaId, ...inflight.location, marker: inflight.operation.marker, source: inflight.operation.op.source, coverOnly: Boolean(inflight.operation.op.coverOnly) };
      } else if (candidate.state === "failed" || inflight.failed || inflight.native?.state === "failed") failedBlockKey = candidate.blockKey;
      else throw new Error("X is still processing the current media. Wait for it to finish before resuming.");
    }
    const allowed = new Set([...checkpoint.protectedAtomicBlocks, ...completed.map(item => item.blockKey), ...(candidate ? [candidate.blockKey] : [])]);
    content.getBlockMap().forEach((block, key) => { if (block.getType() === "atomic" && !allowed.has(key)) throw new Error("The draft media changed after stopping. Check it before resuming."); });
    for (const fallback of checkpoint.fallbacks || []) {
      if (content.getBlockMap().get(fallback.key)?.getText() !== fallback.text) throw new Error("The draft was edited after stopping. Resume was stopped to preserve your changes.");
    }
    return { completed, resolved, failedBlockKey };
  }

  function restoreRecoveryMarkers(draftNode, checkpoint) {
    const editorState = draftNode.props.editorState, EditorState = editorState.constructor;
    let content = editorState.getCurrentContent(), blocks = content.getBlockMap();
    for (const fallback of checkpoint.fallbacks || []) blocks = blocks.set(fallback.key, fallback.original);
    content = content.set("blockMap", blocks);
    draftNode.props.onChange(EditorState.push(editorState, content, "insert-characters"));
    checkpoint.fallbacks = [];
  }

  async function runFlow(payload) {
    cancelRequested = false;
    const resuming = Boolean(payload.resume);
    let checkpoint = resuming ? recovery : null;
    let draftNode = findDraftStateNode();
    if (!draftNode) throw new Error("X Draft.js editor was not reachable");
    let articleId = articleIdFromUrl();
    let resumeState = null;
    if (resuming) {
      try { resumeState = validateRecovery(checkpoint, payload.sourceMarkdown, articleId, draftNode.props.editorState.getCurrentContent()); }
      catch(error) { if(checkpoint && /^(The current media status|X is still processing)/.test(error.message)) error.recovery={articleId,completed:checkpoint.uploads.length,total:checkpoint.payload.plan.filter(item=>item.op.type==="image").length}; throw error; }
      payload = checkpoint.payload;
    } else if (payload.sourceMarkdown) recovery = null;
    const summary = resuming ? checkpoint.summary : {
      atomicOk: 0,
      atomicFail: 0,
      imgOk: 0,
      imgFail: 0,
      imgPending: 0,
      imageErrors: [],
      markersCleaned: 0,
      relocatedImages: 0,
      title: {
        requested: Boolean(payload.title),
        value: payload.title || null,
        articleId: articleId || null,
        ui: null,
        graphql: null
      },
      cover: {
        requested: Boolean(payload.cover),
        source: payload.cover || null,
        matchedUpload: false,
        mediaIdSuffix: null,
        graphql: null,
        bodyBlockDeleted: null,
        skippedReason: null
      }
    };

    const uploads = resuming ? resumeState.completed : [];
    const protectedAtomicBlocks = resuming ? checkpoint.protectedAtomicBlocks : new Set();
    let expectedArticleText = resuming ? checkpoint.expectedArticleText : [];
    let written = resuming;
    try {
    if (resuming) {
      if (resumeState.failedBlockKey) deleteBlockByKey(draftNode, resumeState.failedBlockKey);
      draftNode = findDraftStateNode() || draftNode;
      restoreRecoveryMarkers(draftNode, checkpoint);
      if (resumeState.resolved) uploads.push(resumeState.resolved);
      checkpoint.uploads = uploads; checkpoint.inflight = null;
      summary.imgOk = uploads.length; summary.imgFail = 0; summary.imageErrors = [];
      if (!summary.cover.graphql?.ok) { summary.cover.graphql = null; summary.cover.skippedReason = null; }
    } else {
    // Prove image transport before changing the editor or its metadata.
    const firstImage = (payload.plan || []).find(item => item.op?.type === "image");
    if (firstImage) {
      progress("Preparing image transfer...");
      const firstFile = await requestPreparedFile(firstImage);
      firstImage.op.file = firstFile;
    }

    await applyTitleMetadata(payload.title, articleId, summary);
    draftNode = findDraftStateNode() || draftNode;

    throwIfCancelled();
    progress("Pasting structured Markdown...");
    draftNode = await ensureDraftCharacterSample(draftNode);
    throwIfCancelled();
    const writeResult = writeDraftBlocks(draftNode, payload.blocks);
    if (!writeResult.ok) {
      console.warn(LOG, "structured block write failed; falling back to paste", writeResult.error);
      pasteHtml(payload.html, payload.plain);
    }
    written = true;
    draftNode = await waitForDraftMarkers(payload.markerPrefix, (payload.plan || []).length);
    if (!draftNode) throw new Error("X Draft.js editor was not reachable after writing Markdown");
    await sleep(150);
    throwIfCancelled();
    articleId ||= articleIdFromUrl();
    if (articleId) {
      await applyTitleGraphqlMetadata(payload.title, articleId, summary);
    }
    if (payload.title && !summary.title.ui?.ok) {
      await applyTitleMetadata(payload.title, articleId, summary);
      draftNode = findDraftStateNode() || draftNode;
    }

    const atomicOps = (payload.plan || []).filter((item) => item.op.type === "atomic");
    const imageOps = (payload.plan || []).filter((item) => item.op.type === "image");

    if (atomicOps.length) {
      throwIfCancelled();
      progress(`Inserting ${atomicOps.length} special block(s)...`);
      draftNode = findDraftStateNode() || draftNode;
      const result = insertAtomicBatch(draftNode, atomicOps);
      summary.atomicOk = result.okCount;
      summary.atomicFail = result.failCount;
      if (result.errors?.length) console.warn(LOG, "atomic failures", result.errors);
      await sleep(350);
    }

    draftNode = findDraftStateNode() || draftNode;
    draftNode.props.editorState
      .getCurrentContent()
      .getBlockMap()
      .forEach((block, key) => {
        if (block.getType() === "atomic") protectedAtomicBlocks.add(key);
      });

    expectedArticleText = articleTextBlocks(draftNode.props.editorState.getCurrentContent());
    if (payload.sourceMarkdown && articleId && !summary.atomicFail) checkpoint = recovery = { payload, articleId, uploads, protectedAtomicBlocks, expectedArticleText, summary, inflight: null, fallbacks: [], signature: null };
    }
    const imageOps = (payload.plan || []).filter(item => item.op.type === "image");
    let coverUpload = uploads.find(upload => upload.coverOnly || uploadMatchesCover(upload, payload.cover)) || null;
    if (coverUpload && !summary.cover.graphql?.ok) await applyCoverMetadata(payload.cover, articleId, coverUpload, summary);
    for (let index = 0; index < imageOps.length; index += 1) {
      throwIfCancelled();
      draftNode = findDraftStateNode() || draftNode;
      assertArticleTextPreserved(expectedArticleText, draftNode.props.editorState.getCurrentContent());
      const op = imageOps[index];
      if (uploads.some(upload => upload.marker === op.marker)) continue;
      if (checkpoint) checkpoint.inflight = { operation: op, handedOff: false, failed: false };
      progress(`Uploading media ${index + 1}/${imageOps.length}...`);
      const result = await uploadImageAtMarker(draftNode, op, protectedAtomicBlocks, {
        index: index + 1,
        total: imageOps.length,
        checkpoint, articleId
      });
      if (result.ok) {
        if (checkpoint) checkpoint.inflight = null;
        summary.imgOk += 1;
        if (result.mediaPending) summary.imgPending += 1;
        uploads.push({
          marker: op.marker,
          blockKey: result.blockKey,
          entityKey: result.entityKey,
          markerBlock: result.markerBlock,
          markerOffset: result.markerOffset,
          markerLength: result.markerLength,
          markerExact: result.markerExact,
          mediaId: result.mediaId,
          source: op.op.source,
          coverOnly: Boolean(op.op.coverOnly)
        });
        const upload = uploads[uploads.length - 1];
        if (upload.coverOnly && !coverUpload) coverUpload = upload;
        if (uploadMatchesCover(upload, payload.cover) && !summary.cover.graphql && !summary.cover.skippedReason) {
          coverUpload = upload;
          await applyCoverMetadata(payload.cover, articleId, upload, summary);
        }
      } else {
        summary.imgFail += 1;
        summary.imageErrors.push({
          kind: imageOperationKind(op),
          index: index + 1,
          marker: op.marker,
          source: op.op.source || null,
          fileName: op.op.file?.fileName || null,
          error: result.error || "Image upload failed"
        });
        console.warn(LOG, "image failed", result.error);
        const failure = new Error(`Media ${index + 1}/${imageOps.length}: ${result.error || "Media upload failed"}`);
        failure.summary = summary;
        throw failure;
      }
      draftNode = findDraftStateNode() || draftNode;
    }

    if (uploads.length) {
      throwIfCancelled();
      progress("Reordering uploaded media...");
      await sleep(900);
      const result = relocateImages(draftNode, uploads.filter((upload) => !upload.coverOnly), protectedAtomicBlocks);
      summary.relocatedImages = result.moved;
      await sleep(400);
    }

    if (payload.cover) {
      throwIfCancelled();
      if (!summary.cover.graphql && !summary.cover.skippedReason && !articleId) {
        summary.cover.skippedReason = "No article id in URL";
        console.warn(LOG, "cover update skipped: no article id");
      } else if (!summary.cover.graphql && !summary.cover.skippedReason) {
        summary.cover.skippedReason = "Cover source was not uploaded; it may have stayed as a Markdown link";
        console.info(LOG, "cover skipped because the source was not uploaded", payload.cover);
      }
      if (coverUpload?.coverOnly && coverUpload.blockKey && !summary.cover.bodyBlockDeleted?.ok) {
        await sleep(600);
        draftNode = findDraftStateNode() || draftNode;
        const deleteResult = deleteBlockByKey(draftNode, coverUpload.blockKey);
        summary.cover.bodyBlockDeleted = deleteResult;
        if (!deleteResult.ok) console.warn(LOG, "cover block cleanup failed", deleteResult);
      }
    }

    progress("Cleaning up import markers...");
    draftNode = findDraftStateNode() || draftNode;
    // React commits onChange asynchronously. Never kick a render from the
    // pre-cleanup props: that writes the old marker blocks back into the draft.
    await sleep(250);
    draftNode = findDraftStateNode() || draftNode;
    summary.markersCleaned += cleanupMarkers(draftNode, payload.markerPrefix);
    await sleep(250);
    draftNode = findDraftStateNode() || draftNode;
    kickRender(draftNode);
    await sleep(250);
    throwIfCancelled();
    assertArticleTextPreserved(expectedArticleText, (findDraftStateNode() || draftNode).props.editorState.getCurrentContent());
    assertImportedMedia((findDraftStateNode() || draftNode).props.editorState.getCurrentContent(), uploads, payload.markerPrefix);
    if (summary.imgFail || summary.atomicFail || (summary.cover.requested && !summary.cover.graphql?.ok)) {
      const error = new Error("The X draft is incomplete. Some media or special blocks failed; your original Markdown is preserved in local records.");
      error.summary = summary;
      throw error;
    }
    if (payload.sourceMarkdown) recovery = null;
    summary.bodyMediaExpected = uploads.filter(upload => !upload.coverOnly).length;
    post("done", { summary });
    } catch (error) {
      // Keep completed images and readable source links when a later image fails.
      // Do not touch a different draft or overwrite edits made while uploading.
      if (written && articleIdFromUrl() === articleId) {
        try {
          draftNode = findDraftStateNode() || draftNode;
          assertArticleTextPreserved(expectedArticleText, draftNode.props.editorState.getCurrentContent());
          relocateImages(draftNode, uploads.filter(upload => !upload.coverOnly), protectedAtomicBlocks);
          draftNode = findDraftStateNode() || draftNode;
          const completed = new Set(uploads.map(upload => upload.marker));
          if (checkpoint) checkpoint.fallbacks = [];
          for (const item of payload.plan || []) {
            if (item.op?.type !== "image" || completed.has(item.marker)) continue;
            const content = draftNode.props.editorState.getCurrentContent();
            const at = checkpoint ? findMarkerLocation(content, item.marker) : null;
            const original = at ? content.getBlockMap().get(at.blockKey) : null;
            replaceMarkerText(draftNode, item.marker, item.op.fallbackText || (checkpoint ? "[Cover pending]" : ""));
            if (checkpoint && original) {
              const latest = (findDraftStateNode() || draftNode).props.editorState.getCurrentContent();
              checkpoint.fallbacks.push({ key: at.blockKey, original, text: latest.getBlockMap().get(at.blockKey)?.getText() });
            }
            draftNode = findDraftStateNode() || draftNode;
          }
          summary.markersCleaned += cleanupMarkers(draftNode, payload.markerPrefix);
          if (checkpoint) checkpoint.signature = recoverySignature((findDraftStateNode() || draftNode).props.editorState.getCurrentContent());
        } catch (cleanupError) { if (checkpoint) { checkpoint.signature = null; recovery = null; } console.warn(LOG, "partial draft cleanup skipped", cleanupError); }
      }
      const failure = error instanceof Error ? error : new Error(String(error));
      failure.summary ||= summary;
      if (checkpoint?.signature) failure.recovery = { articleId, completed: uploads.length, total: (payload.plan || []).filter(item => item.op.type === "image").length };
      throw failure;
    }
  }

  const onMessage = (event) => {
    if (event.source !== window || event.data?.source !== CHANNEL_TO_MAIN) return;
    if (event.data.kind === "ready?") {
      post("ready", { busy: Boolean(activeRunId), protocol: 2 });
      return;
    }
    if (event.data.kind === "run") {
      const runId = event.data.runId;
      if (!runId || typeof runId !== "string") return;
      if (activeRunId) { post("error", { runId, code: "busy", error: "An X import is already running" }); return; }
      activeRunId = runId;
      runFlow(event.data.payload).catch((error) => {
        console.error(LOG, error);
        if (error?.cancelled) {
          post("cancelled", { reason: error.message || "Writing stopped by user.", recovery: error.recovery || null });
          return;
        }
        post("error", { error: error?.message || String(error), stack: error?.stack || null, summary: error?.summary || null, recovery: error?.recovery || null });
      }).finally(() => { pendingFileCancels.clear(); activeRunId = null; });
      return;
    }
    if (event.data.kind === "cancel") {
      if (!activeRunId || event.data.runId !== activeRunId) return;
      cancelRequested = true;
      for (const cancel of [...pendingFileCancels, ...pendingNetworkCancels]) cancel();
      progress("Writing stopped by user.", "warn");
      return;
    }
    if (event.data.kind === "upload-files") {
      try {
        const result = uploadFilesToEditor(event.data.files || []);
        if (result.ok) post("upload-files-done", { requestId: event.data.requestId, summary: result });
        else post("upload-files-error", { requestId: event.data.requestId, error: result.error });
      } catch (error) {
        console.error(LOG, error);
        post("upload-files-error", {
          requestId: event.data.requestId,
          error: error?.message || String(error),
          stack: error?.stack || null
        });
      }
      return;
    }
    if (event.data.kind === "diagnostics") {
      const editorElement = findEditorElement();
      const draftNode = findDraftStateNode();
      const onFilesAdded = findOnFilesAdded();
      post("diagnostics", {
        payload: {
          ok: true,
          mainWorld: true,
          hasEditorElement: Boolean(editorElement),
          hasDraftStateNode: Boolean(draftNode),
          hasOnFilesAdded: Boolean(onFilesAdded),
          articleId: articleIdFromUrl(),
          editorBounds: editorElement
            ? {
                width: Math.round(editorElement.getBoundingClientRect().width),
                height: Math.round(editorElement.getBoundingClientRect().height)
              }
            : null
        }
      });
    }
  };
  window.addEventListener("message", onMessage);
  window.__qiaomuWriteXMainV2 = {
    version,
    busy: () => Boolean(activeRunId),
    dispose: () => {
      cancelRequested = true;
      for (const cancel of [...pendingFileCancels, ...pendingNetworkCancels]) cancel();
      window.removeEventListener("message", onMessage);
    }
  };

  console.log(LOG, "ready");
  post("ready");
})();
