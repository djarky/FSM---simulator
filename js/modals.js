/**
 * --- MODALS ---
 */

export function showModal(type, currentData = {}, canDelete = false, appType = 'MEALY') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('modal-overlay');
        const input = document.getElementById('modal-input');
        const output = document.getElementById('modal-output');
        const save = document.getElementById('modal-save');
        const cancel = document.getElementById('modal-cancel');
        const deleteBtn = document.getElementById('modal-delete');
        const header = document.querySelector('.modal-header');

        deleteBtn.style.display = canDelete ? 'block' : 'none';

        input.parentElement.style.display = 'block';
        output.parentElement.style.display = 'block';

        if (type === 'TRANSITION_ONLY') {
            header.innerText = "Configurar Transición";
            output.parentElement.style.display = 'none';
            input.value = currentData.input || "0";
        } else if (type === 'TRANSITION_MEALY') {
            header.innerText = "Configurar Transición";
            input.value = currentData.input || "0";
            output.value = currentData.output || "0";
        } else if (type === 'STATE_EDIT') {
            header.innerText = "Configurar Estado";
            input.previousElementSibling.innerText = "Nombre del Estado";
            input.value = currentData.name || "";
            if (appType === 'MOORE') {
                output.previousElementSibling.innerText = "Salida (Z)";
                output.value = currentData.output || "0";
            } else {
                output.parentElement.style.display = 'none';
            }
        }

        overlay.style.display = 'flex';
        input.focus();

        const validateBinary = (e) => {
            e.target.value = e.target.value.replace(/[^01Xx]/g, '').toUpperCase();
        };

        const validateStateName = (e) => {
            let val = e.target.value;
            if (!val.startsWith('S')) val = 'S' + val.replace(/S/g, '');
            e.target.value = 'S' + val.substring(1).replace(/[^0-9]/g, '');
        };

        if (type === 'STATE_EDIT') {
            input.oninput = validateStateName;
        } else {
            input.oninput = validateBinary;
        }
        output.oninput = (e) => {
            e.target.value = e.target.value.replace(/[^01]/g, ''); 
        };

        const cleanup = () => {
            overlay.style.display = 'none';
            save.onclick = null;
            cancel.onclick = null;
            deleteBtn.onclick = null;
            input.oninput = null;
            output.oninput = null;
            // Reset labels for next time
            input.previousElementSibling.innerText = "Entrada (X)";
            output.previousElementSibling.innerText = "Salida (Z)";
        };

        save.onclick = () => {
            const data = { input: input.value, output: output.value, name: input.value };
            cleanup();
            resolve(data);
        };

        cancel.onclick = () => {
            cleanup();
            resolve(null);
        };

        deleteBtn.onclick = () => {
            cleanup();
            resolve({ action: 'DELETE' });
        };
    });
}

export function showConfirm(id_overlay, header_text, body_text) {
    return new Promise((resolve) => {
        const overlay = document.getElementById(id_overlay);
        const header = document.getElementById('confirm-header');
        const body = document.getElementById('confirm-body');
        const save = document.getElementById('confirm-save');
        const cancel = document.getElementById('confirm-cancel');

        if (header_text) header.innerText = header_text;
        if (body_text) body.innerText = body_text;

        overlay.style.display = 'flex';

        const cleanup = () => {
            overlay.style.display = 'none';
            save.onclick = null;
            cancel.onclick = null;
        };

        save.onclick = () => {
            cleanup();
            resolve(true);
        };

        cancel.onclick = () => {
            cleanup();
            resolve(false);
        };
    });
}

export function showSavePrompt(defaultName) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('save-overlay');
        const input = document.getElementById('save-filename');
        const save = document.getElementById('save-confirm');
        const cancel = document.getElementById('save-cancel');

        if (defaultName) input.value = defaultName;
        overlay.style.display = 'flex';
        input.focus();
        input.select();

        const cleanup = () => {
            overlay.style.display = 'none';
            save.onclick = null;
            cancel.onclick = null;
        };

        save.onclick = () => {
            const val = input.value.trim() || 'fsm_design';
            cleanup();
            resolve(val);
        };

        cancel.onclick = () => {
            cleanup();
            resolve(null);
        };
    });
}

