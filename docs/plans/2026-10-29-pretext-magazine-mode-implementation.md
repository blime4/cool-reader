# Pretext Magazine Reading Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a persisted magazine-style reading mode that uses Pretext to flow selectable book text around nearby nature images without replacing the existing plain-text or book-guide modes.

**Architecture:** Keep page selection, navigation, collection, and guide matching in `app.mjs`. Add a pure line-layout adapter around Pretext and a DOM view that renders one accessible line layer plus positioned figures for each leaf. A small persisted mode controller coordinates plain, guide, and magazine modes and requests re-layout when typography or viewport geometry changes.

**Tech Stack:** Vanilla ES modules, `@chenglou/pretext`, DOM/CSS, Node test runner, existing FOLIO reader modules.

---

### Task 1: Install and pin Pretext

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1:** Run `npm view @chenglou/pretext version` and record the current stable version.

**Step 2:** Run `npm install --save-exact @chenglou/pretext@<version>`.

**Step 3:** Run `npm test`; expect the existing 267 tests to pass.

**Step 4:** Commit with `build: add pretext layout engine`.

### Task 2: Add a persisted reading-mode controller

**Files:**
- Create: `dist/reader-presentation-mode.mjs`
- Modify: `dist/index.html`
- Modify: `dist/app.mjs`
- Test: `tests/reader-presentation-mode.test.mjs`

**Step 1:** Write failing tests for the whitelist `plain | guides | magazine`, default `guides`, invalid-storage recovery, persistence, and accessible pressed state.

**Step 2:** Run `node --test tests/reader-presentation-mode.test.mjs`; expect module-not-found failure.

**Step 3:** Implement `createReaderPresentationMode({buttons, storage, onChange})`, render a three-button segmented control in the book-guide toolbar, and keep guide visibility controlled by the selected mode rather than deleting the current toggle behavior.

**Step 4:** Run the focused test and then `npm test`; expect all tests to pass.

**Step 5:** Commit with `feat: add reading presentation modes`.

### Task 3: Build the Pretext line-flow adapter

**Files:**
- Create: `dist/pretext-magazine-layout.mjs`
- Test: `tests/pretext-magazine-layout.test.mjs`

**Step 1:** Write failing tests using an injected Pretext API for left/right obstacles, full-width recovery below an image, bounded 1/2/3 density, safe-image priority, stable source offsets, hard line breaks, and unsupported-runtime fallback.

**Step 2:** Run `node --test tests/pretext-magazine-layout.test.mjs`; expect module-not-found failure.

**Step 3:** Implement cached `prepareWithSegments`, iterative `layoutNextLineRange`, and `materializeLineRange`. Return `{lines, figures, height, supported}` without reading layout from the DOM.

**Step 4:** Run the focused test and then `npm test`; expect all tests to pass.

**Step 5:** Commit with `feat: compute magazine text flow with pretext`.

### Task 4: Render accessible magazine leaves

**Files:**
- Create: `dist/pretext-magazine-view.mjs`
- Modify: `dist/styles.css`
- Test: `tests/pretext-magazine-view.test.mjs`

**Step 1:** Write failing DOM-fixture tests for selectable line spans, `textContent`-only figures and captions, real/reference/generated badges, image-error removal and reflow, figure click callback, and stale async render cancellation.

**Step 2:** Run `node --test tests/pretext-magazine-view.test.mjs`; expect module-not-found failure.

**Step 3:** Implement a view per leaf with a semantic text layer and absolutely positioned `<figure>` elements. Preserve source offsets in `data-source-start/end`; never use `innerHTML`.

**Step 4:** Add CSS for alternating editorial floats, captions, reduced motion, print-safe colors, mobile single-column fallback, and the current typography CSS variables.

**Step 5:** Run focused tests and `npm test`; expect all tests to pass.

**Step 6:** Commit with `feat: render magazine image wraps`.

### Task 5: Wire page data, typography, and collection actions

**Files:**
- Modify: `dist/app.mjs`
- Modify: `dist/reader-typography.mjs`
- Modify: `dist/index.html`
- Test: `tests/pretext-reader-integration.test.mjs`

**Step 1:** Write failing integration tests proving magazine mode uses existing `guidesForPage`, does not launch search/generation, keeps page index stable, responds to typography/fullscreen/resize changes, and opens the existing detail modal from a figure.

**Step 2:** Run the focused test; expect wiring assertions to fail.

**Step 3:** Connect mode changes to `renderBook()`. In magazine mode hide guide rails/lines, pass each leaf's text and ranked pictured guides into the magazine view, and retain the original leaf DOM for selection/accessibility. Add `sparse | balanced | rich` density persistence.

**Step 4:** Expose one typography-change subscription that schedules magazine re-layout without resetting page motion.

**Step 5:** Run focused and full tests; expect all tests to pass.

**Step 6:** Commit with `feat: integrate magazine reading mode`.

### Task 6: Visual, interaction, and regression verification

**Files:**
- Modify only if verification finds a defect.
- Test: existing `tests/*.test.mjs`

**Step 1:** Run `npm test`, `node --check` for new modules, and `git diff --check`.

**Step 2:** Start the isolated worktree server on a non-conflicting port and test a page containing at least two pictured names in normal, full-screen, and extra-large book sizes.

**Step 3:** Verify Chinese wrapping, image non-overlap, image-error reflow, selection explorer, left/right page click navigation, arrow navigation, typography changes, reduced motion, and persisted mode/density after reload.

**Step 4:** Run an independent code review focused on source-offset correctness, XSS, stale image loads, layout loops, and Pretext/browser compatibility.

**Step 5:** Commit any verified fixes, re-run all checks, then merge the isolated branch and push `main`.

