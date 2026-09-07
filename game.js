/* Battleship - vanilla JS, no dependencies.
 *
 * Layout of this file:
 *   1. Constants and model helpers (fleet, boards, placement rules)
 *   2. Rendering
 *   3. Player placement flow
 *   4. Turn handling (player shot -> AI shot)
 *   5. AI OPPONENT  <- hunt/target state machine, clearly marked below
 *   6. Game lifecycle and event wiring
 */

/* ------------------------------------------------------------------ *
 * 1. Constants and model helpers
 * ------------------------------------------------------------------ */

const BOARD_SIZE = 10;

const SHIP_TYPES = [
  { name: "Carrier", size: 5 },
  { name: "Battleship", size: 4 },
  { name: "Cruiser", size: 3 },
  { name: "Submarine", size: 3 },
  { name: "Destroyer", size: 2 },
];

const HORIZONTAL = "horizontal";
const VERTICAL = "vertical";

/** Cell coordinates are stored as a single index: row * BOARD_SIZE + col. */
function toIndex(row, col) {
  return row * BOARD_SIZE + col;
}

function toRow(index) {
  return Math.floor(index / BOARD_SIZE);
}

function toCol(index) {
  return index % BOARD_SIZE;
}

function isInsideBoard(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

/** Human readable coordinate such as "B7", used in the battle log. */
function formatCoordinate(index) {
  return String.fromCharCode(65 + toCol(index)) + (toRow(index) + 1);
}

/**
 * A board owns its fleet plus two parallel lookup arrays:
 *   shipIdAt[i] -> index into `ships` (or null for open water)
 *   firedAt[i]  -> true once anyone has shot at that cell
 */
function createBoard() {
  return {
    ships: SHIP_TYPES.map((type, id) => ({
      id,
      name: type.name,
      size: type.size,
      cells: [],
      hits: 0,
      isSunk: false,
    })),
    shipIdAt: new Array(BOARD_SIZE * BOARD_SIZE).fill(null),
    firedAt: new Array(BOARD_SIZE * BOARD_SIZE).fill(false),
    placedShipCount: 0,
    sunkShipCount: 0,
  };
}

/** Cells a ship of `size` would occupy, or null if the placement is illegal. */
function computeShipCells(board, row, col, size, orientation) {
  const cells = [];
  for (let step = 0; step < size; step += 1) {
    const cellRow = orientation === VERTICAL ? row + step : row;
    const cellCol = orientation === HORIZONTAL ? col + step : col;
    if (!isInsideBoard(cellRow, cellCol)) return null;
    const index = toIndex(cellRow, cellCol);
    if (board.shipIdAt[index] !== null) return null; // overlap
    cells.push(index);
  }
  return cells;
}

function placeShip(board, ship, cells) {
  ship.cells = cells;
  cells.forEach((index) => {
    board.shipIdAt[index] = ship.id;
  });
  board.placedShipCount += 1;
}

function placeFleetRandomly(board) {
  board.ships.forEach((ship) => {
    let cells = null;
    while (cells === null) {
      const orientation = Math.random() < 0.5 ? HORIZONTAL : VERTICAL;
      const row = Math.floor(Math.random() * BOARD_SIZE);
      const col = Math.floor(Math.random() * BOARD_SIZE);
      cells = computeShipCells(board, row, col, ship.size, orientation);
    }
    placeShip(board, ship, cells);
  });
}

/**
 * Fire at a cell and report the outcome.
 * Sunk detection: every ship counts its own hits, so a ship is sunk exactly
 * when its hit counter reaches its length. This keeps detection independent of
 * which cells were struck or in what order.
 */
function fireAt(board, index) {
  board.firedAt[index] = true;
  const shipId = board.shipIdAt[index];
  if (shipId === null) return { hit: false, sunkShip: null };

  const ship = board.ships[shipId];
  ship.hits += 1;
  if (ship.hits === ship.size && !ship.isSunk) {
    ship.isSunk = true;
    board.sunkShipCount += 1;
    return { hit: true, sunkShip: ship };
  }
  return { hit: true, sunkShip: null };
}

/* ------------------------------------------------------------------ *
 * 2. Rendering
 * ------------------------------------------------------------------ */

const playerBoardElement = document.getElementById("player-board");
const enemyBoardElement = document.getElementById("enemy-board");
const playerFleetElement = document.getElementById("player-fleet");
const enemyFleetElement = document.getElementById("enemy-fleet");
const statusElement = document.getElementById("status");
const logElement = document.getElementById("log");
const placementPanel = document.getElementById("placement-panel");
const nextShipNameElement = document.getElementById("next-ship-name");
const nextShipSizeElement = document.getElementById("next-ship-size");
const orientationLabelElement = document.getElementById("orientation-label");
const rotateButton = document.getElementById("rotate-btn");
const randomButton = document.getElementById("random-btn");
const resetPlacementButton = document.getElementById("reset-placement-btn");
const newGameButton = document.getElementById("new-game-btn");
const gameOverOverlay = document.getElementById("game-over-overlay");
const resultTitleElement = document.getElementById("result-title");
const resultDetailElement = document.getElementById("result-detail");
const playAgainButton = document.getElementById("play-again-btn");
/* Everything the overlay covers; made inert while the overlay is open. */
const pageContentElements = Array.from(
  document.querySelectorAll("body > header, body > main")
);

/** Builds the 100 cell buttons once per board and returns them in index order. */
function buildBoardCells(boardElement, label) {
  boardElement.innerHTML = "";
  const cells = [];
  for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index += 1) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    cell.dataset.index = String(index);
    cell.setAttribute("aria-label", `${label} ${formatCoordinate(index)}`);
    boardElement.appendChild(cell);
    cells.push(cell);
  }
  return cells;
}

function renderBoard(board, cellElements, { revealShips }) {
  cellElements.forEach((cellElement, index) => {
    const shipId = board.shipIdAt[index];
    const ship = shipId === null ? null : board.ships[shipId];
    const wasFired = board.firedAt[index];

    cellElement.className = "cell";
    if (ship && ship.isSunk) {
      cellElement.classList.add("sunk");
    } else if (wasFired && ship) {
      cellElement.classList.add("hit");
    } else if (wasFired) {
      cellElement.classList.add("miss");
    } else if (ship && revealShips) {
      cellElement.classList.add("ship");
    }
    if (wasFired) cellElement.classList.add("fired");
  });
}

function renderFleetStatus(board, listElement) {
  listElement.innerHTML = "";
  board.ships.forEach((ship) => {
    const item = document.createElement("li");
    item.textContent = `${ship.name} (${ship.size})`;
    if (ship.isSunk) item.classList.add("sunk-ship");
    listElement.appendChild(item);
  });
}

function renderAll() {
  renderBoard(game.playerBoard, playerCellElements, { revealShips: true });
  renderBoard(game.enemyBoard, enemyCellElements, {
    revealShips: game.phase === "over",
  });
  renderFleetStatus(game.playerBoard, playerFleetElement);
  renderFleetStatus(game.enemyBoard, enemyFleetElement);
  // Only the board the player can actually click is marked interactive, so the
  // hover affordance never promises a click that would do nothing: their own
  // board during placement, the enemy board on their turn, neither otherwise.
  playerBoardElement.classList.toggle("interactive", game.phase === "placement");
  enemyBoardElement.classList.toggle(
    "interactive",
    game.phase === "playing" && game.turn === "player"
  );
}

function setStatus(message) {
  statusElement.textContent = message;
}

function addLogEntry(message) {
  const item = document.createElement("li");
  item.textContent = message;
  logElement.prepend(item);
}

/* ------------------------------------------------------------------ *
 * 3. Player placement flow
 * ------------------------------------------------------------------ */

function updatePlacementHint() {
  const ship = game.playerBoard.ships[game.playerBoard.placedShipCount];
  if (!ship) return;
  nextShipNameElement.textContent = ship.name;
  nextShipSizeElement.textContent = String(ship.size);
  orientationLabelElement.textContent = game.orientation;
}

function clearPreview() {
  playerCellElements.forEach((cellElement) => {
    cellElement.classList.remove("preview-ok", "preview-bad");
  });
}

function showPlacementPreview(index) {
  clearPreview();
  if (game.phase !== "placement") return;
  const ship = game.playerBoard.ships[game.playerBoard.placedShipCount];
  if (!ship) return;

  const cells = computeShipCells(
    game.playerBoard,
    toRow(index),
    toCol(index),
    ship.size,
    game.orientation
  );
  if (cells) {
    cells.forEach((cellIndex) =>
      playerCellElements[cellIndex].classList.add("preview-ok")
    );
  } else {
    playerCellElements[index].classList.add("preview-bad");
  }
}

function handlePlacementClick(index) {
  const board = game.playerBoard;
  const ship = board.ships[board.placedShipCount];
  if (!ship) return;

  const cells = computeShipCells(
    board,
    toRow(index),
    toCol(index),
    ship.size,
    game.orientation
  );
  if (!cells) {
    setStatus(`${ship.name} does not fit there. Try another cell or rotate.`);
    return;
  }

  placeShip(board, ship, cells);
  clearPreview();
  renderAll();

  if (board.placedShipCount === SHIP_TYPES.length) {
    startBattle();
  } else {
    updatePlacementHint();
    setStatus(`${ship.name} placed. Next: ${board.ships[board.placedShipCount].name}.`);
  }
}

function toggleOrientation() {
  game.orientation = game.orientation === HORIZONTAL ? VERTICAL : HORIZONTAL;
  updatePlacementHint();
  clearPreview();
}

/* ------------------------------------------------------------------ *
 * 4. Turn handling
 * ------------------------------------------------------------------ */

function startBattle() {
  game.phase = "playing";
  game.turn = "player";
  placementPanel.hidden = true;
  setStatus("Fleet ready. Fire at the enemy waters!");
  addLogEntry("Battle started.");
  renderAll();
}

function handlePlayerShot(index) {
  if (game.phase !== "playing" || game.turn !== "player") return;
  if (game.enemyBoard.firedAt[index]) {
    setStatus("You already fired at that cell.");
    return;
  }

  const result = fireAt(game.enemyBoard, index);
  const coordinate = formatCoordinate(index);
  if (result.sunkShip) {
    addLogEntry(`You sank the enemy ${result.sunkShip.name}!`);
    setStatus(`Hit at ${coordinate} - enemy ${result.sunkShip.name} sunk!`);
  } else if (result.hit) {
    addLogEntry(`You hit a ship at ${coordinate}.`);
    setStatus(`Hit at ${coordinate}.`);
  } else {
    addLogEntry(`You missed at ${coordinate}.`);
    setStatus(`Miss at ${coordinate}.`);
  }
  renderAll();

  if (game.enemyBoard.sunkShipCount === SHIP_TYPES.length) {
    endGame("player");
    return;
  }

  game.turn = "ai";
  renderAll();
  // Small delay so the player can read the outcome of their own shot.
  game.aiTimeoutId = window.setTimeout(takeAiTurn, 600);
}

function takeAiTurn() {
  if (game.phase !== "playing") return;

  const index = chooseAiShot(game.playerBoard, game.ai);
  const result = fireAt(game.playerBoard, index);
  updateAiAfterShot(game.playerBoard, game.ai, index, result);

  const coordinate = formatCoordinate(index);
  if (result.sunkShip) {
    addLogEntry(`The AI sank your ${result.sunkShip.name}!`);
    setStatus(`AI hit ${coordinate} and sank your ${result.sunkShip.name}!`);
  } else if (result.hit) {
    addLogEntry(`The AI hit your ship at ${coordinate}.`);
    setStatus(`AI hit ${coordinate}. Your turn.`);
  } else {
    addLogEntry(`The AI missed at ${coordinate}.`);
    setStatus(`AI missed at ${coordinate}. Your turn.`);
  }
  renderAll();

  if (game.playerBoard.sunkShipCount === SHIP_TYPES.length) {
    endGame("ai");
    return;
  }

  game.turn = "player";
  renderAll();
}

function endGame(winner) {
  game.phase = "over";
  renderAll();
  if (winner === "player") {
    setStatus("Victory! You sank the entire enemy fleet.");
    addLogEntry("Game over - you win!");
    showGameOverOverlay("You won!", "You sank the entire enemy fleet.");
  } else {
    setStatus("Defeat. The AI sank your entire fleet.");
    addLogEntry("Game over - the AI wins.");
    showGameOverOverlay("You lost", "The AI sank your entire fleet.");
  }
}

function showGameOverOverlay(title, detail) {
  resultTitleElement.textContent = title;
  resultDetailElement.textContent = detail;
  gameOverOverlay.hidden = false;
  // The rest of the page is inert while the result is up, so neither the mouse
  // nor the keyboard can reach the finished boards behind the overlay.
  pageContentElements.forEach((element) => {
    element.setAttribute("inert", "");
    element.setAttribute("aria-hidden", "true");
  });
  playAgainButton.focus();
}

function hideGameOverOverlay() {
  gameOverOverlay.hidden = true;
  pageContentElements.forEach((element) => {
    element.removeAttribute("inert");
    element.removeAttribute("aria-hidden");
  });
}

function isGameOverOverlayOpen() {
  return !gameOverOverlay.hidden;
}

/** Focusable controls inside the overlay, in tab order. */
function overlayFocusableElements() {
  return Array.from(
    gameOverOverlay.querySelectorAll("button, [href], input, select, textarea")
  );
}

/**
 * Focus trap. `inert` already keeps focus out of the page behind the overlay
 * in browsers that support it; wrapping Tab explicitly also keeps the cycle
 * inside the card in browsers that do not, and stops focus escaping to the
 * browser chrome and back into the page.
 */
function handleOverlayKeydown(event) {
  if (!isGameOverOverlayOpen()) return;

  if (event.key === "Escape") {
    // Dismissing would leave a finished game on screen with no visible way to
    // continue, so Escape only reaffirms the one available action.
    event.preventDefault();
    playAgainButton.focus();
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = overlayFocusableElements();
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const movingBackwards = event.shiftKey;

  if (movingBackwards && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!movingBackwards && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ================================================================== *
 * 5. AI OPPONENT - hunt / target state machine
 * ==================================================================
 *
 * State:
 *   mode            "hunt" (nothing to chase) or "target" (chasing damage)
 *   targetQueue     candidate cell indices to try next, highest priority last
 *   unresolvedHits  every hit cell not yet accounted for by a sunk ship
 *
 * Ships may sit next to each other, so hits are NOT assumed to belong to a
 * single ship. `unresolvedHits` is split into contiguous clusters and each
 * cluster is pursued on its own; orientation is only inferred within a
 * cluster that is collinear.
 *
 * Transitions:
 *   hunt   --hit-->  target       (hit joins unresolvedHits, queue rebuilt)
 *   target --hit-->  target
 *   target --sunk--> hunt ONLY when the sunk ship's cells account for every
 *                    unresolved hit; otherwise the leftover hits belong to
 *                    another damaged ship and the chase continues
 *   target --empty queue--> the queue is refilled from unresolvedHits, and
 *                    hunting resumes only once no unresolved hit is left
 */

function createAiState() {
  return { mode: "hunt", targetQueue: [], unresolvedHits: [] };
}

function hasNotBeenFiredAt(board, index) {
  return !board.firedAt[index];
}

function orthogonalNeighbours(index) {
  const row = toRow(index);
  const col = toCol(index);
  return [
    [row - 1, col],
    [row + 1, col],
    [row, col - 1],
    [row, col + 1],
  ]
    .filter(([r, c]) => isInsideBoard(r, c))
    .map(([r, c]) => toIndex(r, c));
}

/**
 * Picks the AI's next shot; never returns a cell that was already fired at.
 * An exhausted queue does not end the chase: while an unresolved hit remains
 * the queue is rebuilt from it (which, after a failed line, degrades to
 * targeting those hits individually), so a damaged ship is never abandoned.
 */
function chooseAiShot(board, ai) {
  for (;;) {
    while (ai.targetQueue.length > 0) {
      const candidate = ai.targetQueue.pop();
      if (hasNotBeenFiredAt(board, candidate)) {
        ai.mode = "target";
        return candidate;
      }
    }
    if (ai.unresolvedHits.length === 0) break;
    const refilled = buildTargetQueue(board, ai.unresolvedHits);
    if (refilled.length === 0) break; // every unresolved hit is boxed in
    ai.targetQueue = refilled;
  }
  ai.mode = "hunt";
  return chooseRandomUnfiredCell(board);
}

function chooseRandomUnfiredCell(board) {
  const openCells = [];
  for (let index = 0; index < board.firedAt.length; index += 1) {
    if (!board.firedAt[index]) openCells.push(index);
  }
  return openCells[Math.floor(Math.random() * openCells.length)];
}

function updateAiAfterShot(board, ai, index, result) {
  if (!result.hit) return;

  ai.unresolvedHits.push(index);

  if (result.sunkShip) {
    // Only the sunk ship's own cells are resolved. Hits left over belong to
    // another damaged ship (adjacent ships share a cluster of hits), so they
    // stay in the pursuit set and the chase continues.
    const sunkCells = new Set(result.sunkShip.cells);
    ai.unresolvedHits = ai.unresolvedHits.filter((hit) => !sunkCells.has(hit));
    ai.targetQueue = ai.targetQueue.filter((cell) => !sunkCells.has(cell));
  }

  if (ai.unresolvedHits.length === 0) {
    ai.mode = "hunt";
    ai.targetQueue = [];
    return;
  }

  ai.mode = "target";
  ai.targetQueue = buildTargetQueue(board, ai.unresolvedHits);
}

/**
 * Splits hits into clusters of orthogonally connected cells. Two damaged
 * ships lying side by side form a single cluster, which is why a cluster is
 * never assumed to be one ship.
 */
function groupContiguousHits(hits) {
  const remaining = new Set(hits);
  const clusters = [];

  while (remaining.size > 0) {
    const seed = remaining.values().next().value;
    remaining.delete(seed);
    const cluster = [seed];
    const frontier = [seed];
    while (frontier.length > 0) {
      const cell = frontier.pop();
      orthogonalNeighbours(cell).forEach((neighbour) => {
        if (remaining.has(neighbour)) {
          remaining.delete(neighbour);
          cluster.push(neighbour);
          frontier.push(neighbour);
        }
      });
    }
    clusters.push(cluster);
  }
  return clusters;
}

function areCollinear(cells) {
  const rows = cells.map(toRow);
  const cols = cells.map(toCol);
  return (
    rows.every((row) => row === rows[0]) || cols.every((col) => col === cols[0])
  );
}

/** The cells extending a collinear cluster past each of its two ends. */
function lineExtensions(cluster) {
  const rows = cluster.map(toRow);
  const cols = cluster.map(toCol);
  const candidates = [];

  if (rows.every((row) => row === rows[0])) {
    const row = rows[0];
    candidates.push([row, Math.min(...cols) - 1], [row, Math.max(...cols) + 1]);
  } else {
    const col = cols[0];
    candidates.push([Math.min(...rows) - 1, col], [Math.max(...rows) + 1, col]);
  }
  return candidates
    .filter(([row, col]) => isInsideBoard(row, col))
    .map(([row, col]) => toIndex(row, col));
}

/**
 * Rebuilds the candidate queue from every unresolved hit. Candidates are
 * popped from the end, so the largest cluster (the strongest lead) is queued
 * last and shot at first.
 *
 * Per cluster:
 *   - collinear with 2+ cells -> extend the inferred line at both ends
 *   - otherwise, or once both of those ends have been fired at (the "line"
 *     was really two adjacent ships) -> fall back to the neighbours of each
 *     hit in the cluster
 * Cells already fired at are dropped, so an empty result means there is
 * genuinely nothing left to try.
 */
function buildTargetQueue(board, unresolvedHits) {
  const clusters = groupContiguousHits(unresolvedHits).sort(
    (a, b) => a.length - b.length
  );
  const queue = [];

  clusters.forEach((cluster) => {
    let candidates = [];
    if (cluster.length >= 2 && areCollinear(cluster)) {
      candidates = lineExtensions(cluster).filter((cell) =>
        hasNotBeenFiredAt(board, cell)
      );
    }
    if (candidates.length === 0) {
      candidates = cluster
        .flatMap(orthogonalNeighbours)
        .filter((cell) => hasNotBeenFiredAt(board, cell));
    }
    candidates.forEach((cell) => {
      if (!queue.includes(cell)) queue.push(cell);
    });
  });
  return queue;
}

/* ------------------------------------------------------------------ *
 * 6. Game lifecycle and event wiring
 * ------------------------------------------------------------------ */

const playerCellElements = buildBoardCells(playerBoardElement, "Your waters");
const enemyCellElements = buildBoardCells(enemyBoardElement, "Enemy waters");

let game;

function newGame() {
  if (game && game.aiTimeoutId) window.clearTimeout(game.aiTimeoutId);
  game = {
    phase: "placement",
    turn: "player",
    orientation: HORIZONTAL,
    playerBoard: createBoard(),
    enemyBoard: createBoard(),
    ai: createAiState(),
    aiTimeoutId: null,
  };
  const overlayWasOpen = isGameOverOverlayOpen();
  placeFleetRandomly(game.enemyBoard);
  placementPanel.hidden = false;
  hideGameOverOverlay();
  logElement.innerHTML = "";
  clearPreview();
  updatePlacementHint();
  setStatus("Place your fleet to begin.");
  renderAll();
  // Closing the overlay must not drop focus onto <body>: hand it to the first
  // control of the phase the player lands in.
  if (overlayWasOpen) randomButton.focus();
}

playerBoardElement.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell || game.phase !== "placement") return;
  handlePlacementClick(Number(cell.dataset.index));
});

playerBoardElement.addEventListener("mouseover", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  showPlacementPreview(Number(cell.dataset.index));
});

playerBoardElement.addEventListener("mouseleave", clearPreview);

enemyBoardElement.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  handlePlayerShot(Number(cell.dataset.index));
});

rotateButton.addEventListener("click", toggleOrientation);

document.addEventListener("keydown", (event) => {
  if (isGameOverOverlayOpen()) {
    handleOverlayKeydown(event);
    return;
  }
  if (event.key.toLowerCase() === "r" && game.phase === "placement") {
    toggleOrientation();
  }
});

// Last line of defence for browsers without `inert`: pull any focus that lands
// outside the overlay back into it.
document.addEventListener("focusin", (event) => {
  if (isGameOverOverlayOpen() && !gameOverOverlay.contains(event.target)) {
    playAgainButton.focus();
  }
});

randomButton.addEventListener("click", () => {
  game.playerBoard = createBoard();
  placeFleetRandomly(game.playerBoard);
  clearPreview();
  startBattle();
});

resetPlacementButton.addEventListener("click", () => {
  game.playerBoard = createBoard();
  clearPreview();
  updatePlacementHint();
  setStatus("Placement cleared. Place your fleet to begin.");
  renderAll();
});

newGameButton.addEventListener("click", newGame);
playAgainButton.addEventListener("click", newGame);

newGame();
