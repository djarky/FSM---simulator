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

    let piList = Array.from(primeImplicants).map(pi => {
        let covered = [];
        minterms.forEach(m => {
            let mStr = m.toString(2).padStart(variables, '0');
            let match = true;
            for (let k = 0; k < variables; k++) if (pi[k] !== '-' && pi[k] !== mStr[k]) { match = false; break; }
            if (match) covered.push(m);
        });
        return { pi, covered };
    });

    // 1. Identify Essential Prime Implicants
    let finalSelection = [];
    let uncovered = new Set(minterms);

    while (true) {
        let counts = {};
        uncovered.forEach(m => counts[m] = 0);
        piList.forEach(p => p.covered.forEach(m => { if (uncovered.has(m)) counts[m]++; }));

        let essentialPIs = piList.filter(p => p.covered.some(m => uncovered.has(m) && counts[m] === 1));
        if (essentialPIs.length === 0) break;

        essentialPIs.forEach(p => {
            if (!finalSelection.some(f => f === p.pi)) {
                finalSelection.push(p.pi);
                p.covered.forEach(m => uncovered.delete(m));
            }
        });
        // Remove PIs that cover nothing new
        piList = piList.filter(p => p.covered.some(m => uncovered.has(m)));
    }

    // 2. Solve the remaining chart (Greedy with lookahead or simple recursion)
    // For small sets, greedy is often enough if we already took EPIs. 
    // Let's use a refined greedy: pick the PI that covers the MOST uncovered minterms.
    while (uncovered.size > 0) {
        piList.sort((a, b) => b.covered.filter(m => uncovered.has(m)).length - a.covered.filter(m => uncovered.has(m)).length);
        let best = piList[0];
        finalSelection.push(best.pi);
        best.covered.forEach(m => uncovered.delete(m));
        piList = piList.filter(p => p.covered.some(m => uncovered.has(m)));
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
