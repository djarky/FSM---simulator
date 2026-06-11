/**
 * --- VHDL EXPORTER ---
 * Generates synthesizable .vhd files using a standard two-process FSM style.
 * Supports both Mealy and Moore machine types.
 */

export function exportToVHDL(app, filename) {
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

    // Sanitize state names for valid VHDL identifiers
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
    portLines.push("        CLK   : in  std_logic;");
    portLines.push("        RST   : in  std_logic;");
    
    // Inputs
    inputNames.forEach(name => {
        portLines.push(`        ${name}    : in  std_logic;`);
    });
    
    // Outputs
    outputNames.forEach((name, i) => {
        const isLast = i === outputNames.length - 1;
        portLines.push(`        ${name}    : out std_logic${isLast ? "" : ";"}`);
    });

    // --- State Type Declaration ---
    const stateTypeDecl = `    type state_type is (${app.states.map(s => stateNamesMap.get(s.id)).join(', ')});`;

    // --- Helper: format input condition for VHDL ---
    function formatVHDLInputCondition(inputPattern) {
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
                parts.push(`${varName} = '1'`);
            } else if (bit === '0') {
                parts.push(`${varName} = '0'`);
            }
            // 'X' = don't care, skip
        }

        if (parts.length === 0) return null;
        return parts.join(' and ');
    }

    // --- Helper: format output list for VHDL ---
    function getOutputAssignments(outputVal, indent = "        ") {
        const val = (outputVal || "").padStart(nOut, '0');
        const assignments = [];
        for (let i = 0; i < nOut; i++) {
            const bit = val[nOut - 1 - i];
            const valChar = bit === '1' ? '1' : '0';
            assignments.push(`${indent}${outputNames[i]} <= '${valChar}';`);
        }
        return assignments;
    }

    // --- Default Output Assignments ---
    const defaultOutputAssignments = outputNames.map(name => `        ${name} <= '0';`).join('\n');

    // --- Case Blocks for FSM States ---
    const caseBlocks = [];
    app.states.forEach((state) => {
        const sName = stateNamesMap.get(state.id);
        const stateBlock = [];
        stateBlock.push(`            when ${sName} =>`);

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

            const cond = formatVHDLInputCondition(link.input);
            if (cond === null) {
                defaultLink = { link, targetState };
            } else {
                conditionalLinks.push({ link, targetState, cond });
            }
        });

        if (conditionalLinks.length > 0) {
            conditionalLinks.forEach((item, lIdx) => {
                const isFirst = lIdx === 0;
                const ifKeyword = isFirst ? 'if' : 'elsif';
                const targetName = stateNamesMap.get(item.targetState.id);
                
                stateBlock.push(`                ${ifKeyword} ${item.cond} then`);
                stateBlock.push(`                    next_state <= ${targetName};`);
                if (!isMoore) {
                    const mealyOut = getOutputAssignments(item.link.output, `                    `);
                    stateBlock.push(mealyOut.join('\n'));
                }
            });

            if (defaultLink) {
                const targetName = stateNamesMap.get(defaultLink.targetState.id);
                stateBlock.push(`                else`);
                stateBlock.push(`                    next_state <= ${targetName};`);
                if (!isMoore) {
                    const mealyOut = getOutputAssignments(defaultLink.link.output, `                    `);
                    stateBlock.push(mealyOut.join('\n'));
                }
            } else {
                stateBlock.push(`                else`);
                stateBlock.push(`                    next_state <= ${sName};`);
                if (!isMoore) {
                    const defaultMealyOut = getOutputAssignments("", `                    `);
                    stateBlock.push(defaultMealyOut.join('\n'));
                }
            }
            stateBlock.push(`                end if;`);
        } else {
            if (defaultLink) {
                const targetName = stateNamesMap.get(defaultLink.targetState.id);
                stateBlock.push(`                next_state <= ${targetName};`);
                if (!isMoore) {
                    const mealyOut = getOutputAssignments(defaultLink.link.output, `                `);
                    stateBlock.push(mealyOut.join('\n'));
                }
            } else {
                stateBlock.push(`                next_state <= ${sName};`);
                if (!isMoore) {
                    const defaultMealyOut = getOutputAssignments("", `                `);
                    stateBlock.push(defaultMealyOut.join('\n'));
                }
            }
        }

        caseBlocks.push(stateBlock.join('\n'));
    });

    // --- Build Clean Filename / Entity Name ---
    const cleanFilename = (filename || "fsm_design").replace(/\.vhd$/i, '').replace(/[^a-zA-Z0-9_]/g, '_');
    const dateStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const fileContent = `-- ********************************************************************
-- FSM Designer Pro - Exportacion a VHDL
-- Dispositivo: Generico / Sintetizable
-- Tipo de Maquina: Maquina de ${isMoore ? 'Moore' : 'Mealy'}
-- Fecha: ${dateStr}
-- ********************************************************************

library IEEE;
use IEEE.STD_LOGIC_1164.ALL;

entity ${cleanFilename} is
    Port (
${portLines.join('\n')}
    );
end ${cleanFilename};

architecture Behavioral of ${cleanFilename} is
    -- Declaracion de estados
${stateTypeDecl}
    signal state, next_state : state_type;
begin

    -- Proceso Sincrono (Registro de Estado)
    sync_proc : process(CLK, RST)
    begin
        if RST = '1' then
            state <= ${resetStateName};
        elsif rising_edge(CLK) then
            state <= next_state;
        end if;
    end process;

    -- Proceso Combinacional (Logica de Siguiente Estado y Salidas)
    comb_proc : process(state, ${inputNames.join(', ')})
    begin
        -- Valores por defecto
        next_state <= state;
${defaultOutputAssignments}

        case state is
${caseBlocks.join('\n\n')}
            when others =>
                next_state <= ${resetStateName};
        end case;
    end process;

end Behavioral;
`;

    // --- Download Handler ---
    const blob = new Blob([fileContent], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const finalName = cleanFilename + '.vhd';
    a.download = finalName;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 20000);
}
