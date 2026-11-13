import { solveSketchConstraints } from '../core/sketchConstraints.js';
import { gearOutline, gearSpec } from './gearGeometry.js';
import { screwSpec } from './screwGeometry.js';
import { chamferThread, cutThread, threadSpec } from './threadGeometry.js';
import { evaluate, evaluateParams } from '../core/expression.js';
import { rotateVector, workPlane } from './planes.js';
import { featureTurn, turnPoint, turnVector } from './turn.js';
import { defaultUp, pipePath } from './pipeGeometry.js';
import { buildMeshSolid } from './meshSolid.js';
import { buildMeshOnlyData } from './meshOnlyData.js';
import { frameSpec } from './frameGeometry.js';
import { arcMidpoint, cornerOutline, nestingDepths, polygonVertices, resolveEntity } from './geometry2d.js';

// Reconstruye la pieza ejecutando las operaciones en orden. `rep` es el módulo replicad ya inicializado
// (setOC hecho): así el mismo código corre en el navegador y en las pruebas de Node.
// Devuelve { shape, features: {id: {status, error}}, paramErrors, order }.


function entityDrawing(rep, entity) {
  const outline = cornerOutline(entity);
  if (outline) return entityDrawing(rep, { t: 'poly', pts: outline });
  switch (entity.t) {
    case 'rect': {
      const drawing = rep.drawRectangle(entity.w, entity.h);
      return (entity.centered ? drawing : drawing.translate(entity.w / 2, entity.h / 2)).translate(entity.x, entity.y);
    }
    case 'circle':
      return rep.drawCircle(entity.d / 2).translate(entity.x, entity.y);
    case 'ellipse':
      return rep.drawEllipse(entity.w / 2, entity.h / 2).rotate(entity.angle ?? 0).translate(entity.x, entity.y);
    case 'slot':
      return rep.drawRoundedRectangle(entity.length, entity.width, entity.width / 2).rotate(entity.angle).translate(entity.x, entity.y);
    case 'polygon': {
      const vertices = polygonVertices(entity);
      let pen = rep.draw(vertices[0]);
      vertices.slice(1).forEach((vertex) => (pen = pen.lineTo(vertex)));
      return pen.close();
    }
    case 'poly': {
      const pts = entity.pts;
      let pen = rep.draw([pts[0].x, pts[0].y]);
      pts.forEach((point, index) => {
        const next = pts[(index + 1) % pts.length];
        const end = [next.x, next.y];
        if (point.bulge) {
          const mid = arcMidpoint(point, next, point.bulge);
          pen = pen.threePointsArcTo(end, [mid.x, mid.y]);
        } else if (index < pts.length - 1) pen = pen.lineTo(end);
      });
      return pen.close();
    }
    default:
      throw new Error(`Entidad desconocida: ${entity.t}`);
  }
}

// Perfil 2D final del boceto: rellena por anidación par/impar (círculo dentro de rectángulo = agujero).
export function sketchDrawing(rep, sketch, params) {
  // Las guías son líneas auxiliares para ubicar objetos: no entran en el perfil.
  const profile = sketch.entities.filter((entity) => entity.t !== 'guide');
  if (!profile.length) throw new Error(sketch.entities.length ? 'El boceto solo tiene guías auxiliares: dibujá al menos una forma' : 'El boceto está vacío');
  const entities = solveSketchConstraints(profile.map((entity) => resolveEntity(entity, params)), sketch.constraints, params);
  const depths = nestingDepths(entities);
  const order = entities.map((entity, index) => ({ entity, depth: depths[index] })).sort((a, b) => a.depth - b.depth);
  let result = null;
  order.forEach(({ entity, depth }) => {
    const drawing = entityDrawing(rep, entity);
    if (result === null) result = drawing;
    else result = depth % 2 === 0 ? result.fuse(drawing) : result.cut(drawing);
  });
  return result;
}

// Perfil en dos capas para tubos: `outer` = formas exteriores (nivel 0), `bore` = huecos (nivel 1, o null si no hay). Más de dos niveles no se usan.
export function sketchLayers(rep, sketch, params) {
  const profile = sketch.entities.filter((entity) => entity.t !== 'guide');
  if (!profile.length) throw new Error(sketch.entities.length ? 'El boceto solo tiene guías auxiliares: dibujá al menos una forma' : 'El boceto está vacío');
  const entities = solveSketchConstraints(profile.map((entity) => resolveEntity(entity, params)), sketch.constraints, params);
  const depths = nestingDepths(entities);
  const fuseAll = (level) => {
    let result = null;
    entities.forEach((entity, index) => {
      if (depths[index] !== level) return;
      const drawing = entityDrawing(rep, entity);
      result = result ? result.fuse(drawing) : drawing;
    });
    return result;
  };
  return { outer: fuseAll(0), bore: fuseAll(1) };
}

const sketchOf = (features, feature) => {
  const sketch = features.find((item) => item.id === feature.sketch && item.type === 'sketch');
  if (!sketch) throw new Error('Falta el boceto de esta operación');
  return sketch;
};

const combine = (solid, tool, mode) => {
  lastTool = { tool: tool.clone(), mode: mode === 'cut' ? 'cut' : 'add' }; // copia: las transformaciones de replicad consumen la forma
  if (mode === 'cut') {
    if (!solid) throw new Error('No hay material para cortar: la primera operación debe agregar');
    return solid.cut(tool);
  }
  return solid ? solid.fuse(tool) : tool;
};

const diagonal = (shape, fallback = 1000) => {
  if (!shape) return fallback;
  const [min, max] = shape.boundingBox.bounds;
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || fallback;
};

// Desplazamiento global de la operación ([x,y,z] en mm), que se aplica a la herramienta antes de combinarla.
export function featureMove(feature) {
  const move = Array.isArray(feature.move) ? feature.move.map(Number) : [0, 0, 0];
  return [0, 1, 2].map((i) => (Number.isFinite(move[i]) ? move[i] : 0));
}

const turnAxes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

// Herramienta de la operación (para «Repetir»): se anota al combinar.
let lastTool = null;
// Huecos de los tubos ya construidos: un tubo nuevo se une a los anteriores y todos los huecos quedan abiertos entre sí.
let boreList = [];

// Modo «tubo»: exterior macizo + hueco aparte. Resultado = (material ∪ (exterior − huecos previos)) − hueco nuevo.
// Así un ramal que entra en otro caño abre su hueco en la pared y no deja su pared tapando el hueco del primero.
function combineTube(solid, outer, bore) {
  lastTool = { tool: outer.clone(), bore: bore ? bore.clone() : null, mode: 'add' };
  let body = outer;
  boreList.forEach((prior) => {
    body = body.cut(prior.clone());
  });
  let result = solid ? solid.fuse(body) : body;
  if (bore) {
    result = result.cut(bore.clone());
    boreList.push(bore);
  }
  return result;
}

// Primero se gira (alrededor del pivote) y después se desplaza.
const shifted = (shape, feature, params) => {
  let out = shape;
  const turn = featureTurn(feature, params);
  if (turn) out = out.rotate(turn.angle, turn.pivot, turn.axis);
  const move = featureMove(feature);
  return move.some((value) => value !== 0) ? out.translate(move) : out;
};

function moveAlong(shape, normal, distance) {
  return shape.translate([normal[0] * distance, normal[1] * distance, normal[2] * distance]);
}

const onPlane = (drawing, work) => (work.offset === undefined ? drawing.sketchOnPlane(work.plane) : drawing.sketchOnPlane(work.plane, work.offset));

// Operaciones avanzadas; los bocetos conservan su plano y expresiones.
function buildLoft(rep, solid, feature, features, params) {
  const a=sketchOf(features,feature),b=features.find(f=>f.id===feature.endSketch&&f.type==='sketch');
  if(!b||a.id===b.id)throw new Error('Loft: elegí dos bocetos distintos, cada uno con un perfil cerrado');
  const first=onPlane(sketchDrawing(rep,a,params),workPlane(rep,a,params));
  const last=onPlane(sketchDrawing(rep,b,params),workPlane(rep,b,params));
  if(!first.wire||!last.wire)throw new Error('Loft: usá un único contorno por boceto');
  return combine(solid,shifted(first.loftWith(last,{ruled:Boolean(feature.ruled)}),feature,params),feature.mode);
}
function buildSweep(rep, solid, feature, features, params) {
  const profile=sketchOf(features,feature),path=features.find(f=>f.id===feature.pathSketch&&f.type==='sketch');
  if(!path)throw new Error('Barrido: elegí un boceto de trayectoria');
  const entity=path.entities.find(e=>e.t==='poly');
  if(!entity||entity.pts.length<2)throw new Error('Trayectoria: dibujá una polilínea; se usa abierta, sin cerrar el último tramo');
  const frame=workPlane(rep,path,params).frame;
  const world=p=>[0,1,2].map(k=>frame.origin[k]+evaluate(p.x,params)*frame.xDir[k]+evaluate(p.y,params)*frame.yDir[k]);
  const edges=[];
  entity.pts.slice(0,-1).forEach((p,i)=>{
    const a=world(p),b=world(entity.pts[i+1]);
    if(Math.hypot(...a.map((v,k)=>v-b[k]))<1e-8)throw new Error('Trayectoria con un tramo de largo cero');
    if(evaluate(p.bulge??0,params)) {
      const mid=arcMidpoint({...p,x:evaluate(p.x,params),y:evaluate(p.y,params)},{...entity.pts[i+1],x:evaluate(entity.pts[i+1].x,params),y:evaluate(entity.pts[i+1].y,params)},evaluate(p.bulge,params));
      edges.push(rep.makeThreePointArc(a,world({x:mid[0],y:mid[1]}),b));
    } else edges.push(rep.makeLine(a,b));
  });
  const wire=rep.assembleWire(edges);
  const sketch=onPlane(sketchDrawing(rep,profile,params),workPlane(rep,profile,params));
  if(!sketch.wire)throw new Error('Barrido: usá un único contorno en el perfil');
  const shape=rep.genericSweep(sketch.wire,wire,{forceProfileSpineOthogonality:true});
  return combine(solid,shifted(shape,feature,params),feature.mode);
}
function buildShell(rep,solid,feature,params) {
  if(!solid)throw new Error('Vaciado: primero construí un sólido');
  const thickness=evaluate(feature.thickness,params);
  if(!(thickness>0))throw new Error('El espesor debe ser positivo');
  const axis={x:0,y:1,z:2}[feature.axis];if(axis===undefined)throw new Error('Eje de vaciado inválido');
  const plane=['YZ','XZ','XY'][axis],bounds=solid.boundingBox.bounds;
  return solid.shell(-thickness,f=>f.inPlane(plane,bounds[feature.side==='min'?0:1][axis]));
}

function buildExtrude(rep, solid, feature, sketch, params) {
  const depth = feature.through ? diagonal(solid) * 2 : evaluate(feature.depth, params);
  if (!(depth > 0)) throw new Error('La profundidad debe ser mayor que 0');
  const work = workPlane(rep, sketch, params);
  const place = (shape) => {
    let tool = shape;
    if (feature.symmetric || (feature.through && feature.mode === 'cut')) tool = moveAlong(tool, work.frame.normal, -depth / 2);
    if (feature.reverse) tool = feature.symmetric || feature.through ? tool : moveAlong(tool, work.frame.normal, -depth);
    return shifted(tool, feature, params);
  };
  if (feature.mode === 'tube') {
    const layers = sketchLayers(rep, sketch, params);
    const outer = place(onPlane(layers.outer, work).extrude(depth));
    const bore = layers.bore ? place(onPlane(layers.bore, work).extrude(depth)) : null;
    return combineTube(solid, outer, bore);
  }
  const drawing = sketchDrawing(rep, sketch, params);
  return combine(solid, place(onPlane(drawing, work).extrude(depth)), feature.mode);
}

// Malla STL importada → sólido (o varios cuerpos), con giro y desplazamiento como cualquier otra operación.
function buildMesh(rep, solid, feature, params) {
  return combine(solid, shifted(buildMeshSolid(rep, feature, params), feature, params), feature.mode);
}

// Perfil (forma local) → dibujo de replicad.
function shapeDrawing(rep, shape) {
  if (shape.type === 'circle') return rep.drawCircle(shape.d / 2);
  if (shape.type === 'rect') return shape.r > 0 ? rep.drawRoundedRectangle(shape.w, shape.h, Math.min(shape.r, Math.min(shape.w, shape.h) / 2 - 0.01)) : rep.drawRectangle(shape.w, shape.h);
  let pen = rep.draw(shape.pts[0]);
  shape.pts.slice(1).forEach((point) => { pen = pen.lineTo(point); });
  return pen.close();
}

// Estructura de perfiles: cada barra es el perfil extruido entre dos puntos; en los nudos de dos barras se cortan con el plano de inglete.
function buildFrame(rep, solid, feature, params) {
  const spec = frameSpec(feature, params);
  if (!spec.members.length) throw new Error('Agregá al menos una barra');
  let result = null;
  spec.members.forEach((member) => {
    const plane = new rep.Plane(member.a, member.xDir, member.d);
    let piece = shapeDrawing(rep, spec.shape.outer).sketchOnPlane(plane).extrude(member.length);
    if (spec.shape.hole) piece = piece.cut(shapeDrawing(rep, spec.shape.hole).sketchOnPlane(new rep.Plane(member.a, member.xDir, member.d)).extrude(member.length));
    const big = 4 * (member.length + Math.max(spec.profile.w, spec.profile.h));
    member.miter.forEach((cutPlane) => {
      if (!cutPlane) return;
      const away = cutPlane.keep.map((v) => -v);
      const ref = Math.abs(away[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const xd = [away[1] * ref[2] - away[2] * ref[1], away[2] * ref[0] - away[0] * ref[2], away[0] * ref[1] - away[1] * ref[0]];
      const l = Math.hypot(...xd);
      const removed = rep.drawRectangle(big, big).sketchOnPlane(new rep.Plane(cutPlane.point, xd.map((v) => v / l), away)).extrude(big);
      piece = piece.cut(removed);
    });
    result = result ? result.fuse(piece) : piece;
  });
  return combine(solid, shifted(result, feature, params), 'add');
}

function buildRevolve(rep, solid, feature, sketch, params) {
  const angle = evaluate(feature.angle, params);
  if (!(angle > 0 && angle <= 360)) throw new Error('El ángulo debe estar entre 0 y 360°');
  const work = workPlane(rep, sketch, params);
  const axis = feature.axis === 'x' ? work.frame.xDir : work.frame.yDir;
  const origin = work.frame.origin;
  const spin = (drawing) => shifted(onPlane(drawing, work).revolve(axis, { origin, angle }), feature, params);
  if (feature.mode === 'tube') {
    const layers = sketchLayers(rep, sketch, params);
    return combineTube(solid, spin(layers.outer), layers.bore ? spin(layers.bore) : null);
  }
  return combine(solid, spin(sketchDrawing(rep, sketch, params)), feature.mode);
}

function holePositions(feature, params) {
  const count = Math.max(1, Math.floor(evaluate(feature.count, params)));
  const x = evaluate(feature.x, params);
  const y = evaluate(feature.y, params);
  if (count === 1) return [[x, y]];
  const pcd = evaluate(feature.pcd, params);
  if (!(pcd > 0)) throw new Error('El diámetro de la circunferencia de agujeros (PCD) debe ser mayor que 0');
  const start = (evaluate(feature.angle0, params) * Math.PI) / 180;
  return Array.from({ length: count }, (_, i) => [x + (pcd / 2) * Math.cos(start + (2 * Math.PI * i) / count), y + (pcd / 2) * Math.sin(start + (2 * Math.PI * i) / count)]);
}

function buildHole(rep, solid, feature, params) {
  if (!solid) throw new Error('No hay material donde agujerear');
  const d = evaluate(feature.d, params);
  if (!(d > 0)) throw new Error('El diámetro debe ser mayor que 0');
  const work = workPlane(rep, feature, params);
  const length = feature.through ? diagonal(solid) * 2 : evaluate(feature.depth, params);
  if (!(length > 0)) throw new Error('La profundidad debe ser mayor que 0');
  const positions = holePositions(feature, params);
  const cutter = (diameter, depth) => {
    let drawing = null;
    positions.forEach(([x, y]) => {
      const circle = rep.drawCircle(diameter / 2).translate(x, y);
      drawing = drawing ? drawing.fuse(circle) : circle;
    });
    const tool = onPlane(drawing, work).extrude(depth);
    if (feature.through) return moveAlong(tool, work.frame.normal, -depth / 2);
    return feature.reverse ? tool : moveAlong(tool, work.frame.normal, -depth);
  };
  let result = solid.cut(cutter(d, length));
  const cboreD = evaluate(feature.cboreD ?? 0, params);
  const cboreDepth = evaluate(feature.cboreDepth ?? 0, params);
  if (cboreD > d && cboreDepth > 0) result = result.cut(cutter(cboreD, cboreDepth));
  return result;
}

// Engranaje recto (o helicoidal) de evolvente: se fusiona con lo existente o queda como primer sólido.
function buildGear(rep, solid, feature, params, forDrawing = false) {
  const spec = gearSpec(feature, params);
  if (forDrawing) spec.twist = 0;
  const work = workPlane(rep, feature, params);
  const outline = gearOutline(spec, { flankSteps: forDrawing ? 3 : spec.z > 40 ? 6 : 8 });
  let pen = rep.draw(outline[0]);
  outline.slice(1).forEach((point) => (pen = pen.lineTo(point)));
  let profile = pen.close();
  const phase = evaluate(feature.phase ?? 0, params) || 0;
  if (phase) {
    const turned = profile.rotate(phase, [0, 0]);
    profile.delete?.();
    profile = turned;
  }
  if (spec.bore > 0) profile = profile.cut(rep.drawCircle(spec.bore / 2));
  const place = (drawing, length, twist = 0) => {
    const moved = drawing.translate(evaluate(feature.x, params), evaluate(feature.y, params));
    const sketch = onPlane(moved, work);
    const shape = sketch.extrude(length, twist ? { twistAngle: twist } : undefined);
    sketch.delete?.();
    moved.delete?.();
    return feature.reverse ? moveAlong(shape, work.frame.normal, -length) : shape;
  };
  let gear = place(profile, spec.width, spec.twist);
  profile.delete?.();
  if (spec.hub > 0 && spec.hubWidth > 0) {
    const hubDrawing = rep.drawCircle(spec.hub / 2).translate(0, 0);
    let ring = hubDrawing;
    if (spec.bore > 0) ring = ring.cut(rep.drawCircle(spec.bore / 2));
    const hubShape = place(ring, spec.width + spec.hubWidth);
    gear = gear.fuse(hubShape);
  }
  gear = shifted(gear, feature, params);
  return combine(solid, gear, 'add');
}

// Tornillo sin fin: eje cilíndrico + filete rectangular extruido con torsión. Para el plano (forDrawing) solo la envolvente cilíndrica
// (la silueta es exacta y evita proyectar superficies helicoidales).
function buildScrew(rep, solid, feature, params, forDrawing = false) {
  const spec = screwSpec(feature, params);
  const work = workPlane(rep, feature, params);
  const normal = work.frame.normal;
  const cx = evaluate(feature.x, params);
  const cy = evaluate(feature.y, params);
  const base = [0, 1, 2].map((i) => work.frame.origin[i] + cx * work.frame.xDir[i] + cy * work.frame.yDir[i]);
  const dir = feature.reverse ? normal.map((v) => -v) : normal;
  const cylinder = (diameter) => rep.makeCylinder(diameter / 2, spec.length, base, dir);
  if (forDrawing) {
    const envelope = shifted(cylinder(spec.outer), feature, params);
    return combine(solid, envelope, 'add');
  }
  const r0 = spec.shaft / 2;
  const r1 = spec.outer / 2;
  const overlap = Math.min(0.5, r0 / 2);
  const key = JSON.stringify(['screw', { ...feature, id: 0, name: '', suppressed: false }, params]);
  const body = cachedBody(key, () => {
    // Se arma con el eje en +Z desde el origen y se lleva a su lugar al final. El filete es un barrido de la sección (radial × axial) a lo
    // largo de una hélice exacta: mucho más liviano para el kernel que una extrusión con torsión (booleanas y mallado ~10× más rápidos).
    let local = rep.makeCylinder(r0, spec.length, [0, 0, 0], [0, 0, 1]);
    for (let k = 0; k < spec.starts; k += 1) {
      const half = spec.thickness / 2;
      const helix = rep.makeHelix(spec.pitch, spec.length - spec.thickness, r0, [0, 0, half], [0, 0, 1], spec.left);
      const wire = rep.makePolygon([[r0 - overlap, 0, 0], [r1, 0, 0], [r1, 0, spec.thickness], [r0 - overlap, 0, spec.thickness]]).outerWire();
      let flight = rep.genericSweep(wire, helix, { frenet: true });
      if (k) flight = flight.rotate((360 * k) / spec.starts, [0, 0, 0], [0, 0, 1]);
      local = local.fuse(flight, { simplify: false });
    }
    const expected = Math.PI * r0 * r0 * spec.length;
    if (!(rep.measureVolume(local) > expected * 1.02)) throw new Error('No se pudo generar el filete helicoidal: probá con otro paso o espesor');
    return shifted(placeLocal(local, work.frame, dir, base), feature, params);
  });
  // Unión barata: la booleana de un filete helicoidal contra piezas grandes tarda segundos aun sin tocarse. Si la envolvente cilíndrica del
  // tornillo (analítica, barata) no corta nada del resto, se agrega como cuerpo aparte, sin booleana.
  if (solid && !touchesEnvelope(rep, solid, shifted(cylinder(spec.outer + 0.2), feature, params))) {
    lastTool = { tool: body.clone(), mode: 'add' };
    return rep.makeCompound([solid, body]);
  }
  return combine(solid, body, 'add');
}

// ¿La forma `envelope` toca a `solid`? (intersección con una forma analítica; se usa para saltear booleanas caras)
function touchesEnvelope(rep, solid, envelope) {
  try {
    const [a0, a1] = solid.boundingBox.bounds;
    const [b0, b1] = envelope.boundingBox.bounds;
    if ([0, 1, 2].some((i) => a1[i] < b0[i] || b1[i] < a0[i])) return false;
    const common = solid.clone().intersect(envelope);
    const touching = rep.measureVolume(common) > 1e-6;
    common.delete?.();
    return touching;
  } catch {
    return true;
  }
}

// Lleva una forma armada con el eje en +Z (y la hélice arrancando hacia +X) al marco real: eje `dir`, arranque hacia xDir, base `base`.
function placeLocal(shape, frame, dir, base) {
  let out = shape;
  const z = [0, 0, 1];
  const cross = [z[1] * dir[2] - z[2] * dir[1], z[2] * dir[0] - z[0] * dir[2], z[0] * dir[1] - z[1] * dir[0]];
  const sin = Math.hypot(...cross);
  const cos = dir[2];
  let x = [1, 0, 0];
  if (sin > 1e-9) {
    const axis = cross.map((v) => v / sin);
    const angle = (Math.atan2(sin, cos) * 180) / Math.PI;
    out = out.rotate(angle, [0, 0, 0], axis);
    x = rotateVector(x, axis, angle);
  } else if (cos < 0) {
    out = out.rotate(180, [0, 0, 0], [1, 0, 0]);
    x = [1, 0, 0];
    x = rotateVector(x, [1, 0, 0], 180);
  }
  // giro final alrededor de `dir` para que el arranque coincida con xDir
  const cx = x[1] * frame.xDir[2] - x[2] * frame.xDir[1];
  const cy = x[2] * frame.xDir[0] - x[0] * frame.xDir[2];
  const cz = x[0] * frame.xDir[1] - x[1] * frame.xDir[0];
  const roll = (Math.atan2(cx * dir[0] + cy * dir[1] + cz * dir[2], x[0] * frame.xDir[0] + x[1] * frame.xDir[1] + x[2] * frame.xDir[2]) * 180) / Math.PI;
  if (Math.abs(roll) > 1e-9) out = out.rotate(roll, [0, 0, 0], dir);
  return out.translate(base);
}

// Caché de cuerpos pesados (tornillos): cambiar otra operación no debe reconstruir un filete de 15 vueltas. Clave = contenido de la operación
// + parámetros. La caché es dueña de sus formas (se excluyen de la limpieza de la arena); cada uso trabaja sobre una copia.
const heavyCache = new Map();
const heavyLimit = 3;
function cachedBody(key, make) {
  const hit = heavyCache.get(key);
  if (hit) {
    heavyCache.delete(key);
    heavyCache.set(key, hit);
    return hit.clone();
  }
  const body = make();
  heavyCache.set(key, body.clone());
  while (heavyCache.size > heavyLimit) {
    const [oldKey, old] = heavyCache.entries().next().value;
    heavyCache.delete(oldKey);
    old.delete?.();
  }
  return body;
}
export const heavyShapes = () => [...heavyCache.values()];

// Cañería / extrusión curva: el perfil recorre tramos rectos y curvas (revolución del perfil). Siempre en modo tubo (pared + hueco).
// Perfil redondo (Ø exterior y pared) o un boceto cualquiera (su plano da el punto y la dirección de arranque).
function buildPipe(rep, solid, feature, params, features, poses) {
  let pose;
  let layers;
  let work = null;
  if (feature.from) {
    const prior = poses[feature.from];
    if (!prior) throw new Error('«Continuar desde» debe ser una cañería anterior que se haya calculado bien');
    pose = prior;
  }
  if (feature.profile === 'sketch') {
    const sketch = sketchOf(features, feature);
    work = workPlane(rep, sketch, params);
    layers = sketchLayers(rep, sketch, params);
    if (!feature.from) pose = { p: work.frame.origin, d: work.frame.normal, u: work.frame.yDir };
  } else {
    const od = evaluate(feature.od, params);
    const wall = evaluate(feature.wall ?? 0, params);
    if (!(od > 0)) throw new Error('El Ø exterior debe ser mayor que 0');
    if (!(wall >= 0 && wall < od / 2)) throw new Error('La pared debe estar entre 0 y el radio exterior');
    layers = { outer: rep.drawCircle(od / 2), bore: wall > 0 ? rep.drawCircle(od / 2 - wall) : null };
    if (!feature.from) {
      const d = (feature.dir ?? [0, 0, 1]).map((v) => evaluate(v, params));
      const dir = Math.hypot(...d) > 1e-9 ? d.map((v) => v / Math.hypot(...d)) : null;
      if (!dir) throw new Error('La dirección de arranque no puede ser el vector nulo');
      pose = { p: (feature.start ?? [0, 0, 0]).map((v) => evaluate(v, params)), d: dir, u: defaultUp(dir) };
    }
  }
  if (feature.from && feature.profile !== 'sketch') pose = { ...pose, u: pose.u };
  const path = pipePath(feature, params, pose);
  const frameOf = (at) => {
    const l = [at.u[1] * at.d[2] - at.u[2] * at.d[1], at.u[2] * at.d[0] - at.u[0] * at.d[2], at.u[0] * at.d[1] - at.u[1] * at.d[0]];
    return new rep.Plane(at.p, l, at.d);
  };
  const pieces = (drawing) => {
    let result = null;
    path.steps.forEach((step) => {
      const plane = frameOf(step.pose);
      const sketch = drawing.clone ? drawing.clone().sketchOnPlane(plane) : drawing.sketchOnPlane(plane);
      const piece = step.kind === 'straight'
        ? sketch.extrude(step.length)
        : sketch.revolve(step.axis, { origin: step.center, angle: step.angle });
      result = result ? result.fuse(piece) : piece;
    });
    return result;
  };
  const outer = shifted(pieces(layers.outer), feature, params);
  const bore = layers.bore ? shifted(pieces(layers.bore), feature, params) : null;
  const turn = featureTurn(feature, params);
  const move = featureMove(feature);
  const end = { p: turnPoint(turn, path.end.p).map((v, i) => v + move[i]), d: turnVector(turn, path.end.d), u: turnVector(turn, path.end.u) };
  poses[feature.id] = end;
  return combineTube(solid, outer, bore);
}

// Repetir: copias de la herramienta de otra operación (cuerpo que se agrega o corte), en círculo alrededor de un eje o en línea.
// La original ya está aplicada: acá se agregan las copias 2..N con el mismo modo (agregar/cortar).
function buildPattern(solid, feature, params, tools) {
  const source = tools[feature.source];
  if (!source) throw new Error('Elegí la operación a repetir (debe ser una extrusión, revolución, engranaje o tornillo anterior)');
  if (!solid) throw new Error('No hay geometría donde repetir');
  const count = Math.floor(evaluate(feature.count, params));
  if (!(count >= 2 && count <= 200)) throw new Error('La cantidad debe estar entre 2 y 200');
  let result = solid;
  const copies = [];
  let patternStep = 0;
  let patternCenter = [0, 0, 0];
  let patternAxis = turnAxes.z;
  if (feature.kind === 'linear') {
    const step = ['dx', 'dy', 'dz'].map((key) => evaluate(feature[key] ?? 0, params));
    if (!step.some((v) => Math.abs(v) > 1e-9)) throw new Error('La separación entre copias no puede ser 0');
    for (let i = 1; i < count; i += 1) copies.push(source.tool.clone().translate(step.map((v) => v * i)));
  } else {
    const axis = turnAxes[feature.axis ?? 'z'] ?? turnAxes.z;
    const center = [evaluate(feature.cx ?? 0, params), evaluate(feature.cy ?? 0, params), evaluate(feature.cz ?? 0, params)];
    const total = evaluate(feature.total ?? 360, params);
    if (!Number.isFinite(total) || Math.abs(total) < 1e-9) throw new Error('El ángulo total no puede ser 0');
    const full = Math.abs(Math.abs(total) - 360) < 1e-6;
    const step = full ? total / count : total / (count - 1);
    patternStep = step;
    patternCenter = center;
    patternAxis = axis;
    for (let i = 1; i < count; i += 1) copies.push(source.tool.clone().rotate(step * i, center, axis));
  }
  copies.forEach((copy) => {
    const next = source.mode === 'cut' ? result.cut(copy) : result.fuse(copy);
    result = next;
  });
  // Tubos: los huecos de las copias se abren al final (y quedan registrados para los tubos siguientes).
  if (source.bore) {
    copies.forEach((_, index) => {
      const i = index + 1;
      const hole = feature.kind === 'linear'
        ? source.bore.clone().translate(['dx', 'dy', 'dz'].map((key) => evaluate(feature[key] ?? 0, params) * i))
        : source.bore.clone().rotate(patternStep * i, patternCenter, patternAxis);
      result = result.cut(hole.clone());
      boreList.push(hole);
    });
  }
  return result;
}

// Rosca: cosmética (no toca el sólido; se rotula en el plano) o real (surco helicoidal, lento).
function buildThread(rep, solid, feature, params, cosmeticOnly = false) {
  if (!solid) throw new Error('No hay material donde roscar');
  const spec = threadSpec(feature, params);
  const chamfered = spec.chamferStart > 0 || spec.chamferEnd > 0 ? chamferThread(rep, solid, spec) : solid;
  if (!feature.real || cosmeticOnly || globalThis.__elcadDraftThreads) return chamfered;
  return cutThread(rep, chamfered, spec, Boolean(feature.lefthand));
}

// Borrador: mientras la persona edita, el filete real (segundos por reconstrucción) se omite y queda la rosca cosmética;
// el filete se corta recién cuando la edición se asienta. Interruptor global del hilo del motor, como `withoutSimplify`.
export function withDraftThreads(active, run) {
  const previous = globalThis.__elcadDraftThreads;
  globalThis.__elcadDraftThreads = Boolean(active);
  try {
    return run();
  } finally {
    globalThis.__elcadDraftThreads = previous;
  }
}

// Selección de aristas para filete / chaflán. Las selecciones del visor ("near") se guardan como puntos
// y se resuelven por cercanía: sobreviven a cambios de parámetros (a diferencia de ids de topología).
export function edgeMidpoint(edge) {
  const p = edge.pointAt(0.5);
  const point = [p.x, p.y, p.z];
  p.delete?.();
  return point;
}

function selectEdges(shape, selector) {
  const [min, max] = shape.boundingBox.bounds;
  switch (selector.kind) {
    case 'all':
      return (finder) => finder;
    case 'circles':
      return (finder) => finder.ofCurveType('CIRCLE');
    case 'top':
      return (finder) => finder.inPlane('XY', max[2]);
    case 'bottom':
      return (finder) => finder.inPlane('XY', min[2]);
    case 'vertical':
      return (finder) => finder.inDirection('Z');
    case 'near': {
      const points = selector.points ?? [];
      if (points.length === 0) throw new Error('No hay aristas elegidas: seleccionalas en el visor');
      const edges = shape.edges.map((edge) => ({ edge, mid: edgeMidpoint(edge) }));
      const tolerance = diagonal(shape) * 0.08;
      const chosen = [];
      points.forEach((point) => {
        const best = edges.map((item) => ({ item, dist: Math.hypot(item.mid[0] - point[0], item.mid[1] - point[1], item.mid[2] - point[2]) })).sort((a, b) => a.dist - b.dist)[0];
        if (best && best.dist <= tolerance) chosen.push(best.item.edge);
      });
      if (chosen.length === 0) throw new Error('Las aristas elegidas ya no existen; volvé a seleccionarlas');
      return (finder) => finder.when(({ element }) => chosen.some((edge) => edge.isSame(element)));
    }
    default:
      throw new Error(`Selección desconocida: ${selector.kind}`);
  }
}

function buildEdgeOp(solid, feature, params, op) {
  if (!solid) throw new Error('No hay geometría donde aplicar');
  const size = evaluate(op === 'fillet' ? feature.radius : feature.size, params);
  if (!(size > 0)) throw new Error('El valor debe ser mayor que 0');
  const filter = selectEdges(solid, feature.selector ?? { kind: 'all' });
  return op === 'fillet' ? solid.fillet(size, filter) : solid.chamfer(size, filter);
}

// Valida la topología con OpenCascade: un chaflán/filete demasiado grande puede devolver un sólido corrupto sin avisar.
export function isValidShape(rep, shape) {
  const analyzer = new (rep.getOC().BRepCheck_Analyzer)(shape.wrapped, true, false);
  const valid = analyzer.IsValid_1 ? analyzer.IsValid_1() : analyzer.IsValid();
  analyzer.delete();
  return valid;
}

const invalidMessages = {
  mesh: 'La malla no forma un sólido válido (¿triángulos superpuestos o auto-intersecciones?). Probá reexportar el STL desde el CAD',
  fillet: 'El filete genera una geometría inválida: probá con un radio menor',
  chamfer: 'El chaflán genera una geometría inválida: probá con un tamaño menor (¿se superponen chaflanes vecinos?)',
};

// forDrawing: únicamente las representaciones para planos usan roscas cosméticas y engranajes de dientes rectos (proyectar superficies helicoidales cuelga la proyección).
// Las mallas STL cosidas (caras casi coplanares) quedan inválidas si el kernel re-unifica caras tras cada booleana: con una malla
// en la pieza se apaga esa simplificación (ver vendor/replicad/casting-*.js). Es un interruptor global del hilo del motor.
export const hasMeshFeature = (part) => Boolean(part?.features?.some((feature) => feature.type === 'mesh' && !feature.suppressed));
export function withoutSimplify(active, run) {
  const previous = globalThis.__elcadNoSimplify;
  globalThis.__elcadNoSimplify = Boolean(previous || active);
  try {
    return run();
  } finally {
    globalThis.__elcadNoSimplify = previous;
  }
}

export function buildPart(rep, part, options = {}) {
  const arena = globalThis.__elcadArena;
  arena?.begin();
  let result = null;
  try {
    result = withoutSimplify(hasMeshFeature(part), () => buildPartInner(rep, part, options));
    return result;
  } finally {
    arena?.end([...(result?.shape ? [result.shape] : []), ...heavyShapes()]);
  }
}

function buildPartInner(rep, part, { stopBefore = null, forDrawing = false } = {}) {
  const { values: params, errors: paramErrors } = evaluateParams(part.params);
  const results = {};
  let solid = null;
  const tools = {};
  const poses = {};
  boreList.forEach((bore) => bore.delete?.());
  boreList = [];
  let blocked = false;
  let stopped = false;
  const meshOnly = [];
  part.features.forEach((feature) => {
    if (feature.id === stopBefore) stopped = true;
    if (stopped) return;
    if (feature.suppressed) {
      results[feature.id] = { status: 'suppressed' };
      return;
    }
    if (feature.type === 'sketch') {
      try { if(feature.constraints?.length)solveSketchConstraints(feature.entities.map(e=>resolveEntity(e,params)),feature.constraints,params); results[feature.id]={status:'ok'}; }
      catch(error){results[feature.id]={status:'error',error:error.message};blocked=true;}
      return;
    }
    if (blocked) {
      results[feature.id] = { status: 'skipped', error: 'No se calculó: una operación anterior falló' };
      return;
    }
    try {
      let next;
      lastTool = null;
      if (feature.type === 'mesh' && feature.meshOnly) {
        // «solo malla»: sin B-Rep (no hay límite de triángulos, pero tampoco cortes, STEP ni planos de esa malla)
        if (!feature.mesh) throw new Error('La operación no tiene malla: importá un STL');
        const scale = evaluate(feature.scale ?? 1, params);
        if (!(scale > 0)) throw new Error('La escala debe ser mayor que 0');
        meshOnly.push(buildMeshOnlyData(feature.mesh, { scale, turn: featureTurn(feature, params), move: featureMove(feature) }));
        results[feature.id] = { status: 'ok' };
        return;
      }
      if (feature.type === 'step') { if(!feature.brep) throw new Error('Importá un STEP desde la barra superior'); next=combine(solid,shifted(rep.deserializeShape(feature.brep),feature,params),feature.mode); }
      else if (feature.type === 'shell') next=buildShell(rep,solid,feature,params);
      else if (feature.type === 'loft') next=buildLoft(rep,solid,feature,part.features,params);
      else if (feature.type === 'sweep') next=buildSweep(rep,solid,feature,part.features,params);
      else if (feature.type === 'pipe') next = buildPipe(rep, solid, feature, params, part.features, poses);
      else if (feature.type === 'pattern') next = buildPattern(solid, feature, params, tools);
      else if (feature.type === 'mesh') next = buildMesh(rep, solid, feature, params);
      else if (feature.type === 'frame') next = buildFrame(rep, solid, feature, params);
      else if (feature.type === 'extrude') next = buildExtrude(rep, solid, feature, sketchOf(part.features, feature), params);
      else if (feature.type === 'revolve') next = buildRevolve(rep, solid, feature, sketchOf(part.features, feature), params);
      else if (feature.type === 'hole') next = buildHole(rep, solid, feature, params);
      else if (feature.type === 'gear') next = buildGear(rep, solid, feature, params, forDrawing);
      else if (feature.type === 'screw') next = buildScrew(rep, solid, feature, params, forDrawing);
      else if (feature.type === 'thread') next = buildThread(rep, solid, feature, params, forDrawing);
      else if (feature.type === 'fillet') next = buildEdgeOp(solid, feature, params, 'fillet');
      else if (feature.type === 'chamfer') next = buildEdgeOp(solid, feature, params, 'chamfer');
      else throw new Error(`Operación desconocida: ${feature.type}`);
      if (!isValidShape(rep, next)) throw new Error(invalidMessages[feature.type] ?? 'La operación genera una geometría inválida');
      solid = next;
      if (lastTool && feature.type !== 'pattern') {
        tools[feature.id]?.tool.delete?.();
        tools[feature.id]?.bore?.delete?.();
        tools[feature.id] = lastTool;
      } else {
        lastTool?.tool.delete?.();
        lastTool?.bore?.delete?.();
      }
      results[feature.id] = { status: 'ok' };
    } catch (error) {
      blocked = true;
      results[feature.id] = { status: 'error', error: error?.message ?? String(error) };
    }
  });
  Object.values(tools).forEach((entry) => {
    entry.tool.delete?.();
    entry.bore?.delete?.();
  });
  boreList.forEach((bore) => bore.delete?.());
  boreList = [];
  let solids = solid ? 1 : 0;
  try {
    if (solid) solids = [...rep.iterTopo(solid.wrapped, 'solid')].length;
  } catch {
    /* sin conteo */
  }
  return { shape: solid, results, paramErrors, params, solids, meshOnly };
}
