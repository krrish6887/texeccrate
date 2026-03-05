/* =========================================================
   MineGuard AI — Simulation Engine & Dashboard Controller
   TEXMiN · BIT Sindri · Underground CPS Safety System
   ========================================================= */

'use strict';

// ─── CONSTANTS & CONFIG ────────────────────────────────────────────────────────
const ZONES = [
    { id: 'zone1', name: 'Goaf Edge · Sector A', sensorCount: 4 },
    { id: 'zone2', name: 'Longwall Face · LW4', sensorCount: 5 },
    { id: 'zone3', name: 'Return Airway · R2', sensorCount: 4 },
    { id: 'zone4', name: 'E-Panel (Electrical)', sensorCount: 3 },
];

// Gas safety thresholds
const THRESHOLDS = {
    CH4: { warn: 0.5, danger: 1.0, max: 5.0, unit: '% Vol' },
    CO: { warn: 25, danger: 100, max: 1200, unit: 'ppm' },
    CO2: { warn: 0.5, danger: 1.0, max: 3.0, unit: '% Vol' },
    O2: { warn: 19.5, danger: 18.0, max: 21.0, unit: '% Vol', inverted: true },
};

const SENSOR_NAMES = [
    'GS-CH4-01', 'GS-CO-01', 'GS-CO2-01', 'GS-O2-01',
    'GS-CH4-02', 'GS-CO-02', 'GS-CO2-02', 'GS-O2-02',
    'GS-CH4-03', 'GS-CO-03', 'GS-CO2-03', 'GS-O2-03',
    'GS-CH4-04', 'GS-CO-04', 'GS-CO2-04', 'GS-O2-04',
];

const CHART_WINDOW = 60; // data points
const UPDATE_INTERVAL = 2000; // ms per tick

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
    tick: 0,
    startTime: Date.now(),
    dataPoints: 0,
    alertCount: 0,
    crisisMode: false,
    ventilationOn: true,
    silenced: false,
    sensorStatus: SENSOR_NAMES.map(() => 'online'),

    zones: ZONES.map(z => ({
        ...z,
        CH4: 0.12, CO: 8, CO2: 0.18, O2: 20.9,
        risk: 'SAFE',
        confidence: 92,
        drift: { CH4: 0, CO: 0, CO2: 0, O2: 0 },
    })),

    history: {
        labels: [],
        CH4: [], CO: [], CO2: [], O2: [],
    },

    alertLog: [],
};

// ─── CHART INSTANCES ──────────────────────────────────────────────────────────
let trendChart = null;
const gaugeCharts = {};

// ─── UTILITY ──────────────────────────────────────────────────────────────────
function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }
function rand(min, max) { return Math.random() * (max - min) + min; }
function fmtTime(d) { return d.toLocaleTimeString('en-IN', { hour12: false }); }
function fmtDate(d) { return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }); }

function gasRisk(zone) {
    const t = THRESHOLDS;
    if (zone.CH4 >= t.CH4.danger || zone.CO >= t.CO.danger || zone.CO2 >= t.CO2.danger || zone.O2 <= t.O2.danger)
        return 'DANGER';
    if (zone.CH4 >= t.CH4.warn || zone.CO >= t.CO.warn || zone.CO2 >= t.CO2.warn || zone.O2 <= t.O2.warn)
        return 'WARNING';
    return 'SAFE';
}

function riskClass(risk) {
    if (risk === 'DANGER') return 'danger';
    if (risk === 'WARNING') return 'warning';
    return 'safe';
}

function aiConfidence(zone) {
    // Simulate AI confidence: higher when conditions are clear
    const baseConf = 88 + Math.random() * 8;
    const risk = gasRisk(zone);
    if (risk === 'DANGER') return Math.round(clamp(baseConf - 10, 60, 99));
    if (risk === 'WARNING') return Math.round(clamp(baseConf - 5, 72, 99));
    return Math.round(clamp(baseConf, 80, 99));
}

// ─── SENSOR SIMULATION ────────────────────────────────────────────────────────
function simulateZone(zone, crisis) {
    const vent = state.ventilationOn ? 0.97 : 1.0; // ventilation reduces buildup

    if (crisis && (zone.id === 'zone1' || zone.id === 'zone2')) {
        // Crisis injection — spike CH4 and CO
        zone.drift.CH4 += rand(0.04, 0.12);
        zone.drift.CO += rand(4, 12);
        zone.drift.O2 -= rand(0.03, 0.08);
    } else {
        // Normal drift — Brownian motion with mean reversion
        zone.drift.CH4 = (zone.drift.CH4 * 0.85 + rand(-0.01, 0.015)) * vent;
        zone.drift.CO = (zone.drift.CO * 0.85 + rand(-1.5, 2.5)) * vent;
        zone.drift.CO2 = (zone.drift.CO2 * 0.85 + rand(-0.01, 0.012)) * vent;
        zone.drift.O2 = (zone.drift.O2 * 0.85 + rand(-0.02, 0.01));
    }

    // Apply drift to gas values, clamp within physical limits
    zone.CH4 = clamp(zone.CH4 + zone.drift.CH4, 0.05, 4.5);
    zone.CO = clamp(zone.CO + zone.drift.CO, 1, 900);
    zone.CO2 = clamp(zone.CO2 + zone.drift.CO2, 0.03, 2.5);
    zone.O2 = clamp(zone.O2 + zone.drift.O2, 14, 21.0);

    // Ventilation recovery nudges values toward normal
    if (state.ventilationOn) {
        zone.CH4 = zone.CH4 * 0.995 + 0.10 * 0.005;
        zone.CO = zone.CO * 0.994 + 5 * 0.006;
        zone.CO2 = zone.CO2 * 0.995 + 0.15 * 0.005;
        zone.O2 = zone.O2 * 0.996 + 20.9 * 0.004;
    }
}

// ─── CHART: TREND LINE ────────────────────────────────────────────────────────
function initTrendChart() {
    const ctx = document.getElementById('trendChart').getContext('2d');
    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'CH₄ (% Vol)',
                    data: [], borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.05)',
                    borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true,
                },
                {
                    label: 'CO (/100 ppm)',
                    data: [], borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.05)',
                    borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true,
                },
                {
                    label: 'CO₂ (% Vol)',
                    data: [], borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.05)',
                    borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true,
                },
                {
                    label: 'O₂ (/10 % Vol)',
                    data: [], borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.05)',
                    borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true,
                },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 300 },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#07142a',
                    borderColor: '#1a3255', borderWidth: 1,
                    titleColor: '#94a3b8', bodyColor: '#e2e8f0',
                    padding: 10,
                },
            },
            scales: {
                x: {
                    ticks: { color: '#475569', font: { family: 'JetBrains Mono', size: 9 }, maxRotation: 0, maxTicksLimit: 8 },
                    grid: { color: '#1a325533' },
                },
                y: {
                    ticks: { color: '#475569', font: { family: 'JetBrains Mono', size: 9 } },
                    grid: { color: '#1a325533' },
                    min: 0,
                },
            },
        },
    });
}

function updateTrendChart(avgCH4, avgCO, avgCO2, avgO2, label) {
    const d = trendChart.data;
    d.labels.push(label);
    d.datasets[0].data.push(+avgCH4.toFixed(3));
    d.datasets[1].data.push(+(avgCO / 100).toFixed(3));
    d.datasets[2].data.push(+avgCO2.toFixed(3));
    d.datasets[3].data.push(+(avgO2 / 10).toFixed(3));

    if (d.labels.length > CHART_WINDOW) {
        d.labels.shift();
        d.datasets.forEach(ds => ds.shift && ds.data.shift());
    }
    trendChart.update('none');
}

// ─── CHART: GAUGES ────────────────────────────────────────────────────────────
function makeGaugeChart(canvasId, color) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    return new Chart(ctx, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [0, 100],
                backgroundColor: [color, '#1a3255'],
                borderWidth: 0,
                circumference: 180,
                rotation: 270,
            }],
        },
        options: {
            responsive: true,
            animation: { duration: 500 },
            cutout: '70%',
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
        },
    });
}

function initGauges() {
    gaugeCharts.CH4 = makeGaugeChart('gaugeCH4', '#f59e0b');
    gaugeCharts.CO = makeGaugeChart('gaugeCO', '#f87171');
    gaugeCharts.CO2 = makeGaugeChart('gaugeCO2', '#60a5fa');
    gaugeCharts.O2 = makeGaugeChart('gaugeO2', '#34d399');
}

function updateGauge(name, pct) {
    const c = gaugeCharts[name];
    const used = clamp(pct, 0, 100);
    c.data.datasets[0].data = [used, 100 - used];
    const col = used > 75 ? '#ef4444' : used > 40 ? '#f59e0b' : (name === 'O2' ? '#34d399' : c.data.datasets[0].backgroundColor[0]);
    c.data.datasets[0].backgroundColor[0] = col;
    c.update('none');
}

// ─── KPI CARDS ────────────────────────────────────────────────────────────────
function updateKPI(gas, value, prev) {
    const idMap = { CH4: 'CH4', CO: 'CO', CO2: 'CO2', O2: 'O2' };
    const id = idMap[gas];
    const t = THRESHOLDS[gas];

    const valEl = document.getElementById('val' + id);
    const barEl = document.getElementById('bar' + id);
    const trendEl = document.getElementById('trend' + id);
    const cardEl = document.getElementById('kpi' + id);

    // Format
    let displayed, pct;
    if (gas === 'CO') {
        displayed = Math.round(value);
        pct = clamp((value / t.max) * 100, 0, 100);
    } else {
        displayed = value.toFixed(2);
        pct = gas === 'O2'
            ? clamp(((21.0 - value) / (21.0 - t.danger)) * 100, 0, 100) // inverted
            : clamp((value / t.max) * 100, 0, 100);
    }

    valEl.textContent = displayed;

    // Bar color & width
    let barColor = '#22c55e';
    if (gas === 'O2') {
        barColor = value <= t.danger ? '#ef4444' : value <= t.warn ? '#f59e0b' : '#22c55e';
    } else {
        barColor = value >= t.danger ? '#ef4444' : value >= t.warn ? '#f59e0b' : '#22c55e';
    }
    barEl.style.width = pct + '%';
    barEl.style.background = barColor;

    // Trend label
    const delta = value - prev;
    if (Math.abs(delta) < (gas === 'CO' ? 0.5 : 0.005)) {
        trendEl.textContent = '— Stable'; trendEl.className = 'kpi-trend';
    } else if (delta > 0) {
        trendEl.textContent = gas === 'O2' ? '▼ Decreasing' : '▲ Rising';
        trendEl.className = 'kpi-trend ' + (gas === 'O2' ? 'up warn' : 'up');
    } else {
        trendEl.textContent = gas === 'O2' ? '▲ Recovery' : '▼ Falling';
        trendEl.className = 'kpi-trend';
    }

    // Card status class
    cardEl.className = 'kpi-card';
    if (gas === 'O2') {
        if (value <= t.danger) cardEl.classList.add('danger');
        else if (value <= t.warn) cardEl.classList.add('warning');
    } else {
        if (value >= t.danger) cardEl.classList.add('danger');
        else if (value >= t.warn) cardEl.classList.add('warning');
    }

    updateGauge(gas, pct);
}

// ─── SIDEBAR ZONE BUTTONS & DOTS ──────────────────────────────────────────────
function updateZoneNav(zone, idx) {
    const n = idx + 1;
    const dot = document.getElementById('dotZone' + n);
    const risk = document.getElementById('riskZone' + n);

    const cls = riskClass(zone.risk);
    dot.className = 'zone-dot ' + (cls === 'danger' ? 'danger' : cls === 'warning' ? 'warn' : '');
    risk.textContent = zone.risk;
    risk.className = 'zone-risk ' + (cls === 'danger' ? 'danger' : cls === 'warning' ? 'warn' : '');
}

// ─── AI RISK CARDS ────────────────────────────────────────────────────────────
function updateAICard(zone, idx) {
    const n = idx + 1;
    const card = document.getElementById('aiCard' + n);
    const badge = document.getElementById('aiBadge' + n);
    const confEl = document.getElementById('aiConf' + n);
    const bar = document.getElementById('aiBar' + n);
    const readings = document.getElementById('aiReadings' + n);

    const cls = riskClass(zone.risk);
    card.className = 'ai-zone-card ' + (cls === 'safe' ? '' : cls);
    badge.textContent = zone.risk;
    badge.className = 'ai-status-badge ' + cls;
    confEl.textContent = zone.confidence + '%';
    bar.style.width = zone.confidence + '%';
    bar.className = 'ai-conf-bar ' + cls;
    readings.textContent = `CH₄: ${zone.CH4.toFixed(2)}% · CO: ${Math.round(zone.CO)}ppm · O₂: ${zone.O2.toFixed(1)}%`;
}

// ─── MINE MAP ─────────────────────────────────────────────────────────────────
const MAP_COLORS = {
    safe: { fill: '#0f2a1a', stroke: '#22c55e', dot: '#22c55e', text: '#86efac' },
    warning: { fill: '#2a1a0a', stroke: '#f59e0b', dot: '#f59e0b', text: '#fcd34d' },
    danger: { fill: '#2a0a0a', stroke: '#ef4444', dot: '#ef4444', text: '#fca5a5' },
};

function updateMap(zone, idx) {
    const n = idx + 1;
    const rect = document.getElementById('mapZone' + n);
    const dot = document.getElementById('mapDot' + n);
    const label = document.getElementById('mapRisk' + n);
    if (!rect) return;

    const cls = riskClass(zone.risk);
    const col = MAP_COLORS[cls];
    rect.setAttribute('fill', col.fill);
    rect.setAttribute('stroke', col.stroke);
    dot.setAttribute('fill', col.dot);
    dot.className.baseVal = 'map-pulse ' + (cls === 'safe' ? '' : cls);
    label.textContent = zone.risk;
    label.setAttribute('fill', col.text);
}

// ─── ALERTS ──────────────────────────────────────────────────────────────────
function addAlert(type, title, sub) {
    const ts = fmtTime(new Date());
    state.alertLog.unshift({ type, title, sub, ts });
    if (state.alertLog.length > 60) state.alertLog.pop();

    // Update alert log panel
    renderAlertLog();

    // Badge
    if (type !== 'safe') {
        state.alertCount++;
        const badge = document.getElementById('alertBadge');
        badge.textContent = state.alertCount > 99 ? '99+' : state.alertCount;
        badge.style.display = 'flex';
    }

    // Toast
    if (!state.silenced || type === 'danger') {
        showToast(type, title, sub);
    }
}

function renderAlertLog() {
    const log = document.getElementById('alertLog');
    if (state.alertLog.length === 0) {
        log.innerHTML = '<div class="alert-empty">No active alerts. System nominal.</div>';
        return;
    }
    log.innerHTML = state.alertLog.map(a => `
    <div class="alert-item ${a.type}">
      <span class="alert-item-dot"></span>
      <div class="alert-item-body">
        <div class="alert-item-title">${a.title}</div>
        <div class="alert-item-sub">${a.sub}</div>
      </div>
      <span class="alert-item-time">${a.ts}</span>
    </div>
  `).join('');
}

function showToast(type, title, sub) {
    const container = document.getElementById('toastContainer');
    const icons = { danger: '🚨', warning: '⚠️', safe: '✅', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-sub">${sub}</div>
    </div>
  `;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('toast-fade'); setTimeout(() => toast.remove(), 400); }, 4500);
}

// ─── SENSOR HEALTH ────────────────────────────────────────────────────────────
function initSensorHealth() {
    const grid = document.getElementById('sensorHealthGrid');
    grid.innerHTML = SENSOR_NAMES.map((name, i) => `
    <div class="sh-item" id="sh${i}">
      <span class="sh-dot online" id="shDot${i}"></span>
      <span class="sh-label">${name}</span>
    </div>
  `).join('');
}

function flickerSensor() {
    // Randomly take 0-1 sensors offline briefly for realism
    const idx = Math.floor(Math.random() * SENSOR_NAMES.length);
    const dot = document.getElementById('shDot' + idx);
    if (!dot) return;
    dot.className = 'sh-dot offline';
    state.sensorStatus[idx] = 'offline';
    document.getElementById('statSensors').textContent = `${SENSOR_NAMES.length - 1} / ${SENSOR_NAMES.length}`;
    setTimeout(() => {
        dot.className = 'sh-dot online';
        state.sensorStatus[idx] = 'online';
        document.getElementById('statSensors').textContent = `${SENSOR_NAMES.length} / ${SENSOR_NAMES.length}`;
    }, 3000 + Math.random() * 4000);
}

// ─── UPTIME ───────────────────────────────────────────────────────────────────
function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${h}:${m}:${sec}`;
}

// ─── CLOCK ─────────────────────────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    document.getElementById('systemClock').textContent = fmtTime(now);
    document.getElementById('systemDate').textContent = fmtDate(now);
}

// ─── MAIN UPDATE LOOP ─────────────────────────────────────────────────────────
let prevCH4 = 0.12, prevCO = 8, prevCO2 = 0.18, prevO2 = 20.9;

function tick() {
    state.tick++;
    state.dataPoints += ZONES.length * 4; // 4 gases × 4 zones
    const now = new Date();

    // ── Simulate all zones
    state.zones.forEach(zone => simulateZone(zone, state.crisisMode));

    // ── Compute averages for KPI display
    const avgCH4 = state.zones.reduce((s, z) => s + z.CH4, 0) / ZONES.length;
    const avgCO = state.zones.reduce((s, z) => s + z.CO, 0) / ZONES.length;
    const avgCO2 = state.zones.reduce((s, z) => s + z.CO2, 0) / ZONES.length;
    const avgO2 = state.zones.reduce((s, z) => s + z.O2, 0) / ZONES.length;

    // ── KPI cards
    updateKPI('CH4', avgCH4, prevCH4);
    updateKPI('CO', avgCO, prevCO);
    updateKPI('CO2', avgCO2, prevCO2);
    updateKPI('O2', avgO2, prevO2);
    prevCH4 = avgCH4; prevCO = avgCO; prevCO2 = avgCO2; prevO2 = avgO2;

    // ── Trend chart
    updateTrendChart(avgCH4, avgCO, avgCO2, avgO2, fmtTime(now).slice(0, 5));

    // ── Per-zone AI + map + alerts
    let overallRisk = 'SAFE';
    state.zones.forEach((zone, i) => {
        const prevRisk = zone.risk;
        zone.risk = gasRisk(zone);
        zone.confidence = aiConfidence(zone);

        updateZoneNav(zone, i);
        updateAICard(zone, i);
        updateMap(zone, i);

        // Alert on risk change
        if (zone.risk !== prevRisk) {
            if (zone.risk === 'DANGER') {
                addAlert('danger', `⚡ CRITICAL: ${zone.name}`, `CH₄ ${zone.CH4.toFixed(2)}% · CO ${Math.round(zone.CO)} ppm — Danger threshold exceeded!`);
            } else if (zone.risk === 'WARNING') {
                addAlert('warning', `⚠️ WARNING: ${zone.name}`, `Gas levels approaching unsafe limits. Monitoring escalated.`);
            } else if (prevRisk !== 'SAFE') {
                addAlert('safe', `✔ RESOLVED: ${zone.name}`, `Gas levels returned to safe range. Continuous monitoring active.`);
            }
        }

        if (zone.risk === 'DANGER') overallRisk = 'DANGER';
        else if (zone.risk === 'WARNING' && overallRisk !== 'DANGER') overallRisk = 'WARNING';
    });

    // ── Footer stats
    document.getElementById('statDataPoints').textContent = state.dataPoints.toLocaleString();
    document.getElementById('statUptime').textContent = formatUptime(Date.now() - state.startTime);
    document.getElementById('statLastInfer').textContent = fmtTime(now);

    // ── Occasionally flicker a sensor for realism
    if (state.tick % 25 === 0) flickerSensor();

    // ── Crisis auto-reset after 20 ticks
    if (state.crisisMode && state.tick % 20 === 0) {
        state.crisisMode = false;
        document.getElementById('btnCrisis').style.background = '';
        showToast('info', 'Crisis Simulation Ended', 'System returning to baseline. Ventilation active.');
        addAlert('warning', '🔴 Crisis Simulation Ended', 'AI predicted event resolved. Ventilation engaged.');
    }
}

// ─── CONTROLS ─────────────────────────────────────────────────────────────────
function initControls() {
    // Inject Crisis
    document.getElementById('btnCrisis').addEventListener('click', () => {
        state.crisisMode = true;
        state.silenced = false;
        document.getElementById('btnCrisis').style.background = '#7f1d1d';
        addAlert('danger', '🚨 CRISIS INJECTED — Demo Mode', 'Simulating rapid CH₄ surge in Goaf Edge & Longwall Face…');
        showToast('danger', 'CRISIS MODE ACTIVATED', 'Methane spike detected in Zone 1 & 2. AI risk classifier engaged!');
    });

    // Ventilation toggle
    document.getElementById('btnVent').addEventListener('click', () => {
        state.ventilationOn = !state.ventilationOn;
        const label = document.getElementById('ventLabel');
        const mapLabel = document.getElementById('ventValueMap');
        label.textContent = state.ventilationOn ? 'Ventilation: AUTO' : 'Ventilation: OFF';
        mapLabel.textContent = state.ventilationOn ? 'AUTO — ACTIVE' : 'MANUAL — OFF ⚠';
        mapLabel.style.fill = state.ventilationOn ? '' : '#f87171';
        document.getElementById('btnVent').style.borderColor = state.ventilationOn ? '#3b82f6' : '#ef4444';
        addAlert(state.ventilationOn ? 'safe' : 'warning',
            state.ventilationOn ? 'Ventilation System Reactivated' : '⚠ Ventilation Disabled',
            state.ventilationOn ? 'Automated airflow control restored.' : 'Manual override active. Monitor gas levels closely!');
    });

    // Silence alarms
    document.getElementById('btnSilence').addEventListener('click', () => {
        state.silenced = !state.silenced;
        const btn = document.getElementById('btnSilence');
        btn.style.borderColor = state.silenced ? '#f59e0b' : '';
        btn.style.color = state.silenced ? '#f59e0b' : '';
    });

    // Clear alert log
    document.getElementById('btnClearLog').addEventListener('click', () => {
        state.alertLog = [];
        state.alertCount = 0;
        renderAlertLog();
        document.getElementById('alertBadge').style.display = 'none';
    });

    // Zone navigation — click to highlight
    document.getElementById('zoneNav').querySelectorAll('.zone-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.zone-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
function init() {
    initSensorHealth();
    initTrendChart();
    initGauges();
    initControls();
    updateClock();

    // Add system-ready alert
    setTimeout(() => {
        addAlert('safe', '✔ System Online — MineGuard AI v2.0', 'All 16 sensors connected. AI models loaded. Real-time monitoring active.');
        showToast('safe', 'MineGuard AI Online', 'All sensors connected. Monitoring underground gas conditions…');
    }, 800);

    // Update clock every second
    setInterval(updateClock, 1000);

    // Main simulation loop
    setInterval(tick, UPDATE_INTERVAL);

    // Initial tick
    setTimeout(tick, 500);
}

// Start when DOM ready
document.addEventListener('DOMContentLoaded', init);
