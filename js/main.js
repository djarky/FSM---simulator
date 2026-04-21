import { AppState, FSMLink } from './models.js';
import { render } from './ui-render.js';
import { getSVGPoint } from './utils.js';
import { showModal, showConfirm, showSavePrompt } from './modals.js';
import { updateAnalysis } from './analysis.js';
import { updateSimulationPanel, triggerClock } from './simulation.js';
import { exportToSimulIDE } from './simulide-export.js?v=7';
import { exportToKiCad } from './kicad-export.js';
import { exportToLivewire } from './livewire-export.js';

/**
 * --- MAIN ---
 */

const svg = document.getElementById('fsm-svg');
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

// SVG Events
svg.addEventListener('pointerdown', (e) => {
    const svgP = getSVGPoint(e, svg);
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
            app.selectedId = null;
            app.onRender();
        }
    }
});

window.addEventListener('pointermove', (e) => {
    if (isDragging && dragTarget && app.mode === 'SELECT') {
        const svgP = getSVGPoint(e, svg);
        dragTarget.x = svgP.x - offset.x;
        dragTarget.y = svgP.y - offset.y;
        app.onRender();
    }
});

window.addEventListener('pointerup', () => {
    isDragging = false;
    dragTarget = null;
});

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

// Initial Render
setMode('SELECT');
app.onRender();
