package models.pano

import models.pano.PanoSource.PanoSource
import play.api.libs.json.{JsObject, Json}

/**
 * The attribution owed for a panorama's imagery when Project Sidewalk itself displays it — a self-hosted copy in the
 * pano viewer, or a crop cut from one (#4865). The live providers' own viewers draw their own.
 *
 * Mapillary imagery is CC BY-SA 4.0: redistribution is permitted with visible attribution, so the line names the
 * contributor (`pano_data.copyright` holds the bare Mapillary username), the provider and the licence. Google's and
 * infra3d's imagery carries the copyright string the provider supplied, which is the whole of what they ask shown.
 */
object ImageryAttribution {

  /** The Mapillary licence, and where its text lives. */
  val MapillaryLicense: String    = "CC BY-SA 4.0"
  val MapillaryLicenseUrl: String = "https://creativecommons.org/licenses/by-sa/4.0/"

  /**
   * One attribution, structured so the UI can link the licence without knowing which providers carry one.
   *
   * @param holder     The rights holder as it should read, e.g. `© 2025 Google` or `© jacobwhall`.
   * @param provider   The imagery provider to name beside the holder, when the holder isn't the provider.
   * @param license    The licence the imagery is shared under, when it is shared under one.
   * @param licenseUrl Where that licence's text lives.
   */
  case class Line(holder: String, provider: Option[String], license: Option[String], licenseUrl: Option[String]) {

    /** The line as plain text, ` · `-joined. */
    def text: String = (Seq(holder) ++ provider ++ license).mkString(" · ")

    def toJson: JsObject = Json.obj(
      "holder"      -> holder,
      "provider"    -> provider,
      "license"     -> license,
      "license_url" -> licenseUrl
    )
  }

  /**
   * @param source    Where the imagery came from.
   * @param copyright The provider's copyright string for the pano, as `pano_data.copyright` stores it.
   * @return          The attribution to show beside the imagery, or None when nothing is known to attribute.
   */
  def line(source: PanoSource, copyright: Option[String]): Option[Line] =
    copyright.map(_.trim).filter(_.nonEmpty).map { holder =>
      source match {
        case PanoSource.Mapillary =>
          Line(s"© $holder", Some("Mapillary"), Some(MapillaryLicense), Some(MapillaryLicenseUrl))
        case _ => Line(holder, None, None, None)
      }
    }
}
