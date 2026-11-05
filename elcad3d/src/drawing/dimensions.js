import { toSheet } from './sheet.js';

// Cotas según ISO 129 / IRAM 4513: línea fina, flechas cerradas, texto de 3,5 mm sobre la línea (sistema alineado).
export const style = { text: 3.5, arrowLength: 2.8, arrowWidth: 0.9, gap: 1, overshoot: 2, lineWidth: 0.25, charWidth: 0.55 };

export const formatNumber = (value) => {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded).replace('.', ',');
};

const textWidth = (text) => text.length * style.text * style.charWidth;

const arrow = (tipX, tipY, dirX, dirY) => {
  // Punta en (tip) apuntando hacia (dir) de la línea (el arrow se dibuja hacia atrás desde la punta).
  const len = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / len;
  const uy = dirY / len;
  const bx = tipX - ux * style.arrowLength;
  const by = tipY - uy * style.arrowLength;
  return [[tipX, tipY], [bx - uy * (style.arrowWidth / 2), by + ux * (style.arrowWidth / 2)], [bx + uy * (style.arrowWidth / 2), by - ux * (style.arrowWidth / 2)]];
};

// Valor medido de una cota lineal (en unidades del modelo).
export function measure(dim) {
  const [a, b] = [dim.a, dim.b];
  if (dim.orientation === 'h') return Math.abs(b[0] - a[0]);
  if (dim.orientation === 'v') return Math.abs(b[1] - a[1]);
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

// Texto base de la cota (medido o escrito a mano) con prefijo/sufijo opcionales ("2× " … " H7", " (ref.)").
export function dimensionText(dim) {
  const own = dim.text ? dim.text : measuredText(dim);
  return `${dim.prefix ?? ''}${own}${dim.suffix ?? ''}`;
}

function measuredText(dim) {
  if (dim.type === 'linear') return `${dim.diameter ? 'Ø' : ''}${formatNumber(measure(dim))}`;
  if (dim.type === 'diameter') return `${dim.count > 1 ? `${dim.count}× ` : ''}Ø${formatNumber(dim.radius * 2)}`;
  if (dim.type === 'radius') return `R${formatNumber(dim.radius)}`;
  if (dim.type === 'angle') return `${formatNumber(dim.value)}°`;
  return '';
}

function linearPrimitives(dim, placement) {
  const text = dimensionText(dim);
  const lines = [];
  const arrows = [];
  const texts = [];
  const sa = toSheet(placement, dim.a);
  const sb = toSheet(placement, dim.b);
  let p1;
  let p2; // extremos de la línea de cota (en hoja)
  let e1; // extensión: [desde, hasta]
  let e2;
  let vertical = false;
  if (dim.orientation === 'h') {
    const y = toSheet(placement, [0, dim.line])[1];
    const sign = Math.sign(y - sa[1]) || 1;
    const sign2 = Math.sign(y - sb[1]) || 1;
    p1 = [sa[0], y];
    p2 = [sb[0], y];
    e1 = [[sa[0], sa[1] + sign * style.gap], [sa[0], y + sign * style.overshoot]];
    e2 = [[sb[0], sb[1] + sign2 * style.gap], [sb[0], y + sign2 * style.overshoot]];
  } else if (dim.orientation === 'v') {
    vertical = true;
    const x = toSheet(placement, [dim.line, 0])[0];
    const sign = Math.sign(x - sa[0]) || 1;
    const sign2 = Math.sign(x - sb[0]) || 1;
    p1 = [x, sa[1]];
    p2 = [x, sb[1]];
    e1 = [[sa[0] + sign * style.gap, sa[1]], [x + sign * style.overshoot, sa[1]]];
    e2 = [[sb[0] + sign2 * style.gap, sb[1]], [x + sign2 * style.overshoot, sb[1]]];
  } else {
    const dx = sb[0] - sa[0];
    const dy = sb[1] - sa[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    const off = dim.line;
    p1 = [sa[0] + nx * off, sa[1] + ny * off];
    p2 = [sb[0] + nx * off, sb[1] + ny * off];
    const s = Math.sign(off) || 1;
    e1 = [[sa[0] + nx * s * style.gap, sa[1] + ny * s * style.gap], [p1[0] + nx * s * style.overshoot, p1[1] + ny * s * style.overshoot]];
    e2 = [[sb[0] + nx * s * style.gap, sb[1] + ny * s * style.gap], [p2[0] + nx * s * style.overshoot, p2[1] + ny * s * style.overshoot]];
  }
  if (!dim.direct) {
    lines.push({ x1: e1[0][0], y1: e1[0][1], x2: e1[1][0], y2: e1[1][1] }, { x1: e2[0][0], y1: e2[0][1], x2: e2[1][0], y2: e2[1][1] });
  }
  const length = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const ux = length > 0 ? (p2[0] - p1[0]) / length : 1;
  const uy = length > 0 ? (p2[1] - p1[1]) / length : 0;
  const needed = style.arrowLength * 2 + 1;
  const inside = length >= needed;
  if (inside) {
    arrows.push(arrow(p1[0], p1[1], -ux, -uy), arrow(p2[0], p2[1], ux, uy));
    lines.push({ x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] });
  } else {
    // Flechas por fuera apuntando hacia adentro.
    arrows.push(arrow(p1[0], p1[1], ux, uy), arrow(p2[0], p2[1], -ux, -uy));
    lines.push({ x1: p1[0] - ux * (style.arrowLength + 2), y1: p1[1] - uy * (style.arrowLength + 2), x2: p2[0] + ux * (style.arrowLength + 2), y2: p2[1] + uy * (style.arrowLength + 2) });
  }
  const midX = (p1[0] + p2[0]) / 2;
  const midY = (p1[1] + p2[1]) / 2;
  const fitsText = length >= textWidth(text) + 2;
  let angle = (Math.atan2(uy, ux) * 180) / Math.PI;
  if (angle > 90 || angle <= -90) angle += 180; // texto siempre legible
  if (vertical) angle = -90;
  const normal = [Math.sin((angle * Math.PI) / 180) * -1, Math.cos((angle * Math.PI) / 180) * -1]; // "arriba" del texto
  const lift = style.text * 0.45 + 0.8;
  let tx = midX + normal[0] * lift;
  let ty = midY + normal[1] * lift;
  if (!fitsText) {
    // Texto fuera, a continuación de la línea.
    const extra = (textWidth(text) / 2 + style.arrowLength + 3) * (dim.textSide === -1 ? -1 : 1);
    tx = (dim.textSide === -1 ? Math.min(p1[0], p2[0]) : Math.max(p1[0], p2[0])) + (vertical ? 0 : extra);
    ty = vertical ? (dim.textSide === -1 ? Math.max(p1[1], p2[1]) + extra : Math.min(p1[1], p2[1]) - extra) : midY + normal[1] * lift;
    if (vertical) tx = midX + normal[0] * lift;
  }
  texts.push({ x: tx, y: ty, text, size: style.text, angle, anchor: 'middle' });
  return { lines, arrows, texts };
}

// Cota de diámetro/radio con línea de referencia: flecha en el borde del círculo y "codo" con el texto.
function leaderPrimitives(dim, placement) {
  const [cu, cv] = dim.center;
  const angle = ((dim.angle ?? 45) * Math.PI) / 180;
  const r = dim.radius;
  const edge = toSheet(placement, [cu + Math.cos(angle) * r, cv + Math.sin(angle) * r]);
  const dirX = Math.cos(angle);
  const dirY = -Math.sin(angle); // y de hoja hacia abajo
  const reach = dim.reach ?? 12;
  const elbow = [edge[0] + dirX * reach, edge[1] + dirY * reach];
  const text = dimensionText(dim);
  const shoulder = textWidth(text) + 3;
  const side = dirX >= 0 ? 1 : -1;
  const end = [elbow[0] + side * shoulder, elbow[1]];
  const lines = [{ x1: edge[0], y1: edge[1], x2: elbow[0], y2: elbow[1] }, { x1: elbow[0], y1: elbow[1], x2: end[0], y2: end[1] }];
  // Flecha en el borde, apuntando hacia el círculo (en sentido opuesto al exterior).
  const arrows = [arrow(edge[0], edge[1], -dirX, -dirY)];
  const texts = [{ x: (elbow[0] + end[0]) / 2, y: elbow[1] - 1.1, text, size: style.text, angle: 0, anchor: 'middle' }];
  return { lines, arrows, texts };
}

// Cota angular: arco centrado en el vértice entre dos rayos (grados, sentido antihorario en la vista), radio en mm de hoja.
function anglePrimitives(dim, placement) {
  const [cx, cy] = toSheet(placement, dim.center);
  const radius = dim.arc ?? 16;
  const from = (dim.from * Math.PI) / 180;
  const to = (dim.to * Math.PI) / 180;
  const at = (angle, r) => [cx + Math.cos(angle) * r, cy - Math.sin(angle) * r];
  const steps = Math.max(8, Math.ceil(Math.abs(to - from) / (Math.PI / 24)));
  const lines = [];
  for (let i = 0; i < steps; i += 1) {
    const a = at(from + ((to - from) * i) / steps, radius);
    const b = at(from + ((to - from) * (i + 1)) / steps, radius);
    lines.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
  }
  // Líneas de referencia: los dos rayos, desde un poco fuera del vértice hasta pasado el arco.
  [from, to].forEach((angle) => {
    const a = at(angle, Math.max(0, radius - 3));
    const b = at(angle, radius + style.overshoot);
    lines.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
  });
  const sign = to >= from ? 1 : -1;
  const tangent = (angle) => [-Math.sin(angle), -Math.cos(angle)]; // en hoja (y hacia abajo), sentido de ángulo creciente
  const t0 = tangent(from);
  const t1 = tangent(to);
  const arrows = [arrow(...at(from, radius), -t0[0] * sign, -t0[1] * sign), arrow(...at(to, radius), t1[0] * sign, t1[1] * sign)];
  const mid = (from + to) / 2;
  const [tx, ty] = at(mid, radius + style.text * 0.55 + 1.2);
  const texts = [{ x: tx, y: ty + style.text * 0.35, text: dimensionText(dim), size: style.text, angle: 0, anchor: 'middle' }];
  return { lines, arrows, texts };
}

export function dimensionPrimitives(dim, placement) {
  if (dim.type === 'angle') return anglePrimitives(dim, placement);
  if (dim.type === 'linear') return linearPrimitives(dim, placement);
  return leaderPrimitives(dim, placement);
}
