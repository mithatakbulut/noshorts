# No Shorts

A tiny userscript that removes YouTube Shorts while keeping normal YouTube intact.

No Xcode. No sideloading. No developer account. No subscription.

## What it does

- Hides Shorts shelves and cards
- Blocks navigation to `/shorts/...`
- Keeps regular videos, search, channels, subscriptions, and comments working
- Handles YouTube's SPA navigation and dynamically loaded content

## iPhone / iPad setup

### Option A — Ask ChatGPT

Don't want to figure out the setup yourself? Ask ChatGPT to walk you through it step by step.

Open ChatGPT and send:

```text
Help me install No Shorts on my iPhone using the Userscripts Safari app.
Here's the project: https://github.com/mithatakbulut/noshorts
```

ChatGPT can guide you through installing Userscripts, enabling the Safari extension, adding `noshorts.user.js`, and granting access to `youtube.com`.

### Option B — Manual installation

1. Install the **Userscripts** Safari extension from the App Store.
2. Enable Userscripts in Safari.
3. Add `noshorts.user.js` to Userscripts.
4. Allow the script to run on `youtube.com`.
5. Open YouTube in Safari.

That's it.

## Desktop

The script also works with userscript managers that support standard UserScript metadata, such as Tampermonkey or Violentmonkey.

## How it works

The script uses several small layers together:

- CSS hides known Shorts UI elements before they become distracting.
- A `MutationObserver` removes Shorts elements that YouTube inserts later.
- Click interception blocks Shorts links before YouTube's client-side router handles them.
- A route guard exits `/shorts/...` pages if YouTube reaches one through SPA navigation.

## Why this exists

YouTube doesn't offer a permanent "disable Shorts" option. No Shorts keeps the useful parts of YouTube while removing the infinite short-form feed.

## Maintenance

YouTube occasionally changes its DOM structure. If Shorts elements start appearing again, the relevant selectors in `noshorts.user.js` may need to be updated.

Issues and pull requests are welcome.

## License

MIT
