const UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const hudEl = document.querySelector('.hud');

const statusEl = document.getElementById('status');
const hudToggleBtn = document.getElementById('hudToggleBtn');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');
const modeValueEl = document.getElementById('modeValue');
const packetValueEl = document.getElementById('packetValue');
const vectorValueEl = document.getElementById('vectorValue');
const energyLiveValueEl = document.getElementById('energyLiveValue');
const bleLogEl = document.getElementById('bleLog');
const bleDebugStateEl = document.getElementById('bleDebugState');

const smoothRange = document.getElementById('smoothRange');
const energyRange = document.getElementById('energyRange');
const bloomRange = document.getElementById('bloomRange');
const smoothValue = document.getElementById('smoothValue');
const energyValue = document.getElementById('energyValue');
const bloomValue = document.getElementById('bloomValue');

let device = null;
let server = null;
let txCharacteristic = null;
let rxCharacteristic = null;
let bleBuffer = '';

let lastTime = performance.now();
let hue = 200;

let packetCount = 0;
let lastPacketTime = 0;
let debugLines = [];
const textDecoder = new TextDecoder();
const BLE_PACKET_TIMEOUT_MS = 1600;
let hudCollapsed = false;

const state = {
  x: window.innerWidth * 0.5,
  y: window.innerHeight * 0.5,
  vx: 0,
  vy: 0,
  lastX: window.innerWidth * 0.5,
  lastY: window.innerHeight * 0.5,
  smooth: parseFloat(smoothRange.value),
  energyGain: parseFloat(energyRange.value),
  bloom: parseFloat(bloomRange.value),
  baseEnergy: 0.3,
  lastInput: { dx: 0, dy: 0, dz: 0, energy: 0 },
  points: [],
  sparks: [],
  branches: [],
  nodes: [],
  halos: []
};

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function updateLabels() {
  state.smooth = parseFloat(smoothRange.value);
  state.energyGain = parseFloat(energyRange.value);
  state.bloom = parseFloat(bloomRange.value);
  smoothValue.textContent = smoothRange.value;
  energyValue.textContent = energyRange.value;
  bloomValue.textContent = bloomRange.value;
}

function updateTelemetry() {
  packetValueEl.textContent = String(packetCount);
  vectorValueEl.textContent =
    `${state.lastInput.dx.toFixed(3)} / ${state.lastInput.dy.toFixed(3)}`;
  energyLiveValueEl.textContent = state.lastInput.energy.toFixed(3);
}

function setModeLabel(label) {
  modeValueEl.textContent = label;
}

function syncHudState() {
  hudEl.classList.toggle('collapsed', hudCollapsed);
  hudToggleBtn.textContent = hudCollapsed ? 'Show Panel' : 'Hide Panel';
  hudToggleBtn.setAttribute('aria-expanded', hudCollapsed ? 'false' : 'true');
}

function hasLiveBlePackets() {
  return Boolean(device) && Date.now() - lastPacketTime < BLE_PACKET_TIMEOUT_MS;
}

function pushBleLog(line) {
  debugLines.push(line);
  if (debugLines.length > 10) {
    debugLines = debugLines.slice(-10);
  }
  bleLogEl.textContent = debugLines.join('\n');
}

function setBleDebugState(text) {
  bleDebugStateEl.textContent = text;
}

function setStatus(text, tone = 'default') {
  statusEl.textContent = text;

  if (tone === 'ok') {
    statusEl.style.color = '#7cf0d0';
    statusEl.style.background = 'rgba(124,240,208,0.08)';
  } else if (tone === 'warn') {
    statusEl.style.color = '#ffd1a6';
    statusEl.style.background = 'rgba(255,180,110,0.08)';
  } else if (tone === 'bad') {
    statusEl.style.color = '#ffafc4';
    statusEl.style.background = 'rgba(255,138,168,0.08)';
  } else {
    statusEl.style.color = '#f3f5ff';
    statusEl.style.background = 'rgba(255,255,255,0.06)';
  }
}

function softClear() {
  ctx.fillStyle = 'rgba(7, 8, 12, 0.05)';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
}

function hardClear() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.fillStyle = '#07080b';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  state.points = [];
  state.sparks = [];
  state.branches = [];
  state.nodes = [];
  state.halos = [];
  state.x = window.innerWidth * 0.5;
  state.y = window.innerHeight * 0.5;
  state.lastX = state.x;
  state.lastY = state.y;
  state.vx = 0;
  state.vy = 0;
  state.baseEnergy = 0.3;
}

function handleMotion(dx, dy, dz, energy) {
  state.lastInput = { dx, dy, dz, energy };
  updateTelemetry();

  const gain = 38 * state.energyGain;

  const ex = clamp(dx * gain, -56, 56);
  const ey = clamp(dy * gain, -56, 56);

  const combinedEnergy = clamp(
    Math.abs(energy) + Math.abs(dz) * 0.35,
    0,
    14
  );

  state.vx = state.vx * state.smooth + ex * (1 - state.smooth);
  state.vy = state.vy * state.smooth + ey * (1 - state.smooth);
  state.baseEnergy = state.baseEnergy * 0.68 + combinedEnergy * 0.32;

  state.x += state.vx;
  state.y += state.vy;

  if (state.x < 40 || state.x > window.innerWidth - 40) state.vx *= -0.8;
  if (state.y < 40 || state.y > window.innerHeight - 40) state.vy *= -0.8;

  state.x = clamp(state.x, 30, window.innerWidth - 30);
  state.y = clamp(state.y, 30, window.innerHeight - 30);

  const currentHue = (hue += 1.2 + combinedEnergy * 0.6) % 360;

  const point = {
    x: state.x,
    y: state.y,
    px: state.lastX,
    py: state.lastY,
    energy: combinedEnergy,
    hue: currentHue,
    width: 1.2 + combinedEnergy * 0.9,
    life: 1
  };

  const bridgeSteps = Math.max(1, Math.ceil(Math.hypot(state.x - state.lastX, state.y - state.lastY) / 20));
  for (let i = 1; i <= bridgeSteps; i++) {
    const mix = i / bridgeSteps;
    state.points.push({
      ...point,
      x: state.lastX + (state.x - state.lastX) * mix,
      y: state.lastY + (state.y - state.lastY) * mix,
      px: state.lastX + (state.x - state.lastX) * ((i - 1) / bridgeSteps),
      py: state.lastY + (state.y - state.lastY) * ((i - 1) / bridgeSteps),
      life: 1
    });
  }
  if (state.points.length > 500) {
    state.points.splice(0, state.points.length - 500);
  }

  if (Math.random() < 0.45) {
    state.sparks.push({
      x: state.x,
      y: state.y,
      radius: 4 + combinedEnergy * 2.2,
      alpha: 0.28 + combinedEnergy * 0.02,
      hue: currentHue
    });
  }

  if (Math.random() < 0.35) {
    state.halos.push({
      x: state.x,
      y: state.y,
      radius: 14 + combinedEnergy * 3.5,
      alpha: 0.08 + combinedEnergy * 0.012,
      hue: currentHue
    });
  }

  if (combinedEnergy > 1.8 && Math.random() < 0.22) {
    state.branches.push({
      x1: state.x,
      y1: state.y,
      x2: state.x + (Math.random() - 0.5) * (50 + combinedEnergy * 20),
      y2: state.y + (Math.random() - 0.5) * (50 + combinedEnergy * 20),
      alpha: 0.16 + combinedEnergy * 0.012,
      hue: currentHue,
      width: 0.8 + combinedEnergy * 0.18
    });
  }

  if (combinedEnergy > 2.6 && Math.random() < 0.08) {
    state.nodes.push({
      x: state.x,
      y: state.y,
      radius: 2.0 + combinedEnergy * 0.5,
      alpha: 0.45,
      hue: currentHue
    });
  }

  state.lastX = state.x;
  state.lastY = state.y;
}

function drawBackgroundField(now) {
  const t = now * 0.00025;
  const sweepX = window.innerWidth * (0.5 + Math.sin(t) * 0.22);
  const sweepY = window.innerHeight * (0.48 + Math.cos(t * 1.2) * 0.16);
  const gradient = ctx.createRadialGradient(
    sweepX,
    sweepY,
    0,
    sweepX,
    sweepY,
    240 + state.baseEnergy * 40
  );

  gradient.addColorStop(0, 'rgba(98, 241, 198, 0.02)');
  gradient.addColorStop(0.5, `rgba(116, 185, 255, ${0.02 + state.baseEnergy * 0.003})`);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
}

function drawPoints() {
  for (let i = 0; i < state.points.length; i++) {
    const p = state.points[i];
    p.life *= 0.9978;

    const alpha = clamp(0.06 + p.life * 0.20, 0, 0.28);

    ctx.beginPath();
    ctx.moveTo(p.px, p.py);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = `hsla(${p.hue}, 85%, 68%, ${alpha})`;
    ctx.lineWidth = p.width;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 6 * state.bloom + p.energy * 1.8;
    ctx.shadowColor = `hsla(${p.hue}, 95%, 72%, ${alpha})`;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

function drawPointLinks() {
  const start = Math.max(1, state.points.length - 45);

  for (let i = start; i < state.points.length; i++) {
    const a = state.points[i - 1];
    const b = state.points[i];
    if (!a || !b) continue;

    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist > 72) continue;

    const alpha = clamp(0.018 + b.energy * 0.008, 0.015, 0.08);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = `hsla(${b.hue}, 100%, 78%, ${alpha})`;
    ctx.lineWidth = 0.55 + b.energy * 0.04;
    ctx.stroke();
  }
}

function drawBranches() {
  state.branches = state.branches.filter((b) => {
    b.alpha *= 0.972;
    if (b.alpha < 0.02) return false;

    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.strokeStyle = `hsla(${b.hue}, 90%, 72%, ${b.alpha})`;
    ctx.lineWidth = b.width;
    ctx.shadowBlur = 5 * state.bloom;
    ctx.shadowColor = `hsla(${b.hue}, 95%, 74%, ${b.alpha})`;
    ctx.stroke();
    ctx.shadowBlur = 0;
    return true;
  });
}

function drawNodes() {
  state.nodes = state.nodes.filter((n) => {
    n.alpha *= 0.978;
    n.radius *= 1.003;

    if (n.alpha < 0.03) return false;

    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${n.hue}, 100%, 86%, ${n.alpha})`;
    ctx.shadowBlur = 8 * state.bloom;
    ctx.shadowColor = `hsla(${n.hue}, 100%, 80%, ${n.alpha})`;
    ctx.fill();
    ctx.shadowBlur = 0;
    return true;
  });
}

function drawSparks() {
  state.sparks = state.sparks.filter((s) => {
    s.alpha *= 0.95;
    s.radius *= 0.988;

    if (s.alpha < 0.025) return false;

    const gradient = ctx.createRadialGradient(
      s.x,
      s.y,
      0,
      s.x,
      s.y,
      s.radius * 2.1 * state.bloom
    );
    gradient.addColorStop(0, `hsla(${s.hue}, 100%, 80%, ${s.alpha})`);
    gradient.addColorStop(0.35, `hsla(${s.hue}, 100%, 70%, ${s.alpha * 0.35})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius * 1.8 * state.bloom, 0, Math.PI * 2);
    ctx.fill();

    return true;
  });
}

function drawHalos() {
  state.halos = state.halos.filter((h) => {
    h.alpha *= 0.955;
    h.radius *= 1.018;

    if (h.alpha < 0.015) return false;

    ctx.beginPath();
    ctx.arc(h.x, h.y, h.radius * state.bloom, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${h.hue}, 100%, 74%, ${h.alpha})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    return true;
  });
}

function drawCursor() {
  const r = 3 + state.baseEnergy * 0.6;

  ctx.beginPath();
  ctx.arc(state.x, state.y, r, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(${hue}, 100%, 85%, 0.9)`;
  ctx.shadowBlur = 18 * state.bloom;
  ctx.shadowColor = `hsla(${hue}, 100%, 80%, 0.9)`;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawCenterPulse() {
  const r = 60 + state.baseEnergy * 10;
  const gradient = ctx.createRadialGradient(
    window.innerWidth * 0.5,
    window.innerHeight * 0.5,
    0,
    window.innerWidth * 0.5,
    window.innerHeight * 0.5,
    r
  );
  gradient.addColorStop(0, 'rgba(158,168,255,0.05)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(window.innerWidth * 0.5, window.innerHeight * 0.5, r, 0, Math.PI * 2);
  ctx.fill();
}

function animate(now) {
  const dt = Math.min((now - lastTime) / 16.666, 2);
  lastTime = now;

  softClear();
  drawBackgroundField(now);
  drawCenterPulse();
  drawPoints();
  drawPointLinks();
  drawBranches();
  drawHalos();
  drawSparks();
  drawNodes();
  drawCursor();

  requestAnimationFrame(animate);
}

async function connectBluefruit() {
  if (!navigator.bluetooth) {
    setStatus('Web Bluetooth Unsupported', 'bad');
    setBleDebugState('unsupported');
    alert('This browser does not support Web Bluetooth.');
    return;
  }

  try {
    setStatus('Opening Chooser...', 'warn');
    setBleDebugState('requesting device');

    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'NeuroCanvas' }],
      optionalServices: [UART_SERVICE]
    });

    device.addEventListener('gattserverdisconnected', onDisconnected);

    server = await device.gatt.connect();
    setBleDebugState('gatt connected');
    const service = await server.getPrimaryService(UART_SERVICE);
    setBleDebugState('uart service found');

    txCharacteristic = await service.getCharacteristic(UART_TX);
    rxCharacteristic = await service.getCharacteristic(UART_RX);
    setBleDebugState('characteristics ready');

    await txCharacteristic.startNotifications();
    txCharacteristic.addEventListener('characteristicvaluechanged', onBleData);
    setBleDebugState('notifications started');
    pushBleLog('Notifications enabled on UART TX');

    packetCount = 0;
    lastPacketTime = 0;
    updateTelemetry();
    setModeLabel('BLE Pending');

    setStatus(`Connected: ${device.name || 'Bluefruit'} (waiting data)`, 'warn');
  } catch (error) {
    console.error(error);
    pushBleLog(`Connect error: ${error?.message || error}`);
    setBleDebugState('connect error');
    setStatus('Connection Failed', 'bad');
  }
}

function onDisconnected() {
  setStatus('Disconnected', 'bad');
  setModeLabel('Pointer');
  setBleDebugState('disconnected');
  pushBleLog('Device disconnected');
  device = null;
  server = null;
  txCharacteristic = null;
  rxCharacteristic = null;
}

async function disconnectBluefruit() {
  if (device?.gatt?.connected) {
    setBleDebugState('disconnecting');
    pushBleLog('Manual disconnect requested');
    device.gatt.disconnect();
  } else {
    onDisconnected();
  }
}

function onBleData(event) {
  const value = event.target.value;
  const chunk = textDecoder.decode(value);
  pushBleLog(`chunk: ${JSON.stringify(chunk)}`);
  setBleDebugState('receiving');

  bleBuffer += chunk;
  const lines = bleBuffer.split('\n');
  bleBuffer = lines.pop() || '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    pushBleLog(`line: ${line}`);

    const parts = line.split(',').map(Number);
    if (parts.length < 4 || parts.some(Number.isNaN)) {
      pushBleLog('ignored: invalid csv');
      continue;
    }

    const [dx, dy, dz, energy] = parts;

    packetCount++;
    lastPacketTime = Date.now();
    setModeLabel('BLE Live');

    handleMotion(dx, dy, dz, energy);
  }
}

async function sendBleText(text) {
  if (!rxCharacteristic) return;
  const encoder = new TextEncoder();
  await rxCharacteristic.writeValue(encoder.encode(text));
}

function toggleHud() {
  hudCollapsed = !hudCollapsed;
  syncHudState();
}

connectBtn.addEventListener('click', connectBluefruit);
disconnectBtn.addEventListener('click', disconnectBluefruit);
hudToggleBtn.addEventListener('click', toggleHud);
clearBtn.addEventListener('click', hardClear);

saveBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `neuro-canvas-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});

canvas.addEventListener('mousemove', (e) => {
  if (device) return;

  setModeLabel('Pointer');
  const dx = (e.movementX || 0) * 0.05;
  const dy = (e.movementY || 0) * 0.05;
  const dz = Math.sin(performance.now() * 0.002) * 0.2;
  const energy = Math.min(6, Math.hypot(dx, dy) * 8);

  handleMotion(dx, dy, dz, energy);
});

smoothRange.addEventListener('input', updateLabels);
energyRange.addEventListener('input', updateLabels);
bloomRange.addEventListener('input', updateLabels);

window.addEventListener('resize', resizeCanvas);

setInterval(() => {
  if (hasLiveBlePackets()) {
    setModeLabel('BLE Live');
    setStatus(`Connected: ${device.name || 'Bluefruit'}`, 'ok');
  } else if (device) {
    setModeLabel('BLE Pending');
    setStatus(`Connected: ${device.name || 'Bluefruit'} (waiting data)`, 'warn');
  }
}, 800);

updateLabels();
updateTelemetry();
setModeLabel('Pointer');
syncHudState();
resizeCanvas();
hardClear();
requestAnimationFrame(animate);
