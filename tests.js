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

try {
  runMixedClusterUnitTest();
  runFalseOrientationTest();
  runAdjacentShipsTest([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  runBenchmark(300);
  report("ALL TESTS PASSED");
} catch (error) {
  report(`TEST FAILURE: ${error.message}`);
}
