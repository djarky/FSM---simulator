import { matchInput } from './models.js';

/**
 * --- WINCUPL EXPORTER FOR GAL22V10 ---
 * Generates .pld files using native CUPL SEQUENCE state machine syntax.
 * Supports both Mealy and Moore machine types.
 */

export function exportToWinCUPL(app, filename) {
    if (!app || !app.states || app.states.length === 0) {
        alert("Disena una maquina primero.");
        return;
    }

    const nBits = app.bits;
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

    // Check GAL22v10 hardware constraints
    if (nBits + nOut > 10) {
        alert(`Error de Hardware: La GAL22v10 solo soporta 10 salidas/retroalimentaciones en total (pines 14 a 23). Tu diseno requiere ${nBits} bits de estado + ${nOut} salidas = ${nBits + nOut} pines.`);
        return;
    }
    if (nIn > 11) {
        alert(`Error de Hardware: La GAL22v10 solo soporta hasta 11 pines de entrada dedicada (pines 2-11 y pin 13). Tu diseno requiere ${nIn} entradas.`);
        return;
    }

    // --- Pin Assignments ---
    const pinLines = [];
    const inputPins = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13];

    // Clock
    pinLines.push(`Pin 1 = CLK;`);

    // Inputs
    const inputNames = [];
    for (let i = 0; i < nIn; i++) {
        const pin = inputPins[i];
        const name = nIn > 1 ? `X${nIn - 1 - i}` : "X";
        inputNames.push(name);
        pinLines.push(`Pin ${pin} = ${name};`);
    }

    // State Flip-Flops (Pin 14 upwards)
    const stateNames = [];
    for (let i = 0; i < nBits; i++) {
        const pin = 14 + i;
        const name = nBits > 1 ? `Q${i}` : "Q";
        stateNames.push(name);
        pinLines.push(`Pin ${pin} = ${name};`);
    }

    // Machine Outputs (Pin 23 downwards)
    const outputNames = [];
    for (let i = 0; i < nOut; i++) {
        const pin = 23 - i;
        const name = nOut > 1 ? `Z${i}` : "Z";
        outputNames.push(name);
        pinLines.push(`Pin ${pin} = ${name};`);
    }

    // --- $DEFINE state constants ---
    const defineLines = [];
    app.states.forEach((s, idx) => {
        const binVal = idx.toString(2).padStart(nBits, '0');
        defineLines.push(`$DEFINE ${s.name} 'b'${binVal}`);
    });

    // --- FIELD declaration ---
    // State bits from MSB to LSB: [Q(nBits-1), ..., Q1, Q0]
    const fieldBits = [];
    for (let i = nBits - 1; i >= 0; i--) {
        fieldBits.push(nBits > 1 ? `Q${i}` : "Q");
    }
    const fieldLine = `FIELD state_var = [${fieldBits.join(', ')}];`;

    // --- Helper: format input condition for IF ---
    function formatInputCondition(inputPattern) {
        const pat = (inputPattern || "").padStart(nIn, '0').toUpperCase();

        // Check if all bits are don't-care
        if (pat.split('').every(c => c === 'X')) {
            return null; // Fully don't-care = no condition needed
        }

        const parts = [];
        for (let i = 0; i < nIn; i++) {
            const bit = pat[i];
            // inputNames[0] is X(nIn-1), inputNames[1] is X(nIn-2), etc.
            const varName = inputNames[i];
            if (bit === '1') {
                parts.push(varName);
            } else if (bit === '0') {
                parts.push(`!${varName}`);
            }
            // 'X' = don't care, skip
        }

        if (parts.length === 0) return null;
        return parts.join(' & ');
    }

    // --- Helper: format output list for OUT ---
    function formatOutputList(outputVal) {
        const val = (outputVal || "").padStart(nOut, '0');
        const activeOutputs = [];
        for (let i = 0; i < nOut; i++) {
            // val[0] is MSB = Z(nOut-1), val[nOut-1] is LSB = Z0
            if (val[nOut - 1 - i] === '1') {
                activeOutputs.push(outputNames[i]);
            }
        }
        return activeOutputs;
    }

    // --- Build SEQUENCE block ---
    const sequenceBody = [];

    app.states.forEach((state, idx) => {
        const stateBlock = [];
        stateBlock.push(`    PRESENT ${state.name}`);

        // Get all transitions FROM this state
        const outLinks = app.links.filter(l => l.from === state.id);

        if (isMoore) {
            // Moore: Output depends only on current state
            const mooreOut = formatOutputList(state.output);
            if (mooreOut.length > 0) {
                stateBlock.push(`        OUT ${mooreOut.join(', ')};`);
            }

            // Transitions (without output, since Moore outputs are state-based)
            outLinks.forEach(link => {
                const targetState = app.states.find(s => s.id === link.to);
                if (!targetState) return;

                const cond = formatInputCondition(link.input);
                if (cond === null) {
                    // Fully don't-care input: use DEFAULT
                    stateBlock.push(`        DEFAULT NEXT ${targetState.name};`);
                } else {
                    stateBlock.push(`        IF (${cond}) NEXT ${targetState.name};`);
                }
            });
        } else {
            // Mealy: Output depends on state + input (output goes with IF/NEXT)
            outLinks.forEach(link => {
                const targetState = app.states.find(s => s.id === link.to);
                if (!targetState) return;

                const cond = formatInputCondition(link.input);
                const mealyOut = formatOutputList(link.output);
                const outStr = mealyOut.length > 0 ? ` OUT ${mealyOut.join(', ')}` : '';

                if (cond === null) {
                    // Fully don't-care input: use DEFAULT
                    stateBlock.push(`        DEFAULT NEXT ${targetState.name}${outStr};`);
                } else {
                    stateBlock.push(`        IF (${cond}) NEXT ${targetState.name}${outStr};`);
                }
            });
        }

        // Add DEFAULT self-loop if not already present
        const hasDefault = stateBlock.some(line => line.includes('DEFAULT'));
        if (!hasDefault) {
            stateBlock.push(`        DEFAULT NEXT ${state.name};`);
        }

        sequenceBody.push(stateBlock.join('\n'));
    });

    const sequenceBlock = `SEQUENCE state_var {\n${sequenceBody.join('\n\n')}\n}`;

    // --- PLD File Header ---
    const cleanFilename = (filename || "fsm_wincupl").replace('.pld', '');
    const dateStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const fileContent = `Name       ${cleanFilename}.pld;
Partno     ;
Date       ${dateStr};
Revision   1.0;
Designer   FSM Designer Pro;
Company    VibeCode;
Assembly   ;
Location   ;
Device     P22V10;

/* ******************************************************************** */
/* FSM Designer Pro - Exportacion a WinCUPL                             */
/* Dispositivo: GAL22v10 (24 Pines DIP)                                 */
/* Tipo de Maquina: Maquina de ${isMoore ? 'Moore' : 'Mealy'}                        */
/* ******************************************************************** */

/* Asignacion de Pines */
${pinLines.join('\n')}

/* Definicion de estados */
${defineLines.join('\n')}

/* Campo de estado */
${fieldLine}

/* Maquina de Estados */
${sequenceBlock}
`;

    // --- Download Handler ---
    const blob = new Blob([fileContent], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const finalName = cleanFilename + '.pld';
    a.download = finalName;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 20000);
}
