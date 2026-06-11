/**
 * --- ARDUINO EXPORTER ---
 * Generates synthesizable Arduino sketch (.ino) using a loop-based FSM style.
 * Detects rising edge on a physical CLK pin (Pin 2) and RST pin (Pin 3).
 * Supports both Mealy and Moore machine types.
 */

export function exportToArduino(app, filename) {
    if (!app || !app.states || app.states.length === 0) {
        alert("Diseña una máquina primero.");
        return;
    }

    const isMoore = app.machineType === 'MOORE';

    // Auto-detect max input and output bit lengths
    let nIn = 1;
    let nOut = 1;
    app.links.forEach(l => {
        if (l.input) nIn = Math.max(nIn, l.input.length);
        if (!isMoore && l.output) nOut = Math.max(nOut, l.output.length);
    });
    if (isMoore) {
        app.states.forEach(s => {
            if (s.output) nOut = Math.max(nOut, s.output.length);
        });
    }

    // --- Inputs/Outputs Names ---
    const inputNames = [];
    for (let i = 0; i < nIn; i++) {
        const name = nIn > 1 ? `X${nIn - 1 - i}` : "X";
        inputNames.push(name);
    }

    const outputNames = [];
    for (let i = 0; i < nOut; i++) {
        const name = nOut > 1 ? `Z${i}` : "Z";
        outputNames.push(name);
    }

    // Sanitize state names for valid C++ identifiers
    const stateNamesMap = new Map();
    app.states.forEach(s => {
        let clean = s.name.replace(/[^a-zA-Z0-9_]/g, '_');
        if (/^[0-9]/.test(clean)) {
            clean = "State_" + clean;
        }
        stateNamesMap.set(s.id, clean);
    });

    const resetStateName = stateNamesMap.get(app.states[0].id);

    // --- Pin Definitions ---
    const pinDefs = [];
    pinDefs.push("const int PIN_CLK = 2;");
    pinDefs.push("const int PIN_RST = 3;\n");

    // Inputs starting at Pin 4
    inputNames.forEach((name, i) => {
        pinDefs.push(`const int PIN_${name} = ${4 + i};`);
    });
    pinDefs.push("");

    // Outputs starting at Pin 8
    outputNames.forEach((name, i) => {
        pinDefs.push(`const int PIN_${name} = ${8 + i};`);
    });

    // --- State Enum ---
    const stateEnumDecls = [];
    app.states.forEach(s => {
        stateEnumDecls.push(`    ${stateNamesMap.get(s.id)}`);
    });
    const stateEnumStr = `enum State {\n${stateEnumDecls.join(',\n')}\n};`;

    // --- Setup PinModes ---
    const setupPinModes = [];
    setupPinModes.push("    pinMode(PIN_CLK, INPUT);");
    setupPinModes.push("    pinMode(PIN_RST, INPUT);");
    setupPinModes.push("");
    inputNames.forEach(name => {
        setupPinModes.push(`    pinMode(PIN_${name}, INPUT);`);
    });
    setupPinModes.push("");
    outputNames.forEach(name => {
        setupPinModes.push(`    pinMode(PIN_${name}, OUTPUT);`);
    });

    // --- Helper: format input condition ---
    function formatArduinoInputCondition(inputPattern) {
        const pat = (inputPattern || "").padStart(nIn, '0').toUpperCase();

        if (pat.split('').every(c => c === 'X')) {
            return null; // Fully don't-care = no condition needed
        }

        const parts = [];
        for (let i = 0; i < nIn; i++) {
            const bit = pat[i];
            const varName = inputNames[i];
            if (bit === '1') {
                parts.push(`${varName} == HIGH`);
            } else if (bit === '0') {
                parts.push(`${varName} == LOW`);
            }
        }

        if (parts.length === 0) return null;
        return parts.join(' && ');
    }

    // --- Helper: format output assignments ---
    function getOutputAssignments(outputVal, indent = "        ") {
        const val = (outputVal || "").padStart(nOut, '0');
        const assignments = [];
        for (let i = 0; i < nOut; i++) {
            const bit = val[nOut - 1 - i];
            const pinName = `PIN_${outputNames[i]}`;
            const valStr = bit === '1' ? 'HIGH' : 'LOW';
            assignments.push(`${indent}digitalWrite(${pinName}, ${valStr});`);
        }
        return assignments;
    }

    // --- Reset Outputs Body ---
    const resetOutputsBody = outputNames.map(name => `    digitalWrite(PIN_${name}, LOW);`).join('\n');

    // --- Moore Outputs Function ---
    let mooreUpdateFunc = "";
    if (isMoore) {
        const mooreCaseBlocks = [];
        app.states.forEach(state => {
            const sName = stateNamesMap.get(state.id);
            const block = [];
            block.push(`        case ${sName}:`);
            const mooreOut = getOutputAssignments(state.output, `            `);
            block.push(mooreOut.join('\n'));
            block.push(`            break;`);
            mooreCaseBlocks.push(block.join('\n'));
        });
        mooreUpdateFunc = `void updateMooreOutputs(State state) {
    switch (state) {
${mooreCaseBlocks.join('\n')}
        default:
            resetOutputs();
            break;
    }
}
`;
    }

    // --- Case Blocks for loop FSM ---
    const caseBlocks = [];
    app.states.forEach((state) => {
        const sName = stateNamesMap.get(state.id);
        const stateBlock = [];
        stateBlock.push(`                case ${sName}:`);

        // Transitions from this state
        const outLinks = app.links.filter(l => l.from === state.id);
        const conditionalLinks = [];
        let defaultLink = null;

        outLinks.forEach(link => {
            const targetState = app.states.find(s => s.id === link.to);
            if (!targetState) return;

            const cond = formatArduinoInputCondition(link.input);
            if (cond === null) {
                defaultLink = { link, targetState };
            } else {
                conditionalLinks.push({ link, targetState, cond });
            }
        });

        if (conditionalLinks.length > 0) {
            conditionalLinks.forEach((item, lIdx) => {
                const isFirst = lIdx === 0;
                const ifKeyword = isFirst ? 'if' : 'else if';
                const targetName = stateNamesMap.get(item.targetState.id);
                
                stateBlock.push(`                    ${ifKeyword} (${item.cond}) {`);
                stateBlock.push(`                        nextState = ${targetName};`);
                if (!isMoore) {
                    const mealyOut = getOutputAssignments(item.link.output, `                        `);
                    stateBlock.push(mealyOut.join('\n'));
                }
                stateBlock.push(`                    }`);
            });

            if (defaultLink) {
                const targetName = stateNamesMap.get(defaultLink.targetState.id);
                stateBlock.push(`                    else {`);
                stateBlock.push(`                        nextState = ${targetName};`);
                if (!isMoore) {
                    const mealyOut = getOutputAssignments(defaultLink.link.output, `                        `);
                    stateBlock.push(mealyOut.join('\n'));
                }
                stateBlock.push(`                    }`);
            } else {
                stateBlock.push(`                    else {`);
                stateBlock.push(`                        nextState = ${sName};`);
                if (!isMoore) {
                    const defaultMealyOut = getOutputAssignments("", `                        `);
                    stateBlock.push(defaultMealyOut.join('\n'));
                }
                stateBlock.push(`                    }`);
            }
        } else {
            if (defaultLink) {
                const targetName = stateNamesMap.get(defaultLink.targetState.id);
                stateBlock.push(`                    nextState = ${targetName};`);
                if (!isMoore) {
                    const mealyOut = getOutputAssignments(defaultLink.link.output, `                    `);
                    stateBlock.push(mealyOut.join('\n'));
                }
            } else {
                stateBlock.push(`                    nextState = ${sName};`);
                if (!isMoore) {
                    const defaultMealyOut = getOutputAssignments("", `                    `);
                    stateBlock.push(defaultMealyOut.join('\n'));
                }
            }
        }
        stateBlock.push(`                    break;`);
        caseBlocks.push(stateBlock.join('\n'));
    });

    // --- Build Clean Filename / Module Name ---
    const cleanFilename = (filename || "fsm_design").replace(/\.ino$/i, '').replace(/[^a-zA-Z0-9_]/g, '_');
    const dateStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // Read variables logic inside loop
    const readVarLines = inputNames.map(name => `            bool ${name} = digitalRead(PIN_${name});`).join('\n');

    const fileContent = `// ********************************************************************
// FSM Designer Pro - Exportacion a Arduino (.ino)
// Dispositivo: Arduino Uno / Mega / Nano
// Tipo de Maquina: Maquina de ${isMoore ? 'Moore' : 'Mealy'}
// Fecha: ${dateStr}
// ********************************************************************

// --- Pin Definitions ---
${pinDefs.join('\n')}

// --- State Definitions ---
${stateEnumStr}

State currentState = ${resetStateName};
bool lastClkState = LOW;

void setup() {
    // Configure inputs/outputs
${setupPinModes.join('\n')}

    // Initial Outputs state
    ${isMoore ? `updateMooreOutputs(${resetStateName});` : 'resetOutputs();'}
}

void loop() {
    // 1. Check Reset (active High)
    if (digitalRead(PIN_RST) == HIGH) {
        currentState = ${resetStateName};
        ${isMoore ? `updateMooreOutputs(${resetStateName});` : 'resetOutputs();'}
    } else {
        // 2. Read Clock State
        bool clkState = digitalRead(PIN_CLK);
        
        // 3. Detect Rising Edge (LOW -> HIGH)
        if (clkState == HIGH && lastClkState == LOW) {
            // Read all inputs locally
${readVarLines}

            State nextState = currentState;

            switch (currentState) {
${caseBlocks.join('\n\n')}
                default:
                    nextState = ${resetStateName};
                    break;
            }

            currentState = nextState;
            ${isMoore ? 'updateMooreOutputs(currentState);' : ''}
        }
        lastClkState = clkState;
    }
    delay(10); // debounce and stability
}

void resetOutputs() {
${resetOutputsBody}
}

${mooreUpdateFunc}
`;

    // --- Download Handler ---
    const blob = new Blob([fileContent], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const finalName = cleanFilename + '.ino';
    a.download = finalName;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 20000);
}
