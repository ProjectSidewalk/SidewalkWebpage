/**
 * Pins how Validate's 1/2/3 shortcuts pick a severity (#5298). Each severity button is a `<label>` wrapping a hidden
 * radio, and the click handler lives on the label. The shortcut clicks the radio, so this checks, against the real
 * markup from the view, that the click still reaches the label's handler once and checks the radio. The reason for
 * clicking the radio (a label click moves focus into the radio, which opens the tooltip) is not testable here: jsdom
 * does not move focus on a label click.
 */

const fs = require('fs');
const path = require('path');

const SRC = (relativePath) => fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8');

describe('a shortcut click on a severity radio', () => {
    let picked;

    beforeEach(() => {
        const view = SRC('app/views/apps/validate.scala.html');
        document.body.innerHTML = `
            ${view.split('<div id="severity-radio-holder"')[1].split('</div>')[0].replace(/^[^>]*>/, '')}`;
        picked = [];
        // The same wiring as DesktopValidationMenu's: one handler per label, reading the severity off that label.
        for (const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.severity-button'))) {
            button.addEventListener('click', () => picked.push(Number(button.dataset.severity)));
        }
    });

    it('reaches the label handler with the right severity and checks the radio', () => {
        document.getElementById('validate-severity-radio-2').click();

        expect(picked).toEqual([2]);
        expect(/** @type {HTMLInputElement} */ (document.getElementById('validate-severity-radio-2')).checked).toBe(true);
    });
});
