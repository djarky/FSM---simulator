import { minimize } from './logic-engine.js';
import { matchInput } from './models.js';
import { getGrayCode } from './utils.js';
import { getSuperSimplified } from './algebraic-simplifier.js';

/**
 * --- ANALYSIS ---
 */

export function updateAnalysis(tab, app, container) {
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
        
        // Calculate Don't Cares (unused state binary codes)
        const nDC = [];
        const totalPossibleStates = 1 << nBits;
        const nInCount = 1 << nIn;
        for (let idx = app.states.length; idx < totalPossibleStates; idx++) {
            for (let i = 0; i < nInCount; i++) {
                nDC.push((idx << nIn) | i);
            }
        }

        if (tab === 'equations') {
            let h = `<h3>Ecuaciones Siguiente Estado (Q+)</h3>`;
            for(let b=0; b<nBits; b++) {
                const res = minimize(nVars, nMS[b], nDC, nBits, nIn);
                const bitName = nBits > 1 ? `Q${nBits-1-b}+` : "Q+";
                const superSim = getSuperSimplified(res.selection.map(s => s.pi), nVars, nBits, nIn);
                h += `<div class="equation-group">`;
                h += `<div class="equation">${bitName} = ${res.text}</div>`;
                if (superSim !== res.text.replace(/<[^>]*>/g, '')) {
                    h += `<div class="equation super-equation">Opt: ${bitName} = ${superSim}</div>`;
                }
                h += `</div>`;
            }
            h += `<h3 style="margin-top:20px">Ecuaciones Salida (Z)</h3>`;
            for(let o=0; o<nOut; o++) {
                const res = minimize(nVars, nMO[o], nDC, nBits, nIn);
                const outName = nOut > 1 ? `Z${nOut-1-o}` : "Z";
                const superSim = getSuperSimplified(res.selection.map(s => s.pi), nVars, nBits, nIn);
                h += `<div class="equation-group">`;
                h += `<div class="equation">${outName} = ${res.text}</div>`;
                if (superSim !== res.text.replace(/<[^>]*>/g, '')) {
                    h += `<div class="equation super-equation">Opt: ${outName} = ${superSim}</div>`;
                }
                h += `</div>`;
            }
            container.innerHTML = h + `<p style="font-size:0.75rem; color:var(--text-muted); margin-top:20px">Vbles: Q = Bits de Estado, X = Bits de Entrada</p>`;
        } else {
            if (nVars > 6) { 
                container.innerHTML = `<h3>Mapas de Karnaugh</h3><p>Mapas visuales limitados a 6 variables. Por favor, usa la pestaña de <b>Ecuaciones</b> para ver los resultados de la simplificación de tus ${nVars} variables.</p>`; 
                return; 
            }
            
            const rowBits = Math.floor(nVars / 2);
            const colBits = nVars - rowBits;
            const rowCodes = getGrayCode(rowBits);
            const colCodes = getGrayCode(colBits);

            const renderMap = (title, mList) => {
                const res = minimize(nVars, mList, nDC, nBits, nIn);
                let h = `<div class="kmap-container"><p><b>${title}</b></p><div class="kmap-grid">`;
                
                // Construct axis label
                // Q variables are the first nBits, X variables are the rest
                // Variables in the bitstring: Q_{nBits-1}...Q_0 X_{nIn-1}...X_0
                // We split them into rowBits (MSBs) and colBits (LSBs)
                
                let rowVars = [], colVars = [];
                for (let i = 0; i < nVars; i++) {
                    let name = (i < nBits) ? `Q${nBits - 1 - i}` : `X${nIn - 1 - (i - nBits)}`;
                    if (i < rowBits) rowVars.push(name);
                    else colVars.push(name);
                }

                const axisLabel = `${rowVars.join('')}\\${colVars.join('')}`;
                h += `<div class="kmap-row"><div class="kmap-cell" style="border:none; font-size:0.6rem; color:var(--text-muted)">${axisLabel}</div>${colCodes.map(c => `<div class="kmap-header">${c}</div>`).join('')}</div>`;
                
                rowCodes.forEach(r => {
                    h += `<div class="kmap-row"><div class="kmap-header">${r}</div>`;
                    colCodes.forEach(c => {
                        const m = parseInt(r + c, 2);
                        const hasVal = mList.includes(m);
                        const isDC = nDC.includes(m);
                        h += `<div class="kmap-cell">${isDC ? 'X' : (hasVal ? '1' : '0')}`;
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
                const superSim = getSuperSimplified(res.selection.map(s => s.pi), nVars, nBits, nIn);
                let footer = `<div class="equation" style="font-size:0.8rem">${res.text}</div>`;
                if (superSim !== res.text.replace(/<[^>]*>/g, '')) {
                    footer += `<div class="equation super-equation" style="font-size:0.75rem">Opt: ${superSim}</div>`;
                }
                return h + `</div>` + footer + `</div>`;
            };

            let fullH = `<h3>Mapas de Karnaugh (Siguiente Estado)</h3>`;
            for(let b=0; b<nBits; b++) fullH += renderMap(`Bit D${nBits-1-b}`, nMS[b]);
            fullH += `<h3>Mapas de Karnaugh (Salidas)</h3>`;
            for(let o=0; o<nOut; o++) fullH += renderMap(`Salida Z${nOut-1-o}`, nMO[o]);
            container.innerHTML = fullH;
        }
    }
}
