/**
 * Renders the grab-and-drag hand animation shown during onboarding to teach panning.
 */
class HandAnimation {
  #uiOnboarding;
  #layer;
  #stage = null;
  #openHand;
  #closedHand;
  #openHandReady = false;
  #closedHandReady = false;
  #imageObjOpenHand = new Image();
  #imageObjClosedHand = new Image();
  #$handGestureHolder;
  #onboardingImageDirectory;

  /**
     * @param {string} rootDirectory Root directory that image assets are served from.
     * @param {object} uiOnboarding Onboarding UI elements.
     */
  constructor(rootDirectory, uiOnboarding) {
    this.#uiOnboarding = uiOnboarding;
    this.#$handGestureHolder = uiOnboarding.holder.find('#hand-gesture-holder');
    this.#onboardingImageDirectory = `${rootDirectory}img/onboarding/`;
  }

  /**
     * Sets up the Kinetic stage and loads the open/closed hand images into it.
     */
  initializeHandAnimation() {
    if (this.#$handGestureHolder.length === 1) {
      this.hideGrabAndDragAnimation();

      if (!this.#stage) {
        this.#stage = new Kinetic.Stage({
          container: this.#$handGestureHolder.get(0),
          width: 720,
          height: 200,
        });
        this.#layer = new Kinetic.Layer();
        this.#stage.add(this.#layer);

        this.#imageObjOpenHand.onload = () => {
          this.#openHand = new Kinetic.Image({
            x: 0,
            y: this.#stage.getHeight() / 2 - 59,
            image: this.#imageObjOpenHand,
            width: 110,
            height: 110,
          });
          this.#openHand.hide();
          this.#layer.add(this.#openHand);
          this.#openHandReady = true;
        };
        this.#imageObjOpenHand.src = `${this.#onboardingImageDirectory}HandOpen.png`;

        this.#imageObjClosedHand.onload = () => {
          this.#closedHand = new Kinetic.Image({
            x: 300,
            y: this.#stage.getHeight() / 2 - 59,
            image: this.#imageObjClosedHand,
            width: 82,
            height: 82,
          });
          this.#closedHand.hide();
          this.#layer.add(this.#closedHand);
          this.#closedHandReady = true;
        };
        this.#imageObjClosedHand.src = `${this.#onboardingImageDirectory}HandClosed.png`;
      }
    }
  }

  /**
     * Plays one open-hand → closed-hand drag animation across the stage.
     *
     * References:
     * Kineticjs callback: http://www.html5canvastutorials.com/kineticjs/html5-canvas-transition-callback-with-kineticjs/
     * Setposition: http://www.html5canvastutorials.com/labs/html5-canvas-animals-on-the-beach-game-with-kineticjs/
     *
     * @param {string} direction Either 'left-to-right' or anything else for right-to-left.
     */
  animateHand(direction) {
    if (direction === 'left-to-right') {
      this.#closedHand.hide();
      this.#openHand.setPosition(350, 100);
      this.#openHand.show();
      this.#openHand.transitionTo({
        x: 350,
        y: 30,
        duration: 0.5,
        callback: () => {
          setTimeout(() => {
            this.#openHand.hide();
            this.#closedHand.setPosition(400, 60);
            this.#closedHand.show();
            this.#closedHand.transitionTo({
              x: 550,
              y: 60,
              duration: 1,
            });
          }, 300);
        },
      });
    } else {
      this.#closedHand.hide();
      this.#openHand.setPosition(200, 100);
      this.#openHand.show();
      this.#openHand.transitionTo({
        x: 200,
        y: 0,
        duration: 0.5,
        callback: () => {
          setTimeout(() => {
            this.#openHand.hide();
            this.#closedHand.setPosition(200, 30);
            this.#closedHand.show();
            this.#closedHand.transitionTo({
              x: 0,
              y: 30,
              duration: 1,
            });
          }, 300);
        },
      });
    }
  }

  /**
     * Shows the hand animation and starts looping it.
     * @returns {number|undefined} The interval ID for the loop, or undefined if the images haven't loaded yet.
     */
  showGrabAndDragAnimation() {
    if (this.#closedHandReady && this.#openHandReady) {
      this.#uiOnboarding.handGestureHolder.css('visibility', 'visible');
      this.animateHand('left-to-right');
      return setInterval(() => this.animateHand('left-to-right'), 2000);
    }
  }

  /**
     * Hides the hand animation and stops its loop.
     * @param {number} [interval] The interval ID returned by showGrabAndDragAnimation.
     */
  hideGrabAndDragAnimation(interval) {
    clearInterval(interval);
    this.#uiOnboarding.handGestureHolder.css('visibility', 'hidden');
  }
}
