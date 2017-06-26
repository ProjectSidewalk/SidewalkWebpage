/**
 * ActionStack keeps track of user's actions so you can undo/redo labeling.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ActionStack (tracker, uiActionStack) {
    var self = { className : 'ActionStack'},
        status = {
            actionStackCursor : 0, // This is an index of current state in actionStack
            disableRedo : false,
            disableUndo : false
        },
        lock = {
            disableRedo : false,
            disableUndo : false
        },
        actionStack = [],
        blinkInterval;


    function init () {
        // Initialization function
        uiActionStack.redo.css('opacity', 0.5);
        uiActionStack.undo.css('opacity', 0.5);
        uiActionStack.redo.bind('click', handleButtonRedoClick);
        uiActionStack.undo.bind('click', handleButtonUndoClick);
    }

    /**
     * Blink undo and redo buttons
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            uiActionStack.redo.toggleClass("highlight-50");
            uiActionStack.undo.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Blink undo and redo buttons
     */
    function blinkUndo () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            uiActionStack.undo.toggleClass("highlight-50");
        }, 500);
    }
    
    /**
     * Disable redo
     */
    function disableRedo () {
        if (!lock.disableRedo) {
            status.disableRedo = true;
            uiActionStack.redo.css('opacity', 0.5);
            return this;
        } else {
            return false;
        }
    }

    /** Disable undo */
    function disableUndo () {
        if (!lock.disableUndo) {
            status.disableUndo = true;
            uiActionStack.undo.css('opacity', 0.5);
            return this;
        } else {
            return false;
        }
    }

    /** Enable redo */
    function enableRedo () {
        if (!lock.disableRedo) {
            status.disableRedo = false;
            uiActionStack.redo.css('opacity', 1);
            return this;
        } else {
            return false;
        }
    }

    /** Enable undo */
    function enableUndo () {
        if (!lock.disableUndo) {
            status.disableUndo = false;
            uiActionStack.undo.css('opacity', 1);
            return this;
        } else {
            return false;
        }
    }

    function getStatus(key) { return (key in status) ? status[key] : null; }

    /**
     * This is a callback for redo button click
     */
    function handleButtonRedoClick () {
        if (!status.disableRedo) {
            svl.tracker.push('Click_Redo');
            redo();
        }
    }

    /**
     * This is a callback for undo button click
     */
    function handleButtonUndoClick () {
        if (!status.disableUndo) {
            svl.tracker.push('Click_Undo');
            undo();
        }
    }

    /**
     * Lock disable redo
     * @returns {lockDisableRedo}
     */
    function lockDisableRedo () {
        lock.disableRedo = true;
        return this;
    }

    /**
     * Lock disable undo
     * @returns {lockDisableUndo}
     */
    function lockDisableUndo () {
        lock.disableUndo = true;
        return this;
    }

    /**
     * Pop an action
     */
    function pop () {
        if (actionStack.length > 0) {
            status.actionStackCursor -= 1;
            actionStack.splice(status.actionStackCursor);
        }
        return this;
    }


    /**
     * Push an action
     */
    function push (action, label) {
        var availableActionList = ['addLabel', 'deleteLabel'];
        if (availableActionList.indexOf(action) === -1) {
            throw self.className + ": Illegal action.";
        }

        var actionItem = {
            action : action,
            label : label,
            index : status.actionStackCursor
        };
        if (actionStack.length !== 0 &&
            actionStack.length > status.actionStackCursor) {
            // Delete all the action items after the cursor before pushing the new acitonItem
            actionStack.splice(status.actionStackCursor);
        }
        actionStack.push(actionItem);
        status.actionStackCursor += 1;
        return this;
    }

    /**
     * Redo an action
     */
    function redo () {
        if (!status.disableRedo) {
            if (actionStack.length > status.actionStackCursor) {
                var actionItem = actionStack[status.actionStackCursor];
                if (actionItem.action === 'addLabel') {
                    if ('tracker' in svl) {
                        svl.tracker.push('Redo_AddLabel', {labelId: actionItem.label.getProperty('labelId')});
                    }
                    actionItem.label.setStatus('deleted', false);
                    svl.labelCounter.increment(actionItem.label.getProperty('labelType'));
                } else if (actionItem.action === 'deleteLabel') {
                    if ('tracker' in svl) {
                        svl.tracker.push('Redo_RemoveLabel', {labelId: actionItem.label.getProperty('labelId')});
                    }
                    actionItem.label.setStatus('deleted', true);
                    actionItem.label.setVisibility('hidden');
                    svl.labelCounter.decrement(actionItem.label.getProperty('labelType'));
                }
                status.actionStackCursor += 1;
            }
            if ('canvas' in svl) {
                //svl.map.updatePov(0,0);
                var pov = svl.panorama.getPov();
                svl.panorama.setPov(pov);
                svl.canvas.clear().render2();
            }
        }
    }

    /** return the size of the stack */
    function size () {
        return actionStack.length;
    }

    /**
     * Stop blinking undo and redo buttons
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        uiActionStack.redo.removeClass("highlight-50");
        uiActionStack.undo.removeClass("highlight-50");
    }

    /** Undo an action */
    function undo () {
        if (!status.disableUndo) {
            status.actionStackCursor -= 1;
            if(status.actionStackCursor >= 0) {
                var actionItem = actionStack[status.actionStackCursor];
                if (actionItem.action === 'addLabel') {
                    // Undo Add
                    if ('tracker' in svl) {
                        svl.tracker.push('Undo_AddLabel', {labelId: actionItem.label.getProperty('labelId')});
                    }
                    actionItem.label.setStatus('deleted', true);
                    svl.labelCounter.decrement(actionItem.label.getProperty('labelType'));
                } else if (actionItem.action === 'deleteLabel') {
                    // Undo Delete
                    console.log("Triggered Remove Label for: Undo_RemoveLabel_" + actionItem.label.getProperty('labelType'));
                    $(document).trigger('Undo_RemoveLabel_' + actionItem.label.getProperty('labelType'));
                    if ('tracker' in svl) {
                        svl.tracker.push('Undo_RemoveLabel', {labelId: actionItem.label.getProperty('labelId')});
                    }
                    actionItem.label.setStatus('deleted', false);
                    actionItem.label.setVisibility('visible');
                    svl.labelCounter.increment(actionItem.label.getProperty('labelType'));
                }
            } else {
                status.actionStackCursor = 0;
            }

            if ('canvas' in svl) {
                //svl.map.updatePov(0,0);
                var pov = svl.panorama.getPov();
                svl.panorama.setPov(pov);
                svl.canvas.clear().render2();
            }
        }
    }

    function unlockDisableRedo () { lock.disableRedo = false; return this; }

    function unlockDisableUndo () { lock.disableUndo = false; return this; }

    function getLock (key) {
        return (key in lock) ? lock[key] : null;
    }

    /** Change opacity */
    function updateOpacity () {
        if (status.actionStackCursor < actionStack.length) {
            uiActionStack.redo.css('opacity', 1);
        } else {
            uiActionStack.redo.css('opacity', 0.5);
        }

        if (status.actionStackCursor > 0) {
            uiActionStack.undo.css('opacity', 1);
        } else {
            uiActionStack.undo.css('opacity', 0.5);
        }

        // if the status is set to disabled, then set the opacity of buttons to 0.5 anyway.
        if (status.disableUndo) {
            uiActionStack.undo.css('opacity', 0.5);
        }
        if (status.disableRedo) {
            uiActionStack.redo.css('opacity', 0.5);
        }
    }

    self.blink = blink;
    self.blinkUndo = blinkUndo;
    self.disableRedo = disableRedo;
    self.disableUndo = disableUndo;
    self.enableRedo = enableRedo;
    self.enableUndo = enableUndo;
    self.getStatus = getStatus;
    self.lockDisableRedo = lockDisableRedo;
    self.lockDisableUndo = lockDisableUndo;
    self.pop = pop;
    self.push = push;
    self.redo = redo;
    self.size = size;
    self.undo = undo;
    self.unlockDisableRedo = unlockDisableRedo;
    self.unlockDisableUndo = unlockDisableUndo;
    self.getLock = getLock;
    self.stopBlinking = stopBlinking;
    self.updateOpacity = updateOpacity;

    init();

    return self;
}
