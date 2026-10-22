# NoShorts · v0.2.2

**Keep the useful parts of YouTube. Remove the addictive parts.**

Two small, independently installable userscripts. No build step, account, subscription, backend, or external JavaScript.

- [`noshorts.user.js`](noshorts.user.js) hides Shorts shelves and cards, blocks `/shorts/` navigation, and handles YouTube's SPA updates. The original blocker is unchanged.
- [`youtube-limit.user.js`](youtube-limit.user.js) adds a daily playback budget, a compact remaining-time indicator, private viewing history, and next-day settings. Install either script or both.

## iPhone / iPad installation

1. Install [Userscripts for Safari](https://apps.apple.com/app/userscripts/id1463298887).
2. Open Userscripts and choose its scripts directory in Files.
3. Save `noshorts.user.js`, `youtube-limit.user.js`, or both into that directory. Use the repository's **Raw** file download and keep the `.user.js` extension. Alternatively create a JavaScript script in Userscripts, paste the entire file, and save.
4. In iOS Settings, open Safari → Extensions → Userscripts (Safari may be under Apps). Enable it and grant website access for YouTube. Allow `youtube.com`, `www.youtube.com`, and `m.youtube.com` when prompted; other websites are unnecessary.
5. Open YouTube **in Safari**, open Safari's extensions menu, and confirm the chosen scripts are enabled. The limiter asks for a budget before playback.

Keep the limiter's name and namespace when updating it in place so your userscript manager retains its storage. Installing a second copy can create a separate budget.

For a guided installation, ask ChatGPT: “Help me install NoShorts on my iPhone using the Userscripts Safari app. Project: https://github.com/mithatakbulut/noshorts”.

## Desktop installation

Open the desired `.user.js` file in a userscript manager such as Tampermonkey or Violentmonkey, or paste it into a new script. The limiter requires the asynchronous `GM.getValue`, `GM.setValue`, and `GM.listValues` APIs. The Shorts blocker needs no special APIs.

## Your daily budget

Choose 15 minutes, 30 minutes, 1 hour, 2 hours, or a custom 5–240 whole minutes. There is no skip action. Playback pauses until the choice is saved; press YouTube's play button when ready.

Only real playback counts. Browsing, paused video, seeking, and buffering do not use the budget. Playback speed does not multiply wall-clock usage. Rewatching a video adds to that video's total. Background audio counts while the media advances and Safari continues running the script.

On ordinary `/watch?v=…` pages, tap **◷ … mins left** to open your time details, history, and settings. On iPhone this opens a bottom sheet; desktop uses a side drawer. Close using its button, Escape, or the backdrop. History provides Today, Last 7 days, and Last 30 days, with most-recently-watched videos first and per-day totals. The indicator stays faint in the video box's top-right corner and hides when that corner scrolls offscreen. The drawer shows the hours/minutes until renewal, a daily watch-time line chart (7 or 30 days), and independently scrolling video lists limited to roughly 3½ rows. Days without recorded usage appear as zero on the chart. Older records remain stored, even though the interface shows only the latest 30 days.

Today's limit locks at first playback. Before that, settings can apply immediately. After that, both increases and decreases start the **next local calendar day**. For example, changing 60 to 120 minutes after watching 45 minutes leaves 15 minutes today and schedules 120 minutes tomorrow. The drawer shows today's limit and a different scheduled limit. Usage and the original daily budget remain attached to historical dates.

Dismissible warnings appear at 10, 5, and 1 minute remaining. Thresholds at or above the configured budget are skipped. At zero, video playback pauses and a player-sized overlay shows usage, video count, and renewal at local midnight. You can still search, browse, and read comments. There is no reset, extension, or watch-anyway action. Refreshing or reopening Safari preserves the budget.

Playback outside normal watch pages is still paused before setup and after exhaustion. Previews outside watch pages and Shorts are not attributed to normal-video history; use the companion Shorts blocker to remove Shorts.

## Privacy and storage

The limiter sends no analytics or viewing records anywhere. UI thumbnails load directly from YouTube's thumbnail host when history opens; video links open YouTube. Metadata comes from the current page, with fallbacks for missing titles and channels.

Storage uses the extension's persistent, script-scoped `GM.*` API, verified against the [Userscripts release API documentation](https://github.com/quoid/userscripts/tree/release/4.x.x#api). There is no localStorage/IndexedDB fallback: a storage failure pauses playback and asks you to reload after resolving it. The same installed script can share its budget across `youtube.com`, `www.youtube.com`, and `m.youtube.com` through manager storage, rather than maintaining separate origin budgets. Storage is local to that manager/browser profile; iCloud script-file syncing does not promise usage-data syncing across devices or profiles. Real-device cross-host behavior remains on the manual verification checklist.

Schema **v1** uses `noshorts:v1:` keys:

- Immutable settings events retain onboarding completion, requested limits, and effective dates.
- First-playback records freeze each day's active limit.
- Each document writes only its own cumulative usage keys, one per day/video. Other tabs' counters are added, never overwritten by a shared JSON snapshot.
- Day markers remember the last applicable local day. Warning keys record delivery state.
- Usage records retain video IDs, metadata, first-watch timestamps, and integer milliseconds. Daily totals are derived from these records.

Writes are serialized in each document. Active tabs poll shared storage every second and on media/navigation/lifecycle events. No records are deleted on renewal. New schemas should migrate existing records explicitly; this first schema has no older limiter data to migrate. Storage quota errors, denied permissions, or API failures stop playback instead of silently starting a fresh allowance.

## Platform limitations

This is an attention aid, **not tamper-proof enforcement**.

- iOS can suspend timers or terminate Safari without completing asynchronous writes. Progress is saved on short playback samples and lifecycle events, but an abrupt termination can lose the last unsaved fraction of playback. Final lifecycle writes are best effort.
- Gaps longer than 2.5 seconds are discarded rather than charged as phantom watching. This can undercount genuinely continuing background/native-fullscreen playback while JavaScript is suspended. Native fullscreen may hide all custom DOM overlays; the script does not exit fullscreen to show its indicator. Pausing there depends on Safari delivering script execution.
- `GM.*` storage has no cross-tab transaction or compare-and-swap. Separate writer keys avoid lost usage updates, but concurrent tabs can overshoot the final allowance by approximately a sampling interval per playing tab, plus storage latency. Concurrent threshold crossings can show a duplicate warning in separate tabs. Exact global exclusion is not promised.
- Timekeeping uses local dates and monotonic elapsed samples. Backward dates do not move the last persisted day backwards, but changing the clock/timezone forwards can renew an allowance early. Disabling the extension, deleting manager data, installing a separate copy, using another profile/device, or using the native YouTube app bypasses enforcement.
- DOM selectors and mobile layouts can change. Metadata may fall back to the page title or “YouTube video”. Ads on watch pages may count toward the current video. Native app videos, embedded players, Shorts, and off-watch-page previews are not tracked in normal-video history.
- Stored history is retained without automatic pruning. Large histories increase polling cost and can eventually reach the manager's storage quota. History is also subject to browser/extension data removal. No clear-history or reset-today action is exposed.

## Tests and demo guidance

Run the dependency-free deterministic core suite with Node.js 18 or newer:

```sh
node --test tests/limiter.test.cjs
node --check youtube-limit.user.js
```

The core tests cover onboarding, playback vs. pause/seeking/buffering, speed, suspension, rewatches, restart persistence, daily locks, exhaustion, midnight/DST, retained history, concurrent writers, settings races, warnings, storage failures, and backward clocks.

The optional integration suite uses Playwright with Chromium installed:

```sh
# In an environment with Playwright available:
node --test tests/browser.cjs
```

It uses a synthetic YouTube page and a shared mocked GM API, exercises the distributed userscript, checks onboarding/settings, wall-clock tracking, duplicate-free SPA rebinding, cross-tab exhaustion, reload persistence, mobile/desktop layout, and Escape dismissal. It saves a demo screenshot to `/tmp/noshorts-mobile.png` (override with `NOSHORTS_SCREENSHOT`). Synthetic browser tests do not establish compatibility with the live YouTube DOM or iOS Userscripts.

The GitHub Pages landing page lives in `docs/`, with buildless styles/scripts under `docs/assets/`. Its widget screenshot is captured from the actual limiter using explicitly illustrative history. Run `node --test tests/site.cjs` with Playwright available to check mobile/desktop layout, separate downloads, preview focus behavior, and the setup-prompt fallback.

For screenshots/demo recordings, use a separate test profile: capture onboarding, the indicator during playback, the history sheet in light/dark mode, a scheduled setting, and the exhausted overlay. Do not clear a real user's history to stage a demo.

Real-device verification still required:

1. iPhone Safari with Userscripts: first setup while autoplay is attempting to start; custom-duration validation; touch scrolling, VoiceOver, keyboard focus, and safe areas.
2. Live `m.youtube.com` and `www.youtube.com`: shared manager budget, titles/channels, player placement, SPA next/back/replacement videos, search, and comments after blocking.
3. Pause, seek, 2× playback, buffering, background audio, screen lock, native fullscreen, forced Safari termination/reopen, and crossing midnight.
4. Two simultaneously playing tabs, thresholds, limit exhaustion, next-day settings, and storage denial/quota errors.
5. Desktop YouTube with both scripts enabled, fullscreen/theater/miniplayer, dark mode, keyboard controls, and repeated SPA navigation.

No physical iPhone or live YouTube testing is claimed.

## Maintenance and license

Keep the Shorts blocker independently usable. Prefer focused selector updates when YouTube changes. Issues and pull requests are welcome. MIT; see [LICENSE](LICENSE).
