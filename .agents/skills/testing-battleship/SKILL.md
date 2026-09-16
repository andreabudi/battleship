---
name: testing-battleship
description: Run and browser-test the static Battleship game, including the fleet-picker placement flow, phase hover, complete matches, reset, and mobile layout.
---

## Local setup
- No build or application dependencies: from repo root run `python3 -m http.server 8000 --bind 0.0.0.0`, then open `http://localhost:8000/index.html`.
- No backend or account is required.
- For optional automated real pointer clicks, install `python3 -m pip install --user playwright` and connect to existing Chrome with `chromium.connect_over_cdp('http://localhost:29229')`; no separate browser download is needed.
- Hard reload after stylesheet changes to avoid stale visual evidence.
- Keep long-running verification drivers, measurement logs and screenshots under a persistent home-directory evidence folder rather than `/tmp`; a machine restart may remove temporary files even when the checkout and recordings survive.

## Runtime workflow
- Placement shows only the player's board plus a fleet picker (`#fleet-picker .fleet-option`, one per ship) and the controls panel. Assert the enemy board is absent from the DOM during placement, not merely hidden: `document.body.contains(document.getElementById('enemy-board'))` must be `false` (`#enemy-wrapper` is detached by `newGame()` and appended by Start game). Re-check after New game from the overlay.
- Select a ship by clicking its picker entry; the entry gets `.selected` and `aria-pressed="true"`. Place out of fleet order (e.g. Destroyer first, then Cruiser) and confirm the placed entries become `.placed` and `disabled`, the next unplaced ship is auto-selected, and Undo removes the most recently placed ship regardless of its position in the list.
- Reposition by clicking a cell of an already placed ship: the ship lifts off the board, its picker entry is re-enabled and selected, its orientation is kept, and a preview appears at its old anchor (mouse: hover preview; touch: armed preview awaiting Confirm). Then place it elsewhere. Hovering a placed ship must show no placement preview.
- `#start-game-btn` must stay `disabled` until all five ships are placed, and Random placement fills the fleet without starting the battle. Only Start game moves to firing; afterwards `#placement-panel` and `#fleet-picker-panel` are `hidden` and both boards are present.
- Player shots are enemy-cell button clicks. Select by `#enemy-board .cell` or accessible name such as `Enemy waters A1`.
- Wait for the actual AI response before each new shot; the built-in delay is 600ms. Never mutate game state or bypass timers to demonstrate full-game behavior.
- For AI-turn hover checks, capture within that 600ms interval and corroborate that `game.turn` is `"ai"` before and after the screenshot.
- Background transitions take 150ms. Allow at least 200ms after a stable state change before final screenshots, and move the pointer away from boards when capturing empty reset states.
- Compare all cell and board bounding boxes before/after many shots, with screenshots at identical viewport dimensions and scroll position.
- Test placement and battle at 375×667 with touch enabled: both boards should fit side by side with no document scrolling. Compare `scrollHeight <= clientHeight` and `scrollWidth <= clientWidth`, including after the battle log fills (the log itself can scroll).
- Also test 320×568 through an armed preview, where status wrapping can introduce a classic scrollbar. Compare every cell's bounds against both its board and the available viewport: checking only the board rectangle or document overflow can miss clipped final columns.
- Report `innerWidth` separately from `document.scrollingElement.clientWidth`; classic vertical scrollbars can reduce client width. Placement may scroll vertically, but phone firing must not. Compare cell sizes and board-relative grid geometry separately from page position, which can move when status text wraps.
- Cover landscape as well as portrait: 568×320, 667×375 and 844×390 at minimum, in both the placement and firing phases. 568×320 is the phase that breaks first — the placement controls take a whole column there, so check placement explicitly rather than inferring it from a firing measurement.
- Landscape placement is allowed to scroll vertically (only when the board would otherwise fall below `--cell-min`, 14px per cell); landscape firing must never scroll in either direction. Report the two phases separately, and check the rendered cell size, not just the absence of overflow: a board can fit and still be too small to tap. The board is sized by the smaller of the width and the height available to it, so a regression usually shows up in one orientation only — check `scrollHeight <= clientHeight` there too, not just `scrollWidth`.
- Rotate mid-game (swap the emulated width and height without reloading) and confirm the layout reflows and no game state is lost: compare every cell's class list before and after, plus the shot counts and the fleet lists.
- Landscape reflows the chrome, not just the grids: the title and status share one line, the battle log sits beside the New game button below 600px of height, and during placement the picker and the controls take two columns to the right of the single board. At landscape heights up to 600px the placement hint is hidden; verify the status instruction remains readable and measure with touch Confirm visible, since mouse-only measurements can miss controls-column overflow. In portrait phones the picker sits beside the board and the controls go under it. Screenshot both orientations, since a layout that merely does not overflow can still leave the boards unusably small.
- Touch placement uses tap-to-arm then Confirm, rather than tap-to-commit. Check a second tap moves the preview, rotation preserves the anchor, invalid edge/overlap previews cannot commit, and Undo removes only the last ship. Test mouse mode separately with Confirm hidden.
- Chrome touch emulation can be configured using CDP `Emulation.setDeviceMetricsOverride` (width 375, height 667, mobile true) and `Emulation.setTouchEmulationEnabled`; use real touchStart/touchEnd input events rather than DOM clicks. Verify `innerWidth`, `innerHeight`, `navigator.maxTouchPoints`, and `matchMedia("(hover: none)")` before trusting the mode.
- If desktop hover remains disabled after resetting mobile emulation, use a fresh native tab in one persistent CDP session, and verify `hover: hover` / `pointer: fine` before testing. Resizing/reconnecting may change emulation state in some Chrome builds. For a native near-1280×800 viewport on this Linux desktop, `xrandr --output VNC-0 --mode 1280x960` plus maximizing Chrome yielded 1280×829 content; always report the actual measured viewport.
- Use the Python interpreter that has Playwright installed; interactive shells can choose a different interpreter. `/usr/bin/python3` worked with the existing user installation.
- For placement colors, inspect the hovered anchor as well as the other footprint cells. Cover legal water, the board edge, and overlap with a placed ship; distinguish immediate rotation behavior from the footprint after subsequent pointer movement.
- For modal focus, mix scrim/card-text clicks with both Tab directions instead of testing keyboard alone. Check `document.activeElement` and `document.hasFocus()` after each action so browser-chrome escapes are detected; verify the reset button's resulting focus by activating it with Enter.

## Devin Secrets Needed
None.
