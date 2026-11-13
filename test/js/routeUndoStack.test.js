/**
 * Tests for RouteBuilder's undo history (frontend/js/route-builder/UndoStack.js, #5840): edits come back newest
 * first, and the Undo button is only enabled while there is something to undo.
 */

import { loadModules } from './loader.js';

const { UndoStack } = await loadModules('frontend/js/route-builder/UndoStack.js');

describe('UndoStack', () => {
  let button;
  let stack;

  beforeEach(() => {
    button = document.createElement('button');
    stack = new UndoStack(button);
  });

  test('the Undo button starts disabled', () => {
    expect(button.disabled).toBe(true);
  });

  test('edits come back newest first, and the button disables once they run out', () => {
    stack.push({ type: 'waypoint' });
    stack.push({ type: 'reverse' });
    expect(button.disabled).toBe(false);

    expect(stack.pop()).toEqual({ type: 'reverse' });
    expect(button.disabled).toBe(false);
    expect(stack.pop()).toEqual({ type: 'waypoint' });
    expect(button.disabled).toBe(true);
  });

  test('undoing with nothing left gives null', () => {
    expect(stack.pop()).toBeNull();
    expect(button.disabled).toBe(true);
  });

  test('clearing drops the whole history', () => {
    stack.push({ type: 'waypoint' });

    stack.clear();

    expect(button.disabled).toBe(true);
    expect(stack.pop()).toBeNull();
  });
});
