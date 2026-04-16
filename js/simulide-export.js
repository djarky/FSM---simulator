import { minimize } from './logic-engine.js';
import { matchInput } from './models.js';

/**
 * --- SIMULIDE EXPORTER (Junction Node Version) ---
 */

const staticPinOffsets = {
    'Switch': { pinP0: [16, 0], switch0pinN: [-16, 0], switch1pinN: [-16, -8] },
    'Led': { lPin: [16, 0], rPin: [-16, 0] },
    'Resistor': { lPin: [-16, 0], rPin: [16, 0] },
    'Rail': { outnod: [0, 16] },
    'Ground': { Gnd: [0, -8] },
    'Buffer': { in0: [-16, 0], out: [16, 0] },
    'FlipFlopD': { in0: [-16, 0], in1: [-16, -8], in2: [16, -8], in3: [-16, 8], out0: [24, 0], out1: [24, 8] },
    'Node': { pin0: [0,0], pin1: [0,0], pin2: [0,0], pin3: [0,0], pin4: [0,0], pin5: [0,0], pin6: [0,0], pin7: [0,0], pin8: [0,0], pin9: [0,0] }
};

function getPinOffset(type, pinName, nInputs = 2) {
    if (type === 'And Gate' || type === 'Or Gate') {
        if (pinName === 'out') return [16, -8];
        const idx = parseInt(pinName.replace('in', ''));
        const yOff = (idx - (nInputs - 1) / 2) * 8;
        return [-16, yOff];
    }
    if (type === 'Node') return [0, 0];
    return (staticPinOffsets[type] || {})[pinName] || [0, 0];
}

export function exportToSimulIDE(app, filename) {
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
    let pendingConns = []; // Store connections group by source
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
        for (let k in extra) result[k] = extra[k];
        return Object.entries(result).map(([k, v]) => `${k}="${v}"`).join(' ');
    };

    const createItem = (type, props) => {
        const safeType = type.replace(' ', '_');
        const id = `${safeType}_${uidCount++}`; 
        compItems.push(`<item ${serializeFields(type, id, props)} />`);
        if (props.Pos) {
            const [x, y] = props.Pos.split(',').map(Number);
            const nInps = props.Num_Inputs ? parseInt(props.Num_Inputs.split(' ')[0]) : 2;
            itemData[id] = { x, y, type, nInps };
        }
        return id;
    };

    const queueConnector = (startPinId, endPinId, jitter = 0) => {
        pendingConns.push({ startPinId, endPinId, jitter });
    };

    // --- Layout ---
    const XS = -600, YS = -250, COL_W = 220;

    const xInIds = [];
    for (let i = 0; i < nIn; i++) {
        const sw = createItem('Switch', { Pos: `${XS},${YS + i * 80}`, label: `X${nIn - 1 - i}`, hflip: "-1" });
        xInIds.push(sw);
        const rail = createItem('Rail', { Pos: `${XS - 20},${YS + i * 80}`, Show_Val: "true", ShowProp: "Voltage", Voltage: "5 V", rotation: "90" });
        queueConnector(`${sw}-switch1pinN`, `${rail}-outnod`);
        const gnd = createItem('Ground', { Pos: `${XS - 20},${YS + i * 80 + 30}` });
        queueConnector(`${sw}-switch0pinN`, `${gnd}-Gnd`);
    }
    const clk = createItem('Switch', { Pos: `${XS},${YS + nIn * 80 + 20}`, label: "CLK", hflip: "-1" });
    const cRail = createItem('Rail', { Pos: `${XS - 20},${YS + nIn * 80 + 20}`, Show_Val: "true", ShowProp: "Voltage", Voltage: "5 V", rotation: "90" });
    queueConnector(`${clk}-switch1pinN`, `${cRail}-outnod`);
    const cGnd = createItem('Ground', { Pos: `${XS - 20},${YS + nIn * 80 + 50}` });
    queueConnector(`${clk}-switch0pinN`, `${cGnd}-Gnd`);

    const ffIds = [];
    for (let i = 0; i < nBits; i++) {
        const ff = createItem('FlipFlopD', { Pos: `${XS + COL_W * 2},${YS + i * 150}`, label: `Q${nBits - 1 - i}` });
        ffIds.push(ff);
        queueConnector(`${clk}-pinP0`, `${ff}-in3`, i * 5);
    }

    const xInvIds = [];
    for (let i = 0; i < nIn; i++) {
        const inv = createItem('Buffer', { Pos: `${XS + COL_W * 0.5},${YS + i * 80 + 40}`, Inverted: "true", label: `!X${nIn - 1 - i}` });
        xInvIds.push(inv);
        queueConnector(`${xInIds[i]}-pinP0`, `${inv}-in0`, 10);
    }

    const processEq = (eq, targetX, targetY, label) => {
        const ands = [];
        eq.selection.forEach((sel, termIdx) => {
            const pi = sel.pi;
            let nI = 0; for (let c of pi) if (c !== '-') nI++;
            if (nI === 0) return;
            const and = createItem('And Gate', { Pos: `${targetX},${targetY + termIdx * 80}`, Num_Inputs: `${nI} _Inputs` });
            ands.push(and);
            for (let i = 0, curI = 0; i < nVars; i++) {
                if (pi[i] === '-') continue;
                const tp = `${and}-in${curI++}`;
                const jitter = (i * 2 + termIdx * 3);
                if (i < nBits) {
                    const sp = pi[i] === '1' ? `${ffIds[i]}-out0` : `${ffIds[i]}-out1`;
                    queueConnector(sp, tp, jitter);
                } else {
                    const vIdx = i - nBits;
                    const sp = pi[i] === '1' ? `${xInIds[vIdx]}-pinP0` : `${xInvIds[vIdx]}-out`;
                    queueConnector(sp, tp, jitter);
                }
            }
        });
        if (ands.length === 0) return null;
        if (ands.length === 1) return `${ands[0]}-out`;
        const or = createItem('Or Gate', { Pos: `${targetX + 110},${targetY + (ands.length - 1) * 35}`, Num_Inputs: `${ands.length} _Inputs`, label: label });
        ands.forEach((a, k) => queueConnector(`${a}-out`, `${or}-in${k}`, k * 3));
        return `${or}-out`;
    };

    stateEqs.forEach((eq, i) => {
        const p = processEq(eq, XS + COL_W * 1.0, YS + i * 250, `D${nBits - 1 - i}`);
        if (p) queueConnector(p, `${ffIds[i]}-in0`, 15);
    });

    outputEqs.forEach((eq, i) => {
        const p = processEq(eq, XS + COL_W * 3.4, YS + (i + nBits) * 200, `Z${nOut - 1 - i}`);
        const led = createItem('Led', { Pos: `${XS + COL_W * 4.8},${YS + (i + nBits) * 200}`, label: `Z${nOut - 1 - i}` });
        if (p) queueConnector(p, `${led}-lPin`, 30);
        const res = createItem('Resistor', { Pos: `${XS + COL_W * 4.8},${YS + (i + nBits) * 200 + 40}`, Resistance: "100 Ohm", Show_Val: "true", ShowProp: "Resistance" });
        queueConnector(`${led}-rPin`, `${res}-lPin`);
        const gnd = createItem('Ground', { Pos: `${XS + COL_W * 4.8},${YS + (i + nBits) * 200 + 70}` });
        queueConnector(`${res}-rPin`, `${gnd}-Gnd`);
    });

    // --- Final Step: Junction & Connector Generation ---
    const connectionsBySource = {};
    pendingConns.forEach(conn => {
        if (!connectionsBySource[conn.startPinId]) connectionsBySource[conn.startPinId] = [];
        connectionsBySource[conn.startPinId].push(conn);
    });

    const createFinalConnector = (sId, eId, points) => {
        connItems.push(`<item itemtype="Connector" uid="Connector_${uidCount++}" startpinid="${sId}" endpinid="${eId}" pointList="${points.join(',')}" />`);
    };

    Object.keys(connectionsBySource).forEach(sourceId => {
        const conns = connectionsBySource[sourceId];
        const partsS = sourceId.split('-'), pinS = partsS.pop(), idS = partsS.join('-');
        const cS = itemData[idS];
        if (!cS) return;
        const offS = getPinOffset(cS.type, pinS, cS.nInps);
        const x1 = cS.x + offS[0], y1 = cS.y + offS[1];

        if (conns.length === 1) {
            const conn = conns[0];
            const partsE = conn.endPinId.split('-'), pinE = partsE.pop(), idE = partsE.join('-');
            const cE = itemData[idE];
            if (!cE) return;
            const offE = getPinOffset(cE.type, pinE, cE.nInps);
            const x2 = cE.x + offE[0], y2 = cE.y + offE[1];
            let midX = (x1 + x2) / 2 + conn.jitter;
            if (cS.type === 'FlipFlopD' && x1 > x2) midX = x1 + (30 + conn.jitter);
            else if (cE.type === 'FlipFlopD' && x1 > x2) midX = x2 - (20 + conn.jitter);
            createFinalConnector(sourceId, conn.endPinId, [x1, y1, midX, y1, midX, y2, x2, y2]);
        } else {
            // BRANCHING: Source -> Node -> Target1, Target2...
            // Use midX of the first target as Node position
            const firstConn = conns[0];
            const partsF = firstConn.endPinId.split('-'), pinF = partsF.pop(), idF = partsF.join('-');
            const cF = itemData[idF];
            if (!cF) return;
            let midXBase = (x1 + cF.x + getPinOffset(cF.type, pinF, cF.nInps)[0]) / 2 + firstConn.jitter;
            if (cS.type === 'FlipFlopD' && x1 > cF.x) midXBase = x1 + (30 + firstConn.jitter);

            const nodePos = `${midXBase},${y1}`;
            const nodeId = createItem('Node', { Pos: nodePos });

            // Connection: Source -> Node Input (pin0)
            createFinalConnector(sourceId, `${nodeId}-0`, [x1, y1, midXBase, y1]);

            // Connections: Node Output (pinN) -> Targetes
            conns.forEach((conn, k) => {
                const partsE = conn.endPinId.split('-'), pinE = partsE.pop(), idE = partsE.join('-');
                const cE = itemData[idE];
                if (!cE) return;
                const offE = getPinOffset(cE.type, pinE, cE.nInps);
                const x2 = cE.x + offE[0], y2 = cE.y + offE[1];
                const nodePinOut = `${nodeId}-${k+1}`;
                // Points: from Node (midXBase, y1) to Target (x2, y2)
                createFinalConnector(nodePinOut, conn.endPinId, [midXBase, y1, midXBase, y2, x2, y2]);
            });
        }
    });

    const xml = `<circuit version="1.1.0" rev="1912+dfsg-4build2" stepSize="1000000" stepsPS="1000000" NLsteps="100000" reaStep="1000000" animate="1" >\n\n${compItems.join('\n\n')}\n\n${connItems.join('\n\n')}\n\n</circuit>`;
    
    const blob = new Blob([xml], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    let name = (filename || `fsm_${Date.now()}`).replace('.sim1', '') + '.sim1';
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
