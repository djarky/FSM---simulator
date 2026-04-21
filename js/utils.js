/**
 * --- UTILS ---
 */

export function getSVGPoint(e, svg) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
}

export function getPointOnPath(d, t) {
    const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tempPath.setAttribute("d", d);
    const len = tempPath.getTotalLength();
    return tempPath.getPointAtLength(len * t);
}
export function getGrayCode(bits) {
    if (bits === 0) return [""];
    if (bits === 1) return ["0", "1"];
    const prev = getGrayCode(bits - 1);
    return [...prev.map(s => "0" + s), ...[...prev].reverse().map(s => "1" + s)];
}
