package models.street

/**
 * An elevation model that `street_gradient` rows are sampled from, with the credit its licence asks for (#5223).
 *
 * @param name    The value stored in `street_gradient.dem_source`.
 * @param title   The product's name, as its publisher writes it.
 * @param credit  The attribution line shown wherever the grades are shown.
 * @param licence The licence the model is published under.
 * @param url     The publisher's page for the product.
 * @param citation The reference the publisher suggests for citing the product in a paper, verbatim; None where it
 *                 suggests none.
 */
case class DemSource(
    name: String,
    title: String,
    credit: String,
    licence: String,
    url: Option[String],
    citation: Option[String]
)

/**
 * The elevation models the app knows how to credit.
 *
 * One entry per source registered in tools/city/street_gradient.py (`Source(...)`), which test_street_gradient.py holds
 * to: a source the sampler can write and the app cannot credit would put unattributed grades on a public map. Most of
 * these models are attribution-only, so the credit is the whole of the obligation; docs/street-gradient.md has the
 * roster of planned sources.
 */
object DemSource {
  val registered: Seq[DemSource] = Seq(
    DemSource(
      name = "usgs-3dep-10m",
      title = "USGS 3DEP 1/3 arc-second seamless DEM",
      credit = "Elevation: U.S. Geological Survey, 3D Elevation Program",
      licence = "Public domain",
      url = Some("https://www.usgs.gov/3d-elevation-program"),
      // USGS's own suggested citation, from the collection's ScienceBase entry (item 4f70aa9fe4b058caae3f8de5). It
      // asks for no particular format, so this is the one to reproduce rather than a style of our choosing.
      citation = Some(
        "U.S. Geological Survey, 2024, 1/3rd arc-second Digital Elevation Models (DEMs) - USGS National Map 3DEP " +
          "Downloadable Data Collection: U.S. Geological Survey."
      )
    )
  )

  private val byName: Map[String, DemSource] = registered.map(s => s.name -> s).toMap

  /**
   * The credit for a stored `dem_source`.
   *
   * A city sampled from hand-downloaded rasters (`--dem-dir --dem-name`) stores a name this list has never seen, and
   * a bare name is a truer credit than none, so it is credited by that name until someone registers it.
   *
   * @param name A `street_gradient.dem_source` value.
   * @return The registered source, or one that credits the name itself.
   */
  def forName(name: String): DemSource =
    byName.getOrElse(name, DemSource(name, name, s"Elevation: $name", "See the publisher's terms", None, None))
}
