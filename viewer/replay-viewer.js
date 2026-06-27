import { RENDER_PADDING, drawWarehouseFrame, pixelToCell } from "./warehouse-render.js";

const MAX_CELL = 40;
const DEFAULT_REPLAY_URL = "/runtime/replays/replay.json";

const state = {
  replay: null,
  frames: [],
  frameIndex: 0,
  cellSize: 10,
  minCellSize: 10,
  selectedRobotId: null,
  highlightCell: null,
  showTargets: true,
  showBaseIds: false,
  playing: false,
  loopEnabled: false,
  frameMs: 120,
  zoomed: false,
  animationId: null,
  segmentStart: null,
  animFrom: 0,
  animTo: 0,
  animDirection: 1,
  drag: null,
  wasDrag: false,
};

const el = {
  error: document.getElementById("error"),
  viewerRoot: document.getElementById("viewerRoot"),
  replayFile: document.getElementById("replayFile"),
  replayName: document.getElementById("replayName"),
  seedChip: document.getElementById("seedChip"),
  finalChip: document.getElementById("finalChip"),
  canvasWrap: document.getElementById("canvasWrap"),
  canvas: document.getElementById("warehouse"),
  startBtn: document.getElementById("startBtn"),
  prevBtn: document.getElementById("prevBtn"),
  playBtn: document.getElementById("playBtn"),
  nextBtn: document.getElementById("nextBtn"),
  endBtn: document.getElementById("endBtn"),
  tickSlider: document.getElementById("tickSlider"),
  tickReadout: document.getElementById("tickReadout"),
  speedGroup: document.getElementById("speedGroup"),
  loopBtn: document.getElementById("loopBtn"),
  deliveriesNow: document.getElementById("deliveriesNow"),
  deliveriesDetail: document.getElementById("deliveriesDetail"),
  stats: document.getElementById("stats"),
  robotPanel: document.getElementById("robotPanel"),
  zoomHint: document.getElementById("zoomHint"),
  resetZoomBtn: document.getElementById("resetZoomBtn"),
  showTargets: document.getElementById("showTargets"),
  showBaseIds: document.getElementById("showBaseIds"),
};

async function init() {
  wireControls();
  try {
    const replayUrl = safeReplayPath(new URLSearchParams(location.search).get("replay"));
    const response = await fetch(replayUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not load ${replayUrl} (HTTP ${response.status}). Run tools/make_replay first or use Load JSON.`);
    }
    loadReplay(await response.json());
  } catch (error) {
    showError(error);
  }
}

function safeReplayPath(rawPath) {
  const path = rawPath || DEFAULT_REPLAY_URL;
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin) throw new Error("Replay URL must use the current origin.");
  const allowed = url.pathname.startsWith("/runtime/replays/") || url.pathname.startsWith("/data/");
  if (!allowed || url.pathname.includes("/.")) {
    throw new Error("Replay URL must point to /runtime/replays/*.json or /data/*.json.");
  }
  return url.pathname;
}

function loadReplay(rawReplay) {
  const replay = validateReplay(rawReplay);
  stopTicker();
  state.replay = replay;
  state.frames = replay.frames ?? [];
  state.frameIndex = 0;
  state.selectedRobotId = null;
  state.highlightCell = null;
  state.zoomed = false;

  el.error.hidden = true;
  el.error.textContent = "";
  el.viewerRoot.hidden = false;
  el.replayName.textContent = replay.name || "Replay";
  el.replayName.title = replay.name || "Replay";
  el.seedChip.hidden = !replay.global_seed;
  el.seedChip.textContent = replay.global_seed ? `seed ${replay.global_seed}` : "";
  el.finalChip.textContent = `${replay.total_deliveries} deliveries`;
  el.tickSlider.max = String(Math.max(0, state.frames.length - 1));
  document.title = `REFUGIO Local Replay - ${replay.name || "Replay"}`;

  requestAnimationFrame(() => {
    applyFitZoom();
    renderCurrentFrame();
    syncUi();
  });
}

function wireControls() {
  el.replayFile.addEventListener("change", async () => {
    const file = el.replayFile.files?.[0];
    if (!file) return;
    try {
      loadReplay(JSON.parse(await file.text()));
    } catch (error) {
      showError(error);
    }
  });

  el.startBtn.addEventListener("click", () => setFrame(0));
  el.endBtn.addEventListener("click", () => setFrame(state.frames.length - 1));
  el.prevBtn.addEventListener("click", () => animateStep(-1));
  el.nextBtn.addEventListener("click", () => animateStep(1));
  el.playBtn.addEventListener("click", togglePlayback);
  el.tickSlider.addEventListener("input", () => setFrame(Number(el.tickSlider.value)));

  el.speedGroup.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-ms]");
    if (!button) return;
    state.frameMs = Number(button.dataset.ms);
    for (const sibling of el.speedGroup.querySelectorAll("button")) {
      sibling.classList.toggle("active", sibling === button);
    }
  });

  el.loopBtn.addEventListener("click", () => {
    state.loopEnabled = !state.loopEnabled;
    el.loopBtn.classList.toggle("active", state.loopEnabled);
    el.loopBtn.setAttribute("aria-pressed", String(state.loopEnabled));
  });

  el.showTargets.addEventListener("change", () => {
    state.showTargets = el.showTargets.checked;
    renderCurrentFrame();
  });
  el.showBaseIds.addEventListener("change", () => {
    state.showBaseIds = el.showBaseIds.checked;
    renderCurrentFrame();
  });
  el.resetZoomBtn.addEventListener("click", applyFitZoom);

  el.canvasWrap.addEventListener("wheel", handleWheel, { passive: false });
  el.canvasWrap.addEventListener("mousedown", handleDragStart);
  el.canvasWrap.addEventListener("mousemove", handleDragMove);
  el.canvasWrap.addEventListener("mouseup", handleDragEnd);
  el.canvasWrap.addEventListener("mouseleave", () => {
    handleDragEnd();
    state.highlightCell = null;
    renderCurrentFrame();
  });

  el.canvas.addEventListener("mousemove", (event) => {
    if (!state.replay) return;
    state.highlightCell = pixelToCell(el.canvas, state.replay.layout, state.cellSize, event.clientX, event.clientY);
    renderCurrentFrame();
  });
  el.canvas.addEventListener("click", handleCanvasClick);

  window.addEventListener("resize", () => {
    if (!state.replay || state.zoomed) return;
    applyFitZoom();
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input, select, textarea, button")) return;
    if (!state.frames.length) return;
    if (event.key === " ") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      animateStep(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      animateStep(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setFrame(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setFrame(state.frames.length - 1);
    }
  });
}

function showError(error) {
  el.viewerRoot.hidden = true;
  el.error.hidden = false;
  el.error.textContent = error instanceof Error ? error.message : String(error);
}

function renderCurrentFrame(drawFrame = currentFrame()) {
  if (!state.replay || !drawFrame) return;
  drawWarehouseFrame(el.canvas, state.replay.layout, frameForRender(drawFrame), {
    cellSize: state.cellSize,
    showBaseIds: state.showBaseIds,
    selectedRobotId: state.selectedRobotId,
    highlightCell: state.highlightCell,
  });
}

function currentFrame() {
  return state.frames[state.frameIndex] ?? state.frames[0] ?? null;
}

function setFrame(nextIndex) {
  stopTicker();
  state.frameIndex = clamp(nextIndex, 0, Math.max(0, state.frames.length - 1));
  renderCurrentFrame();
  syncUi();
}

function syncUi() {
  const frame = currentFrame();
  const lastTick = state.frames.at(-1)?.tick ?? 0;
  const canStep = state.frames.length > 1;
  el.tickSlider.value = String(state.frameIndex);
  el.tickReadout.textContent = `${padTick(frame?.tick ?? 0, lastTick)} / ${lastTick}`;
  el.startBtn.disabled = !canStep || state.frameIndex <= 0;
  el.prevBtn.disabled = !canStep || state.frameIndex <= 0;
  el.playBtn.disabled = !canStep;
  el.nextBtn.disabled = !canStep || state.frameIndex >= state.frames.length - 1;
  el.endBtn.disabled = !canStep || state.frameIndex >= state.frames.length - 1;
  el.playBtn.textContent = state.playing ? "Pause" : "Play";
  el.zoomHint.hidden = state.zoomed;
  el.resetZoomBtn.hidden = !state.zoomed;
  renderScore(frame);
  renderRobotPanel(frame);
}

function renderScore(frame) {
  const robots = frame?.robots ?? [];
  const carrying = robots.filter((robot) => robot.carrying).length;
  const deliveries = robots.reduce((total, robot) => total + (robot.deliveries ?? 0), 0);
  el.deliveriesNow.textContent = String(deliveries);
  el.deliveriesDetail.textContent = `deliveries · ${state.replay?.total_deliveries ?? 0} final`;
  el.stats.replaceChildren(statRow("Carrying item", `${carrying} / ${robots.length}`));
}

function renderRobotPanel(frame) {
  const selected = state.selectedRobotId;
  const robot = selected === null ? null : frame?.robots.find((entry) => entry.id === selected) ?? null;
  if (!robot) {
    state.selectedRobotId = null;
    const hint = document.createElement("p");
    hint.className = "robot-empty";
    hint.textContent = "Click a robot to inspect it. Click the same cell again to cycle through stacked robots.";
    el.robotPanel.replaceChildren(hint);
    return;
  }

  const base = state.replay.layout.bases.find((entry) => entry.robot_id === robot.id) ?? null;
  const head = document.createElement("div");
  head.className = "robot-head";
  const id = document.createElement("span");
  id.className = "robot-id";
  id.textContent = `Robot ${robot.id}`;
  const status = document.createElement("span");
  status.className = `chip ${robot.carrying ? "chip-accent" : ""}`.trim();
  status.textContent = robot.carrying ? "Carrying" : "Searching";
  head.append(id, status);

  const x = Math.round(robot.pos[0]);
  const y = Math.round(robot.pos[1]);
  const rows = document.createElement("dl");
  rows.className = "stat-rows";
  rows.append(statRow("Deliveries", robot.deliveries ?? 0));
  rows.append(statRow("Position", `(${x}, ${y})`));
  rows.append(statRow("Target", robot.carrying ? base ? `base (${base.position[0]}, ${base.position[1]})` : "its base" : robot.target ? `shelf (${robot.target[0]}, ${robot.target[1]})` : "-"));

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "block-btn";
  clear.textContent = "Clear selection";
  clear.addEventListener("click", () => {
    state.selectedRobotId = null;
    renderCurrentFrame();
    syncUi();
  });

  el.robotPanel.replaceChildren(head, rows, clear);
}

function statRow(label, value) {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = String(value);
  row.append(dt, dd);
  return row;
}

function frameForRender(frame) {
  if (state.showTargets) return frame;
  return {
    ...frame,
    robots: frame.robots.map((robot) => ({
      id: robot.id,
      pos: robot.pos,
      carrying: robot.carrying,
      deliveries: robot.deliveries,
    })),
  };
}

function applyFitZoom() {
  if (!state.replay) return;
  const size = computeFitCellSize();
  state.minCellSize = size;
  state.cellSize = size;
  state.zoomed = false;
  el.canvasWrap.scrollLeft = 0;
  el.canvasWrap.scrollTop = 0;
  renderCurrentFrame();
  syncUi();
}

function computeFitCellSize() {
  if (!state.replay) return 10;
  const styles = getComputedStyle(el.canvasWrap);
  const availableWidth = el.canvasWrap.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
  const availableHeight = el.canvasWrap.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
  const padding = RENDER_PADDING * 2;
  const cell = Math.floor(Math.min(
    (availableWidth - padding) / state.replay.layout.width,
    (availableHeight - padding) / state.replay.layout.height,
  ));
  return clamp(cell, 1, MAX_CELL);
}

function handleWheel(event) {
  if (!state.replay) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  if (direction === -1 && state.cellSize <= state.minCellSize) return;

  const step = Math.max(1, Math.round(state.cellSize * 0.15));
  const nextSize = clamp(state.cellSize + direction * step, state.minCellSize, MAX_CELL);
  if (nextSize === state.cellSize) return;

  const rect = el.canvasWrap.getBoundingClientRect();
  const mouseX = event.clientX - rect.left + el.canvasWrap.scrollLeft;
  const mouseY = event.clientY - rect.top + el.canvasWrap.scrollTop;
  const ratio = nextSize / state.cellSize;
  const nextScrollX = mouseX * ratio - (event.clientX - rect.left);
  const nextScrollY = mouseY * ratio - (event.clientY - rect.top);

  state.cellSize = nextSize;
  state.zoomed = nextSize > state.minCellSize;
  renderCurrentFrame();
  syncUi();
  requestAnimationFrame(() => {
    if (!state.zoomed) {
      el.canvasWrap.scrollLeft = 0;
      el.canvasWrap.scrollTop = 0;
      return;
    }
    el.canvasWrap.scrollLeft = Math.max(0, nextScrollX);
    el.canvasWrap.scrollTop = Math.max(0, nextScrollY);
  });
}

function handleDragStart(event) {
  if (event.button !== 0 || !state.zoomed) return;
  state.drag = {
    startX: event.clientX,
    startY: event.clientY,
    scrollX: el.canvasWrap.scrollLeft,
    scrollY: el.canvasWrap.scrollTop,
    dragged: false,
  };
  el.canvasWrap.style.cursor = "grabbing";
}

function handleDragMove(event) {
  const drag = state.drag;
  if (!drag) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.dragged = true;
  el.canvasWrap.scrollLeft = drag.scrollX - dx;
  el.canvasWrap.scrollTop = drag.scrollY - dy;
}

function handleDragEnd() {
  state.wasDrag = state.drag?.dragged ?? false;
  state.drag = null;
  el.canvasWrap.style.cursor = state.zoomed ? "grab" : "";
}

function handleCanvasClick(event) {
  if (state.wasDrag) {
    state.wasDrag = false;
    return;
  }
  if (!state.replay) return;
  const cell = pixelToCell(el.canvas, state.replay.layout, state.cellSize, event.clientX, event.clientY);
  if (!cell) return;
  const frame = state.segmentStart !== null
    ? interpolatedBetween(state.frames, state.animFrom, state.animTo, segmentProgress())
    : currentFrame();
  if (!frame) return;

  const [cx, cy] = cell;
  const robotsAtCell = frame.robots
    .filter((robot) => Math.round(robot.pos[0]) === cx && Math.round(robot.pos[1]) === cy)
    .map((robot) => robot.id);

  let foundRobotId = null;
  if (robotsAtCell.length > 0) {
    const currentIndex = state.selectedRobotId === null ? -1 : robotsAtCell.indexOf(state.selectedRobotId);
    foundRobotId = currentIndex === -1
      ? robotsAtCell[robotsAtCell.length - 1]
      : robotsAtCell[(currentIndex + 1) % robotsAtCell.length];
  } else {
    const targetOwner = frame.robots.find(
      (robot) => robot.target && !robot.carrying && robot.target[0] === cx && robot.target[1] === cy,
    );
    foundRobotId = targetOwner?.id ?? null;
  }

  state.selectedRobotId = state.selectedRobotId === foundRobotId ? null : foundRobotId;
  renderCurrentFrame();
  syncUi();
}

function beginSegment(fromIndex, toIndex, direction) {
  state.animFrom = fromIndex;
  state.animTo = toIndex;
  state.animDirection = direction;
  state.segmentStart = performance.now();
}

function scheduleTick() {
  state.animationId = requestAnimationFrame(tick);
}

function tick(now) {
  if (state.segmentStart === null) return;
  const rawProgress = clamp01((now - state.segmentStart) / state.frameMs);
  const progress = state.animDirection === 1 ? rawProgress : 1 - rawProgress;
  const drawFrame = interpolatedBetween(state.frames, state.animFrom, state.animTo, progress);
  renderCurrentFrame(drawFrame);

  const done = state.animDirection === 1 ? progress >= 1 : progress <= 0;
  if (!done) {
    scheduleTick();
    return;
  }

  const finalIndex = state.animDirection === 1 ? state.animTo : state.animFrom;
  state.frameIndex = finalIndex;
  state.segmentStart = null;
  syncUi();

  if (state.playing) {
    if (finalIndex >= state.frames.length - 1) {
      if (state.loopEnabled && state.frames.length > 1) {
        state.frameIndex = 0;
        beginSegment(0, 1, 1);
        syncUi();
        scheduleTick();
        return;
      }
      stopTicker();
      return;
    }
    beginSegment(finalIndex, finalIndex + 1, 1);
    scheduleTick();
    return;
  }

  stopTicker();
}

function animateStep(direction) {
  if (state.frames.length < 2) return;
  stopTicker();
  if (direction === 1 && state.frameIndex < state.frames.length - 1) {
    beginSegment(state.frameIndex, state.frameIndex + 1, 1);
    scheduleTick();
  } else if (direction === -1 && state.frameIndex > 0) {
    beginSegment(state.frameIndex - 1, state.frameIndex, -1);
    scheduleTick();
  }
}

function togglePlayback() {
  if (state.playing) {
    stopTicker();
    renderCurrentFrame();
    return;
  }
  if (state.frames.length < 2) return;
  const startIndex = state.frameIndex >= state.frames.length - 1 ? 0 : state.frameIndex;
  state.frameIndex = startIndex;
  beginSegment(startIndex, startIndex + 1, 1);
  state.playing = true;
  syncUi();
  scheduleTick();
}

function stopTicker() {
  if (state.animationId !== null) cancelAnimationFrame(state.animationId);
  state.animationId = null;
  state.segmentStart = null;
  state.playing = false;
  syncUi();
}

function segmentProgress() {
  if (state.segmentStart === null) return 0;
  const rawProgress = clamp01((performance.now() - state.segmentStart) / state.frameMs);
  return state.animDirection === 1 ? rawProgress : 1 - rawProgress;
}

function interpolatedBetween(frames, fromIndex, toIndex, progress) {
  const from = frames[fromIndex];
  if (!from) return frames[0] ?? null;
  if (fromIndex === toIndex || progress <= 0) return from;
  const to = frames[toIndex] ?? from;
  if (progress >= 1) return to;
  const toById = new Map(to.robots.map((robot) => [robot.id, robot]));
  return {
    tick: from.tick,
    robots: from.robots.map((robot) => {
      const next = toById.get(robot.id);
      if (!next) return robot;
      return {
        ...robot,
        pos: [lerp(robot.pos[0], next.pos[0], progress), lerp(robot.pos[1], next.pos[1], progress)],
      };
    }),
  };
}

function validateReplay(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Replay must be an object.");
  if (data.schema_version !== 1) throw new Error(`Unsupported replay schema_version: ${data.schema_version}`);
  if (!data.layout || typeof data.layout !== "object") throw new Error("Replay is missing layout.");
  if (!Array.isArray(data.frames) || data.frames.length === 0) throw new Error("Replay must contain at least one frame.");
  for (const field of ["width", "height"]) {
    if (!Number.isInteger(data.layout[field])) throw new Error(`layout.${field} must be an integer.`);
  }
  return data;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function padTick(value, lastTick) {
  return String(value).padStart(String(lastTick).length, "0");
}

init();
