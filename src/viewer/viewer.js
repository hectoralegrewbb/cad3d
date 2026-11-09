import * as THREE from 'three';
import { OrbitControls } from '../../vendor/three/OrbitControls.js';
import { sliceToRgba } from '../particles/colormap.js';

// Visor 3D (Z arriba, como en CAD). Mallas de caras + aristas elegibles.
const colors = { bodyLight: 0x9fb4cc, edge: 0x1b2330, edgeHover: 0xffb020, edgeSelected: 0xff5a36, bg: 0x1d222b };

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(colors.bg);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(160, -220, 150);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(200, -150, 300);
    this.scene.add(sun);

    this.grid = new THREE.GridHelper(400, 40, 0x3b4658, 0x2a3240);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);
    this.scene.add(new THREE.AxesHelper(40));

    this.guideGroup = new THREE.Group();
    this.guideLabels = [];
    this.meshListeners = [];
    this.modelGroup = new THREE.Group();
    this.edgeGroup = new THREE.Group();
    this.overlayGroup = new THREE.Group();
    this.threadGroup = new THREE.Group();
    this.axisGroup = new THREE.Group();
    this.particleGroup = new THREE.Group();
    this.nozzleGroup = new THREE.Group();
    this.sensorGroup = new THREE.Group();
    this.renderMode = 'solid';
    this.scene.add(this.guideGroup, this.modelGroup, this.edgeGroup, this.overlayGroup, this.threadGroup, this.axisGroup, this.particleGroup, this.nozzleGroup, this.sensorGroup);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 1.2;
    this.pickEnabled = false;
    this.hoverEdge = null;
    this.selectedMids = [];
    this.onEdgePick = null;
    this.bounds = null;

    canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); this.onContextError?.('Se perdió el contexto gráfico. Esperá su recuperación o recargá después de guardar.'); });
    canvas.addEventListener('webglcontextrestored', () => { this.render(); this.onContextError?.('Contexto gráfico recuperado'); });
    canvas.addEventListener('pointercancel', () => { this.downAt = null; this.cancelPlacement(); });
    canvas.addEventListener('pointermove', (event) => this.handleMove(event));
    canvas.addEventListener('pointerdown', (event) => (this.downAt = { x: event.clientX, y: event.clientY }));
    canvas.addEventListener('pointerup', (event) => this.handleUp(event));
    this.controls.addEventListener('change', () => this.render());
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.canvas.parentElement;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    if (this.camera.isOrthographicCamera) {
      const half = (this.camera.top - this.camera.bottom) / 2;
      this.camera.left = -half * width / height; this.camera.right = half * width / height;
    } else this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    if (this.renderFrame) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.renderer.render(this.scene, this.camera); this.layoutLabels();
    });
  }

  setProjection(orthographic) {
    if (Boolean(this.camera.isOrthographicCamera) === Boolean(orthographic)) return;
    const old = this.camera;
    const aspect = Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight);
    const half = old.isOrthographicCamera ? old.top / old.zoom : old.position.distanceTo(this.controls.target) * Math.tan(35*Math.PI/360);
    this.camera = orthographic ? new THREE.OrthographicCamera(-half*aspect, half*aspect, half, -half, 0.1, 100000) : new THREE.PerspectiveCamera(35, aspect, 0.1, 100000);
    this.camera.position.copy(old.position); this.camera.up.copy(old.up);
    this.controls.object = this.camera; this.controls.update(); this.render();
  }

  setQuality(level) {
    const ratio = { low: 1, medium: 1.5, high: 2 }[level];
    if (!ratio) throw new Error('Calidad inválida');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratio)); this.resize();
  }

  setSection(axis = null, fraction = 0.5, reverse = false) {
    if (axis === null || !this.bounds) this.renderer.clippingPlanes = [];
    else {
      if (![0,1,2].includes(axis) || !Number.isFinite(fraction)) throw new Error('Plano de corte inválido');
      const normal = new THREE.Vector3(); normal.setComponent(axis, reverse ? -1 : 1);
      const position = this.bounds.min[axis] + this.bounds.size[axis] * Math.max(0, Math.min(1, fraction));
      this.renderer.clippingPlanes = [new THREE.Plane(normal, -position * (reverse ? -1 : 1))];
    }
    this.render();
  }

  setItemHidden(id, hidden=true) {
    this.hiddenItems??=new Set();if(hidden)this.hiddenItems.add(id);else this.hiddenItems.delete(id);
    this.applyRenderMode();this.syncEdgeMode();this.render();
  }
  restoreItems() {this.hiddenItems=new Set();this.applyRenderMode();this.syncEdgeMode();this.render();}
  previewPlacement(id, transform) {
    const matrix=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...transform.rot.map(v=>v*Math.PI/180),'ZYX'));matrix.setPosition(...transform.pos);
    for(const object of [...this.modelGroup.children,...this.edgeGroup.children])if(object.userData.itemId===id){object.matrixAutoUpdate=false;object.matrix.copy(matrix);object.matrixWorldNeedsUpdate=true;}
    this.render();
  }
  clearPlacementPreview() {
    for(const object of [...this.modelGroup.children,...this.edgeGroup.children])if(object.userData.baseMatrix){object.matrix.copy(object.userData.baseMatrix);object.matrixWorldNeedsUpdate=true;}
    this.render();
  }
  edgeAt(event) {
    this.rayFromEvent(event);
    let best=null,distance=Infinity;
    const a=new THREE.Vector3(),b=new THREE.Vector3();
    for(const edge of this.edgeRecords??[]){if(this.hiddenItems?.has(edge.itemId))continue;for(let i=3;i<edge.points.length;i+=3){a.fromArray(edge.points,i-3);b.fromArray(edge.points,i);const d=this.raycaster.ray.distanceSqToSegment(a,b);if(d<distance){distance=d;best=edge;}}}
    const hit=this.surfaceAt(event);const tolerance=this.unitsPerPixel(hit?.point??this.controls.target.toArray())*8;
    return distance<tolerance*tolerance?best:null;
  }
  measureBetween(a, b) {
    const delta = b.point.map((v,k) => v-a.point[k]);
    const dot = a.normal.reduce((sum,v,k)=>sum+v*b.normal[k],0);
    return { distance: Math.hypot(...delta), delta, angle: Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI };
  }

  clearGroup(group) {
    const disposed=new Set();
    [...group.children].forEach((child) => {
      child.traverse((node) => {
        if(node.geometry&&!disposed.has(node.geometry)){disposed.add(node.geometry);node.geometry.dispose();}
        node.material?.dispose?.();
      });
      group.remove(child);
    });
  }

  setMesh(data) {
    this.setMeshes(data ? [{ data }] : []);
  }

  // Varias mallas (ensamble): cada ítem { data, color? }. Las aristas solo son elegibles con una única malla.
  setMeshes(items) {
    this.clearGroup(this.modelGroup);
    this.clearGroup(this.edgeGroup);
    this.hoverEdge = null;
    this.edgeLines = [];
    this.edgeRecords = [];
    const all = items.filter((item) => item.data);
    this.items = all.map((item, index) => ({ id: item.id ?? null, name: item.name ?? `Elemento ${index + 1}`, bounds: item.bounds ?? item.data.bounds }));
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    this.stopMotor(false);
    const sharedGeometry=new Map();
    all.forEach(({ data, color, id, transform, bounds }) => {
      let geometry=sharedGeometry.get(data);
      if(!geometry){geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(data.triangles, 1));sharedGeometry.set(data,geometry);}
      const material = new THREE.MeshStandardMaterial({ color: color ?? colors.bodyLight, metalness: 0.15, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.itemId = id ?? null;
      mesh.userData.faceGroups=data.faceGroups??[];
      const baseMatrix=new THREE.Matrix4();
      if(transform){
        const rotation=new THREE.Euler(...transform.rot.map(v=>v*Math.PI/180),'ZYX');
        baseMatrix.makeRotationFromEuler(rotation);baseMatrix.setPosition(...transform.pos);
        mesh.matrixAutoUpdate=false;mesh.matrix.copy(baseMatrix);mesh.userData.baseMatrix=baseMatrix;
      }
      this.modelGroup.add(mesh);
      // Aristas: una sola malla de segmentos por elemento (miles de THREE.Line por separado frenan el render y la animación).
      const visibleEdges = data.edges.filter((edge) => !edge.smooth);
      const worldPoint=p=>new THREE.Vector3(...p).applyMatrix4(baseMatrix).toArray();
      visibleEdges.forEach((edge) => {
        let points=edge.points;
        if(transform){points=[];for(let i=0;i<edge.points.length;i+=3)points.push(...worldPoint(edge.points.slice(i,i+3)));}
        this.edgeRecords.push({type:edge.type,points,mid:transform?worldPoint(edge.mid):edge.mid,index:edge.index,itemId:id??null});
      });
      const positions = [];
      visibleEdges.forEach((edge) => {
        for (let i = 3; i < edge.points.length; i += 3) positions.push(edge.points[i - 3], edge.points[i - 2], edge.points[i - 1], edge.points[i], edge.points[i + 1], edge.points[i + 2]);
      });
      const merged = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)), new THREE.LineBasicMaterial({ color: colors.edge }));
      merged.userData.itemId = id ?? null;
      merged.userData.merged = true;
      if(transform){merged.matrixAutoUpdate=false;merged.matrix.copy(baseMatrix);merged.userData.baseMatrix=baseMatrix;}
      this.edgeGroup.add(merged);
      for (let k = 0; k < 3; k += 1) {
        min[k] = Math.min(min[k], (bounds??data.bounds).min[k]);
        max[k] = Math.max(max[k], (bounds??data.bounds).max[k]);
      }
    });
    this.bounds = all.length === 1 ? (all[0].bounds??all[0].data.bounds) : all.length ? { min, max, size: max.map((v, k) => v - min[k]) } : null;
    this.syncEdgeMode();
    this.applyRenderMode();
    this.onMeshesChanged?.();
    (this.meshListeners ?? []).forEach((listener) => listener());
    const size = this.bounds ? Math.max(...this.bounds.size, 20) : 100;
    const step = size > 300 ? 50 : size > 100 ? 20 : 10;
    this.scene.remove(this.grid);
    this.grid.geometry.dispose(); this.grid.material.dispose();
    this.grid = new THREE.GridHelper(Math.ceil((size * 3) / step) * step, Math.ceil((size * 3) / step), 0x3b4658, 0x2a3240);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);
    this.render();
  }

  // Motor visual: gira uno o varios cuerpos (malla y aristas) alrededor de ejes que pasan por un pivote, con la velocidad que da `rpmAt(t)`.
  // Forma simple: { itemIds, axis, pivot }. Con transmisión: { bodies: [{ itemIds, axis, pivot, ratio, phase }] }; cada cuerpo gira
  // `phase + ratio · ángulo_del_motor` (relación y fase vienen de core/kinematics.js). No toca el modelo ni el kernel.
  // `onTick(angleDeg, rpm)` informa para el tablero.
  startMotor({ itemIds, axis, pivot, bodies = null, rpmAt, onTick = null }) {
    this.stopMotor(false);
    const specs = bodies ?? [{ itemIds, axis, pivot, ratio: 1, phase: 0 }];
    const pool = [...this.modelGroup.children, ...this.edgeGroup.children];
    const built = specs.map((spec) => {
      const wanted = new Set(spec.itemIds);
      return {
        targets: pool.filter((object) => wanted.has(object.userData.itemId ?? null)),
        k: new THREE.Vector3(...spec.axis).normalize(),
        p: new THREE.Vector3(...spec.pivot),
        ratio: spec.ratio ?? 1,
        phase: spec.phase ?? 0,
      };
    }).filter((body) => body.targets.length > 0);
    if (built.length === 0) throw new Error('No hay elemento para mover');
    built.forEach((body) => body.targets.forEach((object) => (object.matrixAutoUpdate = false)));
    this.motor = { bodies: built, targets: built.flatMap((body) => body.targets), angle: 0, elapsed: 0, last: performance.now(), rpmAt, onTick, running: true };
    this.applyMotor(this.motor);
    const tick = (now) => {
      const motor = this.motor;
      if (!motor?.running) return;
      const dt = Math.min(0.1, (now - motor.last) / 1000); // un salto de pestaña no debe dar un salto de giro
      motor.last = now;
      motor.elapsed += dt;
      const rpm = motor.rpmAt(motor.elapsed);
      motor.angle += (rpm * 2 * Math.PI * dt) / 60;
      this.applyMotor(motor);
      motor.onTick?.((((motor.angle * 180) / Math.PI) % 360 + 360) % 360, rpm);
      this.render();
      motor.frame = requestAnimationFrame(tick);
    };
    this.motor.frame = requestAnimationFrame(tick);
  }

  applyMotor(motor) {
    motor.bodies.forEach((body) => {
      const matrix = new THREE.Matrix4().makeTranslation(body.p.x, body.p.y, body.p.z)
        .multiply(new THREE.Matrix4().makeRotationAxis(body.k, body.phase + body.ratio * motor.angle))
        .multiply(new THREE.Matrix4().makeTranslation(-body.p.x, -body.p.y, -body.p.z));
      body.targets.forEach((object) => {
        object.matrix.copy(matrix);
        if(object.userData.baseMatrix)object.matrix.multiply(object.userData.baseMatrix);
        object.matrixWorldNeedsUpdate = true;
      });
    });
  }

  pauseMotor() {
    if (this.motor) {
      this.motor.running = false;
      cancelAnimationFrame(this.motor.frame);
    }
  }

  // Detiene; con reset vuelve la pieza a su posición original.
  stopMotor(reset = true) {
    if (!this.motor) return;
    cancelAnimationFrame(this.motor.frame);
    this.motor.running = false;
    this.motor.targets.forEach((object) => {
      object.matrix.copy(object.userData.baseMatrix??new THREE.Matrix4());
      object.matrixWorldNeedsUpdate = true;
      object.matrixAutoUpdate = !object.userData.baseMatrix;
    });
    this.motor = null;
    if (reset) this.render();
  }

  get motorRunning() {
    return Boolean(this.motor?.running);
  }

  // Elegir aristas necesita una línea por arista (con su punto medio); fuera de ese modo se dibuja la malla unificada.
  syncEdgeMode() {
    const merged = this.edgeGroup.children.filter((object) => object.userData.merged);
    const individual = this.edgeGroup.children.filter((object) => !object.userData.merged);
    if (this.pickEnabled && individual.length === 0) {
      this.edgeLines = this.edgeRecords.map((record) => {
        const line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(record.points, 3)), new THREE.LineBasicMaterial({ color: colors.edge }));
        line.userData = { mid: record.mid, index: record.index, itemId: record.itemId };
        this.edgeGroup.add(line);
        return line;
      });
    } else if (!this.pickEnabled && individual.length) {
      individual.forEach((line) => {
        line.geometry.dispose();
        line.material.dispose();
        this.edgeGroup.remove(line);
      });
      this.edgeLines = [];
      this.hoverEdge = null;
    }
    merged.forEach((object) => (object.visible = !this.pickEnabled&&!this.hiddenItems?.has(object.userData.itemId)));
    individual.forEach(object=>object.visible=!this.hiddenItems?.has(object.userData.itemId));
    this.refreshEdgeColors();
  }

  // Selección de aristas (puntos medios) y modo de elección.
  setPickMode(enabled, selectedMids = []) {
    this.pickEnabled = enabled;
    this.selectedMids = selectedMids;
    this.syncEdgeMode();
    this.canvas.style.cursor = enabled ? 'crosshair' : '';
    this.refreshEdgeColors();
    this.render();
  }

  isSelected(line) {
    return this.selectedMids.some((mid) => Math.hypot(mid[0] - line.userData.mid[0], mid[1] - line.userData.mid[1], mid[2] - line.userData.mid[2]) < 0.6);
  }

  refreshEdgeColors() {
    (this.edgeLines ?? []).forEach((line) => {
      const selected = this.pickEnabled && this.isSelected(line);
      line.material.color.setHex(selected ? colors.edgeSelected : line === this.hoverEdge ? colors.edgeHover : colors.edge);
    });
  }

  pick(event) {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    const hits = this.raycaster.intersectObjects((this.edgeLines??[]).filter(line=>line.visible), false);
    if (hits.length === 0) return null;
    // Descarta aristas ocultas detrás de una cara.
    const solid = this.raycaster.intersectObjects(this.modelGroup.children, false)[0];
    return solid && solid.distance < hits[0].distance - 0.5 ? null : hits[0].object;
  }

  handleMove(event) {
    if (!this.pickEnabled || event.buttons) return;
    const hover = this.pick(event);
    if (hover !== this.hoverEdge) {
      this.hoverEdge = hover;
      this.refreshEdgeColors();
      this.render();
    }
  }

  // Modo "colocar": el próximo clic (sin arrastrar) sobre el modelo entrega {point, normal}; Esc o clic en el vacío cancela.
  startPlacement(callback) {
    this.cancelPlacement();
    this.placing = callback;
    this.canvas.style.cursor = 'crosshair';
    this.placeKey = (event) => event.key === 'Escape' && this.cancelPlacement();
    window.addEventListener('keydown', this.placeKey);
  }

  cancelPlacement() {
    if (!this.placing) return;
    this.placing = null;
    this.canvas.style.cursor = '';
    window.removeEventListener('keydown', this.placeKey);
  }

  surfaceAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    const meshes = this.modelGroup.children.filter((object) => object.isMesh && object.visible);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (normal.dot(this.raycaster.ray.direction) > 0) normal.negate();
    const faceGroup=hit.object.userData.faceGroups?.find(g=>hit.faceIndex*3>=g.start&&hit.faceIndex*3<g.start+g.count);
    return { point: hit.point.toArray(), normal: normal.toArray(), itemId:hit.object.userData.itemId,faceId:faceGroup?.faceId };
  }

  handleUp(event) {
    if (this.placing && this.downAt) {
      const moved = Math.hypot(event.clientX - this.downAt.x, event.clientY - this.downAt.y) > 4;
      this.downAt = null;
      if (moved) return;
      const done = this.placing;
      const found = this.surfaceAt(event);
      this.cancelPlacement();
      if (found) done(found);
      return;
    }
    if (!this.pickEnabled || !this.downAt) return;
    const moved = Math.hypot(event.clientX - this.downAt.x, event.clientY - this.downAt.y) > 4;
    this.downAt = null;
    if (moved) return;
    const line = this.pick(event);
    if (line && this.onEdgePick) this.onEdgePick(line.userData.mid, { additive: event.shiftKey || event.ctrlKey });
  }

  // Estilo de dibujo: 'solid' (caras + aristas), 'wire' (malla de triángulos), 'edges' (solo aristas, el más liviano).
  setRenderMode(mode) {
    this.renderMode = mode;
    this.applyRenderMode();
    this.render();
  }

  applyRenderMode() {
    this.modelGroup.children.forEach((mesh) => {
      mesh.material.wireframe = this.renderMode === 'wire';
      mesh.visible = this.renderMode !== 'edges' && !this.hiddenItems?.has(mesh.userData.itemId);
    });
  }

  // Zona de rosca: cilindro rojo translúcido + círculos, generatrices y eje punteados (se ven a través de la pieza).
  showThreadZone(spec) {
    this.clearGroup(this.threadGroup);
    if (!spec) return this.render();
    const radius = spec.major / 2 + 0.2;
    const length = spec.length;
    const k = new THREE.Vector3(...spec.vector).normalize();
    const holder = new THREE.Group();
    holder.position.set(...spec.p0.map((v, i) => (v + spec.p1[i]) / 2));
    holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), k);
    const red = 0xff3b30;
    const overlay = (object) => {
      object.material.depthTest = false;
      object.renderOrder = 999;
      holder.add(object);
      return object;
    };
    overlay(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 48, 1, true), new THREE.MeshBasicMaterial({ color: red, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })));
    const dashed = () => new THREE.LineDashedMaterial({ color: red, dashSize: Math.max(0.8, radius / 6), gapSize: Math.max(0.6, radius / 8) });
    const dashedLine = (points) => {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), dashed());
      line.computeLineDistances();
      overlay(line);
    };
    [-length / 2, length / 2].forEach((y) => dashedLine(Array.from({ length: 65 }, (_, i) => new THREE.Vector3(radius * Math.cos((i / 64) * 2 * Math.PI), y, radius * Math.sin((i / 64) * 2 * Math.PI)))));
    [[radius, 0], [-radius, 0], [0, radius], [0, -radius]].forEach(([x, z]) => dashedLine([new THREE.Vector3(x, -length / 2, z), new THREE.Vector3(x, length / 2, z)]));
    const overhang = Math.max(4, length * 0.15);
    dashedLine([new THREE.Vector3(0, -length / 2 - overhang, 0), new THREE.Vector3(0, length / 2 + overhang, 0)]);
    this.threadGroup.add(holder);
    this.render();
  }

  // ── Partículas: nube de esferas (impostores en el shader) coloreada por velocidad + caja del emisor ──
  initParticles(maxCount, radius, color = [0.86, 0.7, 0.4]) {
    this.clearParticles();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxCount * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('speed', new THREE.BufferAttribute(new Float32Array(maxCount), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: { tint: { value: new THREE.Vector3(...color) }, radius: { value: radius }, scale: { value: 1 }, ortho: {value:0}, vref: { value: 600 } },
      vertexShader: `
        attribute float speed; uniform float radius; uniform float scale; uniform float ortho; uniform float vref; varying float vHot;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(2.0, 2.0 * radius * scale / mix(-mv.z,1.0,ortho));
          vHot = clamp(speed / vref, 0.0, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 tint; varying float vHot;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(p, p);
          if (r2 > 1.0) discard;
          vec3 n = vec3(p.x, -p.y, sqrt(1.0 - r2));
          float light = 0.35 + 0.65 * max(dot(n, normalize(vec3(0.4, 0.5, 0.8))), 0.0);
          vec3 base = mix(tint, vec3(1.0, 0.42, 0.18), vHot * 0.6);
          gl_FragColor = vec4(base * light, 1.0);
        }`,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.particleGroup.add(this.points);
    this.updateParticleScale();
  }

  showFillOutlet(options) {
    if(this.fillGate){this.fillGate.removeFromParent();this.fillGate.geometry.dispose();this.fillGate.material.dispose();this.fillGate=null;}
    if(!options)return;
    const points=[],axis=options.outletAxis,u=(axis+1)%3,v=(axis+2)%3;
    for(let i=0;i<=64;i++){const p=[0,0,0],angle=i/64*Math.PI*2;p[axis]=options.outletPosition;p[u]=options.outletU+Math.cos(angle)*options.outletRadius;p[v]=options.outletV+Math.sin(angle)*options.outletRadius;points.push(...p);}
    this.fillGate=new THREE.Line(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3)),new THREE.LineBasicMaterial({color:0xff6458,depthTest:false}));
    this.fillGate.renderOrder=990;this.particleGroup.add(this.fillGate);this.render();
  }

  setHopperFill(fill, color = [0.75,0.59,0.32]) {
    if(this.fillPoints){this.fillPoints.removeFromParent();this.fillPoints.geometry.dispose();this.fillPoints.material.dispose();}
    this.fillPoints=null;
    if(!fill)return;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(fill.positions,3));
    const material=new THREE.PointsMaterial({color:new THREE.Color(...color),size:fill.h*1.7,sizeAttenuation:true});
    this.fillPoints=new THREE.Points(geometry,material);this.fillPoints.frustumCulled=false;
    this.particleGroup.add(this.fillPoints);this.updateHopperFill(fill.info);
  }

  updateHopperFill(info) {
    if(this.fillGate)this.fillGate.material.color.setHex(info?.open?0x64da98:0xff6458);
    if(!this.fillPoints)return;
    const count=info?.visible??0;
    this.fillPoints.geometry.setDrawRange(0,count);this.fillPoints.visible=count>0;this.render();
  }

  updateParticleScale() {
    if (!this.points) return;
    const ortho=!!this.camera.isOrthographicCamera;
    this.points.material.uniforms.ortho.value=ortho?1:0;
    this.points.material.uniforms.scale.value = ortho ? this.renderer.domElement.height*this.camera.zoom/(this.camera.top-this.camera.bottom) : this.renderer.domElement.height/(2*Math.tan(this.camera.fov*Math.PI/360));
  }

  // data: Float32Array [x, y, z, velocidad] por partícula.
  setParticles(data) {
    if (!this.points) return;
    const geometry = this.points.geometry;
    const count = Math.min(data.length / 4, geometry.attributes.position.count);
    const position = geometry.attributes.position.array;
    const speed = geometry.attributes.speed.array;
    for (let i = 0; i < count; i += 1) {
      position[i * 3] = data[i * 4];
      position[i * 3 + 1] = data[i * 4 + 1];
      position[i * 3 + 2] = data[i * 4 + 2];
      speed[i] = data[i * 4 + 3];
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.speed.needsUpdate = true;
    geometry.setDrawRange(0, count);
    this.updateParticleScale();
    this.render();
  }

  // Cajas rígidas (productos): 10 números por caja — x, y, z, cuaternión (x, y, z, w) y semiejes. Una InstancedMesh de hasta 300.
  setProducts(data) {
    const count = data ? Math.min(300, Math.floor(data.length / 10)) : 0;
    if (!count && !this.productMesh) return;
    if (!this.productMesh) {
      const material = new THREE.MeshStandardMaterial({ color: 0xe39b3a, roughness: 0.6, metalness: 0.05 });
      this.productMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, 300);
      this.productMesh.frustumCulled = false;
      this.particleGroup.add(this.productMesh);
    }
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (let i = 0; i < count; i += 1) {
      const o = i * 10;
      position.set(data[o], data[o + 1], data[o + 2]);
      quaternion.set(data[o + 3], data[o + 4], data[o + 5], data[o + 6]);
      scale.set(data[o + 7] * 2, data[o + 8] * 2, data[o + 9] * 2);
      this.productMesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
    }
    this.productMesh.count = count;
    this.productMesh.instanceMatrix.needsUpdate = true;
  }

  showEmitter(center, size) {
    if(this.emitterBox){this.emitterBox.parent?.remove(this.emitterBox);this.emitterBox.geometry.dispose();this.emitterBox.material.dispose();}
    this.emitterBox = null;
    if (center) {
      const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size[0], size[1], size[2])), new THREE.LineBasicMaterial({ color: 0x6fd3ff, depthTest: false }));
      box.position.set(...center);
      box.renderOrder = 998;
      this.particleGroup.add(box);
      this.emitterBox = box;
    }
    this.render();
  }

  clearParticles() {
    this.points = null;
    this.productMesh = null;
    this.fillPoints = null;
    this.fillGate = null;
    this.emitterBox = null;
    this.clearGroup(this.particleGroup);
  }

  // Pose rígida de un grupo de elementos: giro `angle` alrededor del eje por el pivote y luego desplazamiento `offset`.
  setBodyPose(itemIds, { axis, pivot, angle = 0, offset = [0, 0, 0] }) {
    const wanted = new Set(itemIds);
    const k = new THREE.Vector3(...axis).normalize();
    const p = new THREE.Vector3(...pivot);
    const matrix = new THREE.Matrix4().makeTranslation(...offset)
      .multiply(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z))
      .multiply(new THREE.Matrix4().makeRotationAxis(k, angle))
      .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    [...this.modelGroup.children, ...this.edgeGroup.children].forEach((object) => {
      if (!wanted.has(object.userData.itemId ?? null)) return;
      object.matrixAutoUpdate = false;
      object.matrix.copy(matrix);
        if(object.userData.baseMatrix)object.matrix.multiply(object.userData.baseMatrix);
      object.matrixWorldNeedsUpdate = true;
    });
  }

  // ── Boquillas de aire: cono + marcadores que fluyen mientras la boquilla está activa ──
  // list: [{ id, pos, dir, range, tan, radius, speed, controlled }]
  showNozzles(list) {
    this.nozzles = list ?? [];
    this.clearGroup(this.nozzleGroup);
    this.tracerPoints = null;
    cancelAnimationFrame(this.nozzleFrame);
    this.nozzleFrame = 0;
    this.nozzleVisuals = [];
    this.nozzles.forEach((nozzle) => {
      const dir = new THREE.Vector3(...nozzle.dir).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      const length = nozzle.range;
      const endRadius = nozzle.radius + length * nozzle.tan;
      const wire = [];
      const rings = [[0, nozzle.radius], [length, endRadius]];
      rings.forEach(([z, r]) => {
        for (let i = 0; i < 24; i += 1) {
          const a0 = (i / 24) * Math.PI * 2;
          const a1 = ((i + 1) / 24) * Math.PI * 2;
          wire.push(r * Math.cos(a0), r * Math.sin(a0), z, r * Math.cos(a1), r * Math.sin(a1), z);
        }
      });
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        wire.push(nozzle.radius * Math.cos(a), nozzle.radius * Math.sin(a), 0, endRadius * Math.cos(a), endRadius * Math.sin(a), length);
      }
      const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wire, 3)), new THREE.LineBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.55, depthTest: false }));
      const count = 70;
      const seeds = Array.from({ length: count }, () => ({ phase: Math.random(), angle: Math.random() * Math.PI * 2, frac: Math.sqrt(Math.random()) }));
      const dots = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)), new THREE.PointsMaterial({ color: 0xbfeaff, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9, depthTest: false }));
      dots.frustumCulled = false;
      const holder = new THREE.Group();
      holder.position.set(...nozzle.pos);
      holder.quaternion.copy(quat);
      holder.renderOrder = 997;
      holder.add(lines, dots);
      this.nozzleGroup.add(holder);
      this.nozzleVisuals.push({ nozzle, holder, lines, dots, seeds, level: nozzle.controlled ? 0 : 1 });
    });
    if (this.nozzleVisuals.length) {
      this.nozzleClock = performance.now();
      const loop = (now) => {
        this.nozzleFrame = requestAnimationFrame(loop);
        const dt = Math.min(0.1, (now - this.nozzleClock) / 1000);
        this.nozzleClock = now;
        this.updateNozzleFlow(dt);
        this.render();
      };
      this.nozzleFrame = requestAnimationFrame(loop);
    }
    this.render();
  }

  setNozzleLevels(levels) {
    (this.nozzleVisuals ?? []).forEach((visual) => {
      visual.level = levels[visual.nozzle.id] ?? (visual.nozzle.controlled ? 0 : 1);
    });
  }

  updateNozzleFlow(dt) {
    (this.nozzleVisuals ?? []).forEach((visual) => {
      const { nozzle, seeds, dots, lines, level } = visual;
      lines.material.opacity = 0.15 + 0.45 * Math.min(1, level);
      dots.visible = level > 0.01 && !this.tracerFromSim;
      if (!dots.visible) return;
      const position = dots.geometry.attributes.position.array;
      // velocidad visual: 1 alcance cada ~1,5 s a nivel 1 (no es la velocidad real del aire)
      seeds.forEach((seed, i) => {
        seed.phase = (seed.phase + (dt * level) / 1.5) % 1;
        const z = seed.phase * nozzle.range;
        const r = (nozzle.radius + z * nozzle.tan) * seed.frac;
        position[i * 3] = r * Math.cos(seed.angle);
        position[i * 3 + 1] = r * Math.sin(seed.angle);
        position[i * 3 + 2] = z;
      });
      dots.geometry.attributes.position.needsUpdate = true;
    });
  }

  // Sensores de zona: cajas verdes (se encienden cuando tienen partículas adentro).
  showSensors(list) {
    this.clearGroup(this.sensorGroup);
    this.sensorBoxes = new Map();
    (list ?? []).forEach((sensor) => {
      const size = sensor.size.map((value) => Math.max(0.5, Math.abs(Number(value))));
      const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)), new THREE.LineBasicMaterial({ color: 0x59d98e, transparent: true, opacity: 0.6, depthTest: false }));
      box.position.set(...sensor.center.map(Number));
      box.renderOrder = 996;
      this.sensorGroup.add(box);
      this.sensorBoxes.set(sensor.id, box);
    });
    this.render();
  }

  setSensorCounts(counts) {
    this.sensorBoxes?.forEach((box, id) => {
      const on = (counts?.[id] ?? 0) > 0;
      box.material.color.set(on ? 0xffe066 : 0x59d98e);
      box.material.opacity = on ? 1 : 0.6;
    });
  }

  // Marcadores que siguen el aire resuelto por la simulación: [x, y, z, velocidad] por punto.
  setTracers(data) {
    if (!this.tracerPoints) {
      const capacity = 1500;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
      this.tracerPoints = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }));
      this.tracerPoints.frustumCulled = false;
      this.tracerPoints.renderOrder = 995;
      this.nozzleGroup.add(this.tracerPoints);
    }
    const geometry = this.tracerPoints.geometry;
    const count = Math.min(data.length / 4, geometry.attributes.position.count);
    const position = geometry.attributes.position.array;
    const color = geometry.attributes.color.array;
    for (let i = 0; i < count; i += 1) {
      position[i * 3] = data[i * 4];
      position[i * 3 + 1] = data[i * 4 + 1];
      position[i * 3 + 2] = data[i * 4 + 2];
      const t = Math.min(1, data[i * 4 + 3] / 6000); // lento = azul, rápido = blanco
      color[i * 3] = 0.35 + 0.65 * t;
      color[i * 3 + 1] = 0.7 + 0.3 * t;
      color[i * 3 + 2] = 1;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.setDrawRange(0, count);
    this.tracerFromSim = count > 0;
  }

  // Plano de corte del aire resuelto (presión o velocidad) como textura coloreada; slice viene de AirSolver.sliceField.
  setAirSlice(slice, mode) {
    this.clearAirSlice(false);
    const texture = new THREE.DataTexture(sliceToRgba(slice, mode), slice.nx, slice.ny, THREE.RGBAFormat);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    const [a, b] = [0, 1, 2].filter((k) => k !== slice.axis);
    const corner = (u, v) => {
      const p = [0, 0, 0];
      p[slice.axis] = slice.coord;
      p[a] = slice.lo[0] + u * slice.size[0];
      p[b] = slice.lo[1] + v * slice.size[1];
      return p;
    };
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([...corner(0, 0), ...corner(1, 0), ...corner(1, 1), ...corner(0, 1)], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.airSlice = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    this.airSlice.renderOrder = 990;
    this.airSlice.frustumCulled = false;
    this.nozzleGroup.add(this.airSlice);
    this.render();
  }

  clearAirSlice(render = true) {
    if (!this.airSlice) return;
    this.nozzleGroup.remove(this.airSlice);
    this.airSlice.geometry.dispose();
    this.airSlice.material.map?.dispose();
    this.airSlice.material.dispose();
    this.airSlice = null;
    if (render) this.render();
  }

  clearNozzles() {
    this.airSlice = null;
    this.tracerPoints = null;
    this.tracerFromSim = false;
    this.clearGroup(this.sensorGroup);
    this.sensorBoxes = new Map();
    cancelAnimationFrame(this.nozzleFrame);
    this.nozzleFrame = 0;
    this.nozzleVisuals = [];
    this.nozzles = [];
    this.clearGroup(this.nozzleGroup);
    this.render();
  }

  // Translucidez de un elemento (para ver el material dentro de una camisa). opacity 1 = normal.
  setItemOpacity(itemId, opacity) {
    this.modelGroup.children.forEach((object) => {
      if ((object.userData.itemId ?? null) !== itemId || !object.material) return;
      object.material.transparent = opacity < 1;
      object.material.opacity = opacity;
      object.material.depthWrite = opacity >= 1;
      object.material.needsUpdate = true;
    });
    this.render();
  }

  clearBodyAngle() {
    [...this.modelGroup.children, ...this.edgeGroup.children].forEach((object) => {
      object.matrix.copy(object.userData.baseMatrix??new THREE.Matrix4());
      object.matrixAutoUpdate = !object.userData.baseMatrix;
      object.matrixWorldNeedsUpdate = true;
    });
    this.render();
  }

  // ── Selección y arrastre de cuerpos ──
  rayFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    return { origin: this.raycaster.ray.origin.toArray(), dir: this.raycaster.ray.direction.toArray() };
  }

  // Id del elemento (cuerpo) bajo el puntero o null.
  pickItem(event) {
    this.rayFromEvent(event);
    const meshes = this.modelGroup.children.filter((object) => object.isMesh && object.visible && object.material.opacity > 0.05);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.itemId ?? null : null;
  }

  // Milímetros del mundo que mide un píxel a la distancia de `point` (para tolerancias de imán).
  unitsPerPixel(point) {
    if (this.camera.isOrthographicCamera) return (this.camera.top-this.camera.bottom) / this.camera.zoom / Math.max(1,this.canvas.clientHeight);
    const distance = this.camera.position.distanceTo(new THREE.Vector3(...point));
    return (2 * distance * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, this.canvas.clientHeight);
  }

  // Resalta los elegidos (naranja) y el que está bajo el puntero (azul tenue).
  setItemHighlight(selectedIds = [], hoverId = null) {
    const selected = new Set(selectedIds);
    this.modelGroup.children.forEach((object) => {
      if (!object.isMesh || !object.material?.emissive) return;
      const id = object.userData.itemId ?? null;
      object.material.emissive.setHex(selected.has(id) ? 0x8a4b00 : id === hoverId && hoverId !== null ? 0x1f3550 : 0x000000);
    });
    this.render();
  }

  // Guías de arrastre: líneas { points, color, dashed } y rótulos { p, text, color } que siguen a la cámara.
  showGuides({ lines = [], labels = [] }) {
    this.clearGuides(false);
    lines.forEach(({ points, color = 0x5ad1c5, dashed = false }) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
      const material = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 4, gapSize: 3, depthTest: false }) : new THREE.LineBasicMaterial({ color, depthTest: false });
      const line = new THREE.Line(geometry, material);
      if (dashed) line.computeLineDistances();
      line.renderOrder = 10;
      this.guideGroup.add(line);
    });
    if (!this.labelLayer) {
      this.labelLayer = document.createElement('div');
      this.labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
      this.canvas.parentElement.append(this.labelLayer);
    }
    labels.forEach(({ p, text, color = '#ffd24d' }) => {
      const node = document.createElement('div');
      node.textContent = text;
      node.style.cssText = `position:absolute;transform:translate(-50%,-120%);padding:1px 6px;border-radius:4px;background:rgba(20,24,31,.9);color:${color};font:600 11px system-ui;white-space:nowrap;`;
      this.labelLayer.append(node);
      this.guideLabels.push({ p, node });
    });
    this.render();
  }

  clearGuides(render = true) {
    this.clearGroup(this.guideGroup);
    this.guideLabels.forEach(({ node }) => node.remove());
    this.guideLabels = [];
    if (render) this.render();
  }

  layoutLabels() {
    if (!this.guideLabels.length) return;
    const { clientWidth: width, clientHeight: height } = this.canvas;
    this.guideLabels.forEach(({ p, node }) => {
      const v = new THREE.Vector3(...p).project(this.camera);
      node.style.display = v.z > 1 ? 'none' : 'block';
      node.style.left = `${((v.x + 1) / 2) * width}px`;
      node.style.top = `${((1 - v.y) / 2) * height}px`;
    });
  }

  // Triángulos del mundo de un elemento (para colisiones): { vertices, triangles }.
  itemGeometry(itemId) {
    const mesh = this.modelGroup.children.find((object) => (object.userData.itemId ?? null) === itemId && object.isMesh);
    if (!mesh) return null;
    const vertices=new Float32Array(mesh.geometry.attributes.position.array);
    const normals=new Float32Array(mesh.geometry.attributes.normal?.array??new Float32Array(vertices.length));
    const base=mesh.userData.baseMatrix;
    if(base)for(let i=0;i<vertices.length;i+=3){const p=new THREE.Vector3(vertices[i],vertices[i+1],vertices[i+2]).applyMatrix4(base);vertices.set(p.toArray(),i);const n=new THREE.Vector3(normals[i],normals[i+1],normals[i+2]).transformDirection(base);normals.set(n.toArray(),i);}
    return { vertices, normals, triangles: new Uint32Array(mesh.geometry.index.array) };
  }

  // Eje de giro del motor: línea punteada amarilla por el punto de giro y una esfera en el pivote.
  showMotorAxis(axis, pivot, extent = 100) {
    this.clearGroup(this.axisGroup);
    if (!axis) return this.render();
    const vector = typeof axis === 'string' ? { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[axis] : axis;
    if (!vector) return this.render();
    const k = new THREE.Vector3(...vector).normalize();
    const p = new THREE.Vector3(...pivot);
    const material = new THREE.LineDashedMaterial({ color: 0xffd23f, dashSize: extent / 40, gapSize: extent / 60, depthTest: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p.clone().addScaledVector(k, -extent), p.clone().addScaledVector(k, extent)]), material);
    line.computeLineDistances();
    line.renderOrder = 999;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(extent / 60, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false }));
    dot.position.copy(p);
    dot.renderOrder = 999;
    this.axisGroup.add(line, dot);
    this.render();
  }

  // Vistas estándar.
  setView(name) {
    const size = this.bounds ? Math.max(...this.bounds.size, 20) : 100;
    const center = this.bounds ? this.bounds.min.map((v, i) => v + this.bounds.size[i] / 2) : [0, 0, 0];
    const distance = size * 3.2;
    const directions = { iso: [0.6, -0.8, 0.55], front: [0, -1, 0], top: [0, 0, 1], right: [1, 0, 0], back: [0, 1, 0], left: [-1, 0, 0], bottom: [0, 0, -1] };
    const [dx, dy, dz] = directions[name] ?? directions.iso;
    const norm = Math.hypot(dx, dy, dz);
    this.camera.up.set(0, 0, name === 'top' ? 0 : 1);
    if (name === 'top') this.camera.up.set(0, 1, 0);
    if (name === 'bottom') this.camera.up.set(0, -1, 0);
    this.camera.position.set(center[0] + (dx / norm) * distance, center[1] + (dy / norm) * distance, center[2] + (dz / norm) * distance);
    if (this.camera.isOrthographicCamera) {
      const half=size*0.75; const aspect=this.canvas.clientWidth/Math.max(1,this.canvas.clientHeight);
      this.camera.top=half;this.camera.bottom=-half;this.camera.left=-half*aspect;this.camera.right=half*aspect;this.camera.zoom=1;this.camera.updateProjectionMatrix();
    }
    this.controls.target.set(...center);
    this.controls.update();
    this.render();
  }

  // Planos de referencia del boceto activo (resaltado translúcido).
  showSketchPlane(plane, offset, extent = 120) {
    this.clearGroup(this.overlayGroup);
    if (!plane) return this.render();
    const geometry = new THREE.PlaneGeometry(extent, extent);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x4da3ff }));
    [mesh, frame].forEach((object) => {
      if (plane === 'XZ') {
        object.rotation.x = Math.PI / 2;
        object.position.y = -offset;
      } else if (plane === 'YZ') {
        object.rotation.y = Math.PI / 2;
        object.position.x = offset;
      } else object.position.z = offset;
      this.overlayGroup.add(object);
    });
    this.render();
  }

  // Plano de trabajo en cualquier orientación: marco { origin, xDir, yDir, normal } del mundo, con sus ejes locales X (rojo) e Y (verde).
  showSketchFrame(frame, extent = 120) {
    this.clearGroup(this.overlayGroup);
    if (!frame) return this.render();
    const [x, y, z] = [frame.xDir, frame.yDir, frame.normal].map((v) => new THREE.Vector3(...v));
    const matrix = new THREE.Matrix4().makeBasis(x, y, z).setPosition(new THREE.Vector3(...frame.origin));
    const geometry = new THREE.PlaneGeometry(extent, extent);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x4da3ff }));
    const axis = (end, color) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), end]), new THREE.LineBasicMaterial({ color }));
    [mesh, outline, axis(new THREE.Vector3(extent * 0.3, 0, 0), 0xff5a5a), axis(new THREE.Vector3(0, extent * 0.3, 0), 0x5ad163)].forEach((object) => {
      object.matrixAutoUpdate = false;
      object.matrix.copy(matrix);
        if(object.userData.baseMatrix)object.matrix.multiply(object.userData.baseMatrix);
      this.overlayGroup.add(object);
    });
    this.render();
  }

  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }
}
