# PixelForge

A visual editor for existing websites: load a page, inspect it like DevTools, restyle it like Figma, ask AI for changes — then turn the edits into a **source patch**, apply it, reload the app and **verify visually** that the code change renders exactly like the edit.

- **URL mode:** any page through a rewriting proxy. Exports an overrides stylesheet plus an HTML patch, and can verify that the export reproduces the edit.
- **Source Project Mode:** a Vite + React project, including the bundled **Nimbus** demo. Rendered elements map back to their JSX. Edits become changes to CSS Modules, global CSS, Tailwind classes, inline style objects or text literals. Patches are applied, hot-reloaded and verified at three viewports.

## Running it

Requirements: Node 20+ (tested on 22) and Chromium for Playwright. The Chromium is used for visual verification and the e2e tests.

```bash
npm install
npx playwright install chromium     # skip if Playwright browsers are already installed
npm run dev                         # API + proxy on :4000/:4001, editor on :5173
```

Open **http://localhost:5173** and click **Open demo project**. Other options on the start screen:

- **Open a URL:** any http(s) URL, or the bundled `plain-site` fixture if you have no internet access.
- **Your source project:** the absolute path of a Vite + React project with its dependencies installed. Patches are written **into that project**, so use git.

Production-style single server (the editor is served by the API server):

```bash
npm start                           # builds, then serves everything on http://localhost:4000
```

AI: with no key set, AI requests use an offline heuristic engine, which is clearly labelled as such in the UI. To use Claude, set a key before starting the server:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev      # optional: PF_AI_MODEL=claude-opus-5-5 (default)
```

Ports can be changed with `PF_API_PORT`, `PF_PROXY_PORT`, `PF_PROJECT_PORT` and `PF_EDITOR_PORT`.

The demo always runs from a scratch copy in `.pixelforge-work/demo`, so the repository is never modified. **Reset demo source** in the Verify tab, or `POST /api/projects/:id/reset`, restores that copy.

## A two-minute tour

1. **Open demo project.** Hover the page to see margin, padding and content boxes, the tag, the component (from React fibers) and the size.
2. **Click the headline.** The inspector shows `src/components/Hero.tsx:14:10`, the component chain, and a coloured dot per property that says where its value comes from: edited, rule or inherited. The **Cascade** tab lists every matching rule by precedence, with overridden declarations struck through and inherited rules grouped by ancestor.
3. **Edit.** Change font size, type new text (or double-click the text on the canvas), or drag the white handles (size) and green bars (padding/margin) on the canvas. `⌘Z` / `⌘⇧Z` step through named history entries.
4. **Go responsive.** Press `3` for mobile. New edits now apply to *Mobile (≤767px)* only. A desktop edit never overrides the site's own mobile rules. The Changes tab badges every edit with its breakpoint.
5. **Compare.** Use the slider, side-by-side or `\` for the untouched original, which is a live copy of the page.
6. **Ask AI.** Select the feature grid, press `⌘K` and choose “Turn these cards into a responsive grid”. The plan lists every operation (element, property, old → new, breakpoint, reason) and is previewed live. Apply it, reject it, or untick individual operations. Applying creates one undo step.
7. **Code → Apply & verify.** The patch shows which strategy each change uses and a diff per file. Verification renders the original, your live edit and the reloaded patched app at 1440, 834 and 390 px. It reports the pixel mismatch, the changed regions and a computed-style check for every edited property. **Revert patch** restores the files and brings your edits back.

Keyboard: `⌘K` AI · `⌘⇧G` generate code · `V`/`I` select/interact · `1 2 3` viewports · `\` original · arrows walk the DOM tree · `Enter` edit text · `Delete` hide · `Esc` close/deselect · `?` all shortcuts.

## Tests

```bash
npm test            # 67 unit tests (vitest)
npm run test:e2e    # 20 Playwright tests that drive the real editor, server, demo and fixture
npm run typecheck
```

- **Unit tests** cover:
  - edit ops and history: undo/redo, coalescing, jump, text restore
  - breakpoints and shorthand handling
  - CSS compilation order
  - AI plan validation
  - JSX instrumentation
  - code generation against the real demo sources: CSS Modules, global CSS, shared classes, Tailwind, inline styles, `@media` placement, text to JSX/data literals, ambiguity refusal
  - Tailwind mapping
  - proxy rewriting
  - image diffing
  - the heuristic AI
  - the Claude provider against a mock Messages API
- **E2E tests** cover inspection, editing, undo/redo, responsive edits, canvas drag handles, interact mode and modals, nested scroll containers, shortcuts, URL mode, and export verification. They also run the full patch → apply → reload → verify → revert flow, the detection of unexpected differences when a shared class is edited, and all six AI prompts from the brief end to end to a *Verified* result.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers the system design, the DOM-to-source mapping, the mutation and undo model, AI, code generation, visual verification, known limitations and next steps.

## Repository layout

```
apps/editor         React editor UI (Zustand store, controller, components)
apps/server         Express API, rewriting proxy, project runner, codegen/verify/AI endpoints
packages/core       Domain model: ops, edit state, history, breakpoints, CSS metadata, protocol
packages/agent      In-page inspector agent (bundled to one script, injected into pages)
packages/codegen    Source transforms (Babel AST + magic-string, PostCSS) and URL-mode export
packages/vite-plugin  JSX → data-pf-src instrumentation + agent injection (dev only)
demo                Nimbus: realistic React + CSS Modules + Tailwind landing page
fixtures/plain-site Plain HTML/CSS site for URL mode without internet
e2e                 Playwright end-to-end tests
```
