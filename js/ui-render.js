import { getPointOnPath } from './utils.js';

/**
 * --- UI RENDER ENGINE ---
 */

export function render(app, layers) {
    const { statesLayer, linksLayer } = layers;
    statesLayer.innerHTML = '';
    linksLayer.innerHTML = '';

    app.links.forEach((link, idx) => {
        const fromState = app.states.find(s => s.id === link.from);
        const toState = app.states.find(s => s.id === link.to);
        if (!fromState || !toState) return;

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const isSelf = fromState.id === toState.id;
        
        let d = "";
        if (isSelf) {
            d = `M ${fromState.x-10} ${fromState.y-25} A 20 20 0 1 1 ${fromState.x+10} ${fromState.y-25}`;
        } else {
            const dx = toState.x - fromState.x;
            const dy = toState.y - fromState.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const midX = (fromState.x + toState.x) / 2 - (dy / dist) * 20;
            const midY = (fromState.y + toState.y) / 2 + (dx / dist) * 20;
            d = `M ${fromState.x} ${fromState.y} Q ${midX} ${midY} ${toState.x} ${toState.y}`;
        }

        path.setAttribute("d", d);
        path.setAttribute("class", "transition-path");
        path.dataset.linkIndex = idx;
        linksLayer.appendChild(path);

        const textArea = document.createElementNS("http://www.w3.org/2000/svg", "text");
        const cp = getPointOnPath(d, 0.5);
        textArea.setAttribute("x", cp.x);
        textArea.setAttribute("y", cp.y - 10);
        textArea.setAttribute("class", "transition-label");
        textArea.dataset.linkIndex = idx;
        textArea.textContent = app.machineType === 'MEALY' ? `${link.input} / ${link.output}` : `${link.input}`;
        linksLayer.appendChild(textArea);
    });

    app.states.forEach(state => {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", state.x);
        circle.setAttribute("cy", state.y);
        circle.setAttribute("r", 25);
        const isSimActive = app.currentSimulationState === state.id;
        circle.setAttribute("class", `state-circle ${app.selectedId === state.id ? 'selected' : ''} ${isSimActive ? 'active-simulation' : ''}`);
        circle.dataset.id = state.id;

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", state.x);
        text.setAttribute("y", state.y + 5);
        text.setAttribute("class", "state-text");
        text.textContent = state.name;

        const code = document.createElementNS("http://www.w3.org/2000/svg", "text");
        code.setAttribute("x", state.x);
        code.setAttribute("y", state.y + 40);
        code.setAttribute("class", "state-text");
        code.style.fontSize = "10px";
        code.style.fill = "var(--text-muted)";
        code.textContent = `(${state.binary})`;

        const outLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
        outLabel.setAttribute("x", state.x);
        outLabel.setAttribute("y", state.y + 18);
        outLabel.setAttribute("class", "state-text");
        outLabel.style.fontSize = "10px";
        outLabel.style.fill = "var(--primary)";
        outLabel.textContent = app.machineType === 'MOORE' ? `Z:${state.output}` : "";

        g.appendChild(circle);
        g.appendChild(text);
        g.appendChild(code);
        g.appendChild(outLabel);
        statesLayer.appendChild(g);
    });
}
