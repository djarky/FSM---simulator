/**
 * --- LOGIC ENGINE (QUINCE-MCCLUSKEY) ---
 */

export function minimize(variables, minterms, dontCares = [], nBits = 0, nIn = 0) {
    if (minterms.length === 0) return { text: "0", selection: [] };
    if (minterms.length === (1 << variables)) return { text: "1", selection: [{pi: "-".repeat(variables), color:0}] };

    let implicants = new Set();
    minterms.forEach(m => implicants.add(m.toString(2).padStart(variables, '0')));
    dontCares.forEach(m => implicants.add(m.toString(2).padStart(variables, '0')));

    let primeImplicants = new Set();
    let current = implicants;

    while (current.size > 0) {
        let next = new Set();
        let combined = new Set();
        let list = Array.from(current);

        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                let diff = -1;
                let count = 0;
                for (let k = 0; k < variables; k++) {
                    if (list[i][k] !== list[j][k]) { count++; diff = k; }
                }
                if (count === 1) {
                    let s = list[i].split('');
                    s[diff] = '-';
                    next.add(s.join(''));
                    combined.add(list[i]);
                    combined.add(list[j]);
                }
            }
        }
        list.forEach(item => { if (!combined.has(item)) primeImplicants.add(item); });
        current = next;
    }

    let uncovered = new Set(minterms);
    let finalSelection = [];
    let piList = Array.from(primeImplicants).sort((a,b) => (b.match(/-/g)||[]).length - (a.match(/-/g)||[]).length);

    for (let pi of piList) {
        let isNeeded = false;
        for (let m of Array.from(uncovered)) {
            let mStr = m.toString(2).padStart(variables, '0');
            let match = true;
            for (let k = 0; k < variables; k++) if (pi[k] !== '-' && pi[k] !== mStr[k]) { match = false; break; }
            if (match) { isNeeded = true; break; }
        }
        if (isNeeded) {
            finalSelection.push(pi);
            for (let m of Array.from(uncovered)) {
                let mStr = m.toString(2).padStart(variables, '0');
                let match = true;
                for (let k = 0; k < variables; k++) if (pi[k] !== '-' && pi[k] !== mStr[k]) { match = false; break; }
                if (match) uncovered.delete(m);
            }
        }
    }

    const terms = finalSelection.map((pi, idx) => {
        let parts = [];
        for (let i = 0; i < variables; i++) {
            let name = "";
            if (i < nBits) {
                name = nBits > 1 ? `Q${nBits - 1 - i}` : "Q";
            } else {
                name = nIn > 1 ? `X${nIn - 1 - (i - nBits)}` : "X";
            }
            if (pi[i] === '1') parts.push(name);
            if (pi[i] === '0') parts.push(name + "'");
        }
        return { text: parts.length === 0 ? "1" : parts.join(''), color: idx % 5 };
    });

    return { 
        text: terms.map(t => `<span class="group-color-${t.color}">${t.text}</span>`).join(' + '), 
        selection: finalSelection.map((pi, idx) => ({ pi, color: idx % 5 })) 
    };
}
