/**
 * Undo history for RouteBuilder edits (#4576). A dumb LIFO of action records — RouteBuilder decides what an
 * action is and how to invert it; this class only stores them and keeps the Undo button's state in sync.
 */
class UndoStack {
  #actions = [];
  #button;

  /**
   * @param {HTMLButtonElement} button - The Undo button; disabled whenever the stack is empty.
   */
  constructor(button) {
    this.#button = button;
    this.#syncButton();
  }

  /**
   * @param {Object} action - An action record (e.g. {type: 'add', streetId: 123}).
   */
  push(action) {
    this.#actions.push(action);
    this.#syncButton();
  }

  /**
   * @returns {Object|null} The most recent action, or null if there is nothing to undo.
   */
  pop() {
    const action = this.#actions.pop() ?? null;
    this.#syncButton();
    return action;
  }

  clear() {
    this.#actions = [];
    this.#syncButton();
  }

  #syncButton() {
    this.#button.disabled = this.#actions.length === 0;
  }
}
