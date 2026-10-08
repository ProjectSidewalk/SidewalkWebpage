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
    ),
    DemSource(
      name = "swissalti3d-2m",
      title = "swissALTI3D (2 m)",
      // The product documentation (swissALTI3D-ProdInfo, §2.3) names this wording as the whole obligation of the
      // OGD terms: "Quelle: Bundesamt für Landestopografie swisstopo" or "© swisstopo".
      credit = "Elevation: © swisstopo (Federal Office of Topography), swissALTI3D",
      licence = "swisstopo OGD terms of use (attribution required)",
      url = Some("https://www.swisstopo.admin.ch/en/height-model-swissalti3d"),
      citation = None // swisstopo suggests no citation form; the source reference above is what it asks for.
    ),
    DemSource(
      name = "linz-nz-1m",
      title = "New Zealand LiDAR 1m DEM (LINZ)",
      // The attribution the LINZ Data Service page for the layer asks for, verbatim, licensor included.
      credit = "Elevation: Sourced from the LINZ Data Service and licensed by Toitū Te Whenua Land Information " +
        "New Zealand, for re-use under CC BY 4.0",
      licence = "CC BY 4.0",
      url = Some("https://data.linz.govt.nz/layer/121859-new-zealand-lidar-1m-dem/"),
      // The AWS Open Data registry entry's own citation form, minus the access date it leaves for the citer.
      citation = Some("New Zealand Elevation was accessed from https://registry.opendata.aws/nz-elevation.")
    ),
    DemSource(
      name = "nrcan-hrdem-mosaic-2m",
      title = "High Resolution Digital Elevation Model Mosaic (HRDEM Mosaic), CanElevation Series (2 m)",
      // NRCan specifies no attribution statement of its own for this product (checked the open.canada.ca record,
      // its CKAN entry and both product specifications), so the licence's default statement is the required one.
      credit = "Elevation: Natural Resources Canada, HRDEM Mosaic. Contains information licensed under the Open " +
        "Government Licence – Canada",
      licence = "Open Government Licence – Canada 2.0",
      url = Some("https://open.canada.ca/data/en/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b"),
      citation = None // The record suggests no citation form.
    ),
    DemSource(
      name = "gedtm30",
      title = "Global Ensemble Digital Terrain Model 30m (GEDTM30), v1.1",
      credit = "Elevation: GEDTM30 © OpenGeoHub, Ho & Hengl (CC BY 4.0)",
      licence = "CC BY 4.0",
      url = Some("https://doi.org/10.5281/zenodo.14900180"),
      // The paper the dataset's README asks to be cited alongside the Zenodo record.
      citation = Some(
        "Ho, Y.-F., Grohmann, C.H., Lindsay, J., Reuter, H.I., Parente, L., Witjes, M., & Hengl, T. (2025). Global " +
          "Ensemble Digital Terrain modeling and parametrization at 30 m resolution (GEDTM30): a data fusion approach " +
          "based on ICESat-2, GEDI and multisource data. PeerJ 13, e19673. https://doi.org/10.7717/peerj.19673"
      )
    ),
    DemSource(
      name = "inegi-lidar-mdt-5m",
      title = "Modelo Digital de Elevación de Alta Resolución LiDAR, tipo Terreno, 5 m (INEGI)",
      // INEGI's terms ask for "Fuente: INEGI, <product>" and that any transformation be disclosed as ours, which
      // the grade documentation does; the credit names the product in INEGI's own words.
      credit = "Elevation: Fuente: INEGI, Modelo Digital de Elevación de Alta Resolución LiDAR tipo Terreno 5 m. " +
        "Street grades derived by Project Sidewalk, not by INEGI",
      licence = "Términos de Libre Uso de la Información del INEGI",
      url = Some("https://www.inegi.org.mx/app/geo2/elevacionesmex/"),
      citation = None // INEGI suggests the "Fuente:" line above, no separate citation form.
    ),
    DemSource(
      name = "ign-lidarhd-mnt-05m",
      title = "MNT LiDAR HD, 0,5 m (IGN)",
      // The Licence Ouverte asks for the producer and the date of the data's last update; the edition date is per
      // tile and lives in IGN's metadata service, so the credit names the producer and links the product.
      credit = "Elevation: IGN, MNT LiDAR HD (Licence Ouverte / Open Licence 2.0)",
      licence = "Licence Ouverte / Open Licence 2.0 (Etalab)",
      url = Some("https://www.data.gouv.fr/fr/datasets/mnt-lidar-hd/"),
      citation = None // IGN publishes no citation form for LiDAR HD.
    ),
    DemSource(
      name = "ahn4-dtm-05m",
      title = "Actueel Hoogtebestand Nederland (AHN4) DTM 0,5 m",
      credit = "Elevation: Actueel Hoogtebestand Nederland (AHN4), Rijkswaterstaat via PDOK, CC0 1.0",
      licence = "CC0 1.0",
      url = Some("https://www.pdok.nl/introductie/-/article/actueel-hoogtebestand-nederland-ahn"),
      citation = None // PDOK suggests no citation form, and CC0 asks for none.
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
