import { evaluate } from '../core/expression.js';
import { planeFrame } from './planes.js';
import { featureTurn, turnPoint, turnVector } from './turn.js';

// Engranaje recto de evolvente (ISO 53 / DIN 867): datos y contorno 2D puros. Unidades mm y grados.
export const defaultGearFeature = () => ({ plane: 'XY', offset: 0, x: 0, y: 0, m: 2, z: 20, alpha: 20, shift: 0, width: 10, bore: 8, hub: 0, hubWidth: 0, helix: 0, phase: 0, reverse: false, backlash:0, addendum:1, dedendum:1.25 });

const inv = (angle) => Math.tan(angle) - angle;

// Medidas del engranaje (Ø primitivo, exterior, de pie, de base, paso circular, tipo de diente).
export function gearSpec(feature, params) {
  const num = (value) => evaluate(value, params);
  const m = num(feature.m);
  const z = Math.round(num(feature.z));
  const alpha = (num(feature.alpha) * Math.PI) / 180;
  const shift = num(feature.shift ?? 0);
  const width = num(feature.width);
  const bore = num(feature.bore ?? 0);
  const hub = num(feature.hub ?? 0);
  const hubWidth = num(feature.hubWidth ?? 0);
  const helix = num(feature.helix ?? 0);
  if (!(m > 0)) throw new Error('El módulo debe ser mayor que 0');
  if (!(z >= 6 && z <= 200)) throw new Error('Cantidad de dientes entre 6 y 200');
  if (!(alpha > 0 && alpha < (35 * Math.PI) / 180)) throw new Error('Ángulo de presión entre 0° y 35°');
  if (!(width > 0)) throw new Error('El ancho debe ser mayor que 0');
  if (Math.abs(helix) >= 45) throw new Error('El ángulo de hélice debe ser menor que 45°');
  const backlash=num(feature.backlash??0),addendum=num(feature.addendum??1),dedendum=num(feature.dedendum??1.25);
  if(![backlash,addendum,dedendum].every(Number.isFinite)||backlash<0||addendum<.2||addendum>2.5||dedendum<.2||dedendum>3)throw new Error('Juego ≥0; coeficientes de cabeza/pie entre 0,2 y 2,5/3.');
  const rp = (m * z) / 2;
  const rb = rp * Math.cos(alpha);
  const ra = rp + m * (addendum + shift);
  const rf = rp - m * (dedendum - shift);
  if (!(rf > 0.5)) throw new Error('Pie del diente demasiado chico: aumentá los dientes o el módulo');
  if(!(ra>rb&&ra>rf))throw new Error('Cabeza insuficiente: el diámetro exterior debe superar la base y el pie.');
  const thickness=m*(Math.PI/2+2*shift*Math.tan(alpha))-backlash;
  if(!(thickness>0))throw new Error('El juego/desplazamiento produce un espesor de diente inválido.');
  const halfPitchAngle = thickness / (2 * rp);
  const flankAngle = (r) => halfPitchAngle + inv(alpha) - inv(Math.acos(Math.min(1, rb / r)));
  const tipAngle = flankAngle(Math.max(ra, rb + 1e-6));
  if (!(2 * tipAngle * ra > 0.15 * m)) throw new Error('Dientes puntiagudos: reducí el desplazamiento o aumentá los dientes');
  if(thickness>=Math.PI*m)throw new Error('El espesor del diente supera el paso circular.');
  if (bore < 0 || bore >= 2 * rf - 1) throw new Error('El agujero debe ser menor que el diámetro de pie');
  if (hub > 0 && !(hub > bore && hub < 2 * rf)) throw new Error('El cubo debe estar entre el agujero y el Ø de pie');
  const twist = helix ? (width * Math.tan((helix * Math.PI) / 180) * 180) / (Math.PI * rp) : 0;
  return {
    m, z, alpha, shift, backlash,addendum,dedendum,thickness,width, bore, hub, hubWidth, helix, twist, rp, rb, ra, rf, flankAngle, tipAngle,
    pitchDiameter: 2 * rp, outsideDiameter: 2 * ra, rootDiameter: 2 * rf, baseDiameter: 2 * rb,
    label: `m=${m} z=${z} α=${Math.round((alpha * 18000) / Math.PI) / 100}°`.replace(/\./g, ','),
  };
}

// Contorno cerrado (antihorario) del engranaje, centrado en el origen. Diente 0 centrado en el eje X.
export function gearOutline(spec, { flankSteps = 8 } = {}) {
  const { z, rb, ra, rf, flankAngle, tipAngle } = spec;
  const rStart = Math.max(rf, rb);
  const points = [];
  const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
  for (let k = 0; k < z; k += 1) {
    const center = (2 * Math.PI * k) / z;
    const flank = Array.from({ length: flankSteps + 1 }, (_, i) => {
      const r = rStart + ((ra - rStart) * i) / flankSteps;
      return { r, a: flankAngle(r) };
    });
    // Tramo radial bajo el círculo base (si el pie queda más abajo).
    if (rf < rb - 1e-6) points.push(polar(rf, center - flankAngle(rb)));
    flank.forEach(({ r, a }) => points.push(polar(r, center - a)));
    points.push(polar(ra, center - tipAngle / 3), polar(ra, center + tipAngle / 3));
    [...flank].reverse().forEach(({ r, a }) => points.push(polar(r, center + a)));
    if (rf < rb - 1e-6) points.push(polar(rf, center + flankAngle(rb)));
    // Fondo del diente: arco sobre el círculo de pie hasta el siguiente diente.
    const rootAngle = flankAngle(rf < rb ? rb : rStart);
    const lastFlank = center + rootAngle;
    const nextFlank = center + (2 * Math.PI) / z - rootAngle;
    for (let i = 1; i <= 2; i += 1) points.push(polar(rf, lastFlank + ((nextFlank - lastFlank) * i) / 3));
  }
  return points;
}

// Distancia entre centros con otro engranaje del mismo módulo.
export const centerDistance = (m, z1, z2) => (m * (z1 + z2)) / 2;

// Engranajes de la pieza (no suprimidos y válidos) para el plano.
export function gearFeatureSpecs(part, params) {
  const specs = [];
  (part.features ?? []).forEach((feature) => {
    if (feature.type !== 'gear' || feature.suppressed) return;
    try {
      const spec = gearSpec(feature, params);
      const frame = planeFrame(null, feature, params);
      const x = evaluate(feature.x, params);
      const y = evaluate(feature.y, params);
      const shift = Array.isArray(feature.move) ? feature.move : [0, 0, 0];
      const turn = featureTurn(feature, params);
      const center = turnPoint(turn, [0, 1, 2].map((i) => frame.origin[i] + x * frame.xDir[i] + y * frame.yDir[i])).map((v, i) => v + (Number(shift[i]) || 0));
      // Tramo axial que ocupa el dentado, medido desde el centro a lo largo del eje (la extrusión puede ir invertida).
      const axial = feature.reverse ? [-spec.width, 0] : [0, spec.width];
      // Dirección del diente 0: el eje X del plano girado `phase` grados alrededor de la normal.
      const phase = ((evaluate(feature.phase ?? 0, params) || 0) * Math.PI) / 180;
      const [c, s] = [Math.cos(phase), Math.sin(phase)];
      const xDir = [0, 1, 2].map((i) => frame.xDir[i] * c + frame.yDir[i] * s);
      specs.push({ id: feature.id, ...spec, center, vector: turnVector(turn, frame.normal), xDir: turnVector(turn, xDir), axial });
    } catch {
      /* engranaje inválido */
    }
  });
  return specs;
}

// Medidas teóricas de evolvente a un diámetro elegido; no usa la teselación del visor.
export function gearToothMeasure(spec,{diameter=spec.pitchDiameter,teeth=1}={}) {
  if(!Number.isFinite(diameter)||diameter/2<Math.max(spec.rb,spec.rf)-1e-8||diameter/2>spec.ra+1e-8||!Number.isInteger(teeth)||teeth<1||teeth>=spec.z)throw new Error('Elegí un diámetro entre base/pie y exterior, y un salto entre 1 y z−1 dientes.');
  const r=diameter/2,toothAngle=2*spec.flankAngle(r),pitchAngle=2*Math.PI/spec.z,gapAngle=pitchAngle-toothAngle;
  if(toothAngle<=0||gapAngle<=0)throw new Error('El perfil no tiene diente/hueco válido en ese diámetro.');
  return {diameter,toothAngle:toothAngle*180/Math.PI,gapAngle:gapAngle*180/Math.PI,pitchAngle:pitchAngle*180/Math.PI,
    toothArc:r*toothAngle,toothChord:2*r*Math.sin(toothAngle/2),gapArc:r*gapAngle,gapChord:2*r*Math.sin(gapAngle/2),
    stepArc:r*pitchAngle*teeth,stepChord:2*r*Math.abs(Math.sin(pitchAngle*teeth/2)),localPressureAngle:Math.acos(Math.min(1,spec.rb/r))*180/Math.PI};
}
