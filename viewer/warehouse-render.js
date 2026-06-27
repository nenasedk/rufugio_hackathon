export const COLORS = {
  background: "#f1e6c8",
  empty: "#ffffff",
  emptyAlt: "#fbf9f1",
  shelf: "#0e0e0e",
  shelfEdge: "#0e0e0e",
  base: "#2362ab",
  baseEdge: "#0e0e0e",
  grid: "rgba(14, 14, 14, 0.12)",
  robot: "#cc3a2c",
  carrying: "#f1b91e",
  edge: "#0e0e0e",
  target: "#f1b91e",
  targetEdge: "#0e0e0e",
  text: "#ffffff",
};

export const DEEMPHASIZED_ALPHA = 0.4;
export const RENDER_PADDING = 10;

export function drawWarehouseFrame(canvas, layout, frame, options) {
  const { cellSize, highlightCell, selectedRobotId, showBaseIds } = options;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const width = layout.width * cellSize + RENDER_PADDING * 2;
  const height = layout.height * cellSize + RENDER_PADDING * 2;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  for (let y = 0; y < layout.height; y += 1) {
    for (let x = 0; x < layout.width; x += 1) {
      drawCell(ctx, layout, x, y, cellSize, selectedRobotId);
    }
  }

  drawGrid(ctx, layout, cellSize);
  if (showBaseIds) drawBaseIds(ctx, layout, cellSize, selectedRobotId);

  const activeSelectedId = frame.robots.some((robot) => robot.id === selectedRobotId)
    ? selectedRobotId
    : null;
  const hasSelection = activeSelectedId !== null;

  for (const robot of frame.robots) {
    if (robot.target && !robot.carrying) {
      drawTarget(
        ctx,
        robot.target,
        cellSize,
        hasSelection && robot.id !== activeSelectedId ? DEEMPHASIZED_ALPHA : 1,
      );
    }
  }
  for (const robot of frame.robots) {
    drawRobot(
      ctx,
      robot,
      cellSize,
      hasSelection && robot.id !== activeSelectedId ? DEEMPHASIZED_ALPHA : 1,
    );
  }
  if (hasSelection) {
    const selected = frame.robots.find((robot) => robot.id === activeSelectedId);
    if (selected) drawSelectionOverlay(ctx, layout, selected, cellSize);
  }
  if (highlightCell) {
    const [px, py] = cellToPixel(highlightCell[0], highlightCell[1], cellSize);
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
  }
}

function drawCell(ctx, layout, x, y, size, selectedRobotId) {
  const type = cellTypeAt(layout, x, y);
  const [px, py] = cellToPixel(x, y, size);
  if (type === "shelf") {
    ctx.fillStyle = COLORS.shelf;
    ctx.fillRect(px, py, size, size);
    ctx.strokeStyle = COLORS.shelfEdge;
    ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
  } else if (type === "base") {
    const base = layout.bases.find((entry) => entry.position[0] === x && entry.position[1] === y);
    const oldAlpha = ctx.globalAlpha;
    if (selectedRobotId !== null && base?.robot_id !== selectedRobotId) {
      ctx.globalAlpha = oldAlpha * DEEMPHASIZED_ALPHA;
    }
    ctx.fillStyle = COLORS.base;
    ctx.fillRect(px, py, size, size);
    ctx.strokeStyle = COLORS.baseEdge;
    ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
    ctx.globalAlpha = oldAlpha;
  } else if (x === 0 || y === 0 || x === layout.width - 1 || y === layout.height - 1) {
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(px, py, size, size);
  } else {
    ctx.fillStyle = (x + y) % 2 === 0 ? COLORS.emptyAlt : COLORS.empty;
    ctx.fillRect(px, py, size, size);
  }
}

function drawGrid(ctx, layout, size) {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= layout.width; x += 1) {
    const px = RENDER_PADDING + x * size + 0.5;
    ctx.moveTo(px, RENDER_PADDING);
    ctx.lineTo(px, RENDER_PADDING + layout.height * size);
  }
  for (let y = 0; y <= layout.height; y += 1) {
    const py = RENDER_PADDING + y * size + 0.5;
    ctx.moveTo(RENDER_PADDING, py);
    ctx.lineTo(RENDER_PADDING + layout.width * size, py);
  }
  ctx.stroke();
}

function drawBaseIds(ctx, layout, size, selectedRobotId) {
  if (size < 12) return;
  ctx.font = `${Math.max(6, Math.floor(size * 0.5))}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const base of layout.bases ?? []) {
    const [px, py] = cellToPixel(base.position[0], base.position[1], size);
    const oldAlpha = ctx.globalAlpha;
    if (selectedRobotId !== null && base.robot_id !== selectedRobotId) {
      ctx.globalAlpha = oldAlpha * DEEMPHASIZED_ALPHA;
    }
    ctx.fillStyle = COLORS.text;
    ctx.fillText(String(base.robot_id), px + size / 2, py + size / 2);
    ctx.globalAlpha = oldAlpha;
  }
}

function drawTarget(ctx, target, size, alpha = 1) {
  const [px, py] = cellToPixel(target[0], target[1], size);
  const oldAlpha = ctx.globalAlpha;
  ctx.fillStyle = COLORS.target;
  ctx.globalAlpha = oldAlpha * 0.75 * alpha;
  ctx.fillRect(px + 1, py + 1, size - 2, size - 2);
  ctx.globalAlpha = oldAlpha * alpha;
  ctx.strokeStyle = COLORS.targetEdge;
  ctx.strokeRect(px + 1.5, py + 1.5, size - 3, size - 3);
  ctx.globalAlpha = oldAlpha;
}

function drawRobot(ctx, robot, size, alpha = 1) {
  const [px, py] = cellToPixel(robot.pos[0], robot.pos[1], size);
  const cx = px + size / 2;
  const cy = py + size / 2;
  const oldAlpha = ctx.globalAlpha;
  ctx.globalAlpha = oldAlpha * alpha;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, size * 0.34), 0, Math.PI * 2);
  ctx.fillStyle = robot.carrying ? COLORS.carrying : COLORS.robot;
  ctx.fill();
  ctx.strokeStyle = COLORS.edge;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = oldAlpha;
}

function drawSelectionOverlay(ctx, layout, robot, size) {
  const [px, py] = cellToPixel(robot.pos[0], robot.pos[1], size);
  const cx = px + size / 2;
  const cy = py + size / 2;
  const base = layout.bases.find((entry) => entry.robot_id === robot.id);
  const goal = robot.carrying ? base?.position : robot.target;

  if (goal) {
    const [gpx, gpy] = cellToPixel(goal[0], goal[1], size);
    ctx.save();
    ctx.strokeStyle = COLORS.edge;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(gpx + size / 2, gpy + size / 2);
    ctx.stroke();
    ctx.restore();
  }
}

export function cellToPixel(x, y, size) {
  return [RENDER_PADDING + x * size, RENDER_PADDING + y * size];
}

export function cellTypeAt(layout, x, y) {
  const ch = layout.grid[y]?.[x];
  if (ch === layout.cell_encoding.shelf) return "shelf";
  if (ch === layout.cell_encoding.base) return "base";
  return "empty";
}

export function pixelToCell(canvas, layout, size, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((clientX - rect.left - RENDER_PADDING) / size);
  const y = Math.floor((clientY - rect.top - RENDER_PADDING) / size);
  if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) return null;
  return [x, y];
}
