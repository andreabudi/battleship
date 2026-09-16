/* Deterministic checks for the AI opponent. No test framework: open
 * tests.html in a browser, or run it headless, e.g.
 *
 *   google-chrome --headless=new --disable-gpu --dump-dom tests.html
 *
 * Math.random is replaced by a seeded generator so every run - and any
 * before/after comparison of the benchmark - is reproducible.
 */

const output = [];

function report(line) {
  output.push(line);
  document.getElementById("results").textContent = output.join("\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Mulberry32: tiny seeded PRNG, good enough for reproducible test runs. */
function seedRandom(seed) {
  let state = seed >>> 0;
  Math.random = function seededRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plays the AI against a board until `isFinished` returns true.
 * Returns the shot count and whether the AI ever hunted while an unresolved
 * hit was outstanding (which is the bug this suite guards against).
 */
function playAiUntil(board, isFinished, shotLimit, ai = createAiState()) {
  const firedCells = new Set();
  board.firedAt.forEach((wasFired, index) => {
    if (wasFired) firedCells.add(index);
  });
  let shots = 0;
  let huntedWithUnresolvedHits = false;

  while (!isFinished(board)) {
    const index = chooseAiShot(board, ai);
    // The mode chosen for this shot is what matters: hunting while a hit is
    // unresolved means the AI abandoned a damaged ship.
    if (ai.mode === "hunt" && ai.unresolvedHits.length > 0) {
      huntedWithUnresolvedHits = true;
    }
    assert(!firedCells.has(index), `AI fired twice at cell ${index}`);
    firedCells.add(index);

    const result = fireAt(board, index);
    updateAiAfterShot(board, ai, index, result);
    shots += 1;

    assert(shots <= BOARD_SIZE * BOARD_SIZE, "AI exceeded the board size in shots");
    assert(shots <= shotLimit, `AI needed more than ${shotLimit} shots`);
  }
  return { shots, huntedWithUnresolvedHits };
}

const wholeFleetSunk = (board) => board.sunkShipCount === SHIP_TYPES.length;

/** Benchmark: average shots the AI needs to clear a randomly placed fleet. */
function runBenchmark(games) {
  seedRandom(12345);
  let totalShots = 0;

  for (let game = 0; game < games; game += 1) {
    const board = createBoard();
    placeFleetRandomly(board);
    const run = playAiUntil(board, wholeFleetSunk, 100);
    totalShots += run.shots;
  }
  report(
    `Benchmark: ${games} games, average ${(totalShots / games).toFixed(2)} ` +
      `shots per win (seed 12345)`
  );
}

/**
 * Board with two size-3 ships side by side in adjacent columns:
 *
 *      col 4  col 5
 *  row 3   C      S
 *  row 4   C      S      <- the two hits that trigger the bug
 *  row 5   C      S
 *
 * Cruiser and Submarine both run vertically, so hits at (4,4) and (4,5) look
 * like a horizontal ship. Extending that false line hits water at both ends;
 * the AI must then fall back to the individual unresolved hits instead of
 * returning to HUNT with two damaged ships on the board.
 */
function buildAdjacentShipsBoard() {
  const board = createBoard();
  // Only these two ships are placed; the rest of the fleet is left off the
  // board so a run ends as soon as both are sunk.
  placeShip(board, board.ships[2], [toIndex(3, 4), toIndex(4, 4), toIndex(5, 4)]); // Cruiser
  placeShip(board, board.ships[3], [toIndex(3, 5), toIndex(4, 5), toIndex(5, 5)]); // Submarine
  return board;
}

const bothAdjacentShipsSunk = (board) =>
  board.ships[2].isSunk && board.ships[3].isSunk;

/** Deterministic: the two seeding hits are forced, no randomness involved. */
function runFalseOrientationTest() {
  seedRandom(1);
  const board = buildAdjacentShipsBoard();
  const ai = createAiState();

  [toIndex(4, 4), toIndex(4, 5)].forEach((index) => {
    const result = fireAt(board, index);
    updateAiAfterShot(board, ai, index, result);
  });
  assert(ai.mode === "target", "AI should be targeting after two hits");

  const run = playAiUntil(
    board,
    bothAdjacentShipsSunk,
    BOARD_SIZE * BOARD_SIZE,
    ai
  );
  assert(
    !run.huntedWithUnresolvedHits,
    "AI returned to HUNT while a hit was still unresolved"
  );
  assert(bothAdjacentShipsSunk(board), "AI failed to sink both adjacent ships");
  report(
    `False orientation: both adjacent size-3 ships sunk in ${run.shots} further ` +
      `shots, never hunting with an unresolved hit`
  );
}

/** Same layout, but the AI has to find the ships on its own from HUNT mode. */
function runAdjacentShipsTest(seeds) {
  seeds.forEach((seed) => {
    seedRandom(seed);
    const board = buildAdjacentShipsBoard();
    const run = playAiUntil(board, bothAdjacentShipsSunk, BOARD_SIZE * BOARD_SIZE);

    assert(
      !run.huntedWithUnresolvedHits,
      `seed ${seed}: AI returned to HUNT while a hit was still unresolved`
    );
    assert(bothAdjacentShipsSunk(board), `seed ${seed}: AI failed to sink both ships`);
  });
  report(
    `Adjacent ships: ${seeds.length} seeded runs - both size-3 ships sunk, ` +
      `no HUNT while hits were unresolved, no repeated shots`
  );
}

/** Direct check of the state machine on a hand-built mixed-ship cluster. */
function runMixedClusterUnitTest() {
  const board = createBoard();
  const cruiser = [toIndex(4, 2), toIndex(4, 3), toIndex(4, 4)];
  const submarine = [toIndex(5, 2), toIndex(5, 3), toIndex(5, 4)];
  placeShip(board, board.ships[2], cruiser);
  placeShip(board, board.ships[3], submarine);

  const ai = createAiState();
  // Hit the whole Cruiser plus one Submarine cell underneath it.
  [toIndex(5, 3), ...cruiser].forEach((index) => {
    const result = fireAt(board, index);
    updateAiAfterShot(board, ai, index, result);
  });

  assert(board.ships[2].isSunk, "Cruiser should be sunk");
  assert(!board.ships[3].isSunk, "Submarine should still be afloat");
  assert(
    ai.unresolvedHits.length === 1 && ai.unresolvedHits[0] === toIndex(5, 3),
    "only the Submarine hit should remain unresolved after the Cruiser sinks"
  );
  assert(ai.mode === "target", "AI must stay in TARGET mode with a hit outstanding");

  const nextShot = chooseAiShot(board, ai);
  assert(
    [toIndex(5, 2), toIndex(5, 4), toIndex(6, 3)].includes(nextShot),
    `next shot ${nextShot} should neighbour the unresolved Submarine hit`
  );
  report("Mixed cluster: sunk ship's cells resolved, leftover hit still pursued");
}

/**
 * Tap placement: a first tap only arms a preview, Confirm commits it, an
 * invalid preview cannot be confirmed, and Undo gives the ship back.
 */
function runTapPlacementTest() {
  newGame();
  usesTapPlacement = true;
  const board = game.playerBoard;

  selectPlacementCell(toIndex(0, 0));
  assert(board.placedShipCount === 0, "a tap must not commit a placement");
  assert(game.pendingIndex === toIndex(0, 0), "the tap should arm a preview");
  assert(!confirmPlacementButton.disabled, "a legal preview must be confirmable");

  selectPlacementCell(toIndex(3, 3));
  assert(game.pendingIndex === toIndex(3, 3), "a second tap should move the preview");

  toggleOrientation();
  assert(game.pendingIndex === toIndex(3, 3), "rotating must keep the preview armed");

  selectPlacementCell(toIndex(9, 9)); // a size-5 ship cannot fit in the corner
  assert(confirmPlacementButton.disabled, "an invalid preview must not be confirmable");
  commitPlacement(game.pendingIndex);
  assert(board.placedShipCount === 0, "an invalid preview must not commit");

  selectPlacementCell(toIndex(3, 3));
  commitPlacement(game.pendingIndex);
  assert(board.placedShipCount === 1, "Confirm should commit the armed placement");
  assert(game.pendingIndex === null, "committing should disarm the preview");

  undoLastShip();
  assert(board.placedShipCount === 0, "Undo should remove the last ship");
  assert(
    board.shipIdAt.every((shipId) => shipId === null),
    "Undo should free every cell of the removed ship"
  );
  assert(undoShipButton.disabled, "Undo must be unavailable with no ships placed");

  newGame();
  report(
    "Tap placement: tap arms a preview, taps move it, rotate keeps it, " +
      "invalid previews cannot be confirmed, Confirm places and Undo removes"
  );
}

/**
 * Fleet-picker placement: ships go down in any order, a placed ship can be
 * picked back up from the board, Undo respects placement order, the enemy
 * board is absent from the document until Start game, and Start game is
 * gated on the full fleet.
 */
function runFleetPickerPlacementTest() {
  newGame();
  usesTapPlacement = false;
  let board = game.playerBoard;
  const inDocument = (element) => document.body.contains(element);

  assert(!inDocument(enemyBoardElement), "enemy board must not be in the DOM during placement");
  assert(startGameButton.disabled, "Start game must be disabled with no ships placed");
  assert(game.selectedShipId === 0, "the Carrier is selected by default");

  selectShip(4); // Destroyer first, out of fleet order
  assert(fleetOptionElements[4].classList.contains("selected"), "picker marks the chosen ship");
  commitPlacement(toIndex(0, 0));
  assert(isShipPlaced(board.ships[4]), "the selected ship, not the first, was placed");
  assert(fleetOptionElements[4].disabled, "a placed ship cannot be selected again");
  assert(game.selectedShipId === 0, "after placing, the next unplaced ship is selected");

  selectShip(2); // Cruiser
  commitPlacement(toIndex(5, 5));
  assert(board.placementOrder.join() === "4,2", "placement order is tracked");

  // Pick the Destroyer (at A1) back up: it is selected again, orientation kept.
  game.orientation = VERTICAL;
  handlePlacementCellActivation(toIndex(0, 0));
  assert(!isShipPlaced(board.ships[4]), "clicking a placed ship lifts it off the board");
  assert(game.selectedShipId === 4, "the lifted ship becomes the selection");
  assert(game.orientation === HORIZONTAL, "the lifted ship keeps its orientation");
  assert(!fleetOptionElements[4].disabled, "a lifted ship is selectable again");
  commitPlacement(toIndex(9, 0));
  assert(board.shipIdAt[toIndex(9, 0)] === 4, "the lifted ship can be placed elsewhere");

  undoLastShip();
  assert(!isShipPlaced(board.ships[4]), "Undo removes the most recently placed ship, whatever its id");
  assert(isShipPlaced(board.ships[2]), "Undo leaves earlier ships alone");

  selectShip(null);
  handlePlacementCellActivation(toIndex(8, 0));
  assert(board.placedShipCount === 1, "no ship is placed while nothing is selected");

  // Fill the fleet: Start game only enables at five, and only then does the
  // enemy board enter the document.
  startBattle();
  assert(game.phase === "placement", "Start game must do nothing before the fleet is complete");
  randomButton.click();
  board = game.playerBoard;
  assert(board.placedShipCount === SHIP_TYPES.length, "Random placement fills the fleet");
  assert(game.phase === "placement", "Random placement must not start the game");
  assert(!startGameButton.disabled, "Start game enables with five ships placed");
  assert(!inDocument(enemyBoardElement), "enemy board still absent until Start game");

  startBattle();
  assert(game.phase === "playing", "Start game begins the battle");
  assert(inDocument(enemyBoardElement), "enemy board is in the DOM once the battle starts");
  assert(placementPanel.hidden, "placement controls are gone during the battle");

  newGame();
  assert(!inDocument(enemyBoardElement), "New game removes the enemy board again");
  report(
    "Fleet picker: any-order placement, pick-up to reposition, ordered Undo, " +
      "Start game gated on five ships, enemy board absent until then"
  );
}

try {
  runTapPlacementTest();
  runFleetPickerPlacementTest();
  runMixedClusterUnitTest();
  runFalseOrientationTest();
  runAdjacentShipsTest([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  runBenchmark(300);
  report("ALL TESTS PASSED");
} catch (error) {
  report(`TEST FAILURE: ${error.message}`);
}
