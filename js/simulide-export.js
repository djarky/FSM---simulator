import { minimize } from './logic-engine.js';
import { matchInput } from './models.js';

/**
 * --- SIMULIDE EXPORTER (Strict Tag/Tunnel Version) ---
 * All signals use Tunnels. No long wires. No Nodes.
 */

const staticPinOffsets = {
    'Switch': { pinP0: [16, 0], switch0pinN: [-16, 0], switch1pinN: [-16, -8] },
    'Led': { lPin: [16, 0], rPin: [-16, 0] },
    'Resistor': { lPin: [-16, 0], rPin: [16, 0] },
    'Rail': { outnod: [0, 16] },
    'Ground': { Gnd: [0, -8] },
    'Buffer': { in0: [-16, 0], out: [16, 0] },
    'FlipFlopD': { in0: [-16, 0], in1: [-16, -8], in2: [16, -8], in3: [-16, 8], out0: [24, 0], out1: [24, 8] },
    'Tunnel': { pin: [0, 0] }
};

function getPinOffset(type, pinName, nInputs = 2) {
    if (type === 'And Gate' || type === 'Or Gate') {
        if (pinName === 'out') return [16, -8];
        const idx = parseInt(pinName.replace('in', ''));
        const yOff = (idx - (nInputs - 1) / 2) * 8;
        return [-16, yOff];
    }
    return (staticPinOffsets[type] || {})[pinName] || [0, 0];
}

export function exportToSimulIDE(app, filename) {
    console.log('[SimulIDE] Tunnel/Tag Version v2 loaded');
    if (app.states.length === 0) {
        alert("Diseña una máquina primero.");
        return;
    }

    const nBits = app.bits;
    const isMoore = app.machineType === 'MOORE';
    let nIn = 1, nOut = 1;
    app.links.forEach(l => nIn = Math.max(nIn, (l.input || "").length));
    if (isMoore) { app.states.forEach(s => nOut = Math.max(nOut, (s.output || "").length)); }
    else { app.links.forEach(l => nOut = Math.max(nOut, (l.output || "").length)); }
    const nVars = nBits + nIn;

    const nMS = Array(nBits).fill().map(() => []);
    const nMO = Array(nOut).fill().map(() => []);

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

    let compItems = [];
    let connItems = [];
    let itemData = {};
    let uidCount = 1;

    const serializeFields = (type, id, extra) => {
        const base = {
            itemtype: type, CircId: id, mainComp: "false",
            Show_id: (type === 'FlipFlopD' || type === 'Switch') ? "true" : "false",
            Show_Val: (extra.ShowProp || extra.Show_Val) ? "true" : "false",
            Pos: extra.Pos || "0,0", rotation: extra.rotation || "0",
            hflip: extra.hflip || "1", vflip: extra.vflip || "1",
            label: extra.label || id, idLabPos: extra.idLabPos || "-16,-24",
            labelrot: extra.labelrot || "0", valLabPos: extra.valLabPos || "-16,20", valLabRot: extra.valLabRot || "0"
        };
        const logic = {
            Input_High_V: "2.5 V", Input_Low_V: "2.5 V", Input_Imped: "1000 MOhm",
            Out_High_V: "5 V", Out_Low_V: "0 V", Out_Imped: "40 Ohm",
            Tpd_ps: "10000 ps", Tr_ps: "3000 ps", Tf_ps: "4000 ps"
        };
        let result = { ...base };
        if (['And Gate', 'Or Gate', 'Buffer', 'FlipFlopD'].includes(type)) result = { ...result, ...logic };
        if (type === 'FlipFlopD') {
            result.pd_n = "1 _Gates"; result.UseRS = "false"; result.Reset_Inverted = "false";
            result.Clock_Inverted = "false"; result.Trigger = "Clock";
        }
        if (type === 'And Gate' || type === 'Or Gate') {
            result.Invert_Inputs = "false"; result.Inverted = "false";
            result.Open_Collector = "false"; result.initHigh = "false";
            result.Num_Inputs = extra.Num_Inputs || "2 _Inputs";
        }
        if (type === 'Switch') {
            result.Poles = "1 _Poles"; result.Norm_Close = "false"; result.DT = "true";
        }
        if (type === 'Led') {
            result.Color = "Yellow"; result.Grounded = "false";
            result.Threshold = "2.4 V"; result.MaxCurrent = "0.03 A"; result.Resistance = "0.6 Ohm";
        }
        if (type === 'Tunnel') {
            result.Name = extra.Name || "net"; result.IsBus = "false";
            result.Show_id = "false";
        }
        for (let k in extra) result[k] = extra[k];
        return Object.entries(result).map(([k, v]) => `${k}="${v}"`).join(' ');
    };

    const createItem = (type, props) => {
        const id = `${type}-${uidCount++}`; 
        compItems.push(`<item ${serializeFields(type, id, props)} />`);
        if (props.Pos) {
            const [x, y] = props.Pos.split(',').map(Number);
            const nInps = props.Num_Inputs ? parseInt(props.Num_Inputs.split(' ')[0]) : 2;
            itemData[id] = { x, y, type, nInps };
        }
        return id;
    };

    const createStubConnector = (sId, eId, x1, y1, x2, y2) => {
        connItems.push(`<item itemtype="Connector" uid="Connector-${uidCount++}" startpinid="${sId}" endpinid="${eId}" pointList="${x1},${y1},${x2},${y2}" />`);
    };

    const connectToNet = (pinId, netName, direction = 'in') => {
        const parts = pinId.split('-'), pinName = parts.pop(), compId = parts.join('-');
        const comp = itemData[compId];
        if(!comp) return;
        const off = getPinOffset(comp.type, pinName, comp.nInps);
        const x1 = comp.x + off[0], y1 = comp.y + off[1];
        
        // Offset tunnel: 24 pixels away
        const dist = 24;
        const tx = x1 + (direction === 'in' ? -dist : dist);
        const ty = y1;
        const hflip = (direction === 'in') ? "1" : "-1";
        
        const tunnelId = createItem('Tunnel', { Pos: `${tx},${ty}`, Name: netName, hflip: hflip, label: `Tunnel-${uidCount}` });
        
        // Create the direct stub connector
        if (direction === 'in') {
            createStubConnector(`${tunnelId}-pin`, pinId, tx, ty, x1, y1);
        } else {
            createStubConnector(pinId, `${tunnelId}-pin`, x1, y1, tx, ty);
        }
    };

    // --- Layout ---
    const XS = -600, YS = -250, COL_W = 240;

    // Inputs (Switches)
    for (let i = 0; i < nIn; i++) {
        const name = `X${nIn - 1 - i}`;
        const swX = XS, swY = YS + i * 80;
        const sw = createItem('Switch', { Pos: `${swX},${swY}`, label: name, hflip: "-1" });
        
        const railX = XS - 24, railY = swY;
        const rail = createItem('Rail', { Pos: `${railX},${railY}`, Show_Val: "true", ShowProp: "Voltage", Voltage: "5 V", rotation: "90" });
        createStubConnector(`${sw}-switch1pinN`, `${rail}-outnod`, swX-16, swY-8, railX, railY+16);
        
        const gndX = XS - 24, gndY = swY + 32;
        const gnd = createItem('Ground', { Pos: `${gndX},${gndY}` });
        createStubConnector(`${sw}-switch0pinN`, `${gnd}-Gnd`, swX-16, swY, gndX, gndY-8);
        
        connectToNet(`${sw}-pinP0`, name, 'out');
        
        // Inverter (Buffer)
        const inv = createItem('Buffer', { Pos: `${XS + 80},${YS + i * 80 + 40}`, Inverted: "true", label: `!${name}` });
        connectToNet(`${inv}-in0`, name, 'in');
        connectToNet(`${inv}-out`, `not${name}`, 'out');
    }

    // Clock (Switch)
    const clkY = YS + nIn * 80 + 20;
    const clk = createItem('Switch', { Pos: `${XS},${clkY}`, label: "CLK", hflip: "-1" });
    const cRail = createItem('Rail', { Pos: `${XS - 24},${clkY}`, Show_Val: "true", ShowProp: "Voltage", Voltage: "5 V", rotation: "90" });
    createStubConnector(`${clk}-switch1pinN`, `${cRail}-outnod`, XS-16, clkY-8, XS-24, clkY+16);
    const cGnd = createItem('Ground', { Pos: `${XS - 24},${clkY + 32}` });
    createStubConnector(`${clk}-switch0pinN`, `${cGnd}-Gnd`, XS-16, clkY, XS-24, clkY+24);
    connectToNet(`${clk}-pinP0`, "CLK", 'out');

    // Flip-Flops
    const ffIds = [];
    for (let i = 0; i < nBits; i++) {
        const name = `Q${nBits - 1 - i}`;
        const ff = createItem('FlipFlopD', { Pos: `${XS + COL_W * 2},${YS + i * 150}`, label: name });
        ffIds.push(ff);
        connectToNet(`${ff}-in3`, "CLK", 'in');
        connectToNet(`${ff}-in0`, `D${nBits - 1 - i}`, 'in');
        connectToNet(`${ff}-out0`, name, 'out');
        connectToNet(`${ff}-out1`, `not${name}`, 'out');
    }

    const processEq = (eq, targetX, targetY, netOut) => {
        const ands = [];
        eq.selection.forEach((sel, termIdx) => {
            const pi = sel.pi;
            let nI = 0; for (let c of pi) if (c !== '-') nI++;
            if (nI === 0) return;
            const and = createItem('And Gate', { Pos: `${targetX},${targetY + termIdx * 100}`, Num_Inputs: `${nI} _Inputs` });
            ands.push(and);
            for (let i = 0, curI = 0; i < nVars; i++) {
                if (pi[i] === '-') continue;
                const netName = i < nBits ? (pi[i] === '1' ? `Q${nBits-1-i}` : `notQ${nBits-1-i}`) 
                                         : (pi[i] === '1' ? `X${nIn-1-(i-nBits)}` : `notX${nIn-1-(i-nBits)}`);
                connectToNet(`${and}-in${curI++}`, netName, 'in');
            }
        });
        
        if (ands.length === 0) return;
        if (ands.length === 1) {
            connectToNet(`${ands[0]}-out`, netOut, 'out');
        } else {
            const orY = targetY + (ands.length - 1) * 50;
            const or = createItem('Or Gate', { Pos: `${targetX + 120},${orY}`, Num_Inputs: `${ands.length} _Inputs`, label: netOut });
            ands.forEach((a, k) => {
                const offS = getPinOffset('And Gate', 'out');
                const offE = getPinOffset('Or Gate', `in${k}`, ands.length);
                const x1 = itemData[a].x + offS[0], y1 = itemData[a].y + offS[1];
                const x2 = itemData[or].x + offE[0], y2 = itemData[or].y + offE[1];
                connItems.push(`<item itemtype="Connector" uid="Connector-${uidCount++}" startpinid="${a}-out" endpinid="${or}-in${k}" pointList="${x1},${y1},${(x1+x2)/2},${y1},${(x1+x2)/2},${y2},${x2},${y2}" />`);
            });
            connectToNet(`${or}-out`, netOut, 'out');
        }
    };

    stateEqs.forEach((eq, i) => processEq(eq, XS + COL_W * 1.0, YS + i * 250, `D${nBits - 1 - i}`));

    outputEqs.forEach((eq, i) => {
        const netZ = `Z${nOut - 1 - i}`;
        processEq(eq, XS + COL_W * 3.4, YS + (i + nBits) * 200, netZ);
        const ledX = XS + COL_W * 4.8, ledY = YS + (i + nBits) * 200;
        const led = createItem('Led', { Pos: `${ledX},${ledY}`, label: netZ });
        connectToNet(`${led}-lPin`, netZ, 'in');
        
        const resX = ledX, resY = ledY + 40;
        const res = createItem('Resistor', { Pos: `${resX},${resY}`, Resistance: "100 Ohm", Show_Val: "true", ShowProp: "Resistance" });
        createStubConnector(`${led}-rPin`, `${res}-lPin`, ledX-16, ledY, resX-16, resY);
        
        const gndX = ledX, gndY = ledY + 72;
        const gnd = createItem('Ground', { Pos: `${gndX},${gndY}` });
        createStubConnector(`${res}-rPin`, `${gnd}-Gnd`, resX+16, resY, gndX, gndY-8);
    });

    const xml = `<circuit version="1.1.0" rev="1912+dfsg-4build2" stepSize="1000000" stepsPS="1000000" NLsteps="100000" reaStep="1000000" animate="1" >\n\n${compItems.join('\n\n')}\n\n${connItems.join('\n\n')}\n\n</circuit>`;
    
    const blob = new Blob([xml], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    let name = (filename || `fsm_${Date.now()}`).replace('.sim1', '') + '.sim1';
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
