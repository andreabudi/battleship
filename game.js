/* Battleship - vanilla JS, no dependencies.
 *
 * Layout of this file:
 *   1. Constants and model helpers (fleet, boards, placement rules)
 *   2. Rendering (2a. ship graphics, 2b. boards and panels)
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
    /* Ship ids in the order they were placed, so Undo works in any order. */
    placementOrder: [],
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

/**
 * The on-board cells a ship would cover, ignoring legality. Used by the
 * preview so an invalid placement can be shown in full (the part that runs off
 * the board simply has no cells to mark) rather than as a single red cell.
 */
function computeFootprintCells(row, col, size, orientation) {
  const cells = [];
  for (let step = 0; step < size; step += 1) {
    const cellRow = orientation === VERTICAL ? row + step : row;
    const cellCol = orientation === HORIZONTAL ? col + step : col;
    if (isInsideBoard(cellRow, cellCol)) cells.push(toIndex(cellRow, cellCol));
  }
  return cells;
}

function placeShip(board, ship, cells) {
  ship.cells = cells;
  cells.forEach((index) => {
    board.shipIdAt[index] = ship.id;
  });
  board.placementOrder.push(ship.id);
  board.placedShipCount += 1;
}

function isShipPlaced(ship) {
  return ship.cells.length > 0;
}

/** Takes a placed ship off the board again, returning it. */
function unplaceShip(board, ship) {
  ship.cells.forEach((index) => {
    board.shipIdAt[index] = null;
  });
  ship.cells = [];
  board.placementOrder = board.placementOrder.filter((id) => id !== ship.id);
  board.placedShipCount -= 1;
  return ship;
}

/** Removes the most recently placed ship, returning it (or null if none). */
function unplaceLastShip(board) {
  if (board.placedShipCount === 0) return null;
  const lastId = board.placementOrder[board.placementOrder.length - 1];
  return unplaceShip(board, board.ships[lastId]);
}

/** Orientation of a placed ship, derived from its cells. */
function orientationOf(ship) {
  if (ship.cells.length < 2) return HORIZONTAL;
  return toRow(ship.cells[0]) === toRow(ship.cells[1]) ? HORIZONTAL : VERTICAL;
}

function placeFleetRandomly(board) {
  board.ships.forEach((ship) => {
    if (isShipPlaced(ship)) return;
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
const mainElement = document.getElementById("game");
const boardsElement = document.getElementById("boards");
const enemyWrapperElement = document.getElementById("enemy-wrapper");
const placementPanel = document.getElementById("placement-panel");
const fleetPickerPanel = document.getElementById("fleet-picker-panel");
const fleetPickerElement = document.getElementById("fleet-picker");
const startGameButton = document.getElementById("start-game-btn");
const nextShipNameElement = document.getElementById("next-ship-name");
const nextShipSizeElement = document.getElementById("next-ship-size");
const orientationLabelElement = document.getElementById("orientation-label");
const placementInstructionElement = document.getElementById(
  "placement-instruction"
);
const rotateButton = document.getElementById("rotate-btn");
const confirmPlacementButton = document.getElementById("confirm-placement-btn");
const undoShipButton = document.getElementById("undo-ship-btn");
const randomButton = document.getElementById("random-btn");
const resetPlacementButton = document.getElementById("reset-placement-btn");
const newGameButton = document.getElementById("new-game-btn");
const gameOverOverlay = document.getElementById("game-over-overlay");
const resultTitleElement = document.getElementById("result-title");
const resultDetailElement = document.getElementById("result-detail");
const playAgainButton = document.getElementById("play-again-btn");
const rulesButton = document.getElementById("rules-btn");
const resultRulesButton = document.getElementById("result-rules-btn");
const rulesOverlay = document.getElementById("rules-overlay");
const rulesCloseButton = document.getElementById("rules-close-btn");
/* Everything the overlay covers; made inert while the overlay is open. */
const pageContentElements = Array.from(
  document.querySelectorAll("body > header, body > main")
);

/* ------------------------------------------------------------------ *
 * 2a. Ship graphics
 *
 * Every ship is one inline SVG drawn in a 100-unit-per-cell coordinate
 * system, horizontally with the bow pointing right. On a board the SVG is a
 * grid item spanning the ship's cells (gaps included), so it lines up with
 * the grid at any size; the vertical variant is the same drawing rotated.
 * The SVGs never take pointer events - clicks land on the cell buttons
 * underneath exactly as they did before.
 * ------------------------------------------------------------------ */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Silhouettes keyed by ship name; `length` is the ship's size * 100. */
const SHIP_SILHOUETTES = {
  // Flat, near-rectangular flight deck with an angled bow, an island and a
  // dashed runway line.
  Carrier: (length) => `
    <path class="hull" d="M 34 16 H ${length - 52} L ${length - 8} 50 L ${length - 52} 84 H 34 Q 8 84 8 50 Q 8 16 34 16 Z"/>
    <line class="deck-line" x1="44" y1="50" x2="${length - 60}" y2="50" stroke-dasharray="16 12"/>
    <rect class="deck" x="${length * 0.58}" y="22" width="70" height="20" rx="3"/>`,
  // Pointed bow, a central superstructure with a funnel and two gun turrets.
  Battleship: (length) => `
    <path class="hull" d="M 40 20 H ${length - 72} L ${length - 8} 50 L ${length - 72} 80 H 40 Q 10 80 10 50 Q 10 20 40 20 Z"/>
    <rect class="deck" x="${length * 0.4}" y="30" width="${length * 0.2}" height="40" rx="4"/>
    <rect class="detail" x="${length * 0.48}" y="38" width="14" height="24" rx="2"/>
    <line class="barrel" x1="${length * 0.22}" y1="50" x2="${length * 0.13}" y2="50"/>
    <circle class="turret" cx="${length * 0.24}" cy="50" r="14"/>
    <line class="barrel" x1="${length * 0.74}" y1="50" x2="${length * 0.86}" y2="50"/>
    <circle class="turret" cx="${length * 0.72}" cy="50" r="14"/>`,
  // Slimmer hull with a bridge, one funnel and a single forward turret.
  Cruiser: (length) => `
    <path class="hull" d="M 34 26 H ${length - 62} L ${length - 8} 50 L ${length - 62} 74 H 34 Q 10 74 10 50 Q 10 26 34 26 Z"/>
    <rect class="deck" x="${length * 0.38}" y="35" width="${length * 0.22}" height="30" rx="3"/>
    <circle class="detail" cx="${length * 0.44}" cy="50" r="7"/>
    <line class="barrel" x1="${length * 0.74}" y1="50" x2="${length * 0.86}" y2="50"/>
    <circle class="turret" cx="${length * 0.73}" cy="50" r="10"/>`,
  // Cigar-shaped hull rounded at both ends, a conning tower and a periscope.
  Submarine: (length) => `
    <path class="hull" d="M 50 28 H ${length - 50} Q ${length - 8} 28 ${length - 8} 50 Q ${length - 8} 72 ${length - 50} 72 H 50 Q 8 72 8 50 Q 8 28 50 28 Z"/>
    <rect class="deck" x="${length * 0.42}" y="16" width="${length * 0.17}" height="32" rx="7"/>
    <line class="mast" x1="${length * 0.5}" y1="6" x2="${length * 0.5}" y2="18"/>`,
  // Small and sharp: a bridge with a mast and one gun.
  Destroyer: (length) => `
    <path class="hull" d="M 30 28 H ${length - 50} L ${length - 8} 50 L ${length - 50} 72 H 30 Q 8 72 8 50 Q 8 28 30 28 Z"/>
    <rect class="deck" x="${length * 0.38}" y="36" width="${length * 0.24}" height="28" rx="3"/>
    <line class="mast" x1="${length * 0.5}" y1="16" x2="${length * 0.5}" y2="36"/>
    <line class="barrel" x1="${length * 0.76}" y1="50" x2="${length * 0.87}" y2="50"/>
    <circle class="turret" cx="${length * 0.75}" cy="50" r="8"/>`,
};

/**
 * An SVG of `type` pointing right (horizontal) or down (vertical). A preview
 * that runs off the board is drawn with `visibleCells` < size: the viewBox
 * then shows only the part of the ship that is on the board.
 */
function createShipGraphic(type, orientation, visibleCells = type.size) {
  const svg = document.createElementNS(SVG_NS, "svg");
  const length = type.size * 100;
  const visibleLength = visibleCells * 100;
  svg.setAttribute(
    "viewBox",
    orientation === HORIZONTAL
      ? `0 0 ${visibleLength} 100`
      : `0 0 100 ${visibleLength}`
  );
  // The span includes the gaps between cells, so the box is slightly longer
  // than size:1; stretching to fill it keeps the graphic on the cells.
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("ship-graphic", `ship-${type.name.toLowerCase()}`);
  const group = document.createElementNS(SVG_NS, "g");
  if (orientation === VERTICAL) {
    // (x, y) -> (100 - y, x): the bow at x = length ends up at the bottom.
    group.setAttribute("transform", "translate(100 0) rotate(90)");
  }
  group.innerHTML = SHIP_SILHOUETTES[type.name](length);
  svg.appendChild(group);
  return svg;
}

/** Places a ship graphic over the grid cells `cells` (contiguous, in order). */
function positionShipGraphic(svg, cells) {
  const first = cells[0];
  const last = cells[cells.length - 1];
  svg.style.gridArea = `${toRow(first) + 1} / ${toCol(first) + 1} / ${
    toRow(last) + 2
  } / ${toCol(last) + 2}`;
}

/**
 * Draws the ships of `board` that may be shown. Enemy ships are only added
 * to the document once sunk (or when the game is over), so nothing about
 * their position exists in the page before that.
 */
function renderShipGraphics(board, boardElement, { revealShips }) {
  boardElement
    .querySelectorAll(".ship-graphic:not(.preview)")
    .forEach((element) => element.remove());
  board.ships.forEach((ship) => {
    if (!isShipPlaced(ship)) return;
    if (!revealShips && !ship.isSunk) return;
    const svg = createShipGraphic(ship, orientationOf(ship));
    svg.classList.add("placed");
    if (ship.isSunk) svg.classList.add("sunk");
    positionShipGraphic(svg, ship.cells);
    boardElement.appendChild(svg);
  });
}

/* ------------------------------------------------------------------ *
 * 2b. Boards and panels
 * ------------------------------------------------------------------ */

/** Builds the 100 cell buttons once per board and returns them in index order. */
function buildBoardCells(boardElement, label) {
  boardElement.innerHTML = "";
  const cells = [];
  for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index += 1) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    cell.dataset.index = String(index);
    // Explicit grid placement, so the ship graphics (also grid items) can
    // share the same tracks without displacing the cells.
    cell.style.gridArea = `${toRow(index) + 1} / ${toCol(index) + 1}`;
    cell.setAttribute("aria-label", `${label} ${formatCoordinate(index)}`);
    boardElement.appendChild(cell);
    cells.push(cell);
  }
  return cells;
}

function renderBoard(board, cellElements, { revealShips }) {
  renderShipGraphics(board, cellElements[0].parentElement, { revealShips });
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

/**
 * The fleet picker: one button per ship, built once. During placement it is
 * how the player chooses which ship to place next, in any order; a placed
 * ship's entry is disabled (click it on the board to pick it up again).
 */
function buildFleetPicker() {
  fleetPickerElement.innerHTML = "";
  return SHIP_TYPES.map((type, id) => {
    const item = document.createElement("li");
    const option = document.createElement("button");
    option.type = "button";
    option.className = "fleet-option";
    option.dataset.shipId = String(id);

    const name = document.createElement("span");
    name.className = "fleet-option-name";
    name.textContent = `${type.name} (${type.size})`;

    const silhouette = createShipGraphic(type, HORIZONTAL);
    silhouette.classList.add("fleet-silhouette");
    silhouette.style.setProperty("--ship-length", String(type.size));

    option.append(name, silhouette);
    item.appendChild(option);
    fleetPickerElement.appendChild(item);
    return option;
  });
}

function renderFleetPicker() {
  game.playerBoard.ships.forEach((ship, id) => {
    const option = fleetOptionElements[id];
    const placed = isShipPlaced(ship);
    const selected = game.selectedShipId === id;
    option.classList.toggle("placed", placed);
    option.classList.toggle("selected", selected);
    option.disabled = placed;
    option.setAttribute("aria-pressed", String(selected));
  });
}

function renderAll() {
  renderBoard(game.playerBoard, playerCellElements, { revealShips: true });
  renderBoard(game.enemyBoard, enemyCellElements, {
    revealShips: game.phase === "over",
  });
  renderFleetStatus(game.playerBoard, playerFleetElement);
  renderFleetStatus(game.enemyBoard, enemyFleetElement);
  if (game.phase === "placement") {
    renderFleetPicker();
    updatePlacementControls();
  }
  // Only the board the player can actually click is marked interactive, so the
  // hover affordance never promises a click that would do nothing: their own
  // board during placement, the enemy board on their turn, neither otherwise.
  playerBoardElement.classList.toggle("interactive", game.phase === "placement");
  enemyBoardElement.classList.toggle(
    "interactive",
    game.phase === "playing" && game.turn === "player"
  );
  // renderBoard resets every cell's classes, so the preview is repainted last.
  paintPreview();
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

/**
 * Touch screens have no hover, so a tap cannot both preview and commit. On a
 * touch interaction placement becomes select-then-confirm: the first tap only
 * arms `pendingIndex`, and Confirm commits it. A mouse keeps the original
 * hover-preview / click-to-place flow. The mode follows the pointer that was
 * last used rather than the device, so hybrid laptops behave sensibly.
 */
let usesTapPlacement = window.matchMedia("(hover: none)").matches;

/** The ship chosen in the fleet picker, or null once it is on the board. */
function selectedShip() {
  if (game.selectedShipId === null) return null;
  const ship = game.playerBoard.ships[game.selectedShipId];
  return isShipPlaced(ship) ? null : ship;
}

/** Selects a ship from the picker; null when nothing is left to place. */
function selectShip(shipId) {
  game.selectedShipId = shipId;
  game.pendingIndex = null;
  game.previewIndex = null;
  updatePlacementHint();
  renderAll();
}

/** The first ship still waiting to be placed, in fleet order, or null. */
function nextUnplacedShipId() {
  const ship = game.playerBoard.ships.find((candidate) => !isShipPlaced(candidate));
  return ship ? ship.id : null;
}

function updatePlacementHint() {
  const ship = selectedShip();
  if (!ship) {
    const allPlaced = game.playerBoard.placedShipCount === SHIP_TYPES.length;
    placementInstructionElement.textContent = allPlaced
      ? "Press Start game, or click a ship on the board to move it."
      : "Select a ship from the list to place it.";
    nextShipNameElement.textContent = allPlaced
      ? "All ships placed"
      : "No ship selected";
    nextShipSizeElement.textContent = "";
    orientationLabelElement.textContent = "";
    placementPanel.classList.add("no-selection");
    return;
  }
  placementPanel.classList.remove("no-selection");
  nextShipNameElement.textContent = ship.name;
  nextShipSizeElement.textContent = String(ship.size);
  orientationLabelElement.textContent = game.orientation;
  placementInstructionElement.textContent = usesTapPlacement
    ? "Tap a cell on your waters to preview, then Confirm to place it"
    : "Click a cell on your waters to place it";
}

/** The cells a preview at `index` covers, and whether it may be committed. */
function previewPlacement(index) {
  const ship = selectedShip();
  if (!ship) return null;
  const row = toRow(index);
  const col = toCol(index);
  const legalCells = computeShipCells(
    game.playerBoard,
    row,
    col,
    ship.size,
    game.orientation
  );
  return {
    ship,
    isValid: legalCells !== null,
    cells: legalCells || computeFootprintCells(row, col, ship.size, game.orientation),
  };
}

/** Repaints the preview from `game.previewIndex`; safe to call after any render. */
function paintPreview() {
  playerCellElements.forEach((cellElement) => {
    cellElement.classList.remove("preview-ok", "preview-bad", "preview-pending");
  });
  playerBoardElement
    .querySelectorAll(".ship-graphic.preview")
    .forEach((element) => element.remove());
  if (game.phase !== "placement" || game.previewIndex === null) return;

  const preview = previewPlacement(game.previewIndex);
  if (!preview) return;
  const stateClass = preview.isValid ? "preview-ok" : "preview-bad";
  // A tap-selected preview is armed rather than merely hovered, so it gets an
  // extra outline that survives the pointer leaving the board.
  const pending = game.pendingIndex !== null;
  preview.cells.forEach((cellIndex) => {
    playerCellElements[cellIndex].classList.add(stateClass);
    if (pending) playerCellElements[cellIndex].classList.add("preview-pending");
  });
  // The ship itself, tinted for validity; off-board previews show only the
  // part of the hull that is on the board.
  const svg = createShipGraphic(
    preview.ship,
    game.orientation,
    preview.cells.length
  );
  svg.classList.add("preview", stateClass);
  if (pending) svg.classList.add("preview-pending");
  positionShipGraphic(svg, preview.cells);
  playerBoardElement.appendChild(svg);
}

function setPreview(index) {
  game.previewIndex = index;
  paintPreview();
}

function clearPreview() {
  game.previewIndex = null;
  game.pendingIndex = null;
  paintPreview();
  updatePlacementControls();
}

/** Confirm is only offered — and only enabled — when it would do something. */
function updatePlacementControls() {
  const pendingPreview =
    game.pendingIndex === null ? null : previewPlacement(game.pendingIndex);
  confirmPlacementButton.hidden = !usesTapPlacement;
  confirmPlacementButton.disabled = !pendingPreview || !pendingPreview.isValid;
  undoShipButton.disabled = game.playerBoard.placedShipCount === 0;
  startGameButton.disabled =
    game.playerBoard.placedShipCount !== SHIP_TYPES.length;
}

/** Tap flow: arm a placement without committing it. */
function selectPlacementCell(index) {
  const preview = previewPlacement(index);
  if (!preview) return;
  game.pendingIndex = index;
  setPreview(index);
  updatePlacementControls();
  setStatus(
    preview.isValid
      ? `${preview.ship.name} at ${formatCoordinate(index)} - Confirm to place, or Rotate.`
      : `${preview.ship.name} does not fit at ${formatCoordinate(index)}. Rotate or pick another cell.`
  );
}

function commitPlacement(index) {
  const board = game.playerBoard;
  const preview = previewPlacement(index);
  if (!preview) return;
  if (!preview.isValid) {
    setStatus(`${preview.ship.name} does not fit there. Try another cell or rotate.`);
    return;
  }

  placeShip(board, preview.ship, preview.cells);
  // Move on to the next unplaced ship so a player who does not care about
  // the order never has to touch the picker; they can still override it.
  selectShip(nextUnplacedShipId());

  if (board.placedShipCount === SHIP_TYPES.length) {
    setStatus(`${preview.ship.name} placed. All ships placed - press Start game.`);
  } else {
    setStatus(`${preview.ship.name} placed. Next: ${selectedShip().name}.`);
  }
}

/**
 * Clicking a placed ship during placement lifts it off the board and makes it
 * the selected ship again, keeping its orientation. In tap mode the lifted
 * ship stays armed at its old position so a stray tap costs nothing: Confirm
 * simply puts it back.
 */
function pickUpShip(ship) {
  const anchorIndex = ship.cells[0];
  game.orientation = orientationOf(ship);
  unplaceShip(game.playerBoard, ship);
  selectShip(ship.id);
  if (usesTapPlacement) {
    selectPlacementCell(anchorIndex);
  } else {
    setPreview(anchorIndex);
    setStatus(`${ship.name} picked up. Click a cell to place it again.`);
  }
}

function handlePlacementCellActivation(index) {
  const shipId = game.playerBoard.shipIdAt[index];
  if (shipId !== null) {
    pickUpShip(game.playerBoard.ships[shipId]);
    return;
  }
  if (!selectedShip()) {
    setStatus("Select a ship from the list first.");
    return;
  }
  if (usesTapPlacement) {
    selectPlacementCell(index);
  } else {
    commitPlacement(index);
  }
}

function undoLastShip() {
  const removed = unplaceLastShip(game.playerBoard);
  if (!removed) return;
  selectShip(removed.id);
  setStatus(`${removed.name} removed. Place it again.`);
}

function toggleOrientation() {
  game.orientation = game.orientation === HORIZONTAL ? VERTICAL : HORIZONTAL;
  updatePlacementHint();
  // Rotating redraws the current preview in place, so a tap-selected placement
  // can be rotated without re-tapping (and a hovered one without moving).
  if (game.pendingIndex !== null) {
    selectPlacementCell(game.pendingIndex);
    return;
  }
  paintPreview();
}

/* ------------------------------------------------------------------ *
 * 4. Turn handling
 * ------------------------------------------------------------------ */

function startBattle() {
  if (game.playerBoard.placedShipCount !== SHIP_TYPES.length) return;
  game.phase = "playing";
  game.turn = "player";
  game.previewIndex = null;
  game.pendingIndex = null;
  placementPanel.hidden = true;
  fleetPickerPanel.hidden = true;
  // The enemy board only exists in the document once the battle starts.
  boardsElement.appendChild(enemyWrapperElement);
  mainElement.classList.remove("placement");
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

/* ------------------------------------------------------------------ *
 * Rules dialog. Purely presentational: it never touches `game`, so it can
 * be opened in any phase - including while the AI's timer is pending, whose
 * shot simply lands behind the scrim. It stacks above the end-of-game
 * overlay, which is why that overlay is made inert too while it is open.
 * ------------------------------------------------------------------ */

/* The control that opened the rules; focus returns to it on close. */
let rulesOpener = null;

function isRulesOpen() {
  return !rulesOverlay.hidden;
}

function openRules(opener) {
  rulesOpener = opener;
  rulesOverlay.hidden = false;
  rulesOverlay.scrollTop = 0;
  [...pageContentElements, gameOverOverlay].forEach((element) => {
    element.setAttribute("inert", "");
    element.setAttribute("aria-hidden", "true");
  });
  rulesCloseButton.focus();
}

function closeRules() {
  rulesOverlay.hidden = true;
  gameOverOverlay.removeAttribute("inert");
  gameOverOverlay.removeAttribute("aria-hidden");
  // The page itself stays inert if the result is still up underneath.
  if (!isGameOverOverlayOpen()) {
    pageContentElements.forEach((element) => {
      element.removeAttribute("inert");
      element.removeAttribute("aria-hidden");
    });
  }
  const opener = rulesOpener;
  rulesOpener = null;
  // If the game ended while the rules were open, the opener in the page is
  // now inert, so focus goes to the result instead.
  if (isGameOverOverlayOpen() && !gameOverOverlay.contains(opener)) {
    playAgainButton.focus();
  } else if (opener) {
    opener.focus();
  }
}

/** The topmost open modal, if any. */
function activeModal() {
  if (isRulesOpen()) return rulesOverlay;
  if (isGameOverOverlayOpen()) return gameOverOverlay;
  return null;
}

/** Where focus is parked when it tries to leave the active modal. */
function activeModalHome() {
  return isRulesOpen() ? rulesCloseButton : playAgainButton;
}

/** Focusable controls inside the given modal, in tab order. */
function overlayFocusableElements(modal) {
  return Array.from(
    modal.querySelectorAll("button, [href], input, select, textarea")
  );
}

/**
 * Focus trap. `inert` already keeps focus out of the page behind the overlay
 * in browsers that support it; wrapping Tab explicitly also keeps the cycle
 * inside the card in browsers that do not, and stops focus escaping to the
 * browser chrome and back into the page.
 */
function handleOverlayKeydown(event) {
  const modal = activeModal();
  if (!modal) return;

  if (event.key === "Escape") {
    event.preventDefault();
    if (isRulesOpen()) {
      closeRules();
    } else {
      // Dismissing would leave a finished game on screen with no visible way
      // to continue, so Escape only reaffirms the one available action.
      playAgainButton.focus();
    }
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = overlayFocusableElements(modal);
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
const fleetOptionElements = buildFleetPicker();

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
    previewIndex: null,
    pendingIndex: null,
    selectedShipId: 0,
  };
  const overlayWasOpen = isGameOverOverlayOpen();
  placeFleetRandomly(game.enemyBoard);
  placementPanel.hidden = false;
  fleetPickerPanel.hidden = false;
  enemyWrapperElement.remove();
  mainElement.classList.add("placement");
  hideGameOverOverlay();
  logElement.innerHTML = "";
  updatePlacementHint();
  setStatus("Select a ship and place it on your waters.");
  renderAll();
  // Closing the overlay must not drop focus onto <body>: hand it to the first
  // control of the phase the player lands in.
  if (overlayWasOpen) randomButton.focus();
}

// The pointer that starts the interaction decides the placement flow, so a
// touch on a hybrid device switches to tap-and-confirm and a mouse switches
// back.
playerBoardElement.addEventListener("pointerdown", (event) => {
  const nowTapPlacement = event.pointerType !== "mouse";
  if (nowTapPlacement === usesTapPlacement) return;
  usesTapPlacement = nowTapPlacement;
  updatePlacementHint();
  updatePlacementControls();
});

playerBoardElement.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell || game.phase !== "placement") return;
  handlePlacementCellActivation(Number(cell.dataset.index));
});

playerBoardElement.addEventListener("mouseover", (event) => {
  const cell = event.target.closest(".cell");
  // A tap-selected preview stays put until it is confirmed or moved.
  if (!cell || game.phase !== "placement" || game.pendingIndex !== null) return;
  const index = Number(cell.dataset.index);
  // Over a placed ship the click would pick it up, not place, so no preview.
  setPreview(game.playerBoard.shipIdAt[index] === null ? index : null);
});

fleetPickerElement.addEventListener("click", (event) => {
  const option = event.target.closest(".fleet-option");
  if (!option || option.disabled || game.phase !== "placement") return;
  const ship = game.playerBoard.ships[Number(option.dataset.shipId)];
  selectShip(ship.id);
  setStatus(
    usesTapPlacement
      ? `${ship.name} selected. Tap a cell on your waters to preview it.`
      : `${ship.name} selected. Click a cell on your waters to place it.`
  );
});

startGameButton.addEventListener("click", startBattle);

playerBoardElement.addEventListener("mouseleave", () => {
  if (game.pendingIndex === null) setPreview(null);
});

confirmPlacementButton.addEventListener("click", () => {
  if (game.pendingIndex !== null) commitPlacement(game.pendingIndex);
});

undoShipButton.addEventListener("click", undoLastShip);

enemyBoardElement.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  handlePlayerShot(Number(cell.dataset.index));
});

rotateButton.addEventListener("click", toggleOrientation);

document.addEventListener("keydown", (event) => {
  if (activeModal()) {
    handleOverlayKeydown(event);
    return;
  }
  if (event.key.toLowerCase() === "r" && game.phase === "placement") {
    toggleOrientation();
  }
});

// Clicking the scrim would otherwise blur to <body> without firing focusin,
// leaving Shift+Tab to escape the trap.
gameOverOverlay.addEventListener("mousedown", (event) => {
  if (event.target.closest("button")) return;
  event.preventDefault();
  playAgainButton.focus();
});

rulesOverlay.addEventListener("mousedown", (event) => {
  if (event.target.closest("button")) return;
  event.preventDefault();
});

// Clicking the scrim (outside the card) closes the rules.
rulesOverlay.addEventListener("click", (event) => {
  if (event.target === rulesOverlay) closeRules();
});

rulesCloseButton.addEventListener("click", closeRules);
rulesButton.addEventListener("click", () => openRules(rulesButton));
resultRulesButton.addEventListener("click", () => openRules(resultRulesButton));

// Last line of defence for browsers without `inert`: pull any focus that lands
// outside the active modal back into it.
document.addEventListener("focusin", (event) => {
  const modal = activeModal();
  if (modal && !modal.contains(event.target)) {
    activeModalHome().focus();
  }
});

randomButton.addEventListener("click", () => {
  game.playerBoard = createBoard();
  placeFleetRandomly(game.playerBoard);
  selectShip(null);
  setStatus("Fleet placed at random. Press Start game, or click a ship to move it.");
});

resetPlacementButton.addEventListener("click", () => {
  game.playerBoard = createBoard();
  selectShip(0);
  setStatus("Placement cleared. Select a ship and place it on your waters.");
});

newGameButton.addEventListener("click", newGame);
playAgainButton.addEventListener("click", newGame);

newGame();
