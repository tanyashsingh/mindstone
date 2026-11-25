// Cairn logo: three pebbles stacked on a rounded app tile, rendered with three.js.
// Rendered by scripts/render-logo.mjs; outputs are committed (brand/, build/, public/, src/assets/).
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const SIZE = 1024;

/** A smooth, slightly irregular pebble: a flattened ellipsoid with low-frequency surface noise. */
function pebble(rx: number, ry: number, rz: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 160, 96);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n =
      0.045 * Math.sin(3.1 * v.x + seed) * Math.cos(2.3 * v.z + seed * 1.7) +
      0.03 * Math.sin(5.2 * v.z - seed * 0.6) * Math.sin(4.1 * v.y + seed);
    // Flatter underside, so each stone sits believably on the one below.
    const flat = v.y < 0 ? 0.82 : 1;
    v.multiplyScalar(1 + n);
    p.setXYZ(i, v.x * rx, v.y * ry * flat, v.z * rz);
  }
  g.computeVertexNormals();
  return g;
}

export function render(): HTMLCanvasElement {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0.55, 10.2);
  camera.lookAt(0, 0.0, 0);

  // App tile: an extruded rounded square (true squircle-like corners) with a vertical indigo gradient.
  const R = 2.1, r = 0.95;
  const shape = new THREE.Shape();
  shape.moveTo(-R + r, -R);
  shape.lineTo(R - r, -R); shape.quadraticCurveTo(R, -R, R, -R + r);
  shape.lineTo(R, R - r); shape.quadraticCurveTo(R, R, R - r, R);
  shape.lineTo(-R + r, R); shape.quadraticCurveTo(-R, R, -R, R - r);
  shape.lineTo(-R, -R + r); shape.quadraticCurveTo(-R, -R, -R + r, -R);
  const tileGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.14, bevelSegments: 10, curveSegments: 48 });
  tileGeo.translate(0, 0, -0.45);
  const top = new THREE.Color(0x3340b0), bottom = new THREE.Color(0x0c1036), col = new THREE.Color();
  const tp = tileGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(tp.count * 3);
  for (let i = 0; i < tp.count; i++) {
    col.copy(bottom).lerp(top, THREE.MathUtils.clamp((tp.getY(i) + R) / (2 * R), 0, 1));
    colors.set([col.r, col.g, col.b], i * 3);
  }
  tileGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const tile = new THREE.Mesh(tileGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0, envMapIntensity: 0.12 }));
  tile.receiveShadow = true;
  scene.add(tile);

  const stones: [THREE.BufferGeometry, number, number, number, number, number][] = [
    // geometry, color, y, x offset, yaw, roughness
    [pebble(1.3, 0.46, 1.0, 1.3), 0xb8ab95, -1.0, 0.02, 0.25, 0.66],
    [pebble(0.98, 0.39, 0.78, 4.1), 0x6e6a66, -0.2, -0.08, -0.4, 0.58],
    [pebble(0.66, 0.34, 0.54, 7.7), 0x9aa6ff, 0.48, 0.06, 0.6, 0.22],
  ];
  for (const [geo, color, y, x, yaw, rough] of stones) {
    const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.45, envMapIntensity: 0.55 }));
    m.position.set(x, y, 0.55);
    m.rotation.set(0.12, yaw, 0.03);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  // The light the cairn points to: a glowing spark with a soft halo.
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.15, 48, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe9a8, emissiveIntensity: 3 }));
  spark.position.set(0.06, 1.3, 0.55);
  scene.add(spark);
  const halo = new THREE.Mesh(new THREE.CircleGeometry(0.55, 64), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "varying vec2 vUv; void main(){ float d = distance(vUv, vec2(0.5)) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.2) * 0.7; gl_FragColor = vec4(1.0, 0.9, 0.62, a); }",
  }));
  halo.position.copy(spark.position).add(new THREE.Vector3(0, 0, -0.05));
  scene.add(halo);
  const sparkLight = new THREE.PointLight(0xffe7a6, 5, 3, 2);
  sparkLight.position.copy(spark.position);
  scene.add(sparkLight);

  const key = new THREE.DirectionalLight(0xfff6ea, 2.6);
  key.position.set(-3.5, 7.5, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fb0ff, 1.4);
  rim.position.set(4, 2, -3);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xdfe4ff, 0x1a1f4a, 0.3));

  renderer.render(scene, camera);
  return renderer.domElement;
}

/** High-quality downscale by repeated halving, then a final resize. */
export function resized(src: HTMLCanvasElement, size: number): string {
  let cur: HTMLCanvasElement = src;
  while (cur.width / 2 >= size) {
    const c = document.createElement("canvas");
    c.width = c.height = cur.width / 2;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  const out = document.createElement("canvas");
  out.width = out.height = size;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cur, 0, 0, size, size);
  return out.toDataURL("image/png");
}

const canvas = render();
(window as unknown as { cairnLogo: Record<number, string> }).cairnLogo = Object.fromEntries([1024, 512, 256, 128, 64, 32].map((s) => [s, s === 1024 ? canvas.toDataURL("image/png") : resized(canvas, s)]));
