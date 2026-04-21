import { minimize } from './logic-engine.js';
import { matchInput } from './models.js';
import { KICAD_LIB_SYMBOLS } from './lib_symbols.js';

function uuidv4() {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

const FOOTPRINT_MAP = {
    "74xx:74LS08": "Package_DIP:DIP-14_W7.62mm_Socket_LongPads",
    "74xx:74LS32": "Package_DIP:DIP-14_W7.62mm_Socket_LongPads",
    "74xx:74LS74": "Package_DIP:DIP-14_W7.62mm_Socket_LongPads",
    "Device:LED": "LED_THT:LED_D4.0mm",
    "Device:R": "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal",
    "power:+5V": "",
    "power:GND": ""
};

function generateConnectorSymbol(n) {
    const nStr = n.toString().padStart(2, '0');
    const graphics = [];
    const pins = [];
    for (let i = 1; i <= n; i++) {
        const y = 1.27 * (n - 1) - 2.54 * (i - 1);
        graphics.push(`\t\t\t(rectangle (start 0.8636 ${y + 0.127}) (end 0 ${y - 0.127}) (stroke (width 0.1524) (type default)) (fill (type outline)))`);
        graphics.push(`\t\t\t(polyline (pts (xy 1.27 ${y}) (xy 0.8636 ${y})) (stroke (width 0.1524) (type default)) (fill (type none)))`);
        pins.push(`\t\t\t(pin passive line (at 5.08 ${y} 180) (length 3.81)\n\t\t\t\t(name "Pin_${i}" (effects (font (size 1.27 1.27))))\n\t\t\t\t(number "${i}" (effects (font (size 1.27 1.27))))\n\t\t\t)`);
    }

    return `\t(symbol "Connector:Conn_01x${nStr}_Pin"
		(pin_names (offset 1.016) (hide yes))
		(exclude_from_sim no) (in_bom yes) (on_board yes)
		(property "Reference" "J" (at 0 ${1.27 * n + 2} 0) (effects (font (size 1.27 1.27))))
		(property "Value" "Conn_01x${nStr}_Pin" (at 0 ${-1.27 * n - 2} 0) (effects (font (size 1.27 1.27))))
		(property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
		(property "Datasheet" "~" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
		(property "Description" "Generic connector, single row, 01x${nStr}, script generated" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
		(symbol "Conn_01x${nStr}_Pin_1_1"
${graphics.join('\n')}
${pins.join('\n')}
		)
	)`;
}

export function exportToKiCad(app, filename) {
    if (app.states.length === 0) {
        alert("Diseña una máquina primero.");
        return;
    }

    const rootUuid = uuidv4();
    const projectName = filename ? filename.replace('.kicad_sch', '') : "fsm_project";
    
    const nBits = app.bits;
    const isMoore = app.machineType === 'MOORE';
    let nIn = 1, nOut = 1;
    app.links.forEach(l => nIn = Math.max(nIn, (l.input || "").length));
    if (isMoore) { app.states.forEach(s => nOut = Math.max(nOut, (s.output || "").length)); }
    else { app.links.forEach(l => nOut = Math.max(nOut, (l.output || "").length)); }
    const nVars = nBits + nIn;

    const nMS = Array(nBits).fill().map(() => []);
    const nMO = Array(nOut).fill().map(() => []);

    // Tablas de verdad
    app.states.forEach((s, idx) => {
        const rowCount = 1 << nIn;
        for (let i = 0; i < rowCount; i++) {
            const xStr = i.toString(2).padStart(nIn, '0');
            const l = app.links.find(link => link.from === s.id && matchInput(link.input, xStr, nIn));
            const nextS = l ? app.states.find(st => st.id === l.to) : null;
            const m = (idx << nIn) | i;
            if (nextS) { for (let b = 0; b < nBits; b++) if (nextS.binary[nBits - 1 - b] === '1') nMS[b].push(m); }
            if (!isMoore && l) {
                const outVal = (l.output || "").padStart(nOut, '0');
                for (let o = 0; o < nOut; o++) if (outVal[nOut - 1 - o] === '1') nMO[o].push(m);
            }
        }
        if (isMoore) {
            const outVal = (s.output || "").padStart(nOut, '0');
            for (let o = 0; o < nOut; o++) if (outVal[nOut - 1 - o] === '1') for (let i = 0; i < (1 << nIn); i++) nMO[o].push((idx << nIn) | i);
        }
    });

    const stateEqs = nMS.map(mList => minimize(nVars, mList, [], nBits, nIn));
    const outputEqs = nMO.map(mList => minimize(nVars, mList, [], nBits, nIn));

    let components = [];
    let wiresLabels = [];

    let chipAllocators = {
        AND: { ref: 'U_AND', lib: '74xx:74LS08', maxUnits: 4, count: 0, pwrUnit: 5 },
        OR:  { ref: 'U_OR',  lib: '74xx:74LS32', maxUnits: 4, count: 0, pwrUnit: 5 },
        FF:  { ref: 'U_FF',  lib: '74xx:74LS74', maxUnits: 2, count: 0, pwrUnit: 3 }
    };

    function allocate(type) {
        const alloc = chipAllocators[type];
        const chipIdx = Math.floor(alloc.count / alloc.maxUnits) + 1;
        const unitIdx = (alloc.count % alloc.maxUnits) + 1;
        alloc.count++;
        return { ref: `${alloc.ref}${chipIdx}`, unit: unitIdx, lib: alloc.lib };
    }

    function addLabel(name, x, y, rot=0, shape="input") {
        wiresLabels.push(`\t(global_label "${name}"\n\t\t(shape ${shape})\n\t\t(at ${x} ${y} ${rot})\n\t\t(uuid "${uuidv4()}")\n\t\t(property "Intersheetrefs" "\\\${INTERSHEET_REFS}"\n\t\t\t(at ${x} ${y} 0)\n\t\t\t(effects\n\t\t\t\t(font\n\t\t\t\t\t(size 1.27 1.27)\n\t\t\t\t)\n\t\t\t\t(hide yes)\n\t\t\t)\n\t\t)\n\t)`);
    }

    function wirePinToLabel(labelName, pinX, pinY, labelX, labelY, labelRot, labelShape="input") {
        wiresLabels.push(`\t(wire\n\t\t(pts\n\t\t\t(xy ${pinX} ${pinY}) (xy ${labelX} ${labelY})\n\t\t)\n\t\t(stroke\n\t\t\t(width 0)\n\t\t\t(type default)\n\t\t)\n\t\t(uuid "${uuidv4()}")\n\t)`);
        addLabel(labelName, labelX, labelY, labelRot, labelShape);
    }

    function addInstance(lib, ref, unit, x, y, value="", rot=0, pins=[]) {
        const uid = uuidv4();
        const pinDeclarations = pins.map(p => `\t\t(pin "${p}" (uuid "${uuidv4()}"))`).join('\n');
        
        let footprint = FOOTPRINT_MAP[lib] || "";
        if (!footprint && lib.includes("Conn_01x")) {
            const num = lib.split('x')[1].split('_')[0];
            footprint = `Connector_PinHeader_2.54mm:PinHeader_1x${num.padStart(2, '0')}_P2.54mm_Vertical`;
        }

        components.push(`\t(symbol
		(lib_id "${lib}")
		(at ${x} ${y} ${rot})
		(unit ${unit})
		(in_bom yes)
		(on_board yes)
		(dnp no)
		(uuid "${uid}")
		(property "Reference" "${ref}"
			(at ${x} ${y - 8} 0)
			(effects (font (size 1.27 1.27)))
		)
		(property "Value" "${value || lib.split(':')[1] || ""}"
			(at ${x} ${y - 6} 0)
			(effects (font (size 1.27 1.27)))
		)
		(property "Footprint" "${footprint}"
			(at ${x} ${y} 0)
			(effects (font (size 1.27 1.27)) (hide yes))
		)
		(property "Datasheet" "~"
			(at ${x} ${y} 0)
			(effects (font (size 1.27 1.27)) (hide yes))
		)
		(property "Description" ""
			(at ${x} ${y} 0)
			(effects (font (size 1.27 1.27)) (hide yes))
		)
${pinDeclarations}
		(instances
			(project "${projectName}"
				(path "/${rootUuid}"
					(reference "${ref}")
					(unit ${unit})
				)
			)
		)
	)`);
    }

    // --- GENERATE SCHEMATIC ---
    const XS = 30, YS = 30;

    const numPins = 3 + (2 * nIn);
    const connLib = `Connector:Conn_01x${numPins.toString().padStart(2, '0')}_Pin`;
    const connX = XS, connY = YS + (numPins * 1.27);
    const allPins = Array.from({length: numPins}, (_, i) => (i + 1).toString());
    addInstance(connLib, "J_INPUTS", 1, connX, connY, "Inputs / Power", 0, allPins);

    const getPinY = (pinIdx) => connY + (1.27 * (numPins - 1) - 2.54 * (pinIdx - 1));
    
    wirePinToLabel("VCC", connX + 5.08, getPinY(1), connX + 10.08, getPinY(1), 0, "input");
    wirePinToLabel("GND", connX + 5.08, getPinY(2), connX + 10.08, getPinY(2), 0, "input");
    wirePinToLabel("CLK", connX + 5.08, getPinY(3), connX + 10.08, getPinY(3), 0, "input");
    
    for (let i = 0; i < nIn; i++) {
        const pinX = 4 + (i * 2);
        const pinNotX = pinX + 1;
        const name = `X${nIn - 1 - i}`;
        wirePinToLabel(name, connX + 5.08, getPinY(pinX), connX + 10.08, getPinY(pinX), 0, "input");
        wirePinToLabel(`!${name}`, connX + 5.08, getPinY(pinNotX), connX + 10.08, getPinY(pinNotX), 0, "input");
    }

    const dynamicLibSymbols = KICAD_LIB_SYMBOLS.replace(/\)\s*$/, generateConnectorSymbol(numPins) + "\n)");

    const logicXS = XS + 60;
    for (let i = 0; i < nBits; i++) {
        const a = allocate('FF');
        const xPos = logicXS + 120; const yPos = YS + i * 25;
        const pins = a.unit === 1 ? ["2", "3", "4", "1", "5", "6"] : ["12", "11", "10", "13", "9", "8"];
        addInstance(a.lib, a.ref, a.unit, xPos, yPos, "", 0, pins);
        wirePinToLabel(`D${nBits-1-i}`, xPos - 7.62, yPos - 2.54, xPos - 12.62, yPos - 2.54, 180, "output");
        wirePinToLabel(`CLK`, xPos - 7.62, yPos, xPos - 12.62, yPos, 180, "output");
        wirePinToLabel(`VCC`, xPos, yPos - 7.62, xPos, yPos - 12.62, 90, "input");
        wirePinToLabel(`VCC`, xPos, yPos + 7.62, xPos, yPos + 12.62, 270, "input");
        wirePinToLabel(`Q${nBits-1-i}`, xPos + 7.62, yPos - 2.54, xPos + 12.62, yPos - 2.54, 0, "input");
        wirePinToLabel(`!Q${nBits-1-i}`, xPos + 7.62, yPos + 2.54, xPos + 12.62, yPos + 2.54, 0, "input");
    }

    let eqY = YS + Math.max(nBits * 25, numPins * 2.54) + 20;
    const buildEquation = (eq, labelOut) => {
        const andLabels = [];
        eq.selection.forEach((sel, termIdx) => {
            const pi = sel.pi;
            let nI = 0; for (let c of pi) if (c !== '-') nI++;
            if (nI === 0) return;
            const termInputs = [];
            for (let i = 0; i < nVars; i++) {
                if (pi[i] === '-') continue;
                if (i < nBits) { termInputs.push(pi[i] === '1' ? `Q${nBits - 1 - i}` : `!Q${nBits - 1 - i}`); }
                else { const vIdx = i - nBits; termInputs.push(pi[i] === '1' ? `X${nIn - 1 - vIdx}` : `!X${nIn - 1 - vIdx}`); }
            }
            if (termInputs.length === 1) { andLabels.push(termInputs[0]); return; }

            let currentIn1 = termInputs[0];
            for (let i = 1; i < termInputs.length; i++) {
                const isLast = (i === termInputs.length - 1);
                const outLabel = isLast ? `${labelOut}_AND${termIdx}` : `${labelOut}_AND_CHAIN_${uuidv4().substring(0,4)}`;
                if (isLast) andLabels.push(outLabel);
                const a = allocate('AND');
                const xPos = logicXS + (i * 20); const yPos = eqY + termIdx * 15;
                const pins = [ [1,2,3], [4,5,6], [9,10,8], [12,13,11] ][a.unit-1].map(String);
                addInstance(a.lib, a.ref, a.unit, xPos, yPos, "", 0, pins);
                wirePinToLabel(currentIn1, xPos - 7.62, yPos - 2.54, xPos - 12.62, yPos - 2.54, 180, "output");
                wirePinToLabel(termInputs[i], xPos - 7.62, yPos + 2.54, xPos - 12.62, yPos + 2.54, 180, "output");
                wirePinToLabel(outLabel, xPos + 7.62, yPos, xPos + 12.62, yPos, 0, "input");
                currentIn1 = outLabel;
            }
        });

        if (andLabels.length === 0) return;
        if (andLabels.length === 1) {
            // Draw a direct wire bridge for single terms
            const x1 = logicXS - 10, x2 = logicXS + 10;
            wiresLabels.push(`\t(wire\n\t\t(pts (xy ${x1} ${eqY}) (xy ${x2} ${eqY}))\n\t\t(stroke (width 0) (type default))\n\t\t(uuid "${uuidv4()}")\n\t)`);
            addLabel(andLabels[0], x1, eqY, 180, "output");
            addLabel(labelOut, x2, eqY, 0, "input");
        } else {
            let currentIn1 = andLabels[0];
            for (let i = 1; i < andLabels.length; i++) {
                const isLast = (i === andLabels.length - 1);
                const outLabel = isLast ? labelOut : `${labelOut}_OR_CHAIN_${uuidv4().substring(0,4)}`;
                const a = allocate('OR');
                const xPos = logicXS + 50 + (i * 20); const yPos = eqY;
                const pins = [ [1,2,3], [4,5,6], [9,10,8], [12,13,11] ][a.unit-1].map(String);
                addInstance(a.lib, a.ref, a.unit, xPos, yPos, "", 0, pins);
                wirePinToLabel(currentIn1, xPos - 7.62, yPos - 2.54, xPos - 12.62, yPos - 2.54, 180, "output");
                wirePinToLabel(andLabels[i], xPos - 7.62, yPos + 2.54, xPos - 12.62, yPos + 2.54, 180, "output");
                wirePinToLabel(outLabel, xPos + 7.62, yPos, xPos + 12.62, yPos, 0, "input");
                currentIn1 = outLabel;
            }
        }
        eqY += 30; // Consistent spacing
    };

    stateEqs.forEach((eq, i) => buildEquation(eq, `D${i}`));
    
    // Position LEDs after equations to avoid overlap and improve alignment
    eqY += 20; 
    outputEqs.forEach((eq, i) => {
        const zLbl = `Z${i}`;
        const currentY = eqY;
        buildEquation(eq, zLbl);
        
        const xPos = logicXS + 220; const yPos = currentY;
        addInstance("Device:LED", `D${i+1}`, 1, xPos, yPos, zLbl, 180, ["1", "2"]);
        addInstance("Device:R", `R${i+1}`, 1, xPos + 15, yPos, "330", 90, ["1", "2"]);
        
        // Connect LED to Label
        wirePinToLabel(zLbl, xPos - 3.81, yPos, xPos - 8.81, yPos, 180, "output"); 
        // Connect LED to Resistor
        wiresLabels.push(`\t(wire\n\t\t(pts (xy ${xPos + 3.81} ${yPos}) (xy ${xPos + 11.19} ${yPos}))\n\t\t(stroke (width 0) (type default))\n\t\t(uuid "${uuidv4()}")\n\t)`);
        // Connect Resistor to GND
        wirePinToLabel("GND", xPos + 18.81, yPos, xPos + 23.81, yPos, 0, "input");
    });

    let pwrX = logicXS + 300, pwrY = YS;
    Object.keys(chipAllocators).forEach(key => {
        const alloc = chipAllocators[key];
        const numChips = Math.ceil(alloc.count / alloc.maxUnits);
        for (let i = 1; i <= numChips; i++) {
            const ref = `${alloc.ref}${i}`;
            addInstance(alloc.lib, ref, alloc.pwrUnit, pwrX, pwrY, "PWR", 0, ["14", "7"]);
            wirePinToLabel("VCC", pwrX, pwrY - 7.62, pwrX, pwrY - 12.62, 90, "input");
            wirePinToLabel("GND", pwrX, pwrY + 7.62, pwrX, pwrY + 12.62, 270, "input");
            pwrY += 35;
        }
    });

    const fileContent = `(kicad_sch
	(version 20250114)
	(generator "fsm-designer")
	(generator_version "1.0")
	(uuid "${rootUuid}")
	(paper "A3")
${dynamicLibSymbols}
${components.join('\n')}
${wiresLabels.join('\n')}
	(sheet_instances
		(path "/" (page "1"))
	)
	(embedded_fonts no)
)`;

    const blob = new Blob([fileContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    let name = (filename || `fsm_${Date.now()}`).replace('.kicad_sch', '') + '.kicad_sch';
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
