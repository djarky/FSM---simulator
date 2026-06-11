/**
 * --- VERILOG EXPORTER ---
 * Generates synthesizable .v files using a standard two-process FSM style.
 * Supports both Mealy and Moore machine types.
 */

export function exportToVerilog(app, filename) {
    if (!app || !app.states || app.states.length === 0) {
        alert("Diseña una máquina primero.");
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

    // Sanitize state names for valid Verilog identifiers
    const stateNamesMap = new Map();
    app.states.forEach(s => {
        let clean = s.name.replace(/[^a-zA-Z0-9_]/g, '_');
        if (/^[0-9]/.test(clean)) {
            clean = "State_" + clean;
        }
        stateNamesMap.set(s.id, clean);
    });

    const resetStateName = stateNamesMap.get(app.states[0].id);

    // --- Port Lines ---
    const portLines = [];
    portLines.push("    input clk,");
    portLines.push("    input rst,");
    
    // Inputs
    inputNames.forEach(name => {
        portLines.push(`    input ${name},`);
    });
    
    // Outputs
    outputNames.forEach((name, i) => {
        const isLast = i === outputNames.length - 1;
        portLines.push(`    output reg ${name}${isLast ? "" : ","}`);
    });

    // --- localparam Declarations ---
    const localparamDecls = [];
    app.states.forEach((s, idx) => {
        const sName = stateNamesMap.get(s.id);
        localparamDecls.push(`    localparam ${sName} = ${nBits}'d${idx};`);
    });

    // --- Helper: format input condition for Verilog ---
    function formatVerilogInputCondition(inputPattern) {
        const pat = (inputPattern || "").padStart(nIn, '0').toUpperCase();

        // Check if all bits are don't-care
        if (pat.split('').every(c => c === 'X')) {
            return null; // Fully don't-care = no condition needed
        }

        const parts = [];
        for (let i = 0; i < nIn; i++) {
            const bit = pat[i];
            const varName = inputNames[i];
            if (bit === '1') {
                parts.push(`${varName} == 1'b1`);
            } else if (bit === '0') {
                parts.push(`${varName} == 1'b0`);
            }
            // 'X' = don't care, skip
        }

        if (parts.length === 0) return null;
        return parts.join(' && ');
    }

    // --- Helper: format output list for Verilog ---
    function getOutputAssignments(outputVal, indent = "        ") {
        const val = (outputVal || "").padStart(nOut, '0');
        const assignments = [];
        for (let i = 0; i < nOut; i++) {
            const bit = val[nOut - 1 - i];
            const valChar = bit === '1' ? '1' : '0';
            assignments.push(`${indent}${outputNames[i]} = 1'b${valChar};`);
        }
        return assignments;
    }

    // --- Default Output Assignments ---
    const defaultOutputAssignments = outputNames.map(name => `        ${name} = 1'b0;`).join('\n');

    // --- Case Blocks for FSM States ---
    const caseBlocks = [];
    app.states.forEach((state) => {
        const sName = stateNamesMap.get(state.id);
        const stateBlock = [];
        stateBlock.push(`            ${sName}: begin`);

        // Moore Outputs
        if (isMoore) {
            const mooreOut = getOutputAssignments(state.output, `                `);
            if (mooreOut.length > 0) {
                stateBlock.push(mooreOut.join('\n'));
            }
        }

        // Transitions from this state
        const outLinks = app.links.filter(l => l.from === state.id);
        const conditionalLinks = [];
        let defaultLink = null;

        outLinks.forEach(link => {
            const targetState = app.states.find(s => s.id === link.to);
            if (!targetState) return;

            const cond = formatVerilogInputCondition(link.input);
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
                
                stateBlock.push(`                ${ifKeyword} (${item.cond}) begin`);
                stateBlock.push(`                    next_state = ${targetName};`);
                if (!isMoore) {
                    const mealyOut = getOutputAssignments(item.link.output, `                    `);
                    stateBlock.push(mealyOut.join('\n'));
                }
                stateBlock.push(`                end`);
            });

            if (defaultLink) {
                const targetName = stateNamesMap.get(defaultLink.targetState.id);
                stateBlock.push(`                else begin`);
                stateBlock.push(`                    next_state = ${targetName};`);
                if (!isMoore) {
                    const mealyOut = getOutputAssignments(defaultLink.link.output, `                    `);
                    stateBlock.push(mealyOut.join('\n'));
                }
                stateBlock.push(`                end`);
            } else {
                stateBlock.push(`                else begin`);
                stateBlock.push(`                    next_state = ${sName};`);
                if (!isMoore) {
                    const defaultMealyOut = getOutputAssignments("", `                    `);
                    stateBlock.push(defaultMealyOut.join('\n'));
                }
                stateBlock.push(`                end`);
            }
        } else {
            if (defaultLink) {
                const targetName = stateNamesMap.get(defaultLink.targetState.id);
                stateBlock.push(`                next_state = ${targetName};`);
                if (!isMoore) {
                    const mealyOut = getOutputAssignments(defaultLink.link.output, `                `);
                    stateBlock.push(mealyOut.join('\n'));
                }
            } else {
                stateBlock.push(`                next_state = ${sName};`);
                if (!isMoore) {
                    const defaultMealyOut = getOutputAssignments("", `                `);
                    stateBlock.push(defaultMealyOut.join('\n'));
                }
            }
        }

        stateBlock.push(`            end`);
        caseBlocks.push(stateBlock.join('\n'));
    });

    // --- Build Clean Filename / Module Name ---
    const cleanFilename = (filename || "fsm_design").replace(/\.v$/i, '').replace(/[^a-zA-Z0-9_]/g, '_');
    const dateStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const bitRange = nBits > 1 ? `[${nBits - 1}:0] ` : "";

    const fileContent = `// ********************************************************************
// FSM Designer Pro - Exportacion a Verilog
// Dispositivo: Generico / Sintetizable
// Tipo de Maquina: Maquina de ${isMoore ? 'Moore' : 'Mealy'}
// Fecha: ${dateStr}
// ********************************************************************

module ${cleanFilename} (
${portLines.join('\n')}
);

    // Definicion de estados
${localparamDecls.join('\n')}

    reg ${bitRange}state;
    reg ${bitRange}next_state;

    // Registro de Estado (Sincrono)
    always @(posedge clk or posedge rst) begin
        if (rst) begin
            state <= ${resetStateName};
        end else begin
            state <= next_state;
        end
    end

    // Logica de Siguiente Estado y Salidas (Combinacional)
    always @(*) begin
        // Valores por defecto
        next_state = state;
${defaultOutputAssignments}

        case (state)
${caseBlocks.join('\n\n')}
            default: begin
                next_state = ${resetStateName};
            end
        endcase
    end

endmodule
`;

    // --- Download Handler ---
    const blob = new Blob([fileContent], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const finalName = cleanFilename + '.v';
    a.download = finalName;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 20000);
}
