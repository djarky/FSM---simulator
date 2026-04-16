/**
 * --- CORE MODELS ---
 */

function matchInput(pattern, actual, n) {
    const p = (pattern || "").padStart(n, '0').toUpperCase();
    const a = (actual || "").padStart(n, '0').toUpperCase();
    if (p.length !== a.length) return false;
    for (let i = 0; i < p.length; i++) {
        if (p[i] !== 'X' && p[i] !== a[i]) return false;
    }
    return true;
}

class FSMState {
    constructor(id, x, y, name) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.name = name;
        this.binary = ""; 
        this.output = "0"; // Used in Moore machines
    }
}

class FSMLink {
    constructor(from, to, input, output) {
        this.from = from;
        this.to = to;
        this.input = input; // '0' or '1'
        this.output = output; // string like '01'
    }
}

class AppState {
    constructor() {
        this.states = [];
        this.links = [];
        this.selectedId = null;
        this.mode = 'SELECT'; // 'SELECT', 'ADD', 'CONNECT'
        this.nextStateId = 0;
        this.bits = 0;
        this.machineType = 'MEALY'; // 'MEALY' or 'MOORE'
        this.currentSimulationState = null;
        this.inputBits = ["0"]; // Array of binary strings for X bits
    }

    setMachineType(type) {
        this.machineType = type;
        document.getElementById('machine-subtitle').innerText = `Arquitecto de Máquinas de ${type.charAt(0) + type.slice(1).toLowerCase()}`;
        document.querySelectorAll('.machine-toggle .btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`type-${type.toLowerCase()}`).classList.add('active');
        render();
    }

    addState(x, y) {
        const id = this.nextStateId++;
        const state = new FSMState(id, x, y, `S${id}`);
        this.states.push(state);
        this.updateEncoding();
        return state;
    }

    updateEncoding() {
        this.bits = Math.ceil(Math.log2(Math.max(2, this.states.length)));
        this.states.forEach((s, index) => {
            s.binary = index.toString(2).padStart(this.bits, '0');
        });
    }

    async addLink(fromId, toId) {
        const result = await showModal(this.machineType === 'MOORE' ? 'TRANSITION_ONLY' : 'TRANSITION_MEALY');
        if (!result) return;
        const { input, output } = result;

        this.links = this.links.filter(l => !(l.from === fromId && l.input === input));
        const link = new FSMLink(fromId, toId, input, output || "");
        this.links.push(link);
        render();
    }

    clear() {
        this.states = [];
        this.links = [];
        this.nextStateId = 0;
        this.selectedId = null;
    }

    exportJSON() {
        const data = {
            states: this.states,
            links: this.links,
            machineType: this.machineType,
            nextStateId: this.nextStateId
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fsm_design_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    importJSON(data) {
        try {
            if (!data.states || !data.links || !data.machineType) {
                throw new Error("Formato JSON inválido.");
            }
            this.states = data.states;
            this.links = data.links;
            this.nextStateId = data.nextStateId || (this.states.length > 0 ? Math.max(...this.states.map(s => s.id)) + 1 : 0);
            this.setMachineType(data.machineType);
            this.selectedId = null;
            this.currentSimulationState = null;
            this.updateEncoding();
            render();
        } catch (e) {
            alert("Error al cargar el archivo JSON: " + e.message);
        }
    }
}

/**
 * --- UI ENGINE ---
 */

const svg = document.getElementById('fsm-svg');
const statesLayer = document.getElementById('states-layer');
const linksLayer = document.getElementById('links-layer');
const app = new AppState();

let isDragging = false;
let dragTarget = null;
let offset = { x: 0, y: 0 };
let connectionStart = null;

function render() {
    statesLayer.innerHTML = '';
    linksLayer.innerHTML = '';

    app.links.forEach((link, idx) => {
        const fromState = app.states.find(s => s.id === link.from);
        const toState = app.states.find(s => s.id === link.to);
        if (!fromState || !toState) return;

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const isSelf = fromState.id === toState.id;
        
        let d = "";
        if (isSelf) {
            d = `M ${fromState.x-10} ${fromState.y-25} A 20 20 0 1 1 ${fromState.x+10} ${fromState.y-25}`;
        } else {
            const dx = toState.x - fromState.x;
            const dy = toState.y - fromState.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const midX = (fromState.x + toState.x) / 2 - (dy / dist) * 20;
            const midY = (fromState.y + toState.y) / 2 + (dx / dist) * 20;
            d = `M ${fromState.x} ${fromState.y} Q ${midX} ${midY} ${toState.x} ${toState.y}`;
        }

        path.setAttribute("d", d);
        path.setAttribute("class", "transition-path");
        path.dataset.linkIndex = idx;
        linksLayer.appendChild(path);

        const textArea = document.createElementNS("http://www.w3.org/2000/svg", "text");
        const cp = getPointOnPath(d, 0.5);
        textArea.setAttribute("x", cp.x);
        textArea.setAttribute("y", cp.y - 10);
        textArea.setAttribute("class", "transition-label");
        textArea.dataset.linkIndex = idx;
        textArea.textContent = app.machineType === 'MEALY' ? `${link.input} / ${link.output}` : `${link.input}`;
        linksLayer.appendChild(textArea);
    });

    app.states.forEach(state => {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", state.x);
        circle.setAttribute("cy", state.y);
        circle.setAttribute("r", 25);
        const isSimActive = app.currentSimulationState === state.id;
        circle.setAttribute("class", `state-circle ${app.selectedId === state.id ? 'selected' : ''} ${isSimActive ? 'active-simulation' : ''}`);
        circle.dataset.id = state.id;

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", state.x);
        text.setAttribute("y", state.y + 5);
        text.setAttribute("class", "state-text");
        text.textContent = state.name;

        const code = document.createElementNS("http://www.w3.org/2000/svg", "text");
        code.setAttribute("x", state.x);
        code.setAttribute("y", state.y + 40);
        code.setAttribute("class", "state-text");
        code.style.fontSize = "10px";
        code.style.fill = "var(--text-muted)";
        code.textContent = `(${state.binary})`;

        const outLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
        outLabel.setAttribute("x", state.x);
        outLabel.setAttribute("y", state.y + 18);
        outLabel.setAttribute("class", "state-text");
        outLabel.style.fontSize = "10px";
        outLabel.style.fill = "var(--primary)";
        outLabel.textContent = app.machineType === 'MOORE' ? `Z:${state.output}` : "";

        g.appendChild(circle);
        g.appendChild(text);
        g.appendChild(code);
        g.appendChild(outLabel);
        statesLayer.appendChild(g);
    });
}

function getPointOnPath(d, t) {
    const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tempPath.setAttribute("d", d);
    const len = tempPath.getTotalLength();
    return tempPath.getPointAtLength(len * t);
}

/**
 * --- LOGIC ENGINE (QUINCE-MCCLUSKEY) ---
 */

function minimize(variables, minterms, dontCares = [], nBits = 0, nIn = 0) {
    if (minterms.length === 0) return { text: "0", selection: [] };
    if (minterms.length === (1 << variables)) return { text: "1", selection: [{pi: "-".repeat(variables), color:0}] };

    let implicants = new Set();
    minterms.forEach(m => implicants.add(m.toString(2).padStart(variables, '0')));
    dontCares.forEach(m => implicants.add(m.toString(2).padStart(variables, '0')));

    let primeImplicants = new Set();
    let current = implicants;

    while (current.size > 0) {
        let next = new Set();
        let combined = new Set();
        let list = Array.from(current);

        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                let diff = -1;
                let count = 0;
                for (let k = 0; k < variables; k++) {
                    if (list[i][k] !== list[j][k]) { count++; diff = k; }
                }
                if (count === 1) {
                    let s = list[i].split('');
                    s[diff] = '-';
                    next.add(s.join(''));
                    combined.add(list[i]);
                    combined.add(list[j]);
                }
            }
        }
        list.forEach(item => { if (!combined.has(item)) primeImplicants.add(item); });
        current = next;
    }

    let uncovered = new Set(minterms);
    let finalSelection = [];
    let piList = Array.from(primeImplicants).sort((a,b) => (b.match(/-/g)||[]).length - (a.match(/-/g)||[]).length);

    for (let pi of piList) {
        let isNeeded = false;
        for (let m of Array.from(uncovered)) {
            let mStr = m.toString(2).padStart(variables, '0');
            let match = true;
            for (let k = 0; k < variables; k++) if (pi[k] !== '-' && pi[k] !== mStr[k]) { match = false; break; }
            if (match) { isNeeded = true; break; }
        }
        if (isNeeded) {
            finalSelection.push(pi);
            for (let m of Array.from(uncovered)) {
                let mStr = m.toString(2).padStart(variables, '0');
                let match = true;
                for (let k = 0; k < variables; k++) if (pi[k] !== '-' && pi[k] !== mStr[k]) { match = false; break; }
                if (match) uncovered.delete(m);
            }
        }
    }

    const terms = finalSelection.map((pi, idx) => {
        let parts = [];
        for (let i = 0; i < variables; i++) {
            let name = "";
            if (i < nBits) {
                name = nBits > 1 ? `Q${nBits - 1 - i}` : "Q";
            } else {
                name = nIn > 1 ? `X${nIn - 1 - (i - nBits)}` : "X";
            }
            if (pi[i] === '1') parts.push(name);
            if (pi[i] === '0') parts.push(name + "'");
        }
        return { text: parts.length === 0 ? "1" : parts.join(''), color: idx % 5 };
    });

    return { 
        text: terms.map(t => `<span class="group-color-${t.color}">${t.text}</span>`).join(' + '), 
        selection: finalSelection.map((pi, idx) => ({ pi, color: idx % 5 })) 
    };
}

/**
 * --- POINTER EVENTS (TOUCH & MOUSE) ---
 */

function getSVGPoint(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function showModal(type, currentData = {}, canDelete = false) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('modal-overlay');
        const input = document.getElementById('modal-input');
        const output = document.getElementById('modal-output');
        const save = document.getElementById('modal-save');
        const cancel = document.getElementById('modal-cancel');
        const deleteBtn = document.getElementById('modal-delete');
        const header = document.querySelector('.modal-header');

        deleteBtn.style.display = canDelete ? 'block' : 'none';

        input.parentElement.style.display = 'block';
        output.parentElement.style.display = 'block';

        if (type === 'TRANSITION_ONLY') {
            header.innerText = "Configurar Transición";
            output.parentElement.style.display = 'none';
            input.value = currentData.input || "0";
        } else if (type === 'TRANSITION_MEALY') {
            header.innerText = "Configurar Transición";
            input.value = currentData.input || "0";
            output.value = currentData.output || "0";
        } else if (type === 'STATE_EDIT') {
            header.innerText = "Configurar Estado";
            input.previousElementSibling.innerText = "Nombre del Estado";
            input.value = currentData.name || "";
            if (app.machineType === 'MOORE') {
                output.previousElementSibling.innerText = "Salida (Z)";
                output.value = currentData.output || "0";
            } else {
                output.parentElement.style.display = 'none';
            }
        }

        overlay.style.display = 'flex';
        input.focus();

        const validateBinary = (e) => {
            e.target.value = e.target.value.replace(/[^01Xx]/g, '').toUpperCase();
        };

        const validateStateName = (e) => {
            let val = e.target.value;
            if (!val.startsWith('S')) {
                val = 'S' + val.replace(/S/g, '');
            }
            e.target.value = 'S' + val.substring(1).replace(/[^0-9]/g, '');
        };

        if (type === 'STATE_EDIT') {
            input.oninput = validateStateName;
        } else {
            input.oninput = validateBinary;
        }
        output.oninput = (e) => {
            e.target.value = e.target.value.replace(/[^01]/g, ''); // Outputs must remain binary
        };

        const cleanup = () => {
            overlay.style.display = 'none';
            save.onclick = null;
            cancel.onclick = null;
            // Reset labels
            input.previousElementSibling.innerText = "Entrada (X)";
            output.previousElementSibling.innerText = "Salida (Z)";
        };

        save.onclick = () => {
            const data = { input: input.value, output: output.value, name: input.value };
            cleanup();
            resolve(data);
        };

        cancel.onclick = () => {
            cleanup();
            resolve(null);
        };

        deleteBtn.onclick = () => {
            cleanup();
            resolve({ action: 'DELETE' });
        };
    });
}

svg.addEventListener('pointerdown', (e) => {
    const svgP = getSVGPoint(e);
    const target = e.target.closest('.state-circle');
    const linkTarget = e.target.closest('.transition-path, .transition-label');
    const isCircle = !!target;

    if (app.mode === 'ADD') {
        if (!isCircle) {
            app.addState(svgP.x, svgP.y);
            render();
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
                app.addLink(from, id);
            }
            render();
        }
        return;
    }

    if (app.mode === 'SELECT') {
        const now = Date.now();

        if (isCircle) {
            const id = parseInt(target.dataset.id);
            
            // Double click logic for editing states
            if (this.lastClick && now - this.lastClick < 300 && this.lastClickId === id && this.lastClickType === 'state') {
                isDragging = false;
                dragTarget = null;
                const state = app.states.find(s => s.id === id);
                showModal('STATE_EDIT', state, true).then(res => {
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
                        render();
                    }
                });
                return;
            }
            this.lastClick = now;
            this.lastClickId = id;
            this.lastClickType = 'state';

            isDragging = true;
            dragTarget = app.states.find(s => s.id === id);
            app.selectedId = id;
            offset.x = svgP.x - dragTarget.x;
            offset.y = svgP.y - dragTarget.y;
            render();
        } else if (linkTarget) {
            const idx = parseInt(linkTarget.dataset.linkIndex);
            
            // Double click logic for editing transitions
            if (this.lastClick && now - this.lastClick < 300 && this.lastClickId === idx && this.lastClickType === 'link') {
                const link = app.links[idx];
                showModal(app.machineType === 'MOORE' ? 'TRANSITION_ONLY' : 'TRANSITION_MEALY', link, true).then(res => {
                    if (res) {
                        if (res.action === 'DELETE') {
                            app.links.splice(idx, 1);
                        } else {
                            link.input = res.input;
                            link.output = res.output;
                        }
                        render();
                    }
                });
                return;
            }
            this.lastClick = now;
            this.lastClickId = idx;
            this.lastClickType = 'link';
            
            app.selectedId = null;
            render();
        } else {
            app.selectedId = null;
            render();
        }
    }
});

window.addEventListener('pointermove', (e) => {
    if (isDragging && dragTarget && app.mode === 'SELECT') {
        const svgP = getSVGPoint(e);
        dragTarget.x = svgP.x - offset.x;
        dragTarget.y = svgP.y - offset.y;
        render();
    }
});

window.addEventListener('pointerup', () => {
    isDragging = false;
    dragTarget = null;
});

/**
 * --- UI CONTROLS ---
 */

function setMode(newMode) {
    app.mode = newMode;
    connectionStart = null;
    
    // Update active states
    document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
    document.getElementById(`mode-${newMode.toLowerCase()}`).classList.add('active');

    const toasts = {
        'SELECT': 'Modo Selección: Arrastra para mover estados',
        'ADD': 'Modo Añadir: Toca en cualquier lugar para crear un estado',
        'CONNECT': 'Modo Conectar: Toca el estado ORIGEN'
    };
    document.getElementById('toast').innerText = toasts[newMode];
    render();
}

document.getElementById('mode-select').onclick = () => setMode('SELECT');
document.getElementById('mode-add').onclick = () => setMode('ADD');
document.getElementById('mode-connect').onclick = () => setMode('CONNECT');

document.getElementById('btn-close-analysis').onclick = () => document.getElementById('analysis-panel').style.display = 'none';

document.getElementById('btn-save').onclick = () => app.exportJSON();
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

document.getElementById('btn-clear').onclick = () => {
    const overlay = document.getElementById('confirm-overlay');
    const save = document.getElementById('confirm-save');
    const cancel = document.getElementById('confirm-cancel');

    overlay.style.display = 'flex';

    save.onclick = () => {
        app.clear();
        render();
        overlay.style.display = 'none';
        save.onclick = null;
        cancel.onclick = null;
    };

    cancel.onclick = () => {
        overlay.style.display = 'none';
        save.onclick = null;
        cancel.onclick = null;
    };
};

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
            app.selectedId = null; app.updateEncoding(); render();
        }
    }
});

document.getElementById('btn-example').onclick = () => {
    app.clear();
    const s0 = app.addState(150, 300); const s1 = app.addState(350, 150);
    const s2 = app.addState(550, 300); const s3 = app.addState(350, 450);
    const links = [
        {f: s0.id, t: s1.id, i: '0', o: '11'}, {f: s0.id, t: s2.id, i: '1', o: '00'},
        {f: s1.id, t: s3.id, i: '0', o: '01'}, {f: s1.id, t: s2.id, i: '1', o: '10'},
        {f: s2.id, t: s1.id, i: '0', o: '00'}, {f: s2.id, t: s3.id, i: '1', o: '10'},
        {f: s3.id, t: s0.id, i: '0', o: '01'}, {f: s3.id, t: s2.id, i: '1', o: '10'},
    ];
    links.forEach(l => app.links.push(new FSMLink(l.f, l.t, l.i, l.o)));
    setMode('SELECT');
    render();
};


// Machine Type Toggles
document.getElementById('type-mealy').onclick = () => app.setMachineType('MEALY');
document.getElementById('type-moore').onclick = () => app.setMachineType('MOORE');

// Sidebar Toggle
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
sidebarToggle.onclick = () => {
    sidebar.classList.toggle('collapsed');
    sidebarToggle.classList.toggle('active');
};


/**
 * --- ANALYSIS UI ---
 */

document.getElementById('btn-calculate').onclick = () => {
    document.getElementById('analysis-panel').style.display = 'flex';
    updateAnalysis('truth-table');
};

const tabs = document.querySelectorAll('.tab');
tabs.forEach(t => { t.onclick = () => { tabs.forEach(x => x.classList.remove('active')); t.classList.add('active'); updateAnalysis(t.dataset.tab); }; });

function updateAnalysis(tab) {
    const container = document.getElementById('tab-content-area');
    container.innerHTML = '';
    if (app.states.length === 0) { container.innerHTML = "Diseña una máquina primero."; return; }

    const nBits = app.bits;
    
    // Auto-detect max bits
    let maxInLen = 1;
    let maxOutLen = 1;
    app.links.forEach(l => maxInLen = Math.max(maxInLen, (l.input || "").length));
    if (app.machineType === 'MOORE') {
        app.states.forEach(s => maxOutLen = Math.max(maxOutLen, (s.output || "").length));
    } else {
        app.links.forEach(l => maxOutLen = Math.max(maxOutLen, (l.output || "").length));
    }
    
    const nIn = maxInLen;
    const nOut = maxOutLen;
    const nVars = nBits + nIn;

    if (tab === 'truth-table') {
        const isMoore = app.machineType === 'MOORE';
        let h = `<table class="truth-table"><tr><th>Actual (Q)</th><th>Entrada (X)</th><th>Sig. (Q+)</th><th>Z (${isMoore ? 'Q' : 'Q,X'})</th></tr>`;
        app.states.forEach((s, idx) => {
            const rowCount = 1 << nIn;
            for (let i = 0; i < rowCount; i++) {
                const xStr = i.toString(2).padStart(nIn, '0');
                const l = app.links.find(link => link.from === s.id && matchInput(link.input, xStr, nIn));
                const nextS = l ? app.states.find(st => st.id === l.to) : null;
                const outputRaw = isMoore ? s.output : (l ? l.output : "");
                const output = (outputRaw || "").padStart(nOut, '0');
                h += `<tr><td>${s.binary}</td><td>${xStr}</td><td>${nextS ? nextS.binary : "-"}</td><td>${output}</td></tr>`;
            }
        });
        container.innerHTML = h + `</table>`;
    }
    if (tab === 'kmaps' || tab === 'equations') {
        const isMoore = app.machineType === 'MOORE';
        const nMS = Array(nBits).fill().map(() => []);
        const nMO = Array(nOut).fill().map(() => []);

        app.states.forEach((s, idx) => {
            const rowCount = 1 << nIn;
            for (let i = 0; i < rowCount; i++) {
                const xStr = i.toString(2).padStart(nIn, '0');
                const l = app.links.find(link => link.from === s.id && matchInput(link.input, xStr, nIn));
                const nextS = l ? app.states.find(st => st.id === l.to) : null;
                const m = (idx << nIn) | i;
                
                if (nextS) {
                    for (let b = 0; b < nBits; b++) if (nextS.binary[b] === '1') nMS[b].push(m);
                }
                
                const outVal = (l && l.output ? l.output : "").padStart(nOut, '0');
                if (!isMoore && l) {
                    for (let o = 0; o < nOut; o++) if (outVal[nOut - 1 - o] === '1') nMO[o].push(m);
                }
            }

            if (isMoore) {
                const outVal = (s.output || "").padStart(nOut, '0');
                for (let o = 0; o < nOut; o++) {
                    if (outVal[nOut - 1 - o] === '1') {
                        for (let i = 0; i < (1 << nIn); i++) {
                            nMO[o].push((idx << nIn) | i);
                        }
                    }
                }
            }
        });

        if (tab === 'equations') {
            let h = `<h3>Ecuaciones Siguiente Estado (Q+)</h3>`;
            for(let b=0; b<nBits; b++) {
                const res = minimize(nVars, nMS[b], [], nBits, nIn);
                const bitName = nBits > 1 ? `Q${nBits-1-b}+` : "Q+";
                h += `<div class="equation">${bitName} = ${res.text}</div>`;
            }
            h += `<h3 style="margin-top:20px">Ecuaciones Salida (Z)</h3>`;
            for(let o=0; o<nOut; o++) {
                const res = minimize(nVars, nMO[o], [], nBits, nIn);
                const outName = nOut > 1 ? `Z${nOut-1-o}` : "Z";
                h += `<div class="equation">${outName} = ${res.text}</div>`;
            }
            container.innerHTML = h + `<p style="font-size:0.75rem; color:var(--text-muted); margin-top:20px">Vbles: Q = Bits de Estado, X = Bits de Entrada</p>`;
        } else {
            if (nVars > 4) { container.innerHTML = "Mapas de Karnaugh visuales limitados a 4 variables."; return; }
            const gray = ["00", "01", "11", "10"], gray1 = ["0", "1"];
            const rowCodes = nVars === 4 ? gray : gray1;
            const colCodes = (nVars === 4 || nVars === 3) ? gray : gray1;

            const renderMap = (title, mList) => {
                const res = minimize(nVars, mList, [], nBits, nIn);
                let h = `<div class="kmap-container"><p><b>${title}</b></p><div class="kmap-grid">`;
                
                // Construct axis label
                const qVars = nBits > 1 ? `Q${nBits-1}..0` : "Q";
                const xVars = nIn > 1 ? `X${nIn-1}..0` : "X";
                h += `<div class="kmap-row"><div class="kmap-cell" style="border:none; font-size:0.6rem">${qVars}\\${xVars}</div>${colCodes.map(c => `<div class="kmap-header">${c}</div>`).join('')}</div>`;
                
                rowCodes.forEach(r => {
                    h += `<div class="kmap-row"><div class="kmap-header">${r}</div>`;
                    colCodes.forEach(c => {
                        const m = parseInt(r + c, 2);
                        const hasVal = mList.includes(m);
                        h += `<div class="kmap-cell">${hasVal ? '1' : '0'}`;
                        res.selection.forEach(sel => {
                            let match = true;
                            let ms = m.toString(2).padStart(nVars, '0');
                            for (let k = 0; k < nVars; k++) if (sel.pi[k] !== '-' && sel.pi[k] !== ms[k]) { match = false; break; }
                            if (match) h += `<div class="kmap-marker border-color-${sel.color}"></div>`;
                        });
                        h += `</div>`;
                    });
                    h += `</div>`;
                });
                return h + `</div><div class="equation" style="font-size:0.8rem">${res.text}</div></div>`;
            };

            let fullH = `<h3>Mapas de Karnaugh (Siguiente Estado)</h3>`;
            for(let b=0; b<nBits; b++) fullH += renderMap(`Bit D${nBits-1-b}`, nMS[b]);
            fullH += `<h3>Mapas de Karnaugh (Salidas)</h3>`;
            for(let o=0; o<nOut; o++) fullH += renderMap(`Salida Z${nOut-1-o}`, nMO[o]);
            container.innerHTML = fullH;
        }
    }
}

/**
 * --- SIMULATION ENGINE ---
 */

function updateSimulationPanel() {
    const inputsArea = document.getElementById('io-inputs');
    const outputsArea = document.getElementById('io-outputs');
    
    // Auto-detect lengths
    let maxInLen = 1;
    let maxOutLen = 1;
    app.links.forEach(l => maxInLen = Math.max(maxInLen, (l.input || "").length));
    if (app.machineType === 'MOORE') {
        app.states.forEach(s => maxOutLen = Math.max(maxOutLen, (s.output || "").length));
    } else {
        app.links.forEach(l => maxOutLen = Math.max(maxOutLen, (l.output || "").length));
    }

    // Sync input bits array length
    while(app.inputBits.length < maxInLen) app.inputBits.push("0");
    if(app.inputBits.length > maxInLen) app.inputBits.length = maxInLen;

    // Initialize simulation state if needed
    if (app.currentSimulationState === null && app.states.length > 0) {
        app.currentSimulationState = app.states[0].id;
    }

    // Update Output LEDs
    outputsArea.innerHTML = '';
    let currentOutput = "0".repeat(maxOutLen);
    if (app.currentSimulationState !== null) {
        const state = app.states.find(s => s.id === app.currentSimulationState);
        if (state) {
            if (app.machineType === 'MOORE') {
                currentOutput = (state.output || "").padStart(maxOutLen, '0');
            } else {
                const inputQuery = app.inputBits.join('');
                const l = app.links.find(link => link.from === state.id && matchInput(link.input, inputQuery, maxInLen));
                if (l) currentOutput = (l.output || "").padStart(maxOutLen, '0');
            }
        }
    }

    for (let i = 0; i < maxOutLen; i++) {
        const item = document.createElement('div');
        item.className = 'io-item';
        const led = document.createElement('div');
        led.className = `led ${currentOutput[maxOutLen - 1 - i] === '1' ? 'active-z' : ''}`;
        const label = document.createElement('div');
        label.className = 'io-bit-label';
        label.innerText = `Z${i}`;
        item.appendChild(led);
        item.appendChild(label);
        outputsArea.appendChild(item);
    }

    // Update Input Switches
    inputsArea.innerHTML = '';
    for (let i = 0; i < maxInLen; i++) {
        const item = document.createElement('div');
        item.className = 'io-item';
        const sw = document.createElement('div');
        sw.className = `io-switch ${app.inputBits[maxInLen - 1 - i] === '1' ? 'active' : ''}`;
        sw.onclick = () => {
            app.inputBits[maxInLen - 1 - i] = app.inputBits[maxInLen - 1 - i] === '1' ? '0' : '1';
            updateSimulationPanel();
        };
        const label = document.createElement('div');
        label.className = 'io-bit-label';
        label.innerText = `X${i}`;
        item.appendChild(sw);
        item.appendChild(label);
        inputsArea.appendChild(item);
    }
}

function triggerClock() {
    if (app.states.length === 0 || app.currentSimulationState === null) return;
    
    const state = app.states.find(s => s.id === app.currentSimulationState);
    if (!state) return;

    let maxInLen = 1;
    app.links.forEach(l => maxInLen = Math.max(maxInLen, (l.input || "").length));
    const inputQuery = app.inputBits.join('');
    
    const l = app.links.find(link => link.from === state.id && matchInput(link.input, inputQuery, maxInLen));
    if (l) {
        app.currentSimulationState = l.to;
        render(); // Highlights the new current state
    }
}

document.getElementById('btn-clk').onclick = triggerClock;

// Update sim panel whenever rendering or selecting
const originalRender = render;
render = function() {
    originalRender();
    updateSimulationPanel();
};

// Initialize
setMode('SELECT');
render();
