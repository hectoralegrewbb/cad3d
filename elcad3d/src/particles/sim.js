import { HopperLoad } from './hopperLoad.js';
import { sampleSdf } from './sdf.js';
import { evaluateActions } from '../core/actions.js';
import { AirGrid } from './airflow.js';
import { AirSolver } from './airSolver.js';
import { relaxation, terminalVelocity } from './drag.js';
import { createRotor, stepRotor } from './rotor.js';
import { RigidWorld, quatFromYaw } from './rigid.js';

// Simulación de material granular / polvo (PBD): partículas esféricas del mismo radio contra cuerpos con SDF.
// Cualitativa, no de ingeniería: sirve para ver cómo avanza el material, no para dimensionar caudales.
// Unidades: mm, s. Z arriba. Un cuerpo puede girar (tornillo): la partícula se lleva al marco del cuerpo para consultar su SDF.

export const materialPresets = {
  // grain = diámetro REAL del grano (mm) y density = densidad del sólido (kg/m³): gobiernan el arrastre del aire en el modelo
  // calculado. `radius` es solo el radio numérico de cada partícula simulada (cada una representa muchos granos).
  arena: { label: 'Arena', radius: 1.5, friction: 0.55, wallFriction: 0.5, drag: 0.4, damping: 0.6, grain: 0.4, density: 2650 },
  azucar: { label: 'Azúcar', radius: 1.2, friction: 0.6, wallFriction: 0.45, drag: 0.5, damping: 0.6, grain: 0.5, density: 1590 },
  granulado: { label: 'Granulado (pellets)', radius: 2, friction: 0.35, wallFriction: 0.3, drag: 0.3, damping: 0.4, grain: 3, density: 1100 },
  harina: { label: 'Harina / polvo', radius: 0.8, friction: 0.8, wallFriction: 0.7, drag: 4, damping: 1.2, grain: 0.08, density: 1450 },
  // Líquidos (PBF): `viscosity` = suavizado XSPH, `cohesion` = atracción entre moléculas (gotas que se juntan).
  agua: { label: 'Agua', kind: 'liquid', grain: 1, density: 1000, radius: 1.2, friction: 0, wallFriction: 0.02, drag: 0.05, damping: 0.05, viscosity: 0.05, cohesion: 0.02, color: [0.25, 0.55, 0.95] },
  aceite: { label: 'Aceite / jarabe', kind: 'liquid', grain: 1, density: 900, radius: 1.2, friction: 0, wallFriction: 0.15, drag: 0.05, damping: 0.3, viscosity: 0.35, cohesion: 0.05, color: [0.9, 0.7, 0.2] },
};

export const defaultSettings = () => ({
  ...materialPresets.arena,
  gravity: 9810,
  wind: [0, 0, 0],
  cap: 3000,
  airCells: 20000, // celdas de la grilla de aire rápido (0 = chorro analítico sin grilla)
  airModel: 'calculado', // 'calculado' (presión y caudal, ver airSolver.js) | 'rapido' (visual, airflow.js)
  airSolverCells: 30000, // celdas del aire calculado
  massFlow: 0, // kg/s de producto; 0 = cada partícula pesa lo que un grano de radio `radius`
  kind: 'granular',
  viscosity: 0.05,
  cohesion: 0.02,
  airEvery: 4, // el aire se resuelve cada N pasos
  tracerCount: 500,
  maxCap: 8000,
  rate: 400, // partículas por segundo
  emitter: { center: [0, 0, 60], size: [20, 20, 5] },
  floorZ: -200,
  seed: 1,
});

export class ParticleSim {
  constructor(bodies, settings = {}) {
    this.s = { ...defaultSettings(), ...settings };
    // Cuerpo: { sdf, key?, movable } con pose { axis, pivot, angle, offset, omega, vel } (la actualiza applyScene).
    this.bodies = bodies.map((body) => ({ movable: !!(body.movable ?? body.rotating), axis: [0, 0, 1], pivot: [0, 0, 0], angle: 0, offset: [0, 0, 0], omega: 0, vel: [0, 0, 0], surf: [0, 0, 0], radiusMax: 20, torqueAcc: 0, rotorSpec: null, ...body }));
    this.rigid = new RigidWorld({ gravity: this.s.gravity });
    this.productEnv = { query: (x, y, z, out) => this.envQuery(x, y, z, out) };
    this.feeders = []; // alimentadores de productos y su reloj: { ...def, timer, spawned }
    this.productsExited = 0;
    this.plug = new Map(); // boquilla → { baseP, baseQ, ratio, state } del detector de taponamiento
    this.bodyByKey = new Map(this.bodies.filter((body) => body.key).map((body) => [body.key, body]));
    this.followKeys = []; // cuerpos movidos por una transmisión (para mostrar sus rpm)
    this.rotors = new Map(); // key → estado del eje con dinámica (ángulo, velocidad, pares)
    this.actions = [];
    this.nozzles = [];
    this.nozzleLevels = {};
    this.airEnergy = 0;
    this.exitTimes = [];
    this.air = null;
    this.airKey = '';
    this.airFrame = 0;
    this.tracers = null;
    this.solverMode = false; // el aire es un AirSolver (calculado) y no un AirGrid (rápido)
    this.airMessage = '';
    this.airSettled = true;
    this.inletKey = '';
    this.airReadings = {};
    this.airStarted = false;
    this.sensors = [];
    this.sensorCounts = {};
    this.zoneReached = new Map(); // `${sensor}:${n}` → instante en que se alcanzó
    this.zoneLast = new Map(); // `${sensor}:${n}` → último flanco ascendente (para los disparos que se rearman)
    this.zoneAbove = new Map();
    this.cap = this.s.cap;
    this.max = this.s.maxCap;
    this.airVel = new Float32Array(this.max * 3);
    this.contact = new Uint8Array(this.max); // el grano tocó otro grano o una pared en este subpaso (la amortiguación es solo de contacto)
    this.asleep = new Uint8Array(this.max); // grano dormido: quieto y apoyado, no se integra ni se resuelve hasta que algo lo despierta
    this.calm = new Uint16Array(this.max); // cuadros seguidos casi sin moverse
    this.frameStart = new Float32Array(this.max * 3);
    this.disp = new Float32Array(this.max);
    this.sleepers = 0;
    this.capNote = '';
    this.liftSpeed = 0; // velocidad de aire (mm/s) que despega un grano apoyado
    this.pEps = new Float32Array(this.max).fill(1); // porosidad del aire en la celda de cada grano (la deja el último depósito)
    this.x = new Float32Array(this.max * 3);
    this.prev = new Float32Array(this.max * 3);
    this.v = new Float32Array(this.max * 3);
    this.count = 0;
    this.time = 0;
    this.exited = 0;
    this.exitWindow = [];
    this.exitSum = [0, 0, 0]; // suma de posiciones de salida (para saber hacia dónde sale el material)
    this.spawnCarry = 0;
    this.rng = this.s.seed >>> 0 || 1;
    this.cellItems = new Int32Array(this.max);
    this.grid = null;
    this.grad = [0, 0, 0];
    this.stepMs = 0;
    this.rimSpeed = 0;
    this.liftSpeed = this.s.grain > 0 && this.s.density > 0 ? 500 * terminalVelocity({ diameter: this.s.grain / 1000, density: this.s.density }) : 0;
    this.syncAir();
  }

  initializeFill(plan) {
    if(this.liquid)throw new Error('El llenado inicial de tolva requiere un material granular');
    this.hopper=new HopperLoad(plan,this.s.initialFill,this.s.density);
    const candidates=this.hopper.candidates;
    // Sembrar solamente la zona de salida; el resto del material permanece en el reservorio.
    for(const index of candidates){
      if(this.count>=Math.min(this.cap,1000))break;
      const point=this.hopper.point(index);
      if(this.fillPointFree(point)&&this.hopper.take())this.addFillParticle(point);
    }
    if(this.hopper.totalSolid>=this.hopper.parcelVolume&&!this.count)throw new Error('No cabe ninguna partícula en la zona inferior de la tolva. Reducí el radio de salida o revisá la cavidad.');
    this.initialCount=this.count;
  }

  fillPointFree(point) {
    const r=this.s.radius;
    for(const body of this.bodies)if(this.bodyDistance(body,...point)<r*1.05)return false;
    const distance=(2*r*1.025)**2;
    for(let i=0;i<this.count;i++){const a=i*3;if((point[0]-this.x[a])**2+(point[1]-this.x[a+1])**2+(point[2]-this.x[a+2])**2<distance)return false;}
    return true;
  }

  addFillParticle(point) {
    const at=this.count*3;this.x.set(point,at);this.prev.set(point,at);this.v.fill(0,at,at+3);
    this.asleep[this.count]=0;this.calm[this.count]=0;this.pEps[this.count]=1;this.count++;
  }

  fillInfo() {return this.hopper?.info(this.time,this.count,this.exited)??null;}

  random() {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  setSettings(patch) {
    this.s = { ...this.s, ...patch };
    this.liftSpeed = this.s.grain > 0 && this.s.density > 0 ? 500 * terminalVelocity({ diameter: this.s.grain / 1000, density: this.s.density }) : 0;
    this.cap = Math.min(this.s.cap, this.max);
    this.syncAir();
  }

  // Acciones y boquillas (definiciones puras de core/actions.js).
  setScene({ actions, nozzles, sensors, feeders }) {
    this.wakeAll();
    if (actions) this.actions = actions;
    if (nozzles) this.nozzles = nozzles;
    if (sensors) this.sensors = sensors;
    if (feeders) {
      // se conserva el reloj de los alimentadores que siguen existiendo (editar uno no reinicia a los demás)
      const before = new Map(this.feeders.map((feeder) => [feeder.id, feeder]));
      this.feeders = feeders.map((feeder) => ({ ...feeder, timer: before.get(feeder.id)?.timer ?? feeder.start ?? 0, spawned: before.get(feeder.id)?.spawned ?? 0 }));
    }
    this.syncAir();
  }

  // Crea (o rehace) el campo de aire si hay boquillas o viento; el dominio cubre los cuerpos, el emisor y el chorro cercano.
  // Con boquillas y sin viento, el modelo `calculado` usa AirSolver (presión y caudal reales); si no, la grilla rápida (visual).
  syncAir() {
    const hasNozzles = this.nozzles.length > 0;
    const windy = Math.hypot(...this.s.wind) > 0;
    const wanted = (this.s.airCells > 0 || this.s.airModel === 'calculado') && (hasNozzles || windy);
    if (!wanted) {
      this.air = null;
      this.airKey = '';
      this.tracers = null;
      this.solverMode = false;
      return;
    }
    // el aire calculado solo se usa si hay una entrada de soplador (caudal o presión); los chorros de cono siguen siendo visuales
    const blower = this.nozzles.some((nozzle) => nozzle.bc === 'caudal' || nozzle.bc === 'presion');
    const solver = this.s.airModel === 'calculado' && blower && !windy && !this.quickOnly;
    const key = JSON.stringify([this.nozzles.map((n) => [n.pos, n.dir, Math.min(n.range, 200), n.radius, n.tan]), solver ? this.s.airSolverCells : this.s.airCells, this.bodies.length, solver]);
    if (this.air && key === this.airKey) {
      if (this.solverMode) this.syncInlets();
      return;
    }
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const grow = (point) => [0, 1, 2].forEach((k) => {
      lo[k] = Math.min(lo[k], point[k]);
      hi[k] = Math.max(hi[k], point[k]);
    });
    this.bodies.forEach(({ sdf }) => {
      grow(sdf.origin);
      grow(sdf.origin.map((v, k) => v + sdf.dims[k] * sdf.cell));
    });
    const { emitter } = this.s;
    grow(emitter.center.map((v, k) => v - emitter.size[k] / 2));
    grow(emitter.center.map((v, k) => v + emitter.size[k] / 2));
    this.nozzles.forEach((nozzle) => {
      grow(nozzle.pos);
      const reach = Math.min(nozzle.range, 200);
      grow(nozzle.pos.map((v, k) => v + nozzle.dir[k] * reach));
    });
    const pad = solver ? 15 : 10;
    const box = { lo: lo.map((v) => v - pad), hi: hi.map((v) => v + pad) };
    this.airKey = key;
    this.airMessage = '';
    if (solver) {
      try {
        this.air = new AirSolver({ ...box, bodies: this.bodies, cells: this.s.airSolverCells });
        this.solverMode = true;
        this.airSettled = false;
        this.airStarted = false; // el cálculo inicial frena la emisión; después el aire se reajusta en vuelo sin frenarla
        this.inletKey = '';
        this.syncInlets();
      } catch (error) {
        this.useQuickAir(`No se pudo armar el aire calculado (${error.message}): se usa el modelo rápido`, box);
      }
    } else {
      this.air = new AirGrid({ ...box, bodies: this.bodies, cells: this.s.airCells });
      this.solverMode = false;
      this.airSettled = true;
    }
    this.tracers = this.s.tracerCount > 0 ? { n: this.s.tracerCount, pos: new Float32Array(this.s.tracerCount * 4), life: new Float32Array(this.s.tracerCount).fill(-1) } : null;
  }

  // Reemplaza el aire calculado por la grilla rápida (si el solver falla o se vuelve inestable): la simulación nunca se cuelga.
  useQuickAir(reason, box = null) {
    this.quickOnly = true;
    this.solverMode = false;
    this.airSettled = true;
    this.airMessage = reason;
    const lo = box?.lo ?? this.air.origin;
    const hi = box?.hi ?? this.air.origin.map((v, k) => v + this.air.dims[k] * this.air.hmm);
    this.air = new AirGrid({ lo, hi, bodies: this.bodies, cells: this.s.airCells });
  }

  // Entradas del aire calculado a partir de las boquillas activas: caudal (m³/s) o presión de plenum (Pa), escalados por su nivel.
  syncInlets() {
    if (!this.solverMode) return;
    const inlets = [];
    this.nozzles.forEach((nozzle) => {
      const level = this.nozzleLevels[nozzle.id] ?? (nozzle.controlled ? 0 : 1);
      if (!(level > 0)) return;
      const radius = nozzle.radius ?? 5;
      const base = { pos: nozzle.pos, dir: nozzle.dir, radius };
      if (nozzle.bc === 'presion' && nozzle.pressure > 0) inlets.push({ ...base, pressure: nozzle.pressure * level });
      else {
        const flow = nozzle.bc === 'caudal' && nozzle.flow > 0 ? nozzle.flow / 3600 : (nozzle.speed / 1000) * Math.PI * (radius / 1000) ** 2;
        inlets.push({ ...base, flow: flow * level });
      }
    });
    const key = JSON.stringify(inlets);
    if (key === this.inletKey) return;
    this.inletKey = key;
    this.air.setInlets(inlets);
    if (!this.airStarted) this.airSettled = false;
    if (this.air.warnings.length) this.airMessage = this.air.warnings.join(' · ');
  }

  // ¿Falta resolver el aire inicial? Mientras tanto no se emiten granos.
  airPending() {
    return this.solverMode && !this.airSettled;
  }

  // Avanza el aire calculado hasta `budgetMs`; devuelve { done, progress }. Si diverge, pasa al modelo rápido.
  solveAirSlice(budgetMs) {
    const air = this.air;
    this.syncInlets();
    const done = air.advance({ budgetMs, tolerance: 6e-3 }) || air.steps >= 800;
    if (air.diverging()) {
      this.useQuickAir('El aire calculado se volvió inestable (geometría con aristas muy finas o caudal excesivo): se usa el modelo rápido');
      return { done: true, progress: 1 };
    }
    if (done) {
      this.airSettled = true;
      this.airStarted = true;
      this.monitorInlets(); // referencia limpia, antes de emitir el primer grano
      air.steps = 0;
    }
    return { done, progress: done ? 1 : this.airProgress() };
  }

  airProgress() {
    const delta = this.air?.delta ?? 1;
    return Math.max(0, Math.min(0.99, Math.log10(1 / Math.max(delta, 1e-6)) / Math.log10(1 / 6e-3)));
  }

  // Masa que representa cada partícula simulada (kg): o la de un grano de radio `radius`, o la que da el caudal de producto pedido.
  parcelMass() {
    const { massFlow, rate, density, radius } = this.s;
    if (!this.hopper && massFlow > 0 && rate > 0) return massFlow / rate;
    return density * (4 / 3) * Math.PI * (radius / 1000) ** 3;
  }

  // Granos → aire: porosidad por celda y acople de arrastre en ambos sentidos (cada cierto paso de aire).
  depositGrains() {
    const air = this.air;
    if (this.liquid) {
      air.clearParticles();
      return;
    }
    const diameter = this.s.grain / 1000;
    const density = this.s.density;
    const mass = this.parcelMass();
    const volume = mass / density;
    const { x, v, count, airVel, pEps } = this;
    air.beginDeposit();
    if(this.hopper&&this.time>=this.hopper.options.settleSeconds)this.hopper.deposit(air,relaxation,diameter);
    for (let i = 0; i < count; i += 1) {
      const a = i * 3;
      const slip = Math.sqrt((airVel[a] - v[a]) * (airVel[a] - v[a]) + (airVel[a + 1] - v[a + 1]) * (airVel[a + 1] - v[a + 1]) + (airVel[a + 2] - v[a + 2]) * (airVel[a + 2] - v[a + 2])) / 1000;
      air.depositParticle(x[a], x[a + 1], x[a + 2], v[a], v[a + 1], v[a + 2], volume, mass * relaxation(diameter, density, slip, pEps[i]));
    }
    air.endDeposit();
    for (let i = 0; i < count; i += 1) pEps[i] = air.cellPorosity(x[i * 3], x[i * 3 + 1], x[i * 3 + 2]);
  }

  // Lecturas del aire en cada sensor (cada tanto: recorre las celdas de la caja).
  readSensorsAir() {
    if (!this.solverMode) return;
    const readings = {};
    this.sensors.forEach((sensor) => {
      const center = sensor.min.map((v, k) => (v + sensor.max[k]) / 2);
      const size = sensor.min.map((v, k) => sensor.max[k] - v);
      const r = this.air.readBox(center, size);
      readings[sensor.id] = { pressure: r.pressure, speed: r.speed, flow: r.flow * 3600 };
    });
    this.airReadings = readings;
    this.monitorInlets();
  }

  // Detector de taponamiento: cada soplador (caudal o presión impuesta) se compara con su estado limpio, medido al asentarse el aire
  // y antes de que entren granos. Con caudal impuesto el taponamiento sube la presión de entrada; con presión impuesta baja el caudal.
  monitorInlets() {
    if (!this.airSettled) return;
    const h = this.air.hmm;
    this.nozzles.forEach((nozzle) => {
      if (nozzle.bc !== 'caudal' && nozzle.bc !== 'presion') return;
      if ((this.nozzleLevels[nozzle.id] ?? (nozzle.controlled ? 0 : 1)) <= 0) return;
      const center = nozzle.pos.map((v, k) => v + nozzle.dir[k] * h * 3);
      const r = this.air.readBox(center, [h * 3, h * 3, h * 3]);
      const mon = this.plug.get(nozzle.id) ?? { ratio: 1, state: 'normal' };
      if (mon.baseP === undefined) {
        mon.baseP = Math.abs(r.pressure);
        mon.pressureFloor = Math.max(50, 0.5 * 1.2 * r.speed * r.speed);
        mon.baseQ = Math.max(1e-9, Math.abs(r.flow));
      }
      const raw = nozzle.bc === 'caudal' ? (Math.abs(r.pressure) + mon.pressureFloor) / (mon.baseP + mon.pressureFloor) : mon.baseQ / Math.max(1e-9 * mon.baseQ, Math.abs(r.flow));
      mon.ratio += (Math.min(raw, 50) - mon.ratio) * 0.3;
      mon.state = mon.ratio > 2.2 ? 'taponada' : mon.ratio > 1.4 ? 'aviso' : 'normal';
      mon.bc = nozzle.bc;
      mon.pressure = r.pressure;
      this.plug.set(nozzle.id, mon);
    });
  }

  // Corte del aire para mostrar en el visor (null si no hay solver). req = { axis: 0|1|2, t: 0..1 }
  airSlice(req) {
    if (!this.solverMode || !this.air || !req) return null;
    return this.air.sliceField(req.axis, req.t);
  }

  plugInfo() {
    return [...this.plug.entries()].map(([id, mon]) => ({ id, ratio: mon.ratio, state: mon.state, bc: mon.bc, baselinePa: mon.baseP, pressurePa: mon.pressure, pressureFloorPa: mon.pressureFloor }));
  }

  airInfo() {
    const air = this.air;
    if (!air) return null;
    if (!this.solverMode) return { model: 'rapido', ready: true, cells: air.n, message: this.airMessage };
    return {
      model: 'calculado',
      ready: this.airSettled,
      progress: this.airSettled ? 1 : this.airProgress(),
      cells: air.n,
      cellMm: air.hmm,
      stepMs: air.stepCost,
      pcg: air.pcgIterations,
      residual: air.delta,
      inletFlow: air.inletFlow() * 3600,
      readings: this.airReadings,
      plug: this.plugInfo(),
      message: this.airMessage,
    };
  }

  // Resuelve el aire cada `airEvery` pasos y muestrea la velocidad para cada partícula (una vez por paso).
  updateAir(dt) {
    if (this.solverMode) {
      this.updateAirSolver(dt);
      return;
    }
    const air = this.air;
    const active = this.nozzles.map((nozzle) => ({ ...nozzle, level: this.nozzleLevels[nozzle.id] ?? (nozzle.controlled ? 0 : 1) }));
    const sources = active.some((nozzle) => nozzle.level > 0) || Math.hypot(...this.s.wind) > 0;
    this.airFrame += 1;
    if ((sources || this.airEnergy > 5) && this.airFrame % this.s.airEvery === 0) {
      air.step(dt * this.s.airEvery, active, this.s.wind);
      let peak = 0;
      for (let c = 0; c < air.n; c += 1) peak = Math.max(peak, Math.abs(air.u[c]) + Math.abs(air.v[c]) + Math.abs(air.w[c]));
      this.airEnergy = peak;
    }
    const out = [0, 0, 0];
    const { x, airVel, count } = this;
    for (let i = 0; i < count; i += 1) {
      air.velocityAt(x[i * 3], x[i * 3 + 1], x[i * 3 + 2], out, this.s.wind);
      airVel[i * 3] = out[0];
      airVel[i * 3 + 1] = out[1];
      airVel[i * 3 + 2] = out[2];
    }
    this.wakeByAir();
    this.stepTracers(dt, active, sources);
  }

  // Aire calculado en régimen casi-estacionario: un paso por cada `stride` cuadros según su costo (≤ ~7 ms por cuadro de aire).
  updateAirSolver(dt) {
    const air = this.air;
    this.syncInlets();
    this.airFrame += 1;
    const stride = Math.min(12, Math.max(1, Math.ceil(air.stepCost / 7)));
    if (this.airFrame % stride === 0) {
      this.depositGrains();
      air.step();
      if (air.diverging()) {
        this.useQuickAir('El aire calculado se volvió inestable: se usa el modelo rápido');
        this.updateAir(dt);
        return;
      }
    }
    if (this.airFrame % 15 === 0) this.readSensorsAir();
    const out = [0, 0, 0];
    const { x, airVel, count } = this;
    for (let i = 0; i < count; i += 1) {
      air.velocityAt(x[i * 3], x[i * 3 + 1], x[i * 3 + 2], out, this.s.wind);
      airVel[i * 3] = out[0];
      airVel[i * 3 + 1] = out[1];
      airVel[i * 3 + 2] = out[2];
    }
    this.wakeByAir();
    const active = this.nozzles.map((nozzle) => ({ ...nozzle, level: this.nozzleLevels[nozzle.id] ?? (nozzle.controlled ? 0 : 1) }));
    this.stepTracers(dt, active, active.some((nozzle) => nozzle.level > 0));
  }

  // El aire despierta a los granos dormidos que levantaría (arrastre mayor que ~⅓ del peso).
  wakeByAir() {
    if (!(this.liftSpeed > 0) || !this.sleepers) return;
    const { airVel, asleep, count } = this;
    const lift2 = this.liftSpeed * this.liftSpeed;
    for (let i = 0; i < count; i += 1) {
      if (!asleep[i]) continue;
      const a = i * 3;
      if (airVel[a] * airVel[a] + airVel[a + 1] * airVel[a + 1] + airVel[a + 2] * airVel[a + 2] > lift2) this.wake(i);
    }
  }

  // Marcadores que siguen el aire (solo para mostrar el flujo).
  stepTracers(dt, active, sources) {
    const tr = this.tracers;
    if (!tr) return;
    const air = this.air;
    const out = [0, 0, 0];
    const mouths = active.filter((nozzle) => nozzle.level > 0);
    for (let i = 0; i < tr.n; i += 1) {
      let alive = tr.life[i] > 0;
      if (alive) {
        air.velocityAt(tr.pos[i * 4], tr.pos[i * 4 + 1], tr.pos[i * 4 + 2], out, this.s.wind);
        const speed = Math.hypot(...out);
        const ax = tr.pos[i * 4], ay = tr.pos[i * 4 + 1], az = tr.pos[i * 4 + 2];
        const bx = ax + out[0] * dt, by = ay + out[1] * dt, bz = az + out[2] * dt;
        if (air.blockedLine(ax, ay, az, bx, by, bz)) tr.life[i] = 0;
        else { tr.pos[i * 4] = bx; tr.pos[i * 4 + 1] = by; tr.pos[i * 4 + 2] = bz; }
        tr.pos[i * 4 + 3] = speed;
        tr.life[i] -= dt;
        if (speed < 30) tr.life[i] -= dt * 4; // donde el aire se aquieta, el marcador se apaga pronto
        alive = tr.life[i] > 0;
      }
      if (!alive && sources) {
        if (mouths.length) {
          const nozzle = mouths[Math.floor(this.random() * mouths.length)];
          // punto al azar en la boca, adelantado un poco
          const a = this.random() * Math.PI * 2;
          const r = nozzle.radius * Math.sqrt(this.random());
          const up = Math.abs(nozzle.dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
          const side = [nozzle.dir[1] * up[2] - nozzle.dir[2] * up[1], nozzle.dir[2] * up[0] - nozzle.dir[0] * up[2], nozzle.dir[0] * up[1] - nozzle.dir[1] * up[0]];
          const sl = Math.hypot(...side) || 1;
          const s1 = side.map((v) => v / sl);
          const s2 = [nozzle.dir[1] * s1[2] - nozzle.dir[2] * s1[1], nozzle.dir[2] * s1[0] - nozzle.dir[0] * s1[2], nozzle.dir[0] * s1[1] - nozzle.dir[1] * s1[0]];
          for (let k = 0; k < 3; k += 1) tr.pos[i * 4 + k] = nozzle.pos[k] + nozzle.dir[k] * (air.hmm ?? air.h) + s1[k] * Math.cos(a) * r + s2[k] * Math.sin(a) * r;
          tr.life[i] = 1.5 + this.random() * 1.5;
        } else {
          const wind = this.s.wind;
          const axis = Math.abs(wind[0]) >= Math.abs(wind[1]) && Math.abs(wind[0]) >= Math.abs(wind[2]) ? 0 : Math.abs(wind[1]) >= Math.abs(wind[2]) ? 1 : 2;
          for (let k = 0; k < 3; k += 1) {
            const cellMm = air.hmm ?? air.h;
            const lo = air.origin[k] + cellMm * 2;
            const hi = air.origin[k] + (air.dims[k] - 2) * cellMm;
            tr.pos[i * 4 + k] = k === axis ? (wind[axis] > 0 ? lo : hi) : lo + this.random() * (hi - lo);
          }
          tr.life[i] = 2 + this.random() * 2;
        }
      }
    }
  }

  tracerSnapshot() {
    const tr = this.tracers;
    if (!tr) return new Float32Array(0);
    let alive = 0;
    for (let i = 0; i < tr.n; i += 1) if (tr.life[i] > 0) alive += 1;
    const out = new Float32Array(alive * 4);
    let w = 0;
    for (let i = 0; i < tr.n; i += 1) {
      if (!(tr.life[i] > 0)) continue;
      out.set(tr.pos.subarray(i * 4, i * 4 + 4), w * 4);
      w += 1;
    }
    return out;
  }


  // Pone a cada cuerpo en su pose del instante t y fija los niveles de aire.
  applyScene(t) {
    const poses = evaluateActions(this.actions, t, { exitTime: (n) => this.exitTimes[n - 1] ?? null, zoneTime: (sensor, n, rearm) => (rearm ? this.zoneLast : this.zoneReached).get(`${sensor}:${n}`) ?? null });
    const byKey = new Map(poses.bodies.map((pose) => [pose.key, pose]));
    this.bodies.forEach((body) => {
      const pose = body.key ? byKey.get(body.key) : null;
      if (!pose) {
        body.omega = 0;
        body.vel = [0, 0, 0];
        body.surf = [0, 0, 0];
        return;
      }
      body.axis = pose.axis;
      body.pivot = pose.pivot;
      body.angle = pose.angle;
      body.omega = pose.omega;
      body.rotorSpec = pose.rotor ?? null;
      if (pose.rotor) {
        if (!this.rotors.has(pose.key)) this.rotors.set(pose.key, { ...createRotor(), filtered: 0 });
        const state = this.rotors.get(pose.key);
        body.angle += state.angle;
        body.omega += state.omega;
      }
      body.offset = pose.offset;
      body.vel = pose.vel;
      body.surf = pose.surf ?? [0, 0, 0];
    });
    this.applyLinks(poses);
    this.nozzleLevels = poses.nozzles;
  }

  // Transmisiones: los seguidores toman del maestro la parte dinámica (la que integra el motor real) y le devuelven carga e inercia.
  applyLinks(poses) {
    const links = poses.links ?? [];
    this.bodies.forEach((body) => { body.linkRoot = null; });
    this.followKeys = links.filter((link) => link.kind === 'rotate').map((link) => link.key);
    if (!links.length) return;
    const linkById = new Map(links.map((link) => [link.id, link]));
    const rotorKeyOfAction = new Map();
    poses.bodies.forEach((pose) => { if (pose.rotor) rotorKeyOfAction.set(pose.rotor.id, pose.key); });
    // ángulo y velocidad dinámicos de una acción: su propio rotor + lo que le llega por su transmisión
    const dyn = (id, depth = 0) => {
      let a = 0;
      let w = 0;
      const state = this.rotors.get(rotorKeyOfAction.get(id));
      if (state) { a += state.angle; w += state.omega; }
      const link = linkById.get(id);
      if (link && link.kind === 'rotate' && depth < 8) {
        const m = dyn(link.master, depth + 1);
        a += link.ratio * m.a;
        w += link.ratio * m.w;
      }
      return { a, w };
    };
    const reflected = new Map();
    links.forEach((link) => {
      const body = this.bodyByKey.get(link.key);
      if (!body) return;
      const m = dyn(link.master);
      if (link.kind === 'slide') {
        for (let c = 0; c < 3; c += 1) {
          if (link.belt) body.surf[c] += link.axis[c] * link.ratio * m.w;
          else {
            body.offset[c] += link.axis[c] * link.ratio * m.a;
            body.vel[c] += link.axis[c] * link.ratio * m.w;
          }
        }
        return;
      }
      body.angle += link.ratio * m.a;
      body.omega += link.ratio * m.w;
      // cadena hasta el eje con motor: relación total y rendimiento total
      let ratio = 1;
      let eff = 1;
      let cur = link;
      for (let depth = 0; cur && depth < 8; depth += 1) {
        ratio *= cur.ratio;
        eff *= cur.eff;
        const next = linkById.get(cur.master);
        if (!next) { cur = { rootAction: cur.master }; break; }
        cur = next;
      }
      const rootKey = cur?.rootAction ? rotorKeyOfAction.get(cur.rootAction) : null;
      if (!rootKey) return;
      body.linkRoot = { rootKey, factor: ratio / Math.max(eff, 0.05) };
      reflected.set(rootKey, (reflected.get(rootKey) ?? 0) + link.inertia * ratio * ratio);
    });
    reflected.forEach((extra, rootKey) => {
      const root = this.bodyByKey.get(rootKey);
      if (root?.rotorSpec) root.rotorSpec = { ...root.rotorSpec, params: { ...root.rotorSpec.params, inertia: root.rotorSpec.params.inertia + extra } };
    });
  }

  // Velocidad del aire en un punto: suma de chorros (cono, caída con la distancia, sombra de las paredes).
  airAt(x, y, z, out, blockedBy) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    for (let n = 0; n < this.nozzles.length; n += 1) {
      const nozzle = this.nozzles[n];
      const level = this.nozzleLevels[nozzle.id] ?? (nozzle.controlled ? 0 : 1);
      if (!(level > 0)) continue;
      const dx = x - nozzle.pos[0];
      const dy = y - nozzle.pos[1];
      const dz = z - nozzle.pos[2];
      const along = dx * nozzle.dir[0] + dy * nozzle.dir[1] + dz * nozzle.dir[2];
      if (along < 0 || along > nozzle.range) continue;
      const rx = dx - along * nozzle.dir[0];
      const ry = dy - along * nozzle.dir[1];
      const rz = dz - along * nozzle.dir[2];
      const radial2 = rx * rx + ry * ry + rz * rz;
      const rmax = (nozzle.radius ?? 5) + along * nozzle.tan;
      if (radial2 > rmax * rmax) continue;
      if (blockedBy && blockedBy(nozzle, x, y, z)) continue;
      const axial = 1 - along / nozzle.range;
      const f = level * nozzle.speed * axial * axial * (1 - radial2 / (rmax * rmax));
      out[0] += nozzle.dir[0] * f;
      out[1] += nozzle.dir[1] * f;
      out[2] += nozzle.dir[2] * f;
    }
  }

  // ¿Hay pared entre la boquilla y el punto? Se muestrea la recta contra el SDF de todos los cuerpos (en su pose actual).
  blocked(nozzle, x, y, z) {
    const samples = 5;
    for (let s = 1; s < samples; s += 1) {
      const f = s / samples;
      const px = nozzle.pos[0] + (x - nozzle.pos[0]) * f;
      const py = nozzle.pos[1] + (y - nozzle.pos[1]) * f;
      const pz = nozzle.pos[2] + (z - nozzle.pos[2]) * f;
      for (let b = 0; b < this.bodies.length; b += 1) {
        if (this.bodyDistance(this.bodies[b], px, py, pz) < 0) return true;
      }
    }
    return false;
  }

  bodyDistance(body, x, y, z) {
    let lx = x;
    let ly = y;
    let lz = z;
    if (body.movable) {
      const [px, py, pz] = body.pivot;
      const rx = x - body.offset[0] - px;
      const ry = y - body.offset[1] - py;
      const rz = z - body.offset[2] - pz;
      if (body.angle !== 0) {
        const [kx, ky, kz] = body.axis;
        const c = Math.cos(body.angle);
        const s = Math.sin(body.angle);
        const kd = kx * rx + ky * ry + kz * rz;
        lx = px + rx * c - (ky * rz - kz * ry) * s + kx * kd * (1 - c);
        ly = py + ry * c - (kz * rx - kx * rz) * s + ky * kd * (1 - c);
        lz = pz + rz * c - (kx * ry - ky * rx) * s + kz * kd * (1 - c);
      } else {
        lx = px + rx;
        ly = py + ry;
        lz = pz + rz;
      }
    }
    return sampleSdf(body.sdf, lx, ly, lz, this.grad);
  }

  spawn(dt) {
    if(this.hopper){
      if(this.time<this.hopper.options.settleSeconds)return;
      const load=this.hopper;
      this.spawnCarry=Math.min(8,this.spawnCarry+load.options.feedRate*dt);
      let attempts=0;
      while(this.spawnCarry>=1&&this.count<Math.min(this.cap,this.max)&&attempts++<24&&load.remainingSolid>=load.parcelVolume){
        const index=load.candidates[Math.floor(this.random()*load.candidates.length)],point=load.point(index);
        if(!this.fillPointFree(point))continue;
        if(!load.take())break;
        this.addFillParticle(point);this.spawnCarry--;
      }
      return;
    }
    const { emitter, rate, radius } = this.s;
    this.spawnCarry += rate * dt;
    while (this.spawnCarry >= 1 && this.count < this.cap) {
      this.spawnCarry -= 1;
      const at = this.count * 3;
      for (let k = 0; k < 3; k += 1) this.x[at + k] = emitter.center[k] + (this.random() - 0.5) * emitter.size[k];
      this.prev.set(this.x.subarray(at, at + 3), at);
      this.asleep[this.count] = 0;
      this.calm[this.count] = 0;
      this.v[at] = 0;
      this.v[at + 1] = 0;
      this.v[at + 2] = -radius * 4;
      this.count += 1;
    }
    this.spawnCarry = Math.min(this.spawnCarry, 5);
  }

  // Grilla densa de celdas de 2r sobre la zona útil (cuerpos + emisor); fuera de esa zona los granos no se tocan entre sí.
  setupGrid() {
    const { radius, emitter } = this.s;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const grow = (min, max) => [0, 1, 2].forEach((k) => {
      lo[k] = Math.min(lo[k], min[k]);
      hi[k] = Math.max(hi[k], max[k]);
    });
    this.bodies.forEach(({ sdf }) => grow(sdf.origin, sdf.origin.map((v, k) => v + sdf.dims[k] * sdf.cell)));
    grow(emitter.center.map((v, k) => v - emitter.size[k] / 2), emitter.center.map((v, k) => v + emitter.size[k] / 2));
    this.liquid = this.s.kind === 'liquid';
    this.restSpacing = radius * 1.6; // separación de reposo del líquido
    this.h = radius * 3.2; // radio de influencia del líquido
    this.setupLiquid();
    let cell = this.liquid ? this.h : radius * 2;
    const dimsFor = (c) => [0, 1, 2].map((k) => Math.max(1, Math.ceil((hi[k] - lo[k]) / c)));
    let dims = dimsFor(cell);
    while (dims[0] * dims[1] * dims[2] > 1_500_000) {
      cell *= 1.25;
      dims = dimsFor(cell);
    }
    this.grid = { lo, cell, inv: 1 / cell, dims, total: dims[0] * dims[1] * dims[2] };
    this.cellStart = new Int32Array(this.grid.total + 1);
    this.fill = new Int32Array(this.grid.total);
    this.cellOf = new Int32Array(this.max);
    this.pairs = new Int32Array(this.max * 2 * (this.liquid ? 24 : 10));
    this.pairNormal = new Float32Array(this.pairs.length / 2); // fuerza normal acumulada por par en el subpaso (suma de penetraciones resueltas)
    this.pairCut = new Float32Array(this.pairs.length / 2); // deslizamiento ya frenado por fricción en el subpaso
    this.load = new Float32Array(this.max); // granos apilados (en contacto) sobre cada grano: carga que sostiene su rozamiento
    this.order = new Int32Array(this.max);
    this.maxLoad = 0; // altura de la pila más alta (en granos)
    this.loadUnit = 0; // g·h² del subpaso: «penetración equivalente» del peso de un grano
    this.wallNormal = new Float32Array(this.max);
    this.wallCut = new Float32Array(this.max);
    this.lambda = new Float32Array(this.max);
    this.rho = new Float32Array(this.max);
    this.dp = new Float32Array(this.max * 3);
    this.gsum = new Float32Array(this.max * 3);
    this.pairCount = 0;
  }

  // Cuenta granos por celda y arma la lista de pares cercanos (se reutiliza en las dos pasadas del subpaso).
  buildPairs() {
    if (!this.grid) this.setupGrid();
    const { lo, inv, dims, total } = this.grid;
    const { x, count, cellStart, cellItems, cellOf, fill, pairs } = this;
    if (count === 0) {
      this.pairCount = 0; // sin granos (solo cajas o aire): no se recorre la grilla entera en cada subpaso
      return;
    }
    const reach = this.liquid ? this.h * this.h : (this.s.radius * 2) ** 2 * 1.44; // margen: los granos se mueven entre la búsqueda y la segunda pasada
    cellStart.fill(0);
    const [nx, ny, nz] = dims;
    for (let i = 0; i < count; i += 1) {
      const cx = Math.floor((x[i * 3] - lo[0]) * inv);
      const cy = Math.floor((x[i * 3 + 1] - lo[1]) * inv);
      const cz = Math.floor((x[i * 3 + 2] - lo[2]) * inv);
      if (cx < 0 || cy < 0 || cz < 0 || cx >= nx || cy >= ny || cz >= nz) {
        cellOf[i] = -1;
        continue;
      }
      const cell = cx + nx * (cy + ny * cz);
      cellOf[i] = cell;
      cellStart[cell + 1] += 1;
    }
    for (let i = 0; i < total; i += 1) cellStart[i + 1] += cellStart[i];
    fill.fill(0);
    for (let i = 0; i < count; i += 1) {
      const cell = cellOf[i];
      if (cell < 0) continue;
      cellItems[cellStart[cell] + fill[cell]] = i;
      fill[cell] += 1;
    }
    let found = 0;
    const capacity = pairs.length - 2;
    for (let i = 0; i < count && found < capacity; i += 1) {
      const cell = cellOf[i];
      if (cell < 0) continue;
      const cx = cell % nx;
      const cy = Math.floor(cell / nx) % ny;
      const cz = Math.floor(cell / (nx * ny));
      const xi = x[i * 3];
      const yi = x[i * 3 + 1];
      const zi = x[i * 3 + 2];
      for (let c = Math.max(0, cz - 1); c <= Math.min(nz - 1, cz + 1); c += 1) {
        for (let b = Math.max(0, cy - 1); b <= Math.min(ny - 1, cy + 1); b += 1) {
          const row = nx * (b + ny * c);
          const from = cellStart[row + Math.max(0, cx - 1)];
          const to = cellStart[row + Math.min(nx - 1, cx + 1) + 1];
          // las celdas de una fila contigua en X son consecutivas en cellItems
          for (let n = from; n < to; n += 1) {
            const j = cellItems[n];
            if (j <= i) continue;
            const dx = xi - x[j * 3];
            const dy = yi - x[j * 3 + 1];
            const dz = zi - x[j * 3 + 2];
            if (dx * dx + dy * dy + dz * dz < reach && found < capacity) {
              pairs[found] = i;
              pairs[found + 1] = j;
              found += 2;
            }
          }
        }
      }
    }
    this.pairCount = found;
    this.pairNormal.fill(0, 0, found / 2);
    this.pairCut.fill(0, 0, found / 2);
    this.wallNormal.fill(0, 0, count);
    this.wallCut.fill(0, 0, count);
  }

  // Constantes del núcleo (poly6 para densidad, spiky para gradiente) y densidad de reposo en una red cúbica.
  setupLiquid() {
    if (!this.liquid) return;
    const { h, restSpacing } = this;
    this.poly6 = 315 / (64 * Math.PI * h ** 9);
    this.spiky = -45 / (Math.PI * h ** 6);
    const w = (r2) => (r2 < h * h ? this.poly6 * (h * h - r2) ** 3 : 0);
    let rho = w(0);
    const range = Math.ceil(h / restSpacing);
    for (let i = -range; i <= range; i += 1) {
      for (let j = -range; j <= range; j += 1) {
        for (let k = -range; k <= range; k += 1) {
          if (i === 0 && j === 0 && k === 0) continue;
          rho += w((i * i + j * j + k * k) * restSpacing * restSpacing);
        }
      }
    }
    this.rho0 = rho * (this.s.rhoScale ?? 0.65); // <1: compensa la falta de vecinas en la superficie libre
    this.wRef = w((0.2 * h) ** 2); // para la corrección de tensión
    // Aporte de pared: fracción de la masa del núcleo que cae del lado sólido de un plano a distancia d (tabla F y derivada dF).
    const steps = 64;
    const shell = 200;
    const total = (r) => w(r * r) * r * r;
    let all = 0;
    for (let n = 0; n < shell; n += 1) all += total(((n + 0.5) / shell) * h);
    const frac = new Float32Array(steps + 1);
    for (let k = 0; k <= steps; k += 1) {
      const d = (k / steps) * h;
      let part = 0;
      for (let n = 0; n < shell; n += 1) {
        const r = ((n + 0.5) / shell) * h;
        if (r > d) part += total(r) * (1 - d / r) * 0.5;
      }
      frac[k] = part / all;
    }
    this.wallFrac = frac;
    this.wallSteps = steps;
    this.wallD = new Float32Array(this.max);
    this.wallN = new Float32Array(this.max * 3);
  }

  // Distancia y normal (mundo) a la pared más cercana de cada partícula; solo cuenta si está a menos de h.
  findWalls() {
    const { count, h, x, wallD, wallN } = this;
    wallD.fill(h, 0, count);
    for (let b = 0; b < this.bodies.length; b += 1) {
      const body = this.bodies[b];
      const turned = body.movable && body.angle !== 0;
      const [kx, ky, kz] = body.axis ?? [0, 0, 1];
      const c = Math.cos(body.angle ?? 0);
      const s = Math.sin(body.angle ?? 0);
      for (let i = 0; i < count; i += 1) {
        const d = this.bodyDistance(body, x[i * 3], x[i * 3 + 1], x[i * 3 + 2]);
        if (d >= wallD[i]) continue;
        let gx = this.grad[0];
        let gy = this.grad[1];
        let gz = this.grad[2];
        const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (gl < 1e-6) continue;
        gx /= gl;
        gy /= gl;
        gz /= gl;
        if (turned) {
          const kd = kx * gx + ky * gy + kz * gz;
          const nx = gx * c + (ky * gz - kz * gy) * s + kx * kd * (1 - c);
          const ny = gy * c + (kz * gx - kx * gz) * s + ky * kd * (1 - c);
          const nz = gz * c + (kx * gy - ky * gx) * s + kz * kd * (1 - c);
          gx = nx;
          gy = ny;
          gz = nz;
        }
        wallD[i] = d;
        wallN[i * 3] = gx;
        wallN[i * 3 + 1] = gy;
        wallN[i * 3 + 2] = gz;
      }
    }
  }

  // Un paso de restricción de densidad (PBF): empuja las partículas apretadas hacia donde hay lugar. Solo comprime (no atrae).
  solveLiquid() {
    const { x, pairs, pairCount, count, lambda, rho, dp, gsum, h, rho0, poly6, spiky, wRef } = this;
    const h2 = h * h;
    const eps = 0.1; // relajación (CFM): en mm los gradientes del núcleo son O(1)
    rho.fill(poly6 * h2 ** 3, 0, count);
    gsum.fill(0, 0, count * 3);
    lambda.fill(0, 0, count);
    const g2 = this.g2 ?? (this.g2 = new Float32Array(this.max));
    g2.fill(0, 0, count);
    for (let n = 0; n < pairCount; n += 2) {
      const i = pairs[n];
      const j = pairs[n + 1];
      const dx = x[i * 3] - x[j * 3];
      const dy = x[i * 3 + 1] - x[j * 3 + 1];
      const dz = x[i * 3 + 2] - x[j * 3 + 2];
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 >= h2 || r2 < 1e-12) continue;
      const r = Math.sqrt(r2);
      const w = poly6 * (h2 - r2) ** 3;
      rho[i] += w;
      rho[j] += w;
      const k = (spiky * (h - r) ** 2) / (r * rho0);
      const gx = dx * k;
      const gy = dy * k;
      const gz = dz * k;
      gsum[i * 3] += gx;
      gsum[i * 3 + 1] += gy;
      gsum[i * 3 + 2] += gz;
      gsum[j * 3] -= gx;
      gsum[j * 3 + 1] -= gy;
      gsum[j * 3 + 2] -= gz;
      const mag = gx * gx + gy * gy + gz * gz;
      g2[i] += mag;
      g2[j] += mag;
    }
    this.findWalls();
    const { wallD, wallN, wallFrac, wallSteps } = this;
    const dStep = h / wallSteps;
    const offset = this.s.radius - this.restSpacing * 0.5;
    const dF = this.wallDF ?? (this.wallDF = new Float32Array(this.max));
    for (let i = 0; i < count; i += 1) {
      // la pared aporta densidad como si del otro lado hubiera líquido en reposo
      const d = Math.max(0, wallD[i] - offset);
      dF[i] = 0;
      if (d < h) {
        const q = d / dStep;
        const k = Math.min(wallSteps - 1, Math.floor(q));
        const f = wallFrac[k] + (wallFrac[k + 1] - wallFrac[k]) * (q - k);
        const slope = (wallFrac[k + 1] - wallFrac[k]) / dStep; // ≤ 0
        rho[i] += rho0 * f;
        dF[i] = slope;
        gsum[i * 3] += slope * wallN[i * 3];
        gsum[i * 3 + 1] += slope * wallN[i * 3 + 1];
        gsum[i * 3 + 2] += slope * wallN[i * 3 + 2];
        g2[i] += slope * slope;
      }
      const c = Math.max(0, rho[i] / rho0 - 1);
      const denom = g2[i] + gsum[i * 3] ** 2 + gsum[i * 3 + 1] ** 2 + gsum[i * 3 + 2] ** 2 + eps;
      lambda[i] = -c / denom;
    }
    dp.fill(0, 0, count * 3);
    const cohesion = this.s.cohesion;
    for (let n = 0; n < pairCount; n += 2) {
      const i = pairs[n];
      const j = pairs[n + 1];
      const dx = x[i * 3] - x[j * 3];
      const dy = x[i * 3 + 1] - x[j * 3 + 1];
      const dz = x[i * 3 + 2] - x[j * 3 + 2];
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 >= h2 || r2 < 1e-12) continue;
      const r = Math.sqrt(r2);
      const w = poly6 * (h2 - r2) ** 3;
      const sCorr = -cohesion * (w / wRef) ** 4; // corrección de tensión: evita grumos y da cohesión
      const k = ((lambda[i] + lambda[j] + sCorr) * spiky * (h - r) ** 2) / (r * rho0);
      dp[i * 3] += dx * k;
      dp[i * 3 + 1] += dy * k;
      dp[i * 3 + 2] += dz * k;
      dp[j * 3] -= dx * k;
      dp[j * 3 + 1] -= dy * k;
      dp[j * 3 + 2] -= dz * k;
    }
    for (let i = 0; i < count; i += 1) {
      const slope = dF[i];
      if (slope === 0) continue;
      dp[i * 3] += lambda[i] * slope * wallN[i * 3];
      dp[i * 3 + 1] += lambda[i] * slope * wallN[i * 3 + 1];
      dp[i * 3 + 2] += lambda[i] * slope * wallN[i * 3 + 2];
    }
    const limit = this.s.radius * 0.5; // corrección máxima por iteración (estabilidad)
    for (let i = 0; i < count; i += 1) {
      let ox = dp[i * 3];
      let oy = dp[i * 3 + 1];
      let oz = dp[i * 3 + 2];
      const m = Math.hypot(ox, oy, oz);
      if (m > limit) {
        const f = limit / m;
        ox *= f;
        oy *= f;
        oz *= f;
      }
      x[i * 3] += ox;
      x[i * 3 + 1] += oy;
      x[i * 3 + 2] += oz;
    }
  }

  // Viscosidad XSPH: cada partícula se alinea con la velocidad de sus vecinas.
  smoothVelocities() {
    const { v, x, pairs, pairCount, count, h, poly6 } = this;
    const c = this.s.viscosity;
    if (!(c > 0)) return;
    const h2 = h * h;
    const dv = this.dp;
    dv.fill(0, 0, count * 3);
    const w0 = poly6 * h2 ** 3;
    for (let n = 0; n < pairCount; n += 2) {
      const i = pairs[n];
      const j = pairs[n + 1];
      const dx = x[i * 3] - x[j * 3];
      const dy = x[i * 3 + 1] - x[j * 3 + 1];
      const dz = x[i * 3 + 2] - x[j * 3 + 2];
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 >= h2) continue;
      const w = (poly6 * (h2 - r2) ** 3) / w0;
      for (let k = 0; k < 3; k += 1) {
        const d = (v[j * 3 + k] - v[i * 3 + k]) * w * c;
        dv[i * 3 + k] += d;
        dv[j * 3 + k] -= d;
      }
    }
    for (let i = 0; i < count * 3; i += 1) v[i] += dv[i];
  }

  solveParticles() {
    if (this.liquid) return;
    const { radius, friction } = this.s;
    const diameter = radius * 2;
    // piel de contacto: dos granos que se tocan (después de resolver quedan a distancia exacta) siguen transmitiendo carga y fricción
    const skin = diameter * 1.03;
    const d2max = skin * skin;
    const { x, prev, pairs, pairCount } = this;
    for (let n = 0; n < pairCount; n += 2) {
      const i = pairs[n];
      const j = pairs[n + 1];
      const dx = x[i * 3] - x[j * 3];
      const dy = x[i * 3 + 1] - x[j * 3 + 1];
      const dz = x[i * 3 + 2] - x[j * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= d2max || d2 < 1e-12) continue;
      const sleepI = this.asleep[i];
      const sleepJ = this.asleep[j];
      if (sleepI && sleepJ) continue;
      // un grano dormido actúa como fijo: el despierto absorbe toda la corrección
      const wi = sleepI ? 0 : sleepJ ? 1 : 0.5;
      const wj = 1 - wi;
      const d = Math.sqrt(d2);
      const penetration = Math.max(0, diameter - d);
      this.contact[i] = 1;
      this.contact[j] = 1;
      // normal de contacto: la actual; si el grano se metió muy adentro (impacto rápido) la actual apunta para cualquier lado y el
      // empuje lo lanzaría de costado (salpicado): se usa entonces la dirección por la que venían, la del subpaso anterior
      let nxv = dx / d;
      let nyv = dy / d;
      let nzv = dz / d;
      if (penetration > diameter * 0.4) {
        const ex = prev[i * 3] - prev[j * 3];
        const ey = prev[i * 3 + 1] - prev[j * 3 + 1];
        const ez = prev[i * 3 + 2] - prev[j * 3 + 2];
        const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (el > 1e-9) {
          nxv = ex / el;
          nyv = ey / el;
          nzv = ez / el;
        }
      }
      x[i * 3] += nxv * penetration * wi;
      x[i * 3 + 1] += nyv * penetration * wi;
      x[i * 3 + 2] += nzv * penetration * wi;
      x[j * 3] -= nxv * penetration * wj;
      x[j * 3 + 1] -= nyv * penetration * wj;
      x[j * 3 + 2] -= nzv * penetration * wj;
      // Fricción de Coulomb con fuerza normal ACUMULADA entre pasadas: en las pasadas siguientes la penetración ya casi se
      // resolvió, pero la carga que sostiene el contacto sigue ahí (si no, los empujes laterales posteriores se escapan).
      const q = n >> 1;
      this.pairNormal[q] += penetration;
      const rx = x[i * 3] - prev[i * 3] - (x[j * 3] - prev[j * 3]);
      const ry = x[i * 3 + 1] - prev[i * 3 + 1] - (x[j * 3 + 1] - prev[j * 3 + 1]);
      const rz = x[i * 3 + 2] - prev[i * 3 + 2] - (x[j * 3 + 2] - prev[j * 3 + 2]);
      const rn = rx * nxv + ry * nyv + rz * nzv;
      const sx = rx - rn * nxv;
      const sy = ry - rn * nyv;
      const sz = rz - rn * nzv;
      const slide = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (slide < 1e-12) continue;
      // la carga del contacto es la mayor entre lo resuelto en las pasadas y el peso estimado de lo que hay encima (≈ ½ por contacto)
      const weight = (1 + Math.min(this.load[i], this.load[j])) * this.loadUnit * 0.5;
      const capacity = friction * Math.max(this.pairNormal[q], weight) - this.pairCut[q];
      if (capacity <= 0) continue;
      const used = Math.min(slide, capacity);
      this.pairCut[q] += used;
      const cut = used / slide;
      x[i * 3] -= sx * cut * wi;
      x[i * 3 + 1] -= sy * cut * wi;
      x[i * 3 + 2] -= sz * cut * wi;
      x[j * 3] += sx * cut * wj;
      x[j * 3 + 1] += sy * cut * wj;
      x[j * 3 + 2] += sz * cut * wj;
    }
  }

  // Colisión continua: un grano rápido (más de ½ radio por subpaso) puede saltar una chapa fina. Se recorre su tramo de `prev` a
  // `x` en pasos de ≤ 0,8 radio; si en algún punto toca un cuerpo, queda ahí, apoyado sobre la superficie (choque inelástico).
  sweepBodies(radius) {
    const { x, prev, count, grad } = this;
    const step = radius * 0.8;
    for (let i = 0; i < count; i += 1) {
      if (this.asleep[i]) continue;
      const a = i * 3;
      const dx = x[a] - prev[a];
      const dy = x[a + 1] - prev[a + 1];
      const dz = x[a + 2] - prev[a + 2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (length <= radius * 0.5) continue;
      const n = Math.ceil(length / step);
      for (let s = 1; s < n; s += 1) {
        const f = s / n;
        const px = prev[a] + dx * f;
        const py = prev[a + 1] + dy * f;
        const pz = prev[a + 2] + dz * f;
        let hit = false;
        for (let b = 0; b < this.bodies.length && !hit; b += 1) {
          const d = this.bodyDistance(this.bodies[b], px, py, pz);
          if (d >= radius * 0.9) continue;
          const gl = Math.sqrt((grad[0]) * (grad[0]) + (grad[1]) * (grad[1]) + (grad[2]) * (grad[2]));
          if (gl < 1e-6) continue;
          const push = Math.max(0, radius - d) / gl;
          // el gradiente está en el marco del cuerpo: para un cuerpo girado se lo lleva al mundo igual que en solveBodies
          let gx = grad[0] * push;
          let gy = grad[1] * push;
          let gz = grad[2] * push;
          const body = this.bodies[b];
          if (body.movable && body.angle !== 0) {
            const [kx, ky, kz] = body.axis;
            const c = Math.cos(body.angle);
            const sn = Math.sin(body.angle);
            const kd = kx * gx + ky * gy + kz * gz;
            const rx = gx * c + (ky * gz - kz * gy) * sn + kx * kd * (1 - c);
            const ry = gy * c + (kz * gx - kx * gz) * sn + ky * kd * (1 - c);
            const rz = gz * c + (kx * gy - ky * gx) * sn + kz * kd * (1 - c);
            gx = rx;
            gy = ry;
            gz = rz;
          }
          x[a] = px + gx;
          x[a + 1] = py + gy;
          x[a + 2] = pz + gz;
          hit = true;
        }
        if (hit) break;
      }
    }
  }

  // Carga de cada grano: cuántos granos en contacto hay apilados encima (en su misma columna de ancho 2·radio). En PBD el peso
  // baja solo ~1 capa por pasada del solver, así que la fuerza normal «vista» por el piso subestima la de una pila alta y la
  // fricción no la sostiene; el peso real se estima directamente. Se calcula una vez por cuadro.
  computeOverburden() {
    this.maxLoad = 0;
    if (this.s.overburden !== true || this.liquid || !this.grid || !(this.s.gravity > 0)) return; // opcional (por defecto apagada): traba los flujos
    const { x, count, load, order, contact } = this;
    load.fill(0, 0, count);
    const size = this.s.radius * 2;
    const lo = this.grid.lo;
    const nx = Math.ceil((this.grid.dims[0] * this.grid.cell) / size);
    const ny = Math.ceil((this.grid.dims[1] * this.grid.cell) / size);
    const keys = this.cellOf; // se reutiliza como clave temporal de columna (buildPairs la rehace en cada subpaso)
    if (!this.colStart || this.colStart.length < nx * ny + 1) {
      this.colStart = new Int32Array(nx * ny + 1);
      this.colFill = new Int32Array(nx * ny);
    }
    const table = this.colStart;
    const used = this.colFill;
    table.fill(0, 0, nx * ny + 1);
    used.fill(0, 0, nx * ny);
    for (let i = 0; i < count; i += 1) {
      let key = -1;
      if (contact[i]) {
        const cx = Math.floor((x[i * 3] - lo[0]) / size);
        const cy = Math.floor((x[i * 3 + 1] - lo[1]) / size);
        if (cx >= 0 && cy >= 0 && cx < nx && cy < ny) key = cx + nx * cy; // solo los granos apoyados cuentan como peso
      }
      keys[i] = key;
      if (key >= 0) table[key + 1] += 1;
    }
    for (let c = 0; c < nx * ny; c += 1) table[c + 1] += table[c];
    for (let i = 0; i < count; i += 1) {
      const c = keys[i];
      if (c < 0) continue;
      order[table[c] + used[c]] = i;
      used[c] += 1;
    }
    for (let c = 0; c < nx * ny; c += 1) {
      const from = table[c];
      const to = table[c + 1];
      // orden por altura descendente (columnas chicas: inserción); el rango en la columna = granos apilados encima
      for (let a = from + 1; a < to; a += 1) {
        const item = order[a];
        const z = x[item * 3 + 2];
        let b = a - 1;
        while (b >= from && x[order[b] * 3 + 2] < z) {
          order[b + 1] = order[b];
          b -= 1;
        }
        order[b + 1] = item;
      }
      const cap = this.s.overburdenMax ?? 99; // Janssen: con la profundidad la presión sobre el contacto satura (la pared sostiene parte del peso)
      for (let a = from; a < to; a += 1) load[order[a]] = Math.min(a - from, cap);
      if (to - from - 1 > this.maxLoad) this.maxLoad = to - from - 1;
    }
  }

  // Estabilización (Macklin et al.): las superposiciones que quedan de un subpaso (la pila comprimida por su propio peso) se
  // resuelven moviendo la posición Y la posición previa por igual, así la corrección no se convierte en velocidad y la pila deja
  // de «fluir» hacia los costados. Usa la lista de pares del subpaso anterior.
  stabilize() {
    if (this.liquid || !this.grid || this.pairCount === 0) return;
    const { x, prev, pairs, pairCount, count } = this;
    const diameter = this.s.radius * 2;
    const d2max = diameter * diameter;
    for (let n = 0; n < pairCount; n += 2) {
      const i = pairs[n];
      const j = pairs[n + 1];
      if (i >= count || j >= count) continue;
      const dx = x[i * 3] - x[j * 3];
      const dy = x[i * 3 + 1] - x[j * 3 + 1];
      const dz = x[i * 3 + 2] - x[j * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= d2max || d2 < 1e-12) continue;
      const d = Math.sqrt(d2);
      const push = ((diameter - d) / d) * 0.5;
      for (let k = 0; k < 3; k += 1) {
        const move = (k === 0 ? dx : k === 1 ? dy : dz) * push;
        x[i * 3 + k] += move;
        prev[i * 3 + k] += move;
        x[j * 3 + k] -= move;
        prev[j * 3 + k] -= move;
      }
    }
  }

  solveBodies(dt) {
    const { radius, wallFriction } = this.s;
    const { x, prev, count, grad } = this;
    this.bodies.forEach((body) => {
      const { sdf } = body;
      const moving = body.movable;
      const turned = moving && body.angle !== 0;
      const [kx, ky, kz] = body.axis;
      const [px, py, pz] = body.pivot;
      const [ox, oy, oz] = body.offset;
      const c = Math.cos(body.angle);
      const s = Math.sin(body.angle);
      const shifted = moving && (ox !== 0 || oy !== 0 || oz !== 0);
      for (let i = 0; i < count; i += 1) {
        if (this.asleep[i]) continue;
        let lx = x[i * 3];
        let ly = x[i * 3 + 1];
        let lz = x[i * 3 + 2];
        if (moving) {
          // al marco del cuerpo: se quita el desplazamiento y se gira −ángulo alrededor del eje por el pivote
          const rx = lx - ox - px;
          const ry = ly - oy - py;
          const rz = lz - oz - pz;
          if (turned) {
            const kd = kx * rx + ky * ry + kz * rz;
            lx = px + rx * c - (ky * rz - kz * ry) * s + kx * kd * (1 - c);
            ly = py + ry * c - (kz * rx - kx * rz) * s + ky * kd * (1 - c);
            lz = pz + rz * c - (kx * ry - ky * rx) * s + kz * kd * (1 - c);
          } else if (shifted) {
            lx = px + rx;
            ly = py + ry;
            lz = pz + rz;
          }
        }
        const d = sampleSdf(sdf, lx, ly, lz, grad);
        if (d >= radius * 1.03) continue; // piel: un grano apoyado justo en la pared sigue sosteniendo carga y fricción
        let gx = grad[0];
        let gy = grad[1];
        let gz = grad[2];
        const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (gl < 1e-6) continue;
        gx /= gl;
        gy /= gl;
        gz /= gl;
        if (turned) {
          // normal al marco del mundo: giro de +ángulo
          const kd = kx * gx + ky * gy + kz * gz;
          const nx = gx * c + (ky * gz - kz * gy) * s + kx * kd * (1 - c);
          const ny = gy * c + (kz * gx - kx * gz) * s + ky * kd * (1 - c);
          const nz = gz * c + (kx * gy - ky * gx) * s + kz * kd * (1 - c);
          gx = nx;
          gy = ny;
          gz = nz;
        }
        const depth = Math.max(0, radius - d);
        x[i * 3] += gx * depth;
        x[i * 3 + 1] += gy * depth;
        x[i * 3 + 2] += gz * depth;
        if ((body.rotorSpec || body.linkRoot) && depth > 0) this.accumulateTorque(body, i, gx * depth, gy * depth, gz * depth, dt);
        // Fricción con la pared (móvil o fija): desplazamiento relativo a la superficie, parte tangencial.
        let sx = 0;
        let sy = 0;
        let sz = 0;
        if (moving) {
          const wx = x[i * 3] - ox - px;
          const wy = x[i * 3 + 1] - oy - py;
          const wz = x[i * 3 + 2] - oz - pz;
          sx = (body.vel[0] + body.surf[0] + (ky * wz - kz * wy) * body.omega) * dt;
          sy = (body.vel[1] + body.surf[1] + (kz * wx - kx * wz) * body.omega) * dt;
          sz = (body.vel[2] + body.surf[2] + (kx * wy - ky * wx) * body.omega) * dt;
        }
        const ex = x[i * 3] - prev[i * 3] - sx;
        const ey = x[i * 3 + 1] - prev[i * 3 + 1] - sy;
        const ez = x[i * 3 + 2] - prev[i * 3 + 2] - sz;
        const en = ex * gx + ey * gy + ez * gz;
        this.contact[i] = 1;
        // Coulomb: el deslizamiento tangencial se anula hasta μ_pared × penetración (estática), más allá solo esa parte
        const tx = ex - en * gx;
        const ty = ey - en * gy;
        const tz = ez - en * gz;
        const slide = Math.sqrt(tx * tx + ty * ty + tz * tz);
        this.wallNormal[i] += depth;
        const capacity = wallFriction * Math.max(this.wallNormal[i], (1 + this.load[i]) * this.loadUnit) - this.wallCut[i];
        if (slide > 1e-12 && capacity > 0) {
          const used = Math.min(slide, capacity);
          this.wallCut[i] += used;
          const cut = used / slide;
          x[i * 3] -= tx * cut;
          x[i * 3 + 1] -= ty * cut;
          x[i * 3 + 2] -= tz * cut;
          if (body.rotorSpec || body.linkRoot) this.accumulateTorque(body, i, -tx * cut, -ty * cut, -tz * cut, dt);
        }
      }
    });
  }

  // Par (N·m) que el grano i le devuelve al cuerpo por el empuje (dx,dy,dz) mm que la pared le dio al grano en este subpaso.
  // F = m·Δx/h² sobre el grano; el cuerpo recibe −F. Se proyecta sobre el eje por el pivote.
  accumulateTorque(body, i, dx, dy, dz, h) {
    const mass = this.parcelMass();
    const k = (-mass * 1e-6) / (h * h); // mm → m al cuadrado (brazo y desplazamiento)
    const rx = this.x[i * 3] - body.offset[0] - body.pivot[0];
    const ry = this.x[i * 3 + 1] - body.offset[1] - body.pivot[1];
    const rz = this.x[i * 3 + 2] - body.offset[2] - body.pivot[2];
    const [kx, ky, kz] = body.axis;
    body.torqueAcc += k * (kx * (ry * dz - rz * dy) + ky * (rz * dx - rx * dz) + kz * (rx * dy - ry * dx));
  }

  // Integra la dinámica de cada eje (motor, fricción, inercia) un subpaso `h` con el par que hicieron los granos.
  advanceRotors(h) {
    // la carga de los granos sobre un eje conducido llega al eje motor por la relación (y el rendimiento) de la transmisión
    this.bodies.forEach((body) => {
      if (!body.linkRoot) return;
      const root = this.bodyByKey.get(body.linkRoot.rootKey);
      if (root) root.torqueAcc += body.linkRoot.factor * body.torqueAcc;
      body.torqueAcc = 0;
    });
    this.bodies.forEach((body) => {
      const spec = body.rotorSpec;
      if (!spec) return;
      const state = this.rotors.get(body.key);
      if (!state) return;
      state.filtered += (body.torqueAcc - state.filtered) * Math.min(1, h / 0.02); // los granos dan un par muy ruidoso: pasabajos de 20 ms
      body.torqueAcc = 0;
      stepRotor(state, spec.params, spec.target, -state.filtered, h);
    });
  }

  // Lecturas de los ejes con dinámica (loadTorque positivo = los granos frenan el giro): rpm, par del motor, par de carga de los granos, fricción.
  rotorInfo() {
    const out = [];
    this.rotors.forEach((state, key) => {
      out.push({ key, rated: this.bodyByKey.get(key)?.rotorSpec?.params.rated ?? 0, rpm: (state.omega * 60) / (2 * Math.PI), motorTorque: state.motorTorque, loadTorque: -state.filtered, frictionTorque: state.frictionTorque, stuck: state.stuck });
    });
    this.followKeys.forEach((key) => {
      const body = this.bodyByKey.get(key);
      if (body) out.push({ key, rpm: (body.omega * 60) / (2 * Math.PI), follower: true, motorTorque: 0, loadTorque: 0, frictionTorque: 0, stuck: false });
    });
    return out;
  }

  // Un paso de `dt` segundos (se divide en subpasos para que el filete no sea atravesado).
  step(dt) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const { radius, gravity, wind, drag, damping, floorZ } = this.s;
    this.applyScene(this.time);
    const rim = this.bodies.reduce((m, body) => (body.movable ? Math.max(m, Math.abs(body.omega) * body.radiusMax + Math.hypot(...body.vel) + Math.hypot(...body.surf)) : m), 0);
    this.rimSpeed = rim;
    // La vibración se muestrea a ≥10 puntos por ciclo (hasta el tope de 12 subpasos).
    const vibHz = this.actions.reduce((m, action) => (action.kind === 'vibrate' && action.targets?.length ? Math.max(m, Number(action.freq) || 0) : m), 0);
    const sub = Math.min(12, Math.max(4, Math.ceil((rim * dt) / (0.7 * radius)), Math.ceil(dt * vibHz * 10)));
    const h = dt / sub;
    const vmax = Math.max((0.9 * radius) / h, this.s.maxSpeed ?? 40000); // tope físico; las paredes las cuida el barrido (sweepBodies)
    const { x, prev, v } = this;
    if (!this.airPending()) {
      this.spawn(dt);
      this.spawnProducts(dt);
    }
    this.frameStart.set(this.x.subarray(0, this.count * 3));
    this.computeOverburden();
    this.loadUnit = gravity * h * h;
    const settling=!!this.hopper&&this.time<this.hopper.options.settleSeconds;
    const gridAir = !!this.air && !settling;
    const airStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (gridAir) this.updateAir(dt);
    const airSpent = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - airStart;
    const jets = !settling && !gridAir && this.nozzles.length > 0;
    // chorros analíticos o viento parejo sin grilla: no hay campo por grano para decidir quién despega, se despierta todo
    if (this.sleepers && (jets || (!gridAir && Math.hypot(...wind) > this.liftSpeed))) this.wakeAll();
    const physical = !this.liquid && this.s.physicalDrag !== false && this.s.grain > 0 && this.s.density > 0; // Schiller-Naumann / Wen-Yu / Ergun con el grano real
    const grainM = this.s.grain / 1000;
    const grainRho = this.s.density;
    const air = [0, 0, 0];
    const shadow = jets ? (nozzle, px, py, pz) => this.blocked(nozzle, px, py, pz) : null;
    for (let n = 0; n < sub; n += 1) {
      const dragK = Math.min(1, drag * h);
      this.applyScene(this.time + n * h);
      if (this.s.stabilize === true) this.stabilize(); // desactivada: sus empujes laterales no pasan por la fricción del piso y la pila se abre
      for (let i = 0; i < this.count; i += 1) {
        if (this.asleep[i]) continue;
        const a = i * 3;
        let wx = settling ? 0 : wind[0];
        let wy = settling ? 0 : wind[1];
        let wz = settling ? 0 : wind[2];
        if (gridAir) {
          wx = this.airVel[a];
          wy = this.airVel[a + 1];
          wz = this.airVel[a + 2];
        } else if (jets) {
          this.airAt(x[a], x[a + 1], x[a + 2], air, n === 0 ? shadow : null);
          wx += air[0];
          wy += air[1];
          wz += air[2];
        }
        let k = dragK;
        if (physical) {
          const slip = Math.sqrt((wx - v[a]) * (wx - v[a]) + (wy - v[a + 1]) * (wy - v[a + 1]) + (wz - v[a + 2]) * (wz - v[a + 2])) / 1000;
          k = 1 - Math.exp(-relaxation(grainM, grainRho, slip, this.pEps[i]) * h); // exacto aunque el arrastre sea muy rígido
        }
        v[a] += (wx - v[a]) * k;
        v[a + 1] += (wy - v[a + 1]) * k;
        v[a + 2] += (wz - v[a + 2]) * k - gravity * h;
        prev[a] = x[a];
        prev[a + 1] = x[a + 1];
        prev[a + 2] = x[a + 2];
        x[a] += v[a] * h;
        x[a + 1] += v[a + 1] * h;
        x[a + 2] += v[a + 2] * h;
      }
      for (let i = 0; i < this.count; i += 1) this.contact[i] = this.asleep[i];
      this.sweepBodies(radius);
      this.buildPairs();
      if (this.liquid) {
        const passes = this.s.liquidPasses ?? 3;
        for (let pass = 0; pass < passes; pass += 1) {
          this.solveLiquid();
          this.solveBodies(h);
        }
      } else {
        // se termina siempre con las paredes: un empuje entre granos en la última pasada no debe escapar de la fricción del piso
        // una pila de N granos de alto necesita ~N/1,5 pasadas para transmitir su peso hasta el piso: se adapta a la altura real
        const passes = this.s.contactPasses ?? Math.min(10, Math.max(3, 3 + Math.ceil(this.maxLoad / 1.5)));
        for (let pass = 0; pass < passes; pass += 1) {
          this.solveParticles();
          this.solveBodies(h);
        }
      }
      if(settling){
        const bottom=this.hopper.minZ-this.s.radius;
        for(let i=0;i<this.count;i++)if(x[i*3+2]<bottom)x[i*3+2]=bottom;
      }
      const keepContact = Math.max(0, 1 - damping * h);
      for (let i = 0; i < this.count; i += 1) {
        if (this.asleep[i]) continue;
        const a = i * 3;
        // la amortiguación (pérdida de energía en choques y rodadura) vale solo con contacto: en vuelo manda el arrastre del aire
        const keep = this.contact[i] || this.liquid ? keepContact : 1;
        let vx = ((x[a] - prev[a]) / h) * keep;
        let vy = ((x[a + 1] - prev[a + 1]) / h) * keep;
        let vz = ((x[a + 2] - prev[a + 2]) / h) * keep;
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (speed > vmax) {
          const f = vmax / speed;
          vx *= f;
          vy *= f;
          vz *= f;
        }
        v[a] = vx;
        v[a + 1] = vy;
        v[a + 2] = vz;
      }
      this.advanceRotors(h);
      if (this.rigid.count) this.rigid.step(h, this.productEnv);
      if (this.liquid) this.smoothVelocities();
    }
    this.time += dt;
    this.cullExits(floorZ);
    if (this.rigid.count) this.cullProducts(floorZ);
    this.updateSleep();
    this.countSensors();
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.stepMs = this.stepMs ? this.stepMs * 0.9 + (t1 - t0) * 0.1 : t1 - t0;
    // costo de las partículas solas (sin el aire) para decidir el tope; el aire se regula con airEvery
    this.partMs = this.partMs ? this.partMs * 0.9 + (t1 - t0 - airSpent) * 0.1 : t1 - t0 - airSpent;
  }

  // Consulta del entorno para los productos: distancia con signo al material más cercano, su normal (mundo) y la velocidad de la
  // superficie en ese punto (cuerpo móvil: traslación + giro + cinta).
  envQuery(px, py, pz, out) {
    let best = Infinity;
    let found = false;
    const grad = this.grad;
    for (let b = 0; b < this.bodies.length; b += 1) {
      const body = this.bodies[b];
      let lx = px;
      let ly = py;
      let lz = pz;
      let c = 1;
      let s = 0;
      const moving = body.movable;
      if (moving) {
        const [kx, ky, kz] = body.axis;
        const rx = px - body.offset[0] - body.pivot[0];
        const ry = py - body.offset[1] - body.pivot[1];
        const rz = pz - body.offset[2] - body.pivot[2];
        if (body.angle !== 0) {
          c = Math.cos(body.angle);
          s = Math.sin(body.angle);
          const kd = kx * rx + ky * ry + kz * rz;
          lx = body.pivot[0] + rx * c - (ky * rz - kz * ry) * s + kx * kd * (1 - c);
          ly = body.pivot[1] + ry * c - (kz * rx - kx * rz) * s + ky * kd * (1 - c);
          lz = body.pivot[2] + rz * c - (kx * ry - ky * rx) * s + kz * kd * (1 - c);
        } else {
          lx = body.pivot[0] + rx;
          ly = body.pivot[1] + ry;
          lz = body.pivot[2] + rz;
        }
      }
      const d = sampleSdf(body.sdf, lx, ly, lz, grad);
      if (d >= best) continue;
      best = d;
      found = true;
      let nx = grad[0];
      let ny = grad[1];
      let nz = grad[2];
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      let vx = 0;
      let vy = 0;
      let vz = 0;
      if (moving) {
        if (body.angle !== 0) {
          const [kx, ky, kz] = body.axis;
          const kd = kx * nx + ky * ny + kz * nz;
          const tx = nx * c + (ky * nz - kz * ny) * s + kx * kd * (1 - c);
          const ty = ny * c + (kz * nx - kx * nz) * s + ky * kd * (1 - c);
          const tz = nz * c + (kx * ny - ky * nx) * s + kz * kd * (1 - c);
          nx = tx;
          ny = ty;
          nz = tz;
        }
        const [kx, ky, kz] = body.axis;
        const wx = px - body.offset[0] - body.pivot[0];
        const wy = py - body.offset[1] - body.pivot[1];
        const wz = pz - body.offset[2] - body.pivot[2];
        vx = body.vel[0] + body.surf[0] + (ky * wz - kz * wy) * body.omega;
        vy = body.vel[1] + body.surf[1] + (kz * wx - kx * wz) * body.omega;
        vz = body.vel[2] + body.surf[2] + (kx * wy - ky * wx) * body.omega;
      }
      out.d = d;
      out.nx = nx;
      out.ny = ny;
      out.nz = nz;
      out.vx = vx;
      out.vy = vy;
      out.vz = vz;
    }
    return found && best < 6;
  }

  // Aparición de productos: cada alimentador suelta una caja cada `every` s mientras haya menos de `max` vivas y el lugar esté libre.
  spawnProducts(dt) {
    this.feeders.forEach((feeder) => {
      feeder.timer += dt;
      if (this.time < feeder.start) return;
      if (feeder.timer < feeder.every) return;
      const alive = this.rigid.bodies.filter((body) => body.group === feeder.id).length;
      if (alive >= feeder.max) return;
      const free = this.rigid.bodies.every((other) => Math.hypot(other.x[0] - feeder.pos[0], other.x[1] - feeder.pos[1], other.x[2] - feeder.pos[2]) > Math.max(...feeder.size) * 0.9 + other.reach * 0.3);
      if (!free) return;
      feeder.timer = 0;
      feeder.spawned += 1;
      this.rigid.add({ pos: feeder.pos, quat: quatFromYaw(feeder.yaw), size: feeder.size, mass: feeder.mass, friction: feeder.friction, group: feeder.id });
    });
  }

  // Cajas que cayeron bajo el piso de la escena (o salieron de la zona útil) se retiran y se cuentan.
  cullProducts(floorZ) {
    this.rigid.bodies.slice().forEach((body) => {
      if (body.x[2] < floorZ || !Number.isFinite(body.x[0] + body.x[1] + body.x[2])) {
        this.rigid.remove(body);
        this.productsExited += 1;
      }
    });
  }

  productSnapshot() {
    return this.rigid.snapshot();
  }

  // Sueño de granos (como el sleeping de los motores físicos): un grano apoyado que casi no se mueve durante ~⅓ s se congela. Así
  // la pila en reposo no se hunde con el creep de PBD y no cuesta nada. Se despierta si un vecino en movimiento lo toca, si un
  // cuerpo móvil se le acerca o si el aire lo despegaría.
  updateSleep() {
    if (this.s.sleep === false || this.liquid) return;
    const { x, frameStart, count, asleep, calm, v, prev, contact, disp } = this;
    const radius = this.s.radius;
    const calmDisp = radius * 0.02;
    const needFrames = this.s.sleepFrames ?? 20;
    let sleepers = 0;
    for (let i = 0; i < count; i += 1) {
      if (asleep[i]) {
        sleepers += 1;
        disp[i] = 0;
        continue;
      }
      const a = i * 3;
      const dx = x[a] - frameStart[a];
      const dy = x[a + 1] - frameStart[a + 1];
      const dz = x[a + 2] - frameStart[a + 2];
      const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
      disp[i] = moved;
      if (contact[i] && moved < calmDisp) {
        calm[i] += 1;
        if (calm[i] >= needFrames) {
          asleep[i] = 1;
          v[a] = 0;
          v[a + 1] = 0;
          v[a + 2] = 0;
          prev[a] = x[a];
          prev[a + 1] = x[a + 1];
          prev[a + 2] = x[a + 2];
          sleepers += 1;
        }
      } else calm[i] = 0;
    }
    this.sleepers = sleepers;
    if (!sleepers) return;
    // un vecino que se mueve despierta al dormido que toca (la perturbación se propaga capa por capa)
    const wakeDisp = radius * 0.4;
    const { pairs, pairCount } = this;
    for (let n = 0; n < pairCount; n += 2) {
      const i = pairs[n];
      const j = pairs[n + 1];
      if (i >= count || j >= count || asleep[i] === asleep[j]) continue;
      const awake = asleep[i] ? j : i;
      if (disp[awake] > wakeDisp) this.wake(asleep[i] ? i : j);
    }
    // cuerpos móviles (tornillo, compuerta, vibración): despiertan lo que tienen cerca
    this.bodies.forEach((body) => {
      const surfing = body.surf && (body.surf[0] !== 0 || body.surf[1] !== 0 || body.surf[2] !== 0);
      if (!body.movable || (!surfing && Math.abs(body.omega) < 1e-9 && Math.hypot(body.vel[0], body.vel[1], body.vel[2]) < 1e-9)) return;
      for (let i = 0; i < count; i += 1) {
        if (!asleep[i]) continue;
        if (this.bodyDistance(body, x[i * 3], x[i * 3 + 1], x[i * 3 + 2]) < radius * 3) this.wake(i);
      }
    });
  }

  wake(i) {
    this.asleep[i] = 0;
    this.calm[i] = 0;
  }

  wakeAll() {
    this.asleep.fill(0, 0, this.count);
    this.calm.fill(0, 0, this.count);
  }

  // Partículas que cayeron bajo el piso (o salieron de la zona útil) se retiran y se cuentan.
  cullExits(floorZ) {
    const { x, prev, v } = this;
    let write = 0;
    for (let i = 0; i < this.count; i += 1) {
      const a = i * 3;
      if (x[a + 2] < floorZ || !Number.isFinite(x[a])) {
        this.exited += 1;
        this.exitSum[0] += prev[a];
        this.exitSum[1] += prev[a + 1];
        this.exitSum[2] += prev[a + 2];
        this.exitWindow.push(this.time);
        if (this.exitTimes.length < 20000) this.exitTimes.push(this.time); // solo se consultan las primeras salidas (disparo «cuando salieron N»)
        continue;
      }
      if (write !== i) {
        const b = write * 3;
        x[b] = x[a];
        x[b + 1] = x[a + 1];
        x[b + 2] = x[a + 2];
        prev[b] = prev[a];
        prev[b + 1] = prev[a + 1];
        prev[b + 2] = prev[a + 2];
        v[b] = v[a];
        v[b + 1] = v[a + 1];
        v[b + 2] = v[a + 2];
        this.asleep[write] = this.asleep[i];
        this.calm[write] = this.calm[i];
      }
      write += 1;
    }
    this.count = write;
    while (this.exitWindow.length && this.exitWindow[0] < this.time - 1) this.exitWindow.shift();
  }

  // Partículas dentro de cada sensor; registra cuándo se alcanzó cada umbral usado por una acción.
  countSensors() {
    const counts = {};
    const { x, count } = this;
    this.sensors.forEach((sensor) => {
      let inside = 0;
      const { min, max } = sensor;
      for (let i = 0; i < count; i += 1) {
        const a = i * 3;
        if (x[a] >= min[0] && x[a] <= max[0] && x[a + 1] >= min[1] && x[a + 1] <= max[1] && x[a + 2] >= min[2] && x[a + 2] <= max[2]) inside += 1;
      }
      if (sensor.counts === 'productos') inside = 0;
      if (sensor.counts === 'productos' || sensor.counts === 'todo') {
        this.rigid.bodies.forEach((body) => {
          if (body.x[0] >= min[0] && body.x[0] <= max[0] && body.x[1] >= min[1] && body.x[1] <= max[1] && body.x[2] >= min[2] && body.x[2] <= max[2]) inside += 1;
        });
      }
      counts[sensor.id] = inside;
    });
    this.sensorCounts = counts;
    this.actions.forEach((action) => {
      const start = action.start;
      if (start?.type !== 'zone' || !start.sensor) return;
      const key = `${start.sensor}:${Number(start.n) || 1}`;
      const reached = (counts[start.sensor] ?? 0) >= (Number(start.n) || 1);
      if (!this.zoneReached.has(key) && reached) this.zoneReached.set(key, this.time);
      if (reached && !this.zoneAbove.get(key)) this.zoneLast.set(key, this.time); // flanco ascendente: se rearma al bajar del umbral
      this.zoneAbove.set(key, reached);
    });
  }

  // Salida reciente: partículas/s y volumen aparente (con ~60 % de compacidad) en mm³/s.
  exitRate() {
    const perSecond = this.exitWindow.length;
    const grain = (4 / 3) * Math.PI * this.s.radius ** 3;
    return { perSecond, volumePerSecond: (perSecond * grain) / 0.6 };
  }

  // Adapta el tope de partículas al costo medido (objetivo ≈ 9 ms por cuadro de 16,7 ms).
  adapt() {
    if (this.air && !this.solverMode) {
      // si resolver el aire cuesta mucho por cuadro, se resuelve más espaciado
      if (this.air.stepCost > 14 && this.s.airEvery < 8) this.s.airEvery += 1;
      else if (this.air.stepCost < 6 && this.s.airEvery > 4) this.s.airEvery -= 1;
    }
    const cost = this.partMs ?? this.stepMs;
    if (cost > 11 && this.cap > 500) this.cap = Math.max(500, Math.floor(this.cap * 0.9));
    else if (cost < 5 && this.cap < Math.min(this.s.cap, this.max)) this.cap = Math.min(this.s.cap, this.max, Math.ceil(this.cap * 1.05));
    // sobrecarga sostenida: el tope por tiempo de paso no alcanza si ya hay más granos de los que el equipo mueve (por ejemplo, al despertar
    // una pila entera). Se baja el tope por debajo de la cantidad actual para que no entren más y se avisa en el panel.
    this.overloadFrames = this.stepMs > 45 ? (this.overloadFrames ?? 0) + 1 : Math.max(0, (this.overloadFrames ?? 0) - 2);
    if (this.overloadFrames > 30 && this.count > 500) {
      this.cap = Math.max(500, Math.floor(this.count * 0.85));
      this.overloadFrames = 0;
      this.capNote = `Equipo al límite (${Math.round(this.stepMs)} ms por paso): tope bajado a ${this.cap} partículas`;
    } else if (this.cap < Math.min(this.s.cap, this.max) * 0.5 && cost > 11) {
      this.capNote = `El tope se adaptó a ${this.cap} partículas para mantener la fluidez`;
    } else if (this.cap >= Math.min(this.s.cap, this.max) * 0.9) this.capNote = '';
  }

  // Vuelve a cero lo que acumula la dinámica (ejes, pares, listas de salida) al reiniciar sin recrear la simulación.
  resetDynamics() {
    this.rotors.clear();
    this.plug.clear();
    this.rigid.clear();
    this.zoneLast.clear();
    this.zoneAbove.clear();
    this.productsExited = 0;
    this.feeders.forEach((feeder) => { feeder.timer = feeder.start ?? 0; feeder.spawned = 0; });
    this.bodies.forEach((body) => { body.torqueAcc = 0; });
    this.overloadFrames = 0;
    this.capNote = '';
  }

  snapshot() {
    const out = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i += 1) {
      const a = i * 3;
      out[i * 4] = this.x[a];
      out[i * 4 + 1] = this.x[a + 1];
      out[i * 4 + 2] = this.x[a + 2];
      out[i * 4 + 3] = Math.hypot(this.v[a], this.v[a + 1], this.v[a + 2]);
    }
    return out;
  }
}
