package models.pano

import models.pano.PanoSource.PanoSource
import play.api.libs.json.{JsObject, Json}

/**
 * The attribution owed for a panorama's imagery when Project Sidewalk itself displays it — a self-hosted copy in the
 * pano viewer, or a crop cut from one (#4865). The live providers' own viewers draw their own.
 *
 * Mapillary imagery is CC BY-SA 4.0: redistribution is permitted with visible attribution, so the line names the
 * contributor (`pano_data.copyright` holds the bare Mapillary username), the provider and the licence. Panoramax
 * imagery is open too, but under a licence its contributor picks per picture, so the licence comes from
 * `pano_data.license` rather than from the source (#5202). Google's and infra3d's imagery carries the copyright
 * string the provider supplied, which is the whole of what they ask shown.
 */
object ImageryAttribution {

  /** The Mapillary licence, and where its text lives. */
  val MapillaryLicense: String    = "CC BY-SA 4.0"
  val MapillaryLicenseUrl: String = "https://creativecommons.org/licenses/by-sa/4.0/"

  /**
   * A licence as it should read on screen, and where its text lives.
   *
   * @param name The licence's short display name, e.g. `CC BY-SA 4.0`.
   * @param url  Where that licence's text lives.
   */
  case class License(name: String, url: String)

  /**
   * The licence identifiers Panoramax uses, mapped to how we show them. Not exhaustive by construction: an instance
   * may record any identifier, and one that isn't here is shown verbatim rather than dropped.
   *
   * This is the only copy. `main.scala.html` stamps [[panoramaxLicensesJson]] onto the page as
   * `window.panoramaxLicenses` so `PanoramaxViewer` can render the live viewer's overlay from the same table
   * (#5202) — change it here and both follow.
   */
  val PanoramaxLicenses: Map[String, License] = Map(
    "CC-BY-SA-4.0" -> License("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "CC-BY-4.0"    -> License("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"),
    "etalab-2.0"   -> License("Licence Ouverte 2.0", "https://www.etalab.gouv.fr/licence-ouverte-open-licence/")
  )

  /** [[PanoramaxLicenses]] as the `{id: {name, url}}` object the page stamp hands to `PanoramaxViewer`. */
  val panoramaxLicensesJson: String = Json.stringify(
    JsObject(PanoramaxLicenses.view.mapValues(l => Json.obj("name" -> l.name, "url" -> l.url)).toSeq)
  )

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
   * @param license   The licence identifier recorded for the pano, as `pano_data.license` stores it. Only Panoramax
   *                  records one; Mapillary's is uniform and known from `source`, and the other providers have none.
   * @return          The attribution to show beside the imagery, or None when nothing is known to attribute. For
   *                  Mapillary the provider and the licence are known from `source` alone, so a pano with no recorded
   *                  contributor is still credited to Mapillary under its licence; likewise a Panoramax pano is
   *                  credited to Panoramax whether or not its producer was recorded.
   */
  def line(source: PanoSource, copyright: Option[String], license: Option[String]): Option[Line] = {
    val recorded = copyright.map(_.trim).filter(_.nonEmpty)
    source match {
      case PanoSource.Mapillary =>
        Some(
          Line(
            recorded.map(holder => s"© $holder").getOrElse("Mapillary"),
            recorded.map(_ => "Mapillary"),
            Some(MapillaryLicense),
            Some(MapillaryLicenseUrl)
          )
        )
      // An unrecognized identifier is still named, unlinked: identifying the licence is what CC BY-SA asks for, and a
      // raw `etalab-2.0` does that where saying nothing does not. A pano recorded before #5202 has none to name.
      case PanoSource.Panoramax =>
        val recordedLicense = license.map(_.trim).filter(_.nonEmpty)
        val known           = recordedLicense.flatMap(PanoramaxLicenses.get)
        Some(
          Line(
            recorded.map(holder => s"© $holder").getOrElse("Panoramax"),
            recorded.map(_ => "Panoramax"),
            known.map(_.name).orElse(recordedLicense),
            known.map(_.url)
          )
        )
      case _ => recorded.map(Line(_, None, None, None))
    }
  }
}
