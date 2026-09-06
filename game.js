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
  updateAiAfterShot(game.ai, index, result);

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
  } else {
    setStatus("Defeat. The AI sank your entire fleet.");
    addLogEntry("Game over - the AI wins.");
  }
}

/* ================================================================== *
 * 5. AI OPPONENT - hunt / target state machine
 * ==================================================================
 *
 * State:
 *   mode          "hunt" (no ship being chased) or "target" (chasing one)
 *   targetQueue   candidate cell indices to try next, highest priority last
 *   currentHits   hits belonging to the ship currently being chased
 *
 * Transitions:
 *   hunt   --hit-->  target       (seed queue with orthogonal neighbours)
 *   target --hit-->  target       (once two hits share a row or column the
 *                                  queue is rebuilt to only the two ends of
 *                                  that line, so the AI follows the ship)
 *   target --sunk--> hunt         (unless leftover hits from another ship
 *                                  remain, in which case chasing continues)
 *   target --empty queue--> hunt
 */

function createAiState() {
  return { mode: "hunt", targetQueue: [], currentHits: [] };
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

/** Picks the AI's next shot; never returns a cell that was already fired at. */
function chooseAiShot(board, ai) {
  while (ai.targetQueue.length > 0) {
    const candidate = ai.targetQueue.pop();
    if (hasNotBeenFiredAt(board, candidate)) return candidate;
  }
  // Queue exhausted (or empty): fall back to hunting.
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

function updateAiAfterShot(ai, index, result) {
  if (!result.hit) return;

  ai.currentHits.push(index);

  if (result.sunkShip) {
    // Drop the sunk ship's cells from the chase. Any hits left over belong to
    // a different ship that was clipped along the way, so keep targeting those.
    const sunkCells = new Set(result.sunkShip.cells);
    ai.currentHits = ai.currentHits.filter((hit) => !sunkCells.has(hit));
    ai.targetQueue = ai.targetQueue.filter((cell) => !sunkCells.has(cell));

    if (ai.currentHits.length === 0) {
      ai.mode = "hunt";
      ai.targetQueue = [];
      return;
    }
  }

  ai.mode = "target";
  ai.targetQueue = buildTargetQueue(ai.currentHits);
}

/**
 * Rebuilds the candidate queue from the hits on the ship being chased.
 * With a single hit the candidates are its four neighbours. With two or more
 * hits the orientation is known, so only the two cells extending the line are
 * worth trying. Cells already fired at are skipped when the queue is consumed.
 */
function buildTargetQueue(hits) {
  if (hits.length === 1) return orthogonalNeighbours(hits[0]);

  const rows = hits.map(toRow);
  const cols = hits.map(toCol);
  const sameRow = rows.every((row) => row === rows[0]);
  const candidates = [];

  if (sameRow) {
    const row = rows[0];
    const minCol = Math.min(...cols);
    const maxCol = Math.max(...cols);
    if (isInsideBoard(row, minCol - 1)) candidates.push(toIndex(row, minCol - 1));
    if (isInsideBoard(row, maxCol + 1)) candidates.push(toIndex(row, maxCol + 1));
  } else {
    const col = cols[0];
    const minRow = Math.min(...rows);
    const maxRow = Math.max(...rows);
    if (isInsideBoard(minRow - 1, col)) candidates.push(toIndex(minRow - 1, col));
    if (isInsideBoard(maxRow + 1, col)) candidates.push(toIndex(maxRow + 1, col));
  }
  return candidates;
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
  placeFleetRandomly(game.enemyBoard);
  placementPanel.hidden = false;
  logElement.innerHTML = "";
  clearPreview();
  updatePlacementHint();
  setStatus("Place your fleet to begin.");
  renderAll();
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
  if (event.key.toLowerCase() === "r" && game.phase === "placement") {
    toggleOrientation();
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

newGame();
