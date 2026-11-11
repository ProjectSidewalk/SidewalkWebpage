/**
 * Test helper: the context menu's markup, pared down to what ContextMenu wires up. The severity segments are laid out
 * as explore.scala.html has them, each radio inside its labelled button, so the smiley and colour updates find them.
 * @returns {object} The `uiContextMenu` argument ContextMenu takes.
 */
function makeContextMenuUi() {
  const holder = document.createElement('div');
  holder.innerHTML = `<img id="context-menu-icon"><span id="context-menu-type"></span>
      <button id="context-menu-share"></button>
      <button id="context-menu-done"></button><button id="context-menu-delete"></button>`;
  const severityRadioHolder = document.createElement('div');
  const radioButtons = [1, 2, 3].map((value) => {
    const button = document.createElement('label');
    button.className = 'severity-button';
    button.dataset.severity = String(value);
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.value = String(value);
    button.append(radio);
    button.insertAdjacentHTML(
      'beforeend',
      '<img class="severity-button__icon"><span class="severity-button__label"></span>',
    );
    severityRadioHolder.append(button);
    return radio;
  });
  return {
    holder,
    severityMenu: document.createElement('div'),
    severityRadioHolder,
    radioButtons,
    textBox: document.createElement('input'),
    tagHolder: document.createElement('div'),
    closeButton: document.createElement('button'),
  };
}

export { makeContextMenuUi };
