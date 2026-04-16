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
