// Primitivas de hoja -> SVG (mm). Estilos de línea ISO 128: visible 0,5 / oculta 0,25 a trazos / ejes 0,18 trazo y punto.
const layerStyle = {
  paper: { fill: '#ffffff', stroke: 'none' },
  frame: { stroke: '#000', width: 0.5 },
  block: { stroke: '#000', width: 0.35 },
  visible: { stroke: '#000', width: 0.5 },
  hidden: { stroke: '#000', width: 0.25, dash: '2.4 1.2' },
  axes: { stroke: '#000', width: 0.18, dash: '8 1.4 1.4 1.4' },
  dims: { stroke: '#000', width: 0.25 },
  hatch: { stroke: '#000', width: 0.18 },
};

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const n = (value) => Math.round(value * 1000) / 1000;
const dashAttr = (style) => (style.dash ? ` stroke-dasharray="${style.dash}"` : '');

export function primitivesToSvg(sheet, primitives, { background = true, selectedDim = null, interactive = false } = {}) {
  const body = primitives
    .filter((p) => background || p.layer !== 'paper')
    .map((p) => {
      const style = layerStyle[p.layer] ?? layerStyle.visible;
      const stroke = `stroke="${style.stroke ?? '#000'}" stroke-width="${style.width ?? 0.25}"${dashAttr(style)} stroke-linecap="round" stroke-linejoin="round"`;
      const viewAttr = p.view ? ` data-view="${esc(p.view)}"` : '';
      const dimAttr = (p.dim ? ` data-dim="${esc(p.dim)}"` : '') + viewAttr;
      const highlight = selectedDim && p.dim === selectedDim ? ' class="sel"' : '';
      switch (p.k) {
        case 'rect':
          return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="${style.fill ?? 'none'}" ${style.fill ? '' : stroke}/>`;
        case 'line': {
          const hit = p.dim ? `<line x1="${n(p.x1)}" y1="${n(p.y1)}" x2="${n(p.x2)}" y2="${n(p.y2)}" stroke="transparent" stroke-width="2.6"${dimAttr} class="hit"/>` : '';
          return `<line x1="${n(p.x1)}" y1="${n(p.y1)}" x2="${n(p.x2)}" y2="${n(p.y2)}" ${stroke}${dimAttr}${highlight}/>${hit}`;
        }
        case 'poly':
          return `<polyline points="${p.points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="none" ${stroke}${viewAttr}/>`;
        case 'circle':
          return `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(p.r)}" fill="none" ${stroke}/>`;
        case 'arrow':
          return `<polygon points="${p.points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="#000"${dimAttr}${highlight}/>`;
        case 'text': {
          const transform = p.angle ? ` transform="rotate(${n(p.angle)} ${n(p.x)} ${n(p.y)})"` : '';
          return `<text x="${n(p.x)}" y="${n(p.y)}" font-size="${p.size}" text-anchor="${p.anchor ?? 'start'}"${transform} fill="${p.fill === 'muted' ? '#555' : '#000'}"${dimAttr}${highlight}>${esc(p.text)}</text>`;
        }
        default:
          return '';
      }
    })
    .join('\n');
  const size = interactive ? '' : ` width="${sheet.width}mm" height="${sheet.height}mm"`;
  const style = interactive ? '<style>line[data-dim]:hover{stroke:#d33}text[data-dim]:hover,polygon[data-dim]:hover{fill:#d33}text.sel,polygon.sel{fill:#1a73e8;stroke:none}line.sel{stroke:#1a73e8;stroke-width:0.7}.hit{pointer-events:stroke}</style>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="0 0 ${sheet.width} ${sheet.height}" font-family="Arial, Helvetica, sans-serif">${style}\n${body}\n</svg>`;
}
