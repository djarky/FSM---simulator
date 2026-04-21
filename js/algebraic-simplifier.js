/**
 * --- SEARCH-BASED ALGEBRAIC SIMPLIFIER (DP) ---
 */

export function getSuperSimplified(piList, variables, nBits, nIn) {
    if (piList.length === 0) return "0";
    if (piList.length === 1 && piList[0].match(/^-+$/)) return "1";

    const getVarName = (i) => {
        if (i < nBits) return nBits > 1 ? `Q${nBits - 1 - i}` : "Q";
        return nIn > 1 ? `X${nIn - 1 - (i - nBits)}` : "X";
    };

    // Initial terms
    let initialTerms = piList.map(pi => {
        let literals = [];
        for (let i = 0; i < variables; i++) {
            if (pi[i] !== '-') literals.push({ id: i, type: pi[i] === '1' ? 'pos' : 'neg', name: getVarName(i) });
        }
        return { type: 'prod', lits: literals };
    });

    const calculateCost = (terms) => {
        let cost = 0;
        terms.forEach(t => {
            if (t.type === 'prod') {
                cost += t.lits.length * 10; // literals are expensive
                if (t.lits.length > 1) cost += 5; // AND gate cost
            } else {
                cost += t.cost; // complex terms have their own cost
            }
        });
        if (terms.length > 1) cost += (terms.length - 1) * 5; // OR gate cost
        return cost;
    };

    const serialize = (terms) => {
        return terms.map(t => {
            if (t.type === 'prod') return t.lits.map(l => `${l.id}${l.type}`).sort().join(',');
            return t.text;
        }).sort().join('|');
    };

    let bestState = initialTerms;
    let minCost = calculateCost(initialTerms);
    let visited = new Map();

    const solve = (currentTerms) => {
        const key = serialize(currentTerms);
        if (visited.has(key)) return;
        visited.set(key, true);

        if (visited.size > 500) return; // Safety break for performance

        const currentCost = calculateCost(currentTerms);
        if (currentCost < minCost) {
            minCost = currentCost;
            bestState = currentTerms;
        }

        // Generate Successors
        // 1. Absorption
        for (let i = 0; i < currentTerms.length; i++) {
            for (let j = 0; j < currentTerms.length; j++) {
                if (i === j) continue;
                let t1 = currentTerms[i], t2 = currentTerms[j];
                if (t1.type === 'prod' && t2.type === 'prod') {
                    // A + AB = A
                    let isSubset = t1.lits.every(l1 => t2.lits.some(l2 => l1.id === l2.id && l1.type === l2.type));
                    if (isSubset) {
                        let next = currentTerms.filter((_, idx) => idx !== j);
                        solve(next); return;
                    }
                    // A + A'B = A + B
                    let diffs = t1.lits.filter(l1 => !t2.lits.some(l2 => l1.id === l2.id && l1.type === l2.type));
                    if (diffs.length === 1) {
                        let d = diffs[0];
                        let match = t2.lits.find(l2 => l2.id === d.id && l2.type !== d.type);
                        if (match && t2.lits.length > t1.lits.length) {
                            let newT2 = { type: 'prod', lits: t2.lits.filter(l => l !== match) };
                            let next = currentTerms.map((t, idx) => idx === j ? newT2 : t);
                            solve(next); return;
                        }
                    }
                }
            }
        }

        // 2. XOR / XNOR pairs
        for (let i = 0; i < currentTerms.length; i++) {
            if (currentTerms[i].type !== 'prod') continue;
            for (let j = i + 1; j < currentTerms.length; j++) {
                if (currentTerms[j].type !== 'prod') continue;
                let t1 = currentTerms[i], t2 = currentTerms[j];
                let common = t1.lits.filter(l1 => t2.lits.some(l2 => l1.id === l2.id && l1.type === l2.type));
                let d1 = t1.lits.filter(l1 => !t2.lits.some(l2 => l1.id === l2.id && l1.type === l2.type));
                let d2 = t2.lits.filter(l2 => !t1.lits.some(l1 => l1.id === l2.id && l1.type === l2.type));
                if (d1.length === 2 && d2.length === 2) {
                    let v1 = d1[0], v2 = d1[1], v3 = d2.find(l => l.id === v1.id), v4 = d2.find(l => l.id === v2.id);
                    if (v3 && v4 && v3.type !== v1.type && v4.type !== v2.type) {
                        let isXor = v1.type !== v2.type;
                        let text = (common.map(l => l.name + (l.type === 'neg' ? "'" : "")).join('') || "") + `(${v1.name} ${isXor ? "⊕" : "⊙"} ${v2.name})`;
                        let complex = { type: 'complex', text, cost: (common.length + 2) * 10 + 5 };
                        let next = currentTerms.filter((_, idx) => idx !== i && idx !== j);
                        next.push(complex);
                        solve(next);
                    }
                }
            }
        }

        // 3. Factoring
        let literalCounts = {};
        currentTerms.forEach(t => {
            if (t.type === 'prod') {
                t.lits.forEach(l => {
                    let lid = `${l.id}_${l.type}`;
                    literalCounts[lid] = (literalCounts[lid] || 0) + 1;
                });
            }
        });

        Object.keys(literalCounts).forEach(lid => {
            if (literalCounts[lid] > 1) {
                let [id, type] = lid.split('_');
                let matches = currentTerms.filter(t => t.type === 'prod' && t.lits.some(l => l.id == id && l.type === type));
                let commonLits = matches[0].lits.filter(l => matches.every(m => m.lits.some(ml => ml.id === l.id && ml.type === l.type)));
                
                let prefix = commonLits.map(l => l.name + (l.type === 'neg' ? "'" : "")).join('');
                let inner = matches.map(m => {
                    let rest = m.lits.filter(l => !commonLits.some(cl => cl.id === l.id && cl.type === l.type));
                    return rest.map(l => l.name + (l.type === 'neg' ? "'" : "")).join('') || "1";
                });
                let text = `${prefix}(${inner.join(' + ')})`;
                let complex = { type: 'complex', text, cost: (commonLits.length + inner.length) * 10 + 5 };
                let next = currentTerms.filter(t => !matches.includes(t));
                next.push(complex);
                solve(next);
            }
        });

        // 4. De Morgan
        if (currentTerms.length > 1 && currentTerms.every(t => t.type === 'prod' && t.lits.length === 1 && t.lits[0].type === 'neg')) {
            let text = "(" + currentTerms.map(t => t.lits[0].name).join('') + ")'";
            solve([{ type: 'complex', text, cost: currentTerms.length * 10 + 5 }]);
        }
    };

    solve(initialTerms);

    // Final formatting
    return bestState.map(t => {
        if (t.type === 'complex') return t.text;
        return t.lits.map(l => l.name + (l.type === 'neg' ? "'" : "")).join('') || "1";
    }).join(' + ');
}
