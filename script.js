/* ================================================================
   1. STORAGE LAYER
   ================================================================ */
const hasArtifactStorage = (typeof window.storage !== 'undefined');
const memory = {};

async function storeGet(key) {
  if (hasArtifactStorage) {
    try { 
      const r = await window.storage.get(key); 
      return r ? r.value : null; 
    } catch(e) { 
      return null; 
    }
  }
  return memory[key] ?? null;
}

async function storeSet(key, value) {
  if (hasArtifactStorage) {
    try { 
      await window.storage.set(key, value); 
      return; 
    } catch(e) {}
  }
  memory[key] = value;
}

/* ================================================================
   2. STATE CONTROLLER
   ================================================================ */
const DEFAULT_SETTINGS = {
  focus: 25, short: 5, long: 15, interval: 4, goal: 8,
  autoBreak: false, autoFocus: false, sound: true, theme: 'light'
};

let settings = { ...DEFAULT_SETTINGS };
let stats = {};                 // Schema: { "YYYY-MM-DD": { sessions, minutes } }
let mode = 'focus';
let timeLeft = settings.focus * 60;
let isRunning = false;
let endAt = null;                // Target modern timestamp bounds
let tickHandle = null;
let cyclePos = 0;                // Inter-loop counter logic

const els = {
  minTens: document.getElementById('minTens'),
  minOnes: document.getElementById('minOnes'),
  secTens: document.getElementById('secTens'),
  secOnes: document.getElementById('secOnes'),
  startBtn: document.getElementById('startBtn'),
  resetBtn: document.getElementById('resetBtn'),
  skipBtn: document.getElementById('skipBtn'),
  modeTabs: document.querySelectorAll('.mode-tab'),
  cycleDots: document.getElementById('cycleDots'),
  goalLabel: document.getElementById('goalLabel'),
  goalPct: document.getElementById('goalPct'),
  goalFill: document.getElementById('goalFill'),
  toast: document.getElementById('toast'),
};

/* ================================================================
   3. SPLIT-FLAP TRANSITION GENERATOR
   ================================================================ */
function buildDigit(el) {
  el.innerHTML = `<div class="flip-digit-inner">
      <div class="face front">0</div>
      <div class="face back">0</div>
    </div>`;
}
[els.minTens, els.minOnes, els.secTens, els.secOnes].forEach(buildDigit);

function flipDigit(el, value) {
  const front = el.querySelector('.face.front');
  const back  = el.querySelector('.face.back');
  if (front.textContent === String(value)) return;   
  
  back.textContent = value;
  const inner = el.querySelector('.flip-digit-inner');
  inner.classList.add('flip-anim');                  
  
  inner.addEventListener('transitionend', function done() {
    inner.classList.add('no-transition');             
    inner.classList.remove('flip-anim');               
    front.textContent = value;                         
    inner.offsetHeight;                                 
    inner.classList.remove('no-transition');           
    inner.removeEventListener('transitionend', done);
  }, { once: true });
}

function renderClock() {
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  flipDigit(els.minTens, Math.floor(m / 10));
  flipDigit(els.minOnes, m % 10);
  flipDigit(els.secTens, Math.floor(s / 10));
  flipDigit(els.secOnes, s % 10);
  document.title = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} — Flow`;
}

/* ================================================================
   4. NAVIGATION AND CYCLE LAYOUTS
   ================================================================ */
function durationFor(m) {
  return (m === 'focus' ? settings.focus : m === 'short' ? settings.short : settings.long) * 60;
}

function setMode(newMode, { resetTime = true } = {}) {
  mode = newMode;
  document.documentElement.setAttribute('data-mode', mode);
  els.modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  if (resetTime) timeLeft = durationFor(mode);
  renderClock();
  renderCycleDots();
}

function renderCycleDots() {
  els.cycleDots.innerHTML = '';
  for (let i = 0; i < settings.interval; i++) {
    const dot = document.createElement('span');
    dot.className = 'lamp' + (i < cyclePos ? ' lit' : '');
    els.cycleDots.appendChild(dot);
  }
}

/* ================================================================
   5. ENGINE SYSTEM (Anti-Drift Reference Checks)
   ================================================================ */
function startTimer() {
  if (isRunning) return;
  isRunning = true;
  endAt = Date.now() + timeLeft * 1000;
  els.startBtn.textContent = 'Pause';
  tickHandle = setInterval(tick, 250);
}

function pauseTimer() {
  isRunning = false;
  clearInterval(tickHandle);
  els.startBtn.textContent = 'Start';
}

function resetTimer() {
  pauseTimer();
  timeLeft = durationFor(mode);
  renderClock();
}

function tick() {
  timeLeft = Math.max(0, Math.round((endAt - Date.now()) / 1000));
  renderClock();
  if (timeLeft <= 0) {
    pauseTimer();
    completeSession();
  }
}

function nextMode() {
  if (mode === 'focus') {
    cyclePos++;
    return cyclePos >= settings.interval ? 'long' : 'short';
  }
  if (mode === 'long') cyclePos = 0;
  return 'focus';
}

async function completeSession() {
  if (mode === 'focus') await logFocusSession();
  playAlarm();
  showToast(mode === 'focus' ? 'Focus session complete — take a break.' : 'Break\u2019s over — back to focus.');
  const upcoming = nextMode();
  setMode(upcoming);
  const shouldAutoStart = upcoming === 'focus' ? settings.autoFocus : settings.autoBreak;
  if (shouldAutoStart) startTimer();
}

function skipSession() {
  pauseTimer();
  const upcoming = nextMode();
  setMode(upcoming);
}

/* ================================================================
   6. SOUND OSCILLATOR (Web Audio API synthesis)
   ================================================================ */
function playAlarm() {
  if (!settings.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1100, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine'; 
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.22);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.22 + 0.02);
      gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + i * 0.22 + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.22);
      osc.stop(ctx.currentTime + i * 0.22 + 0.2);
    });
  } catch(e) {}
}

/* ================================================================
   7. STATISTICS & METRIC LOGISTICS
   ================================================================ */
function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function logFocusSession() {
  const key = todayKey();
  const day = stats[key] || { sessions: 0, minutes: 0 };
  day.sessions += 1;
  day.minutes += settings.focus;
  stats[key] = day;
  await storeSet('stats', JSON.stringify(stats));
  renderGoal();
}

function renderGoal() {
  const today = stats[todayKey()] || { sessions: 0, minutes: 0 };
  const pct = Math.min(100, Math.round((today.sessions / settings.goal) * 100));
  els.goalLabel.textContent = `${today.sessions} / ${settings.goal} sessions today`;
  els.goalPct.textContent = `${pct}%`;
  els.goalFill.style.width = pct + '%';
}

function renderStatsPanel() {
  const today = stats[todayKey()] || { sessions: 0, minutes: 0 };
  let streak = 0;
  for (let i = 0; ; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if ((stats[todayKey(d)]?.sessions || 0) > 0) streak++; else break;
  }
  const allTime = Object.values(stats).reduce((sum, d) => sum + d.sessions, 0);
  document.getElementById('statToday').textContent = today.sessions;
  document.getElementById('statMinutes').textContent = today.minutes;
  document.getElementById('statStreak').textContent = streak;
  document.getElementById('statAllTime').textContent = allTime;

  const chart = document.getElementById('weekChart');
  chart.innerHTML = '';
  const maxSessions = Math.max(1, ...Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return stats[todayKey(d)]?.sessions || 0;
  }));
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const count = stats[todayKey(d)]?.sessions || 0;
    const col = document.createElement('div');
    col.className = 'week-col';
    col.innerHTML = `<div class="week-bar ${count > 0 ? 'has-data' : ''}" style="height:${Math.max(6, (count / maxSessions) * 70)}px"></div>
      <span class="week-day">${d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)}</span>`;
    chart.appendChild(col);
  }
}

/* ================================================================
   8. FORMS & INPUT HANDLING
   ================================================================ */
function fillSettingsForm() {
  document.getElementById('setFocus').value = settings.focus;
  document.getElementById('setShort').value = settings.short;
  document.getElementById('setLong').value = settings.long;
  document.getElementById('setInterval').value = settings.interval;
  document.getElementById('setGoal').value = settings.goal;
  document.getElementById('setAutoBreak').checked = settings.autoBreak;
  document.getElementById('setAutoFocus').checked = settings.autoFocus;
  document.getElementById('setSound').checked = settings.sound;
}

async function saveSettingsForm() {
  settings.focus    = clamp(+document.getElementById('setFocus').value, 1, 180);
  settings.short     = clamp(+document.getElementById('setShort').value, 1, 60);
  settings.long       = clamp(+document.getElementById('setLong').value, 1, 90);
  settings.interval = clamp(+document.getElementById('setInterval').value, 2, 8);
  settings.goal       = clamp(+document.getElementById('setGoal').value, 1, 24);
  settings.autoBreak = document.getElementById('setAutoBreak').checked;
  settings.autoFocus  = document.getElementById('setAutoFocus').checked;
  settings.sound       = document.getElementById('setSound').checked;
  
  await storeSet('settings', JSON.stringify(settings));
  if (!isRunning) timeLeft = durationFor(mode);   
  renderClock(); renderCycleDots(); renderGoal();
  closePanel('settingsOverlay');
  showToast('Settings saved.');
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, isNaN(n) ? lo : n)); }

/* ================================================================
   9. INTERFACE EMISSION HELPERS (Theme, Overlays, Toasts)
   ================================================================ */
async function setTheme(theme) {
  settings.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeBtn').textContent = theme === 'dark' ? '☀️' : '🌙';
  await storeSet('settings', JSON.stringify(settings));
}

function openPanel(id) { document.getElementById(id).classList.add('open'); }
function closePanel(id) { document.getElementById(id).classList.remove('open'); }

let toastTimer = null;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
}

/* ================================================================
   10. INTERACTION LISTENERS & BOOTSTRAP
   ================================================================ */
els.startBtn.addEventListener('click', () => isRunning ? pauseTimer() : startTimer());
els.resetBtn.addEventListener('click', resetTimer);
els.skipBtn.addEventListener('click', skipSession);

els.modeTabs.forEach(tab => tab.addEventListener('click', () => {
  pauseTimer();
  setMode(tab.dataset.mode);
}));

document.getElementById('statsBtn').addEventListener('click', () => { renderStatsPanel(); openPanel('statsOverlay'); });
document.getElementById('settingsBtn').addEventListener('click', () => { fillSettingsForm(); openPanel('settingsOverlay'); });
document.getElementById('themeBtn').addEventListener('click', () => setTheme(settings.theme === 'dark' ? 'light' : 'dark'));
document.getElementById('saveSettingsBtn').addEventListener('click', saveSettingsForm);

document.querySelectorAll('[data-close]').forEach(btn =>
  btn.addEventListener('click', () => closePanel(btn.dataset.close)));

document.querySelectorAll('.panel-overlay').forEach(ov =>
  ov.addEventListener('click', e => { if (e.target === ov) closePanel(ov.id); }));

document.addEventListener('keydown', e => {
  if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    isRunning ? pauseTimer() : startTimer();
  }
});

// Initialization
async function init() {
  const savedSettings = await storeGet('settings');
  if (savedSettings) { try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) }; } catch(e) {} }
  const savedStats = await storeGet('stats');
  if (savedStats) { try { stats = JSON.parse(savedStats); } catch(e) {} }

  document.documentElement.setAttribute('data-theme', settings.theme);
  document.getElementById('themeBtn').textContent = settings.theme === 'dark' ? '☀️' : '🌙';

  setMode('focus');
  renderGoal();
}
init();