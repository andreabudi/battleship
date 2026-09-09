---
name: testing-battleship
description: Run and browser-test the static Battleship game, including phase hover, complete matches, reset, and mobile layout.
---

## Local setup
- No build or application dependencies: from repo root run `python3 -m http.server 8000 --bind 0.0.0.0`, then open `http://localhost:8000/index.html`.
- No backend or account is required.
- For optional automated real pointer clicks, install `python3 -m pip install --user playwright` and connect to existing Chrome with `chromium.connect_over_cdp('http://localhost:29229')`; no separate browser download is needed.
- Hard reload after stylesheet changes to avoid stale visual evidence.

## Runtime workflow
- Manually place a ship by clicking Your waters. Random placement replaces the whole player fleet and starts battle immediately.
- Player shots are enemy-cell button clicks. Select by `#enemy-board .cell` or accessible name such as `Enemy waters A1`.
- Wait for the actual AI response before each new shot; the built-in delay is 600ms. Never mutate game state or bypass timers to demonstrate full-game behavior.
- For AI-turn hover checks, capture within that 600ms interval and corroborate that `game.turn` is `"ai"` before and after the screenshot.
- Background transitions take 150ms. Allow at least 200ms after a stable state change before final screenshots, and move the pointer away from boards when capturing empty reset states.
- Compare all cell and board bounding boxes before/after many shots, with screenshots at identical viewport dimensions and scroll position.
- Test placement and battle at 375×667 with touch enabled: both boards should fit side by side with no document scrolling. Compare `scrollHeight <= clientHeight` and `scrollWidth <= clientWidth`, including after the battle log fills (the log itself can scroll).
- Also test 320×568 through an armed preview, where status wrapping can introduce a classic scrollbar. Compare every cell's bounds against both its board and the available viewport: checking only the board rectangle or document overflow can miss clipped final columns.
- Report `innerWidth` separately from `document.scrollingElement.clientWidth`; classic vertical scrollbars can reduce client width. Placement may scroll vertically, but phone firing must not. Compare cell sizes and board-relative grid geometry separately from page position, which can move when status text wraps.
- Cover landscape as well as portrait: 667×375 and 844×390 at minimum, in both the placement and firing phases. The board is sized by the smaller of the width and the height available to it, so a regression usually shows up in one orientation only — check `scrollHeight <= clientHeight` there too, not just `scrollWidth`.
- Rotate mid-game (swap the emulated width and height without reloading) and confirm the layout reflows and no game state is lost: compare every cell's class list before and after, plus the shot counts and the fleet lists.
- Landscape reflows the chrome, not just the grids: the title and status share one line and the battle log sits beside the New game button below 600px of height. Screenshot both orientations, since a layout that merely does not overflow can still leave the boards unusably small.
- Touch placement uses tap-to-arm then Confirm, rather than tap-to-commit. Check a second tap moves the preview, rotation preserves the anchor, invalid edge/overlap previews cannot commit, and Undo removes only the last ship. Test mouse mode separately with Confirm hidden.
- Chrome touch emulation can be configured using CDP `Emulation.setDeviceMetricsOverride` (width 375, height 667, mobile true) and `Emulation.setTouchEmulationEnabled`; use real touchStart/touchEnd input events rather than DOM clicks. Verify `innerWidth`, `innerHeight`, `navigator.maxTouchPoints`, and `matchMedia("(hover: none)")` before trusting the mode.
- If desktop hover remains disabled after resetting mobile emulation, use a fresh native tab in one persistent CDP session, and verify `hover: hover` / `pointer: fine` before testing. Resizing/reconnecting may change emulation state in some Chrome builds. For a native near-1280×800 viewport on this Linux desktop, `xrandr --output VNC-0 --mode 1280x960` plus maximizing Chrome yielded 1280×829 content; always report the actual measured viewport.
- Use the Python interpreter that has Playwright installed; interactive shells can choose a different interpreter. `/usr/bin/python3` worked with the existing user installation.
- For placement colors, inspect the hovered anchor as well as the other footprint cells. Cover legal water, the board edge, and overlap with a placed ship; distinguish immediate rotation behavior from the footprint after subsequent pointer movement.
- For modal focus, mix scrim/card-text clicks with both Tab directions instead of testing keyboard alone. Check `document.activeElement` and `document.hasFocus()` after each action so browser-chrome escapes are detected; verify the reset button's resulting focus by activating it with Enter.

## Devin Secrets Needed
None.
