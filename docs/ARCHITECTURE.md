# PixelForge architecture

## Overview

```
┌──────────── editor (React, :5173) ─────────────┐        ┌──────── server (Node, :4000) ────────┐
│ Launcher · TopBar · Layers · Canvas · Inspector│  HTTP  │ API: sessions, projects, codegen,    │
│ BottomPanel (changes/history/code/verify/AI)   │◀──────▶│      AI planning, jobs, artifacts    │
│ store (Zustand) ◀─ controller ─▶ AgentBridge   │        │ Project runner ──spawn──▶ launcher   │
└──────────────────────────┬─────────────────────┘        │   (project's own Vite + our plugin)  │
                  postMessage RPC                         │ Verify pipeline (Playwright+pixel)   │
┌──────────────────────────┴─────────────────────┐        │ Rewriting proxy (:4001)              │
│ iframe: the inspected page + injected agent    │◀───────┤  (URL mode: framing, CSSOM access)   │
│ (proxy origin :4001, or dev server :41xx)      │        └──────────────────────────────────────┘
└────────────────────────────────────────────────┘
```

The code is split so that each concern has one owner:

| Concern | Where | Notes |
|---|---|---|
| Page rendering | iframe (proxy or project dev server) | Always a live page, never a screenshot |
| Inspection | `packages/agent` | Geometry, DOM tree, cascade, React component metadata |
| Editor state | `apps/editor/src/state/store.ts` | Plain data plus small reducers |
| Mutations | `packages/core/model.ts` | Declarative ops, a pure `EditState` and CSS compilation |
| History | `packages/core/history.ts` | Transactions (command pattern) with coalescing |
| AI operations | `apps/server/src/ai/*` and `core/aiOps.ts` | Providers return ops; validation is shared |
| Source mapping | `packages/vite-plugin` and the agent's fiber reader | See below |
| Code transformation | `packages/codegen` | Babel AST + magic-string for JSX, PostCSS for CSS |
| Visual verification | `apps/server/src/verify/*` | Playwright captures, pixelmatch, region extraction, property probes |

The editor and the page never share an origin. The page lives on the proxy port or the dev-server port, so its scripts cannot reach the editor. Everything the editor knows about the page arrives through a typed postMessage RPC (`core/protocol.ts`). Page scripts keep running, so the page stays interactive: **Interact** mode passes clicks through, and **Select** mode intercepts them in the capture phase.

## Rendering public URLs: the proxy

Two things block editing a public site in an iframe: framing protection (`X-Frame-Options`, CSP `frame-ancestors`), and cross-origin CSSOM, since `cssRules` on another origin's stylesheet throws. The cascade explanation needs the CSSOM.

The proxy (`apps/server/src/proxy.ts`) serves the target site from its own origin:

- `/__pf/open?url=…` stores the target origin in a cookie and redirects to the real path. The page therefore keeps its real `location.pathname`, so client-side routers, root-relative URLs and `fetch('/api/…')` all work without rewriting JavaScript.
- Framing, CSP, COOP/COEP and HSTS headers are stripped. `<meta>` CSP and SRI attributes are removed. `Set-Cookie` is made first-party.
- Same-origin absolute URLs become root-relative. Cross-origin stylesheets are routed through `/__pf/asset` so their rules are readable.
- The agent `<script>` is injected as the first element of `<head>`.
- The raw HTML is cached for URL-mode code generation.

Limitation: one target origin per browser profile at a time, because it is held in a cookie. Scripts on the page that build absolute URLs to their own origin at runtime bypass the proxy.

## DOM-to-source mapping

Decision: **compile-time instrumentation plus runtime framework metadata**. Nothing is annotated by hand.

1. **`data-pf-src` on every host JSX element.** `packages/vite-plugin` runs as a `pre` transform. It parses each project `.jsx`/`.tsx` file with Babel and uses magic-string to insert `data-pf-src="src/components/Hero.tsx:14:10"` right after the tag name of every lowercase JSX element. The rest of the file is untouched and source maps stay correct. Component elements such as `<Card/>` are skipped, because their props may never reach the DOM.
2. **Zero-config injection.** The project runner does not ask users to edit `vite.config`. It spawns a small launcher that imports *the project's own* Vite, calls `createServer({ root, plugins: [pixelforge()] })`, and lets Vite merge that with the project's config file. The plugin also injects the agent into `index.html`.
3. **Component names from React fibers.** The agent reads `__reactFiber$…` from DOM nodes and walks `.return` to name the components. That gives the component chain, such as `FeatureCard › Features › App`, and component boundaries in the Layers tree: the component whose first host descendant is this element. Fast Refresh swaps fibers with their alternates, and both are accepted.
4. **Repeated elements.** Elements rendered by `array.map` share one `data-pf-src`. The editor shows *All 6 instances*. Because a source edit to that JSX changes every instance, the live preview targets `[data-pf-src="…"]` by default, so preview and code agree. An instance-only preview is available, and the code generator explains why it cannot be expressed in the shared source.

Alternatives considered:

- *Source maps alone.* They map generated JavaScript positions, not DOM nodes.
- *React `_debugSource`.* It was removed in React 19.
- *Heuristic text/class matching against source.* Too ambiguous to rely on. It is still used as a fallback for **text**, see below.
- *Manual annotations.* Rejected by the brief.

For non-Vite toolchains, `instrumentSource()` is exported so the same transform can back a Babel, webpack or Next.js loader. Automatic launch is Vite-only today.

## Mutation model

An edit is a declarative op:

```ts
StyleOp { type: 'style', target, breakpoint: 'base'|'tablet'|'mobile', property, value | null }
TextOp  { type: 'text',  target, value | null, original }
```

`target` identifies what is edited. It is either `source` scope (every element from one JSX location) or `instance` scope (one unique CSS selector). In URL mode, `instance` scope can also be a structural "similar elements" selector such as `.bean-list > article.bean`.

Ops fold into an **`EditState`**, a plain map of targets to breakpoints to longhand properties, plus text edits. The agent *reconciles* the whole state on every change, and doesn't replay deltas:

- Style edits compile (`compileEditCss`) into one managed `<style>` element with `!important` overrides. Base rules come first, then `@media (max-width: 1023px)`, then `@media (max-width: 767px)`. The iframe is sized to the viewport, so the browser evaluates the media queries natively.
- Text edits patch text nodes in place and remember their originals, so removing an edit restores the node exactly. If React re-renders the text, a MutationObserver re-applies the edit.

Because application is idempotent and state-based, undo, redo, jump-to-history, AI previews (an overlay state) and live drag previews cannot drift from what the page shows. Nothing in the page's own DOM or stylesheets is rewritten, which is why editing a property doesn't destroy unrelated styling.

**Breakpoints.** The model is desktop-first: *All sizes*, then *Tablet & below* (≤1023), then *Mobile* (≤767). These line up with Tailwind's `max-lg`/`max-md`. The viewport presets select the matching breakpoint automatically, and the user can pin a different one.

A base edit replaces the element's base declaration. It must not clobber the site's own responsive rules, so the agent checks the site's winning declaration for each base-edited property at the current width. If a width-dependent `@media` rule wins there, the override is dropped at that width. The inspector marks the property with `!` and explains why. This is exactly what happens when the base rule is edited in source, and the verification loop depends on that equivalence.

## Undo/redo

`history.ts` is a command-pattern history of **transactions**. A transaction is a named user operation, such as “Change padding · article.card”, “Resize · p.subtitle” or “AI: Make this hero more premium”. It holds a list of `{ op, before }` changes, where `before` is the prior value of that slot, so undo is exact.

- Continuous controls (typing, arrow-key nudges, label scrubbing) share a `coalesceKey`. Commits within 1.2 s merge into one entry, keeping the earliest `before`.
- Canvas drags preview through an uncommitted `livePreview` state and commit a single transaction on pointer-up.
- AI plans commit as one transaction with `source: 'ai'`, so one undo removes them.
- After a patch is applied, the edits *are* the source. History is rebased to empty, and the pre-apply history is kept so **Revert patch** can restore both the files and the edits.

## Computed styles and the cascade

`packages/agent/cascade.ts` re-implements enough of the cascade to answer "why does it look like this?":

- It flattens same-origin stylesheets and evaluates `@media`, `@supports`, `@import` and `@layer` (layered rules rank below unlayered ones, and the order flips for `!important`). It matches selectors with `Element.matches` and computes Level-4 specificity, including `:is`, `:not`, `:has`, `:where` and `nth-child(… of S)`.
- For each tracked longhand, it ranks candidates by importance, layer, inline, specificity and source order. It reports the winner, the overridden declarations, and for inherited properties the nearest ancestor that declares it. Otherwise it reports "default". Longhands of shorthands that use `var()` read as empty in the CSSOM, so the shorthand's authored value is shown instead.
- Stylesheet sources are resolved to project files through Vite's `data-vite-dev-id`, and CSS-module hashes are de-mangled for display.

The inspector shows this per property: a coloured dot with a tooltip, and a click jumps to the ancestor for inherited values. The **Cascade** tab lists rules DevTools-style with overridden declarations struck through.

## Code generation

`packages/codegen/source.ts` groups edits by target and breakpoint. For each element it locates the JSX element at `data-pf-src` in the Babel AST and analyses how `className` is built. Supported forms are string literals, `styles.x` module references, template literals, `clsx`/`cn` calls, conditionals, and local variables. Then it picks a strategy:

1. **Properties owned by an existing `style={{…}}` object** are edited in that object, because inline styles beat classes. Breakpoint edits to such properties get `!important`, with a warning.
2. **CSS-module class owned by this element**: edit the rule in the module file.
3. **Global CSS class owned by this element**: edit the rule in the project stylesheet.
4. **Tailwind**: rewrite the class list. Utilities of the same variant that the edit supersedes are removed. Exact scale tokens are used where possible (`p-8`, `gap-6`, `rounded-xl`), otherwise arbitrary values. Breakpoints map to `max-lg:`/`max-md:`. Tailwind is skipped when an unlayered rule on the element sets the same property, because utilities live in a cascade layer and would silently lose.
5. **Base edit on a class with responsive overrides**: add a scoped class *right after* that class's base rule, so the existing `@media` overrides still win.
6. **Otherwise, base edits** go into an inline `style={{…}}`, merged into an existing object and using numbers for px.
7. **Otherwise, breakpoint edits** get a new scoped class in the component's CSS module or the global stylesheet. The class is added locally even when `className` is a shared variable.

A class is *owned* when no other JSX element in the project uses it. Shared classes are left alone by default, because editing `.section-title` would restyle four sections. The patch view explains this and offers **Edit the shared class instead**. The verification loop then shows the unexpected differences that choice causes.

CSS edits are surgical PostCSS mutations:

- A longhand is merged into an existing box shorthand: `padding: 28px` plus `padding-top: 36px` becomes `padding: 36px 28px 28px`.
- Complete groups are compressed: four equal sides become `padding: 32px`, and uniform borders become `border`.
- Breakpoint rules go into an existing matching `@media` block. A new tablet block is inserted *before* existing mobile blocks.
- New base rules are inserted before `@media` blocks that mention the selector.

Formatting of untouched code is preserved.

**Text** is written to the JSX text in place. If the element renders `{expr}`, codegen looks for the unique string literal, template or JSXText that produces it, first in the element's file and then across the project. That covers data arrays and component children at the call site. Ambiguous or computed text is refused with an explanation rather than guessed.

Patches are unified diffs (`diff`). Applying one checks that every file still matches the version the patch was generated from (otherwise it returns 409 and asks you to regenerate), writes the files, and keeps a backup for revert.

**URL mode** has no source, so it exports `pixelforge-overrides.css`, which uses the recorded selectors and media queries without `!important`, plus a patch of the served HTML that links the stylesheet and replaces text found in the server-rendered markup.

## Visual verification

`apps/server/src/verify/pipeline.ts`, run as a background job with visible steps:

1. For each viewport (1440, 834 and 390 px), load the app fresh in Playwright. Animations, transitions and caret are frozen. Capture the **baseline**. Then apply the editor's `EditState` through the agent's public API and capture the **expected** render. Record the computed value of every edited property at a structural DOM path, which stays stable even when classes change.
2. Write the patch.
3. Reload from source, retrying while the dev server rebuilds. Detect Vite's error overlay (build errors) and console errors. Capture the **actual** render and read the same properties.
4. Compare. Images are padded when page height changed. A `pixelmatch` mismatch ratio is computed, and changed cells are clustered into regions. Two comparisons are made: *actual vs expected* checks that the code reproduces the edit (tolerance 0.1%), and *actual vs baseline* shows what changed. Every property probe must match.

The Verify tab shows each viewport with Before / Expected / After / Unexpected diff / What changed, with region overlays, the failed property checks and any console errors. URL mode runs the same comparison by serving the exported patch (patched HTML plus overrides) through request interception.

"It compiles" is not accepted as success. This loop caught several real codegen bugs during development:

- inline styles beating the edited module rule
- an inline-style fallback clobbering the site's mobile padding
- a Tailwind utility losing to an unlayered class

Each fix now has a unit test. The loop also correctly reports the side effects of editing a shared class.

## AI

- Providers implement `plan(request) → { summary, rationale, operations[] }` (`apps/server/src/ai/provider.ts`).
- The request is an instruction plus a bounded snapshot of the selected subtree: refs, tags, labels, text, key computed styles, sizes, instance counts, and hidden flags so collapsed mobile menus are visible to the model.
- Operations reference nodes by `ref` and are `style` (property, value, breakpoint) or `text`.
- `core/aiOps.ts` validates them. Unknown refs, unsafe values (`;{}`), non-editable properties and text on containers are rejected. Shorthands are expanded, and each op is turned into a normal `EditOp` with the same targeting rules as manual edits. The plan is previewed as an overlay state, can be edited per operation, and commits as one transaction.

Providers:

- **Claude** (`anthropic.ts`) is used when `ANTHROPIC_API_KEY` is set. It uses the official SDK with structured output (`output_config.format` via a Zod schema), model `claude-opus-5-5` by default (`PF_AI_MODEL` overrides it), and effort `medium` for interactive latency. It also enables the server-side refusal fallback beta and handles `refusal` and `max_tokens` stop reasons. It is tested against a mock Messages API. It has not been exercised against the live API in this environment, which has no key.
- **Offline heuristic engine** (`heuristic.ts`) is the development and demo path. It is not a canned response: it classifies nodes (headings, body text, buttons, card-like surfaces, repeated groups, lists, menu toggles) from the snapshot and derives values from the actual styles. For example, "premium" scales spacing by 1.25, and a grid's `minmax()` comes from the measured item width. It leaves components that are also used outside the selection untouched, and it says plainly when it does not recognise an instruction. The UI always shows which provider answered.

## Known limitations

- **Frameworks:** source mapping and automatic launch support **Vite + React** (JSX/TSX). Vue and Svelte templates, Next.js, and other bundlers would need their own transform or loader, as would projects that don't use JSX. The transform is reusable.
- **Styling systems:** CSS Modules, plain CSS, Tailwind v4 and inline styles are supported. CSS-in-JS (styled-components, emotion), Sass-specific syntax, and design tokens and theme variables are not rewritten; values are written literally.
- **Instance-specific styles on array-rendered elements** can be previewed but not written to shared source. The patch explains this.
- **Text** that is computed at runtime, concatenated, or ambiguous across files is refused rather than guessed.
- **URL mode:**
  - one proxied origin per browser profile at a time
  - JavaScript that hard-codes absolute same-origin URLs bypasses the proxy
  - cross-origin stylesheets injected at runtime are reported as unreadable for cascade analysis
  - sites with bot protection may refuse the proxy's requests
  - the HTML patch only covers server-rendered text
- **Cascade explanation** approximates `@layer` ordering (layered vs unlayered, not the order between named layers). It ignores `@scope` and does not resolve nested CSS rules.
- **Transforms:** transformed elements get an exact quad outline, but resize and spacing handles are disabled on them. Values can be edited in the inspector.
- **Shadow DOM** and cross-origin iframes inside the page are not inspectable.
- **Verification** compares full-page screenshots, so pages with non-deterministic content (live data, random content, video) produce noise. Animations are frozen, but other dynamic content isn't masked.
- **Structural edits** (reordering, inserting or deleting elements, editing attributes such as `href` and image `src`) are not implemented. The op model is designed to accept them.
- **Collaboration and persistence:** sessions and patches live in server memory, and edits are not persisted across server restarts.

## What I'd build next

1. **Structural ops.** Reorder flex and grid children by dragging, duplicate, delete and wrap, with JSX AST moves in codegen.
2. **Design-token awareness.** Map edited values to existing CSS variables or Tailwind theme tokens (`#6d5dfc` → `var(--color-accent)`), and suggest tokens in the inspector.
3. **More toolchains.** A Babel and SWC loader for Next.js and webpack, Vue SFC template instrumentation, and CSS-in-JS rewriting for styled-components.
4. **Verification masking and stability.** Automatically mask regions that differ between two baseline captures (live content), and support per-component visual tests.
5. **AI loop with verification feedback.** Feed failed property checks and unexpected regions back to the model to repair its own patch. Also add multi-turn refinement ("a bit less") on the same transaction.
6. **Persistence.** Save sessions and history server-side, share links to a set of edits, and open a PR through the GitHub API instead of writing to the working tree.
7. **Better URL mode.** Isolate proxy origins with per-target subdomains so several sites can be open at once, and add optional script-disabled snapshots for hostile pages.
