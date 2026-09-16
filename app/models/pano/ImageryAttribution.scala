package models.pano

import models.pano.PanoSource.PanoSource
import play.api.libs.json.{JsObject, Json}

import scala.util.matching.Regex

/**
 * The attribution owed for a panorama's imagery when Project Sidewalk itself displays it — a self-hosted copy in the
 * pano viewer, or a crop cut from one (#4865). The live providers' own viewers draw their own.
 *
 * Mapillary imagery is CC BY-SA 4.0: redistribution is permitted with visible attribution, so the line names the
 * contributor (`pano_data.copyright` holds the bare Mapillary username), the provider and the licence. Panoramax
 * imagery is open too, but under a licence its contributor picks per picture, so the licence comes from
 * `pano_data.license` rather than from the source (#5202). Google's and infra3d's imagery carries the copyright
 * string the provider supplied, which is the whole of what they ask shown.
 *
 * The bare name is a contract with every client that submits a pano, and [[normalizeCopyright]] is what holds it: a
 * client that records the whole attribution as the copyright would otherwise have it composed around again (#5360).
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
    val recorded = normalizeCopyright(source, copyright)
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

  /**
   * A pano's copyright as `pano_data.copyright` should hold it: a provider's own copyright string as recorded, or
   * for Mapillary and Panoramax the contributor's bare name, which is what the live viewers record and what [[line]]
   * composes the `©`, the provider and the licence around.
   *
   * The AI labeler records a whole attribution instead, `© jacobwhall / Mapillary (CC BY-SA 4.0)` or
   * `© Arretche / Panoramax (CC-BY-SA-4.0)`, so composing around it doubled the sign and named the provider and the
   * licence twice (#5360). This unwraps that, and any other `©`-prefixed or provider-suffixed variant of it, back to
   * the name; a wrapper naming only the provider means no contributor was recorded. Every submission passes through
   * it (`ExploreService.savePanoAction`) so the column holds the bare name whichever client wrote it, and [[line]]
   * applies it too so a row written before that guard renders the same. Evolution 390 rewrote the rows recorded
   * before either, with the same two expressions.
   *
   * @param source    Where the imagery came from.
   * @param copyright The copyright string as recorded or submitted.
   * @return          The value to store or render, or None when it is blank or names nothing but the provider.
   */
  def normalizeCopyright(source: PanoSource, copyright: Option[String]): Option[String] = {
    val recorded = copyright.map(_.trim).filter(_.nonEmpty)
    source match {
      case PanoSource.Mapillary => recorded.flatMap(unwrap(_, "Mapillary"))
      case PanoSource.Panoramax => recorded.flatMap(unwrap(_, "Panoramax"))
      case _                    => recorded
    }
  }

  /** A leading copyright sign, which [[line]] adds itself. */
  private val CopyrightSign: Regex = """^\s*©\s*""".r

  /**
   * Strips the sign and a trailing ` / Provider (licence)` from a recorded copyright, leaving the contributor's name.
   * The provider has to stand on its own, at the start or after a slash or a space, so a name that merely ends in
   * it is left alone.
   */
  private def unwrap(recorded: String, provider: String): Option[String] = {
    val providerSuffix = raw"""(^|\s*/\s*|\s+)${Regex.quote(provider)}(\s*\([^)]*\))?\s*$$""".r
    val name           = providerSuffix.replaceFirstIn(CopyrightSign.replaceFirstIn(recorded, ""), "").trim
    Option(name).filter(_.nonEmpty)
  }
}
