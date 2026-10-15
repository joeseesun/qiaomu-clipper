# Qiaomu Clipper: working rules

## Before any UI work (read this first, every time)
The same few mistakes have come back again and again. Check them *before* shipping, not after a screenshot.

1. **svg on the reader page.** `reader.scss` sets `mix-blend-mode: multiply` on every `svg` in light themes. A white icon on a dark button disappears. Any new control that draws an svg and can appear on `reader.html` needs `svg { mix-blend-mode: normal !important }` in its own scoped CSS. (Play button invisible, send icon invisible, ✨ missing: all this.)
2. **The app's global `button` / `select` / `input` styles.** `buttons.scss` makes every `button:not(.clickable-icon)` `width: 100%`, centred, with its own background, box-shadow and `:hover`. A lone `.my-button` loses to it. Scope under a parent (`html button.x:not(.y)` beats the global `:hover`), set `width: auto`, and define the `:hover` colours too. Use a `div[role=button]` for cards and rows.
3. **Translucent backgrounds on sticky things.** Anything `position: sticky/fixed` over scrolling text needs a *solid* background (stack the tint over `var(--background-primary)`). Never rely on a semi-transparent token alone.
4. **A button must look like a button.** A filled shape with a clear hover, not coloured text. Primary = ink fill (`--text-normal` on `--background-primary`), secondary = soft grey fill. Plain text links are for navigation only.
5. **Custom controls** (switch, select, slider, menu) are styled in full: `appearance: none`, a visible focus ring, hover, keyboard, `aria-*`. Do not ship a browser default next to a designed control.
6. **Icons**: lucide names must be registered in `src/icons/icons.ts` (import list *and* object). Elements built before they are in the document cannot use `createIcons()`; use `createElement(IconNode)` or inline svg.
7. **Switches** reset `mask: none` on `::after` (global `inputs.scss` draws a checkmark).
8. **`messages.json`** entries with `$name$` need a `placeholders` block.
9. **Verify with computed styles**, not by eye: in the jsdom/mock check `getComputedStyle` for colour, background, width on the real element. Say plainly what was *not* verified in a real browser.
10. **Field focus.** A focused input/textarea/select gets one soft ring: `border-color: var(--field-focus-border); box-shadow: var(--field-focus-ring); outline: none` (global in `inputs.scss`/`dropdowns.scss`). Never stack a second outline or a solid 2px ring; cards/rows/chips use at most `outline: 1px solid var(--text-muted); outline-offset: 2px`.

## Words the user sees
Write from the user's point of view. They care about what they get, not how it is done.
- Say **「生成字幕」**, not 「上传音频并生成」「开始识别」「转写任务」. A button names the result.
- Say where data goes **once, in the note under the choice** (「云端 · 音频会上传，按量计费」), never in the button.
- No protocol, endpoint, model-id, venv, ASR or "helper" jargon in primary flows. Technical fields belong inside a settings dialog.
- Prefer the user's own words: 字幕 / 文字稿 / 模型 / 本机 / 云端. 「换模型生成文字稿」, not 「换个方式重新生成」.
- One decision per dialog; everything undecided has a sensible default; a recommendation is stated, not left as a list of equals.

## Product defaults
- Recommend one local choice and the two cloud choices that were tested (豆包语音, 硅基流动 Qwen3-ASR); everything else lives behind 「添加其他」.
- Remember choices (per site where it makes sense). Ask again only when something must be installed or the user asks to change.
- Never silently send audio to a cloud service the user has not chosen.

## Releases and Git
- Commit and release only when the user says so. Pass `--repo` to `gh`; look for foreign commits before pushing.

## Build and test delivery

- Read `docs/BUILD-TESTING.md`. The user tests in ONE place: `~/Documents/乔木剪藏测试/extension`, in the Chrome profile named `乔木剪藏测试`. Do not give the user a worktree address to install.
- Default to `npm run build:store && npm run test:prepare`. Use `--edition local` only for standalone-edition testing; the destination stays the same. Never load it into the daily-use profile without an explicit request.
- Each worktree builds into its own `build/`; only explicit test preparation updates the fixed installation. Reload the actual installed extension and verify its displayed identity and helper connection before saying it is installed/tested.
- Before delivery, reconcile every requested feature with all relevant worktrees, including uncommitted changes. Update `test-delivery.json`; `test:prepare` runs its regression tests and rejects loss of an already installed feature. A merged site adapter does not establish that AI image input is included. Never bypass this gate by manually copying an old worktree build.
- `npm run package` is the only extension ZIP writer. Keep immutable candidates in `releases/`; never overwrite versioned archives or copy newer code into an older version-named directory.
- Extension version comes from package.json; helper version comes from native/VERSION. Build/install/publication are separate evidence boundaries. Preserve other threads' working files and legacy loaded directories until migration is verified.

## Page injection and translations

Functions passed to `scripting.executeScript({ func })` run without the extension module closure. Keep them self-contained: return raw page data and localize after returning to the extension; pass input through `args`. Do not add imported helpers (including `t`) or async syntax that needs transpiler helpers. Run `npm run check:injections` and exercise serialized functions, not only direct calls.

New UI wording must include translations in all nine full locales. `npm run check:i18n` runs automatically in production builds, packaging and fixed test preparation. The legacy `update-locales` generator covers only `_locales` messages; do not assume it updates UI/helper catalogs or changed text under existing keys. Translation API failures must stop instead of storing fallback text as a completed translation.

## Stable user test entry

- 用户唯一测试入口是 `/Users/joe/Documents/乔木剪藏测试/extension`，Chrome 资料为「乔木剪藏测试」。开发 worktree 与产物目录不是新的安装入口；交付后用户只需重载原扩展。
- 普通新功能开工先 `git fetch origin`，再执行 `npm run check:dev-base`；检查失败不得在旧基线上开始开发。先读 `/Users/joe/Documents/乔木剪藏测试/CURRENT.json`，核对版本、源码提交、来源工作区和功能清单。当前 cwd 可能是旧分支；不得拿旧 checkout 的构建覆盖较新的测试包。先把本次增量合入包含已安装提交的集成工作区，保留已交付功能。
- 使用最新的 `docs/BUILD-TESTING.md` 和 `npm run build:store && npm run test:prepare` 更新固定入口，默认保持商店版测试；独立版专属测试才显式选择 local。交付脚本必须拒绝版本降级、缺失已安装提交或已交付功能，不手工复制绕过检查。
- 目录、版本、构建身份和源码来源核对完成才报告「文件已更新」；实际重载及真实模型播放另行验证。失败时保留原测试包与 `previous/` 回退。
