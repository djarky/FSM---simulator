/**
 * --- CORE MODELS ---
 */

export function matchInput(pattern, actual, n) {
    const p = (pattern || "").padStart(n, '0').toUpperCase();
    const a = (actual || "").padStart(n, '0').toUpperCase();
    if (p.length !== a.length) return false;
    for (let i = 0; i < p.length; i++) {
        if (p[i] !== 'X' && p[i] !== a[i]) return false;
    }
    return true;
}

export class FSMState {
    constructor(id, x, y, name) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.name = name;
        this.binary = ""; 
        this.output = "0"; // Used in Moore machines
    }
}

export class FSMLink {
    constructor(from, to, input, output) {
        this.from = from;
        this.to = to;
        this.input = input; // '0' or '1'
        this.output = output; // string like '01'
    }
}

export class AppState {
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
        this.onRender = () => {}; // Callback to trigger render
    }

    setMachineType(type) {
        this.machineType = type;
        const subtitle = document.getElementById('machine-subtitle');
        if (subtitle) subtitle.innerText = `Arquitecto de Máquinas de ${type.charAt(0) + type.slice(1).toLowerCase()}`;
        
        document.querySelectorAll('.machine-toggle .btn').forEach(b => b.classList.remove('active'));
        const typeBtn = document.getElementById(`type-${type.toLowerCase()}`);
        if (typeBtn) typeBtn.classList.add('active');
        
        this.onRender();
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

    async addLink(fromId, toId, showModalFn) {
        const result = await showModalFn(this.machineType === 'MOORE' ? 'TRANSITION_ONLY' : 'TRANSITION_MEALY');
        if (!result) return;
        const { input, output } = result;

        this.links = this.links.filter(l => !(l.from === fromId && l.input === input));
        const link = new FSMLink(fromId, toId, input, output || "");
        this.links.push(link);
        this.onRender();
    }

    clear() {
        this.states = [];
        this.links = [];
        this.nextStateId = 0;
        this.selectedId = null;
    }

    exportJSON(filename) {
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
        
        let finalName = filename || `fsm_design_${new Date().toISOString().slice(0,10)}`;
        if (!finalName.endsWith('.json')) finalName += '.json';
        
        a.download = finalName;
        document.body.appendChild(a);
        a.click();
        
        // Remove and revoke with a small delay to ensure the browser has read the URL
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
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
            this.onRender();
        } catch (e) {
            alert("Error al cargar el archivo JSON: " + e.message);
        }
    }
}
