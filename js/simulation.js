import { matchInput } from './models.js';

/**
 * --- SIMULATION ---
 */

export function updateSimulationPanel(app, elements) {
    const { inputsArea, outputsArea } = elements;
    
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
            updateSimulationPanel(app, elements);
        };
        const label = document.createElement('div');
        label.className = 'io-bit-label';
        label.innerText = `X${i}`;
        item.appendChild(sw);
        item.appendChild(label);
        inputsArea.appendChild(item);
    }
}

export function triggerClock(app, onRender) {
    if (app.states.length === 0 || app.currentSimulationState === null) return;
    
    const state = app.states.find(s => s.id === app.currentSimulationState);
    if (!state) return;

    let maxInLen = 1;
    app.links.forEach(l => maxInLen = Math.max(maxInLen, (l.input || "").length));
    const inputQuery = app.inputBits.join('');
    
    const l = app.links.find(link => link.from === state.id && matchInput(link.input, inputQuery, maxInLen));
    if (l) {
        app.currentSimulationState = l.to;
        onRender(); // Highlights the new current state
    }
}
