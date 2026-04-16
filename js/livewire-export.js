import { minimize } from './logic-engine.js';
import { matchInput } from './models.js';

/**
 * --- LIVEWIRE EXPORTER (Template-Based Version) ---
 * Uses a hex boilerplate from a valid .lvw file to ensure structural integrity.
 */

// Boilerplate extracted from 'ejemplo.lvw' (first 512 bytes)
const LVW_HEADER_HEX = "447367000a640a0000010a000000000000ff6e0a00000011b0bcb0bcb1acacadaaaca9a5acacada8a50000000000000000710a00000100d0d70c00f015090000a08c0000a08c0000a08c0000a08c00000000000226660226690d70616765202670206f6620266e05417269616c08000000000000000001000000640000006f0a000001007a0a00000000020000010000401901000a000000ffffff00ff808000c0c0c00000000000c0c0c000ffff0000b0b0ff0045000000008000e4e4ff00000000000000ff008080ff008080ff0080808000e4e4e00001000000000000f03f010000000000002240000019000000dfffffff1fff000000ffffff000000ff0000ff000000000000000001790a00000046652200000200c00d050000460500201c0000a0320000000400000000000500000000008820efffff400b000020efffff400b000020efffff400b000020efffff400b000020efffff400b00000101010101010000000000080000000001000000000008000000000100000000000800000000010000000000080000000001000000000008000000000211021102110211021100000000000090230000020060f70200c04b0300b07b010010d001000004010100000005000000000080302a000040650000302a000040650000302a000068880000302a000068880000302a000090ab00000202020202010000000000";

// Footer extracted from 'ejemplo.lvw' (last 256 bytes)
const LVW_FOOTER_HEX = "0000080000000001000000000008000000000100000000000800000000010000000000080000000001000000000008000000000211021102110211021100000000000000221f0002001e810400429d04001ede010022de010000020000002081040020de0100409d040020de0100f122130000000000a523010000000000020000010800401901000a000000ffffff00ff8080002020200000000000c0c0c000ffff40000000ff0000000100008000e4e4ff00000000000000ff008080ff000000000080808000e4e4e00001000000000000f03f010000000000002240000019000000dfffffff1fff000000ffffff000000ff0000ff00000000000000000000";

class LvwBinaryWriter {
    constructor() {
        this.buffer = new Uint8Array(256 * 1024);
        this.view = new DataView(this.buffer.buffer);
        this.offset = 0;
    }

    writeHex(hex) {
        const h = hex.replace(/[^0-9a-fA-F]/g, '');
        for (let i = 0; i < h.length; i += 2) {
            this.buffer[this.offset++] = parseInt(h.substring(i, i + 2), 16);
        }
    }

    writeBytes(bytes) {
        for (let b of bytes) this.buffer[this.offset++] = b;
    }

    writeString(str) {
        this.buffer[this.offset++] = str.length;
        for (let i = 0; i < str.length; i++) {
            this.buffer[this.offset++] = str.charCodeAt(i);
        }
    }

    writeInt32(val) {
        this.view.setInt32(this.offset, val, true);
        this.offset += 4;
    }

    getBlob() {
        return new Blob([this.buffer.slice(0, this.offset)], { type: 'application/octet-stream' });
    }
}

const LVW_TYPES = {
    FF_D: [0x11, 0x00, 0x02],
    AND: [0x12, 0x00, 0x02],
    OR: [0x13, 0x00, 0x02],
    INPUT: [0x15, 0x00, 0x01],
    LED: [0x16, 0x00, 0x05]
};

export function exportToLivewire(app, filename) {
    try {
        if (!app || !app.states || app.states.length === 0) {
            alert("Diseña una máquina primero.");
            return;
        }

        const nBits = app.bits;
        const isMoore = app.machineType === 'MOORE';
        let nIn = 1, nOut = 1;
        
        app.links.forEach(l => {
            if (l.input) nIn = Math.max(nIn, l.input.length);
            if (!isMoore && l.output) nOut = Math.max(nOut, l.output.length);
        });
        if (isMoore) {
            app.states.forEach(s => {
                if (s.output) nOut = Math.max(nOut, s.output.length);
            });
        }
        
        const nVars = nBits + nIn;
        const nMS = Array.from({ length: nBits }, () => []);
        const nMO = Array.from({ length: nOut }, () => []);

        app.states.forEach((s, idx) => {
            const rowCount = 1 << nIn;
            for (let i = 0; i < rowCount; i++) {
                const xStr = i.toString(2).padStart(nIn, '0');
                const l = app.links.find(link => link.from === s.id && matchInput(link.input, xStr, nIn));
                const nextS = l ? app.states.find(st => st.id === l.to) : null;
                const m = (idx << nIn) | i;
                
                if (nextS) {
                    for (let b = 0; b < nBits; b++) {
                        if (nextS.binary[nBits - 1 - b] === '1') nMS[b].push(m);
                    }
                }
                
                if (!isMoore && l) {
                    const outVal = (l.output || "").padStart(nOut, '0');
                    for (let o = 0; o < nOut; o++) {
                        if (outVal[nOut - 1 - o] === '1') nMO[o].push(m);
                    }
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

        const stateEqs = nMS.map(mList => minimize(nVars, mList, [], nBits, nIn));
        const outputEqs = nMO.map(mList => minimize(nVars, mList, [], nBits, nIn));

        const writer = new LvwBinaryWriter();
        writer.writeHex(LVW_HEADER_HEX);

        const addComponent = (typeCode, x, y, label = "") => {
            writer.writeBytes([0x22]); 
            writer.writeBytes(typeCode); 
            writer.writeInt32(x);
            writer.writeInt32(y);
            
            const safeLabel = String(label || "");
            if (safeLabel) {
                writer.writeString(safeLabel);
            } else {
                writer.writeBytes([0x00]);
            }
            writer.writeBytes([0x00, 0x00, 0x05, 0x00, 0x00, 0x00]); 
        };

        let curX = 2000, curY = 2000;

        for (let i = 0; i < nIn; i++) {
            addComponent(LVW_TYPES.INPUT, curX, curY + i * 800, `X${nIn - 1 - i}`);
        }

        stateEqs.forEach((eq, i) => {
            if (eq && eq.selection) {
                eq.selection.forEach((sel, termIdx) => {
                    addComponent(LVW_TYPES.AND, curX + 1500, curY + i * 2000 + termIdx * 600);
                });
            }
        });

        for (let i = 0; i < nBits; i++) {
            addComponent(LVW_TYPES.FF_D, curX + 3000, curY + i * 1500, `Q${nBits - 1 - i}`);
        }

        outputEqs.forEach((eq, i) => {
            addComponent(LVW_TYPES.LED, curX + 4500, curY + i * 800, `Z${nOut - 1 - i}`);
        });

        writer.writeHex(LVW_FOOTER_HEX);

        const blob = writer.getBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        let name = (filename || `fsm_livewire_${Date.now()}`).toString().replace('.lvw', '') + '.lvw';
        a.download = name;
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 150);

    } catch (error) {
        console.error("Fallo al exportar a Livewire:", error);
        alert("Ocurrió un error al generar el archivo: " + error.message);
    }
}
