import { AppState, FSMLink } from './models.js';
import { render } from './ui-render.js';
import { getSVGPoint } from './utils.js';
import { showModal, showConfirm, showSavePrompt } from './modals.js';
import { updateAnalysis } from './analysis.js';
import { updateSimulationPanel, triggerClock } from './simulation.js';
import { exportToSimulIDE } from './simulide-export.js?v=10';
import { exportToKiCad } from './kicad-export.js?v=10';
import { exportToLivewire } from './livewire-export.js';
import { exportToWinCUPL } from './wincupl-export.js';
import { exportToVHDL } from './vhdl-export.js';
import { exportToVerilog } from './verilog-export.js';
import { exportToArduino } from './arduino-export.js';

/**
 * --- MAIN ---
 */

const svg = document.getElementById('fsm-svg');
const viewport = document.getElementById('viewport');
const gridPattern = document.getElementById('grid');
const statesLayer = document.getElementById('states-layer');
const linksLayer = document.getElementById('links-layer');
const analysisContainer = document.getElementById('tab-content-area');

const app = new AppState();

// UI Elements for simulation
const simElements = {
    inputsArea: document.getElementById('io-inputs'),
    outputsArea: document.getElementById('io-outputs')
};

// Override render to include simulation update
app.onRender = () => {
    render(app, { statesLayer, linksLayer });
    updateSimulationPanel(app, simElements);
};

let isDragging = false;
let dragTarget = null;
let offset = { x: 0, y: 0 };
let connectionStart = null;
let lastClick = 0;
let lastClickId = null;
let lastClickType = null;

// Zoom and Pan state
let currentScale = 1;
let currentPanX = 0;
let currentPanY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let initialPan = { x: 0, y: 0 };

function updateTransform() {
    viewport.setAttribute('transform', `translate(${currentPanX}, ${currentPanY}) scale(${currentScale})`);
    gridPattern.setAttribute('patternTransform', `translate(${currentPanX}, ${currentPanY}) scale(${currentScale})`);
}

function setMode(newMode) {
    app.mode = newMode;
    connectionStart = null;
    
    document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
    const modeBtn = document.getElementById(`mode-${newMode.toLowerCase()}`);
    if (modeBtn) modeBtn.classList.add('active');

    const toasts = {
        'SELECT': 'Modo Selección: Arrastra para mover estados',
        'ADD': 'Modo Añadir: Toca en cualquier lugar para crear un estado',
        'CONNECT': 'Modo Conectar: Toca el estado ORIGEN'
    };
    const toast = document.getElementById('toast');
    if (toast) toast.innerText = toasts[newMode];
    app.onRender();
}

// --- Gesture tracking (touch only) ---
const activePointers = new Map(); // pointerId -> event
let gestureActive = false; // true when 2-finger gesture in progress
let initialPinchDistance = 0;
let initialPinchMidpoint = { clientX: 0, clientY: 0 };
let initialGestureScale = 1;
let initialGesturePan = { x: 0, y: 0 };

function getDistance(p1, p2) {
    const dx = p2.clientX - p1.clientX;
    const dy = p2.clientY - p1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getMidpoint(p1, p2) {
    return {
        clientX: (p1.clientX + p2.clientX) / 2,
        clientY: (p1.clientY + p2.clientY) / 2
    };
}

// --- Primary SVG interaction (clicks, drags, single-finger pan) ---
svg.addEventListener('pointerdown', (e) => {
    // Track pointer for gesture detection
    activePointers.set(e.pointerId, e);

    // If two fingers down -> start pinch/pan gesture, cancel any drag
    if (activePointers.size === 2) {
        isDragging = false;
        dragTarget = null;
        isPanning = false;
        gestureActive = true;

        const pts = [...activePointers.values()];
        initialPinchDistance = getDistance(pts[0], pts[1]);
        initialGestureScale = currentScale;
        initialPinchMidpoint = getMidpoint(pts[0], pts[1]);
        initialGesturePan = { x: currentPanX, y: currentPanY };
        e.preventDefault();
        return;
    }

    // If already in a multi-touch gesture, ignore
    if (gestureActive) { e.preventDefault(); return; }

    // --- Single pointer logic (mouse or single touch) ---
    const svgP = getSVGPoint(e, viewport);
    const target = e.target.closest('.state-circle');
    const linkTarget = e.target.closest('.transition-path, .transition-label');
    const isCircle = !!target;

    if (app.mode === 'ADD') {
        if (!isCircle) {
            app.addState(svgP.x, svgP.y);
            app.onRender();
        }
        return;
    }

    if (app.mode === 'CONNECT') {
        if (isCircle) {
            const id = parseInt(target.dataset.id);
            if (connectionStart === null) {
                connectionStart = id;
                app.selectedId = id;
                document.getElementById('toast').innerText = "Toca el estado DESTINO";
            } else {
                const from = connectionStart;
                connectionStart = null;
                app.selectedId = null;
                document.getElementById('toast').innerText = "Toca el estado ORIGEN";
                app.addLink(from, id, showModal);
            }
            app.onRender();
        }
        return;
    }

    if (app.mode === 'SELECT') {
        const now = Date.now();

        if (isCircle) {
            const id = parseInt(target.dataset.id);
            
            if (lastClick && now - lastClick < 300 && lastClickId === id && lastClickType === 'state') {
                isDragging = false;
                dragTarget = null;
                const state = app.states.find(s => s.id === id);
                showModal('STATE_EDIT', state, true, app.machineType).then(res => {
                    if (res) {
                        if (res.action === 'DELETE') {
                            app.states = app.states.filter(s => s.id !== id);
                            app.links = app.links.filter(l => l.from !== id && l.to !== id);
                            app.selectedId = null;
                            app.updateEncoding();
                        } else {
                            state.name = res.name;
                            if (app.machineType === 'MOORE') state.output = res.output;
                        }
                        app.onRender();
                    }
                });
                return;
            }
            lastClick = now;
            lastClickId = id;
            lastClickType = 'state';

            isDragging = true;
            dragTarget = app.states.find(s => s.id === id);
            app.selectedId = id;
            offset.x = svgP.x - dragTarget.x;
            offset.y = svgP.y - dragTarget.y;
            app.onRender();
        } else if (linkTarget) {
            const idx = parseInt(linkTarget.dataset.linkIndex);
            
            if (lastClick && now - lastClick < 300 && lastClickId === idx && lastClickType === 'link') {
                const link = app.links[idx];
                showModal(app.machineType === 'MOORE' ? 'TRANSITION_ONLY' : 'TRANSITION_MEALY', link, true).then(res => {
                    if (res) {
                        if (res.action === 'DELETE') {
                            app.links.splice(idx, 1);
                        } else {
                            link.input = res.input;
                            link.output = res.output;
                        }
                        app.onRender();
                    }
                });
                return;
            }
            lastClick = now;
            lastClickId = idx;
            lastClickType = 'link';
            
            app.selectedId = null;
            app.onRender();
        } else {
            // Background drag -> pan canvas
            isPanning = true;
            panStart = { x: e.clientX, y: e.clientY };
            initialPan = { x: currentPanX, y: currentPanY };
            app.selectedId = null;
            app.onRender();
        }
    }
});

// --- Pointer Move ---
window.addEventListener('pointermove', (e) => {
    // Update pointer in gesture cache
    if (activePointers.has(e.pointerId)) {
        activePointers.set(e.pointerId, e);
    }

    // Two-finger gesture (pinch-to-zoom + pan)
    if (gestureActive && activePointers.size >= 2) {
        const pts = [...activePointers.values()];
        const p1 = pts[0], p2 = pts[1];

        const currentDist = getDistance(p1, p2);
        const currentMid = getMidpoint(p1, p2);

        let scaleFactor = currentDist / initialPinchDistance;
        if (isNaN(scaleFactor) || !isFinite(scaleFactor) || scaleFactor === 0) scaleFactor = 1;
        const newScale = Math.min(Math.max(initialGestureScale * scaleFactor, 0.15), 5);

        const parentPt = getSVGPoint(initialPinchMidpoint, svg);
        const localPt = getSVGPoint(initialPinchMidpoint, viewport);

        const panDx = currentMid.clientX - initialPinchMidpoint.clientX;
        const panDy = currentMid.clientY - initialPinchMidpoint.clientY;

        currentScale = newScale;
        currentPanX = parentPt.x - currentScale * localPt.x + panDx;
        currentPanY = parentPt.y - currentScale * localPt.y + panDy;

        updateTransform();
        return;
    }

    // Single pointer: drag state or pan canvas
    if (isDragging && dragTarget && app.mode === 'SELECT') {
        const svgP = getSVGPoint(e, viewport);
        dragTarget.x = svgP.x - offset.x;
        dragTarget.y = svgP.y - offset.y;
        app.onRender();
    } else if (isPanning) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        currentPanX = initialPan.x + dx;
        currentPanY = initialPan.y + dy;
        updateTransform();
    }
});

// --- Pointer Up / Cancel ---
const handlePointerUp = (e) => {
    activePointers.delete(e.pointerId);

    if (activePointers.size < 2) {
        gestureActive = false;
        initialPinchDistance = 0;
    }

    if (activePointers.size === 0) {
        isDragging = false;
        dragTarget = null;
        isPanning = false;
    }
};

window.addEventListener('pointerup', handlePointerUp);
window.addEventListener('pointercancel', handlePointerUp);

// --- Wheel Zoom (mouse scroll) ---
svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    const direction = e.deltaY < 0 ? 1 : -1;
    
    const newScale = direction > 0 ? currentScale * zoomFactor : currentScale / zoomFactor;
    const clampedScale = Math.min(Math.max(newScale, 0.15), 5);
    
    const mousePt = { clientX: e.clientX, clientY: e.clientY };
    const parentPt = getSVGPoint(mousePt, svg);
    const localPt = getSVGPoint(mousePt, viewport);
    
    currentScale = clampedScale;
    currentPanX = parentPt.x - currentScale * localPt.x;
    currentPanY = parentPt.y - currentScale * localPt.y;
    
    updateTransform();
}, { passive: false });

// Sidebar & Mode Toggles
document.getElementById('mode-select').onclick = () => setMode('SELECT');
document.getElementById('mode-add').onclick = () => setMode('ADD');
document.getElementById('mode-connect').onclick = () => setMode('CONNECT');

document.getElementById('type-mealy').onclick = () => app.setMachineType('MEALY');
document.getElementById('type-moore').onclick = () => app.setMachineType('MOORE');

const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
sidebarToggle.onclick = () => {
    sidebar.classList.toggle('collapsed');
    sidebarToggle.classList.toggle('active');
};

// Global Buttons
document.getElementById('btn-save').onclick = async () => {
    const filename = await showSavePrompt(`fsm_design_${new Date().toISOString().slice(0,10)}`);
    if (filename) app.exportJSON(filename);
};
document.getElementById('btn-simulide').onclick = async () => {
    const filename = await showSavePrompt(`fsm_logic_${new Date().toISOString().slice(0, 10)}`);
    if (filename) exportToSimulIDE(app, filename);
};
document.getElementById('btn-kicad').onclick = async () => {
    const filename = await showSavePrompt(`fsm_kicad_${new Date().toISOString().slice(0, 10)}`);
    if (filename) exportToKiCad(app, filename);
};
document.getElementById('btn-livewire').onclick = async () => {
    const filename = await showSavePrompt(`fsm_livewire_${new Date().toISOString().slice(0, 10)}`);
    if (filename) exportToLivewire(app, filename);
};
document.getElementById('btn-wincupl').onclick = async () => {
    const filename = await showSavePrompt(`fsm_wincupl_${new Date().toISOString().slice(0, 10)}`);
    if (filename) exportToWinCUPL(app, filename);
};
document.getElementById('btn-vhdl').onclick = async () => {
    const filename = await showSavePrompt(`fsm_vhdl_${new Date().toISOString().slice(0, 10)}`);
    if (filename) exportToVHDL(app, filename);
};
document.getElementById('btn-verilog').onclick = async () => {
    const filename = await showSavePrompt(`fsm_verilog_${new Date().toISOString().slice(0, 10)}`);
    if (filename) exportToVerilog(app, filename);
};
document.getElementById('btn-arduino').onclick = async () => {
    const filename = await showSavePrompt(`fsm_arduino_${new Date().toISOString().slice(0, 10)}`);
    if (filename) exportToArduino(app, filename);
};
document.getElementById('btn-load').onclick = () => document.getElementById('file-input').click();
document.getElementById('file-input').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (re) => {
        try {
            const data = JSON.parse(re.target.result);
            app.importJSON(data);
        } catch (err) {
            alert("Error al procesar el archivo JSON: " + err.message);
        }
    };
    reader.readAsText(file);
    e.target.value = '';
};

document.getElementById('btn-clear').onclick = async () => {
    const confirmed = await showConfirm('confirm-overlay');
    if (confirmed) {
        app.clear();
        app.onRender();
    }
};

document.getElementById('btn-example').onclick = () => {
    app.clear();
    const s0 = app.addState(150, 300); const s1 = app.addState(350, 150);
    const s2 = app.addState(550, 300); const s3 = app.addState(350, 450);
    const exampleLinks = [
        {f: s0.id, t: s1.id, i: '0', o: '11'}, {f: s0.id, t: s2.id, i: '1', o: '00'},
        {f: s1.id, t: s3.id, i: '0', o: '01'}, {f: s1.id, t: s2.id, i: '1', o: '10'},
        {f: s2.id, t: s1.id, i: '0', o: '00'}, {f: s2.id, t: s3.id, i: '1', o: '10'},
        {f: s3.id, t: s0.id, i: '0', o: '01'}, {f: s3.id, t: s2.id, i: '1', o: '10'},
    ];
    exampleLinks.forEach(l => app.links.push(new FSMLink(l.f, l.t, l.i, l.o)));
    setMode('SELECT');
    app.onRender();
};

// Analysis Panel
document.getElementById('btn-calculate').onclick = () => {
    document.getElementById('analysis-panel').style.display = 'flex';
    updateAnalysis('truth-table', app, analysisContainer);
};

document.getElementById('btn-close-analysis').onclick = () => {
    document.getElementById('analysis-panel').style.display = 'none';
};

const tabs = document.querySelectorAll('.tab');
tabs.forEach(t => { 
    t.onclick = () => { 
        tabs.forEach(x => x.classList.remove('active')); 
        t.classList.add('active'); 
        updateAnalysis(t.dataset.tab, app, analysisContainer); 
    }; 
});

// Simulation
document.getElementById('btn-clk').onclick = () => triggerClock(app, app.onRender);

// Keydown Events
window.addEventListener('keydown', (e) => {
    if (e.target.tagName.toLowerCase() === 'input') return;

    if (e.key === 'Escape') {
        setMode('SELECT');
        document.getElementById('analysis-panel').style.display = 'none';
        document.getElementById('modal-overlay').style.display = 'none';
    }
    if (e.key.toLowerCase() === 's') setMode('ADD');
    if (e.key.toLowerCase() === 'c') setMode('CONNECT');
    
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (app.selectedId !== null) {
            app.states = app.states.filter(s => s.id !== app.selectedId);
            app.links = app.links.filter(l => l.from !== app.selectedId && l.to !== app.selectedId);
            app.selectedId = null; 
            app.updateEncoding(); 
            app.onRender();
        }
    }
});

// Floating Bubble Controls Binding
const toggleBtn = document.getElementById('controls-toggle');
const controlsContainer = document.getElementById('canvas-controls-container');

toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    controlsContainer.classList.toggle('expanded');
    toggleBtn.classList.toggle('active');
});

// Close panel when clicking outside
document.addEventListener('click', (e) => {
    if (!controlsContainer.contains(e.target)) {
        controlsContainer.classList.remove('expanded');
        toggleBtn.classList.remove('active');
    }
});

// Zoom operations
function zoomRelativeToCenter(factor) {
    const rect = svg.getBoundingClientRect();
    const centerScreen = {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
    };
    
    const parentPt = getSVGPoint(centerScreen, svg);
    const localPt = getSVGPoint(centerScreen, viewport);
    
    const newScale = Math.min(Math.max(currentScale * factor, 0.15), 5);
    
    currentScale = newScale;
    currentPanX = parentPt.x - currentScale * localPt.x;
    currentPanY = parentPt.y - currentScale * localPt.y;
    
    updateTransform();
}

document.getElementById('zoom-in').addEventListener('click', () => {
    zoomRelativeToCenter(1.2);
});

document.getElementById('zoom-out').addEventListener('click', () => {
    zoomRelativeToCenter(1 / 1.2);
});

document.getElementById('zoom-reset').addEventListener('click', () => {
    currentScale = 1;
    currentPanX = 0;
    currentPanY = 0;
    updateTransform();
});

document.getElementById('zoom-fit').addEventListener('click', () => {
    if (app.states.length === 0) {
        currentScale = 1;
        currentPanX = 0;
        currentPanY = 0;
        updateTransform();
        return;
    }
    
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    app.states.forEach(s => {
        const radius = 50;
        if (s.x - radius < minX) minX = s.x - radius;
        if (s.x + radius > maxX) maxX = s.x + radius;
        if (s.y - radius < minY) minY = s.y - radius;
        if (s.y + radius > maxY) maxY = s.y + radius;
    });
    
    const bboxW = maxX - minX;
    const bboxH = maxY - minY;
    
    const rect = svg.getBoundingClientRect();
    const svgW = rect.width;
    const svgH = rect.height;
    
    const paddingMultiplier = 0.85;
    const scaleX = (svgW * paddingMultiplier) / bboxW;
    const scaleY = (svgH * paddingMultiplier) / bboxH;
    let newScale = Math.min(scaleX, scaleY);
    newScale = Math.min(Math.max(newScale, 0.2), 3);
    
    const bboxCenterX = (minX + maxX) / 2;
    const bboxCenterY = (minY + maxY) / 2;
    
    const svgCenterX = svgW / 2;
    const svgCenterY = svgH / 2;
    
    currentScale = newScale;
    currentPanX = svgCenterX - currentScale * bboxCenterX;
    currentPanY = svgCenterY - currentScale * bboxCenterY;
    
    updateTransform();
});

// Panning operations
function panOffset(dx, dy) {
    currentPanX += dx;
    currentPanY += dy;
    updateTransform();
}

document.getElementById('pan-up').addEventListener('click', () => panOffset(0, 100));
document.getElementById('pan-down').addEventListener('click', () => panOffset(0, -100));
document.getElementById('pan-left').addEventListener('click', () => panOffset(100, 0));
document.getElementById('pan-right').addEventListener('click', () => panOffset(-100, 0));

// Initial Render
setMode('SELECT');
app.onRender();
