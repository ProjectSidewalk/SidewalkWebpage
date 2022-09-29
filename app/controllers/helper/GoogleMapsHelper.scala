package controllers.helper

import models.user._
import play.api.Play
import play.api.Play.current

object GoogleMapsHelper {
    /**
     * Retrieves the static image of the label panorama from the Google Street View Static API. 
     * Note that this returns the image of the panorama, but doesn't actually include the label. 
     * More information here: https://developers.google.com/maps/documentation/streetview/intro
     *
     * @param gsvPanoramaId Id of gsv pano.
     * @param canvasWidth Width of canvas.
     * @param canvasHeight Height of canvas.
     * @param heading Compass heading of the camera.
     * @param pitch Up or down angle of the camera relative to the Street View vehicle.
     * @param zoom Zoom level of the canvas (for fov calculation).
     * @return Image URL that represents the background of the label.
     */
    def getImageUrl(gsvPanoramaId: String, canvasWidth: Int, canvasHeight: Int, heading: Float, pitch: Float, zoom: Int): String = {
        val url = "https://maps.googleapis.com/maps/api/streetview?" +
            "pano=" + gsvPanoramaId +
            "&size=" + canvasWidth + "x" + canvasHeight +
            "&heading=" + heading +
            "&pitch=" + pitch +
            "&fov=" + getFov(zoom) +
            "&key=" + Play.configuration.getString("google-maps-api-key").get
        VersionTable.signUrl(url)
    }

    /**
     * Hacky fix to generate the FOV for an image.
     * Determined experimentally.
     * @param zoom Zoom level of the canvas (for fov calculation).
     * @return FOV of image
     */
    def getFov(zoom: Int): Double = {
        if (zoom <= 2) {
            126.5 - zoom * 36.75
        } else {
            195.93 / scala.math.pow(1.92, zoom * 1.0)
        }
    }
}
