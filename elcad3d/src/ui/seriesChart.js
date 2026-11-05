// Gráfico de líneas en un canvas 2D (series en el tiempo). Sin dependencias; la escala se ajusta sola.
// series: [{ name, times, values, color, dashed }] — values puede tener null (huecos).

const palette = ['#4fc3f7', '#ffb74d', '#aed581', '#ba68c8', '#e57373'];

export function drawChart(canvas, series, { yLabel = '', xLabel = 't (s)' } = {}) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const css = getComputedStyle(canvas);
  const fg = css.color || '#ddd';
  ctx.clearRect(0, 0, width, height);
  const left = 44;
  const right = 8;
  const top = 8;
  const bottom = 26;
  let tMin = Infinity;
  let tMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  series.forEach((s) => s.times.forEach((t, i) => {
    const v = s.values[i];
    if (v == null) return;
    tMin = Math.min(tMin, t);
    tMax = Math.max(tMax, t);
    vMin = Math.min(vMin, v);
    vMax = Math.max(vMax, v);
  }));
  ctx.font = '10px sans-serif';
  ctx.fillStyle = fg;
  if (!Number.isFinite(tMin)) {
    ctx.fillText('Sin datos todavía — iniciá la simulación', left, height / 2);
    return;
  }
  if (vMax - vMin < 1e-9) { vMax += 1; vMin -= 1; }
  const pad = (vMax - vMin) * 0.05;
  vMin -= pad;
  vMax += pad;
  if (tMax - tMin < 1e-9) tMax = tMin + 1;
  const x = (t) => left + ((t - tMin) / (tMax - tMin)) * (width - left - right);
  const y = (v) => top + (1 - (v - vMin) / (vMax - vMin)) * (height - top - bottom);
  ctx.strokeStyle = fg;
  ctx.globalAlpha = 0.2;
  ctx.lineWidth = 1;
  for (let k = 0; k <= 4; k += 1) {
    const gy = top + (k / 4) * (height - top - bottom);
    ctx.beginPath();
    ctx.moveTo(left, gy);
    ctx.lineTo(width - right, gy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let k = 0; k <= 4; k += 1) {
    const value = vMax - (k / 4) * (vMax - vMin);
    ctx.fillText(formatTick(value), 2, top + (k / 4) * (height - top - bottom) + 3);
  }
  ctx.fillText(`${tMin.toFixed(1)}`, left, height - 12);
  ctx.fillText(`${tMax.toFixed(1)} ${xLabel}`, width - right - 48, height - 12);
  if (yLabel) ctx.fillText(yLabel, left, height - 2);
  series.forEach((s, n) => {
    ctx.strokeStyle = s.color ?? palette[n % palette.length];
    ctx.lineWidth = s.dashed ? 1.2 : 1.8;
    ctx.setLineDash(s.dashed ? [5, 3] : []);
    ctx.beginPath();
    let pen = false;
    s.times.forEach((t, i) => {
      const v = s.values[i];
      if (v == null) { pen = false; return; }
      if (pen) ctx.lineTo(x(t), y(v));
      else ctx.moveTo(x(t), y(v));
      pen = true;
    });
    ctx.stroke();
  });
  ctx.setLineDash([]);
}

export const formatTick = (value) => {
  const a = Math.abs(value);
  if (a >= 1000) return value.toFixed(0);
  if (a >= 10) return value.toFixed(1);
  return value.toFixed(2);
};
