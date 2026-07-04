/**
 * Displays the tip message shown after the user jumps to a new street.
 */
class JumpAlert extends Alert {
  /**
     * Shows the jump-tip alert. Called when the user clicks the "jump" message to relocate to a new street.
     */
  onClickJumpMessage() {
    this._showAlert('popup.jump', 'jumpTipMessage');
  }
}
