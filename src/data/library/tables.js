// Tablas de dimensiones normalizadas (valores de catálogo). Todo en mm. Las piezas de la biblioteca las usan para dimensionarse
// sin que haya que cargar cota por cota; son valores típicos: verificar con la norma o el fabricante antes de fabricar.

// Métrica ISO por diámetro nominal d: llave s (ISO 4017/4032), cabeza hexagonal k (ISO 4017), cabeza Allen dk (ISO 4762) y llave Allen sk,
// altura de tuerca m (ISO 4032), arandela plana ISO 7089 (d1, d2, h), cabeza avellanada ISO 10642 (dkc, kc, skc).
export const iso = {
  3: { s: 5.5, k: 2, dk: 5.5, sk: 2.5, m: 2.4, w1: 3.2, w2: 7, wh: 0.5, p: 0.5 },
  4: { s: 7, k: 2.8, dk: 7, sk: 3, m: 3.2, w1: 4.3, w2: 9, wh: 0.8, p: 0.7 },
  5: { s: 8, k: 3.5, dk: 8.5, sk: 4, m: 4.7, w1: 5.3, w2: 10, wh: 1, p: 0.8 },
  6: { s: 10, k: 4, dk: 10, sk: 5, m: 5.2, w1: 6.4, w2: 12, wh: 1.6, p: 1, dkc: 12, kc: 3.3, skc: 4 },
  8: { s: 13, k: 5.3, dk: 13, sk: 6, m: 6.8, w1: 8.4, w2: 16, wh: 1.6, p: 1.25, dkc: 16, kc: 4.4, skc: 5 },
  10: { s: 16, k: 6.4, dk: 16, sk: 8, m: 8.4, w1: 10.5, w2: 20, wh: 2, p: 1.5, dkc: 20, kc: 5.5, skc: 6 },
  12: { s: 18, k: 7.5, dk: 18, sk: 10, m: 10.8, w1: 13, w2: 24, wh: 2.5, p: 1.75, dkc: 24, kc: 6.5, skc: 8 },
  14: { s: 21, k: 8.8, dk: 21, sk: 12, m: 12.8, w1: 15, w2: 28, wh: 2.5, p: 2, dkc: 27, kc: 7.5, skc: 10 },
  16: { s: 24, k: 10, dk: 24, sk: 14, m: 14.8, w1: 17, w2: 30, wh: 3, p: 2, dkc: 30, kc: 8.5, skc: 10 },
  20: { s: 30, k: 12.5, dk: 30, sk: 17, m: 18, w1: 21, w2: 37, wh: 3, p: 2.5, dkc: 36, kc: 10, skc: 12 },
  24: { s: 36, k: 15, dk: 36, sk: 19, m: 21.5, w1: 25, w2: 44, wh: 4, p: 3, dkc: 43, kc: 12, skc: 14 },
  30: { s: 46, k: 18.7, dk: 45, sk: 22, m: 25.6, w1: 31, w2: 56, wh: 4, p: 3.5, dkc: 52, kc: 15, skc: 17 },
};
export const isoSizes = Object.keys(iso).map(Number);
// Fila ISO del diámetro más cercano al pedido.
export function isoRow(d) {
  const size = isoSizes.reduce((best, value) => (Math.abs(value - d) < Math.abs(best - d) ? value : best), isoSizes[0]);
  return { d: size, ...iso[size] };
}

// Rodamientos rígidos de bolas (ISO 15): [designación, d, D, B]. Series 60 (liviana), 62 (media) y 63 (pesada).
export const bearings = [
  ['6000', 10, 26, 8], ['6001', 12, 28, 8], ['6002', 15, 32, 9], ['6003', 17, 35, 10], ['6004', 20, 42, 12], ['6005', 25, 47, 12],
  ['6006', 30, 55, 13], ['6007', 35, 62, 14], ['6008', 40, 68, 15], ['6009', 45, 75, 16], ['6010', 50, 80, 16], ['6011', 55, 90, 18],
  ['6012', 60, 95, 18], ['6200', 10, 30, 9], ['6201', 12, 32, 10], ['6202', 15, 35, 11], ['6203', 17, 40, 12], ['6204', 20, 47, 14],
  ['6205', 25, 52, 15], ['6206', 30, 62, 16], ['6207', 35, 72, 17], ['6208', 40, 80, 18], ['6209', 45, 85, 19], ['6210', 50, 90, 20],
  ['6211', 55, 100, 21], ['6212', 60, 110, 22], ['6300', 10, 35, 11], ['6301', 12, 37, 12], ['6302', 15, 42, 13], ['6303', 17, 47, 14],
  ['6304', 20, 52, 15], ['6305', 25, 62, 17], ['6306', 30, 72, 19], ['6307', 35, 80, 21], ['6308', 40, 90, 23], ['6309', 45, 100, 25],
  ['6310', 50, 110, 27],
];
export const bearingByDesignation = (name) => bearings.find(([id]) => id === String(name));
export const bearingByBore = (d, series = 2) => {
  const wanted = bearings.filter(([id]) => id[1] === String(series === 0 ? 0 : series));
  return wanted.reduce((best, row) => (Math.abs(row[1] - d) < Math.abs(best[1] - d) ? row : best), wanted[0]);
};

// Soportes de chumacera (UCP pie, UCF brida cuadrada, UCFL brida oval) por diámetro de eje:
// d, UCP: [H altura al eje, L largo, J distancia entre agujeros, A ancho de base, N diámetro de agujero, e espesor de base, B alto total],
// UCF: [L lado, J distancia entre agujeros, e espesor de brida, N agujero], UCFL: [L largo, J distancia, A ancho, e espesor, N agujero]
export const pillow = {
  12: { ucp: [30.2, 127, 95, 38, 13, 15, 62], ucf: [86, 64, 12, 12], ucfl: [113, 90, 60, 12, 12], series: 'UC201' },
  15: { ucp: [30.2, 127, 95, 38, 13, 15, 62], ucf: [86, 64, 12, 12], ucfl: [113, 90, 60, 12, 12], series: 'UC202' },
  17: { ucp: [33.3, 127, 95, 38, 13, 15, 65], ucf: [86, 64, 12, 12], ucfl: [113, 90, 60, 12, 12], series: 'UC203' },
  20: { ucp: [33.3, 127, 95, 38, 13, 15, 65], ucf: [86, 64, 12, 12], ucfl: [113, 90, 60, 12, 12], series: 'UC204' },
  25: { ucp: [36.5, 140, 105, 38, 16, 16, 71], ucf: [95, 70, 13, 12], ucfl: [130, 99, 68, 13, 16], series: 'UC205' },
  30: { ucp: [42.9, 165, 121, 48, 16, 18, 83], ucf: [108, 82, 14, 14], ucfl: [146, 112, 78, 14, 16], series: 'UC206' },
  35: { ucp: [47.6, 167, 127, 48, 16, 20, 93], ucf: [117, 92, 15, 14], ucfl: [161, 125, 83, 15, 16], series: 'UC207' },
  40: { ucp: [49.2, 184, 137, 54, 19, 22, 98], ucf: [130, 102, 16, 16], ucfl: [175, 135, 90, 16, 19], series: 'UC208' },
  45: { ucp: [54.0, 190, 146, 54, 19, 22, 106], ucf: [137, 105, 18, 16], ucfl: [180, 140, 100, 18, 19], series: 'UC209' },
  50: { ucp: [57.2, 203, 159, 54, 19, 22, 114], ucf: [143, 111, 19, 16], ucfl: [190, 150, 105, 19, 19], series: 'UC210' },
};
export const pillowSizes = Object.keys(pillow).map(Number);
export const pillowRow = (d) => {
  const size = pillowSizes.reduce((best, value) => (Math.abs(value - d) < Math.abs(best - d) ? value : best), pillowSizes[0]);
  return { d: size, ...pillow[size] };
};

// Bridas de cañería EN 1092-1 PN16 por DN: [diámetro exterior D, círculo de agujeros K, agujeros n, diámetro de agujero, espesor b, diámetro de caño d]
export const flanges = {
  25: [115, 85, 4, 14, 18, 33.7], 32: [140, 100, 4, 18, 18, 42.4], 40: [150, 110, 4, 18, 18, 48.3], 50: [165, 125, 4, 18, 20, 60.3],
  65: [185, 145, 8, 18, 20, 76.1], 80: [200, 160, 8, 18, 22, 88.9], 100: [220, 180, 8, 18, 24, 114.3], 125: [250, 210, 8, 18, 26, 139.7],
  150: [285, 240, 8, 22, 26, 168.3], 200: [340, 295, 12, 22, 30, 219.1],
};
export const flangeSizes = Object.keys(flanges).map(Number);
export const flangeRow = (dn) => {
  const size = flangeSizes.reduce((best, value) => (Math.abs(value - dn) < Math.abs(best - dn) ? value : best), flangeSizes[0]);
  return { dn: size, D: flanges[size][0], K: flanges[size][1], n: flanges[size][2], hole: flanges[size][3], b: flanges[size][4], pipe: flanges[size][5] };
};

// Motores IEC por tamaño de carcasa: [eje d, largo de eje E, altura de eje H, ancho entre agujeros de patas A, largo entre agujeros B,
// distancia C (cara del eje al primer agujero), agujero de pata K, diámetro de carcasa aprox. (AC), largo de carcasa sin eje]
export const iecMotors = {
  63: { d: 11, e: 23, h: 63, a: 100, b: 80, c: 40, k: 7, ac: 120, l: 150, kw: '0,18–0,25' },
  71: { d: 14, e: 30, h: 71, a: 112, b: 90, c: 45, k: 7, ac: 140, l: 175, kw: '0,25–0,37' },
  80: { d: 19, e: 40, h: 80, a: 125, b: 100, c: 50, k: 10, ac: 158, l: 200, kw: '0,55–0,75' },
  90: { d: 24, e: 50, h: 90, a: 140, b: 100, c: 56, k: 10, ac: 178, l: 230, kw: '1,1–1,5' },
  100: { d: 28, e: 60, h: 100, a: 160, b: 140, c: 63, k: 12, ac: 198, l: 265, kw: '2,2–3' },
  112: { d: 28, e: 60, h: 112, a: 190, b: 140, c: 70, k: 12, ac: 218, l: 280, kw: '3–4' },
  132: { d: 38, e: 80, h: 132, a: 216, b: 178, c: 89, k: 12, ac: 258, l: 340, kw: '5,5–7,5' },
  160: { d: 42, e: 110, h: 160, a: 254, b: 210, c: 108, k: 15, ac: 315, l: 400, kw: '11–15' },
};
export const iecSizes = Object.keys(iecMotors).map(Number);
export const iecRow = (frame) => {
  const size = iecSizes.reduce((best, value) => (Math.abs(value - frame) < Math.abs(best - frame) ? value : best), iecSizes[0]);
  return { frame: size, ...iecMotors[size] };
};

// Reductores de sinfín tipo NMRV por tamaño (distancia entre ejes a): [a, eje de salida d, largo de eje, alto de carcasa, ancho de carcasa, largo, brida B14 lado, entrada d]
export const worm = {
  30: { a: 30, out: 14, outL: 30, h: 56, w: 56, l: 80, flange: 65, inD: 9 },
  40: { a: 40, out: 18, outL: 40, h: 70, w: 70, l: 100, flange: 75, inD: 11 },
  50: { a: 50, out: 25, outL: 50, h: 85, w: 85, l: 120, flange: 90, inD: 14 },
  63: { a: 63, out: 25, outL: 60, h: 103, w: 103, l: 144, flange: 110, inD: 19 },
  75: { a: 75, out: 28, outL: 60, h: 112, w: 112, l: 172, flange: 130, inD: 24 },
  90: { a: 90, out: 35, outL: 80, h: 130, w: 130, l: 206, flange: 150, inD: 24 },
};
export const wormSizes = Object.keys(worm).map(Number);
export const wormRow = (size) => {
  const key = wormSizes.reduce((best, value) => (Math.abs(value - size) < Math.abs(best - size) ? value : best), wormSizes[0]);
  return { size: key, ...worm[key] };
};

// Perfiles de aluminio ranurados (serie métrica): lado, ancho de boca, profundidad de ranura, agujero central.
export const alu = {
  20: { side: 20, mouth: 6, depth: 6, core: 4.2, wall: 1.8 },
  30: { side: 30, mouth: 8, depth: 8.5, core: 6.8, wall: 2.2 },
  40: { side: 40, mouth: 10, depth: 11, core: 8.4, wall: 2.6 },
  45: { side: 45, mouth: 10, depth: 11, core: 8.4, wall: 3 },
};
export const aluSizes = Object.keys(alu).map(Number);
