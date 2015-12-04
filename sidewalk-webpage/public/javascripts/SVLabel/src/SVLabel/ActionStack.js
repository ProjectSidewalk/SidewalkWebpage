var svl = svl || {};

/**
 * ActionStack keeps track of user's actions.
 * @param {object} $ jQuery ojbect
 * @param {object} params Other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ActionStack ($, params) {
    var self = {
        'className' : 'ActionStack'
        };
    var properties = {};
    var status = {
            actionStackCursor : 0, // This is an index of current state in actionStack
            disableRedo : false,
            disableUndo : false
        };
    var lock = {
            disableRedo : false,
            disableUndo : false
        };
    var actionStack = [];

    // jQuery dom objects
    var $buttonRedo;
    var $buttonUndo;


    function init (params) {
        // Initialization function
        if (svl.ui && svl.ui.actionStack) {
          // $buttonRedo = $(params.domIds.redoButton);
          // $buttonUndo = $(params.domIds.undoButton);
          $buttonRedo = svl.ui.actionStack.redo;
          $buttonUndo = svl.ui.actionStack.undo;
          $buttonRedo.css('opacity', 0.5);
          $buttonUndo.css('opacity', 0.5);

          // Attach listeners to buttons
          $buttonRedo.bind('click', buttonRedoClick);
          $buttonUndo.bind('click', buttonUndoClick);
        }
    }


    function buttonRedoClick () {
        if (!status.disableRedo) {
          if ('tracker' in svl) {
            svl.tracker.push('Click_Redo');
          }
            self.redo();
        }
    }


    function buttonUndoClick () {
        if (!status.disableUndo) {
          if ('tracker' in svl) {
            svl.tracker.push('Click_Undo');
          }
            self.undo();
        }
    }

    function disableRedo () {
        if (!lock.disableRedo) {
            status.disableRedo = true;
            if (svl.ui && svl.ui.actionStack) {
                $buttonRedo.css('opacity', 0.5);
            }
            return this;
        } else {
            return false;
        }
    }

    function disableUndo () {
        if (!lock.disableUndo) {
            status.disableUndo = true;
            if (svl.ui && svl.ui.actionStack) {
              $buttonUndo.css('opacity', 0.5);
            }
            return this;
        } else {
            return false;
        }
    }
    self.disableRedo = disableRedo;
    self.disableUndo = disableUndo;


    self.enableRedo = function () {
        if (!lock.disableRedo) {
            status.disableRedo = false;
            if (svl.ui && svl.ui.actionStack) {
              $buttonRedo.css('opacity', 1);
            }
            return this;
        } else {
            return false;
        }
    };


    self.enableUndo = function () {
        if (!lock.disableUndo) {
            status.disableUndo = false;
            if (svl.ui && svl.ui.actionStack) {
              $buttonUndo.css('opacity', 1);
            }
            return this;
        } else {
            return false;
        }
    };

    self.getStatus = function(key) {
        if (!(key in status)) {
            console.warn("You have passed an invalid key for status.")
        }
        return status[key];
    };

    self.lockDisableRedo = function () {
        lock.disableRedo = true;
        return this;
    };


    self.lockDisableUndo = function () {
        lock.disableUndo = true;
        return this;
    };


    self.pop = function () {
        // Delete the last action
        if (actionStack.length > 0) {
            status.actionStackCursor -= 1;
            actionStack.splice(status.actionStackCursor);
        }
        return this;
    };


    self.push = function (action, label) {
        var availableActionList = ['addLabel', 'deleteLabel'];
        if (availableActionList.indexOf(action) === -1) {
            throw self.className + ": Illegal action.";
        }

        var actionItem = {
            'action' : action,
            'label' : label,
            'index' : status.actionStackCursor
        };
        if (actionStack.length !== 0 &&
            actionStack.length > status.actionStackCursor) {
            // Delete all the action items after the cursor before pushing the new acitonItem
            actionStack.splice(status.actionStackCursor);
        }
        actionStack.push(actionItem);
        status.actionStackCursor += 1;
        return this;
    };


    self.redo = function () {
        // Redo an action
        if (!status.disableRedo) {
            if (actionStack.length > status.actionStackCursor) {
                var actionItem = actionStack[status.actionStackCursor];
                if (actionItem.action === 'addLabel') {
                  if ('tracker' in svl) {
                    svl.tracker.push('Redo_AddLabel', {labelId: actionItem.label.getProperty('labelId')});
                  }
                    actionItem.label.setStatus('deleted', false);
                } else if (actionItem.action === 'deleteLabel') {
                  if ('tracker' in svl) {
                    svl.tracker.push('Redo_RemoveLabel', {labelId: actionItem.label.getProperty('labelId')});
                  }
                    actionItem.label.setStatus('deleted', true);
                    actionItem.label.setVisibility('hidden');
                }
                status.actionStackCursor += 1;
            }
            if ('canvas' in svl) {
              svl.canvas.clear().render2();
            }
        }
    };

    self.size = function () {
        // return the size of the stack

        return actionStack.length;
    };

    self.undo = function () {
        // Undo an action
        if (!status.disableUndo) {
            status.actionStackCursor -= 1;
            if(status.actionStackCursor >= 0) {
                var actionItem = actionStack[status.actionStackCursor];
                if (actionItem.action === 'addLabel') {
                  if ('tracker' in svl) {
                    svl.tracker.push('Undo_AddLabel', {labelId: actionItem.label.getProperty('labelId')});
                  }
                    actionItem.label.setStatus('deleted', true);
                } else if (actionItem.action === 'deleteLabel') {
                  if ('tracker' in svl) {
                    svl.tracker.push('Undo_RemoveLabel', {labelId: actionItem.label.getProperty('labelId')});
                  }
                    actionItem.label.setStatus('deleted', false);
                    actionItem.label.setVisibility('visible');
                }
            } else {
                status.actionStackCursor = 0;
            }

            if ('canvas' in svl) {
              svl.canvas.clear().render2();
            }
        }
    };


    self.unlockDisableRedo = function () {
        lock.disableRedo = false;
        return this;
    };


    self.unlockDisableUndo = function () {
        lock.disableUndo = false;
        return this;
    };

    self.getLock = function(key) {
        if (!(key in lock)) {
          console.warn("You have passed an invalid key for status.")
        }
        return lock[key];
    }

    self.updateOpacity = function () {
        // Change opacity
        if (svl.ui && svl.ui.actionStack) {
          if (status.actionStackCursor < actionStack.length) {
              $buttonRedo.css('opacity', 1);
          } else {
              $buttonRedo.css('opacity', 0.5);
          }

          if (status.actionStackCursor > 0) {
              $buttonUndo.css('opacity', 1);
          } else {
              $buttonUndo.css('opacity', 0.5);
          }

          // if the status is set to disabled, then set the opacity of buttons to 0.5 anyway.
          if (status.disableUndo) {
              $buttonUndo.css('opacity', 0.5);
          }
          if (status.disableRedo) {
              $buttonRedo.css('opacity', 0.5);
          }
        }
    };
    ////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////
    init(params);

    return self;
}
