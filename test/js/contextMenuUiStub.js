/**
 * Test helper: the context menu's real markup, pared down to what ContextMenu wires up.
 * @returns {object} The `uiContextMenu` argument ContextMenu takes.
 */
function makeContextMenuUi() {
    const holder = document.createElement('div');
    holder.innerHTML = `<img id="context-menu-icon"><span id="context-menu-type"></span>
      <button id="context-menu-done"></button><button id="context-menu-delete"></button>`;
    const radioButtons = [1, 2, 3].map((value) => {
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.value = String(value);
        return radio;
    });
    return {
        holder,
        severityMenu: document.createElement('div'),
        severityRadioHolder: document.createElement('div'),
        radioButtons,
        textBox: document.createElement('input'),
        tagHolder: document.createElement('div'),
        closeButton: document.createElement('button'),
    };
}

module.exports = { makeContextMenuUi };
