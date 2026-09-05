package controllers.helper

import models.api.LabelDataForApi
import models.label.StreetSide
import models.pano.PanoSource
import org.apache.pekko.stream.scaladsl.Source
import org.geotools.data.DataStoreFinder
import org.geotools.data.shapefile.ShapefileDataStoreFactory
import org.geotools.geopkg.GeoPkgDataStoreFactory
import org.opengis.feature.simple.SimpleFeature
import org.scalatest.OptionValues
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder

import java.nio.file.{Files, Path}
import java.time.{OffsetDateTime, ZoneOffset}
import scala.concurrent.Await
import scala.concurrent.duration.DurationInt
import scala.jdk.CollectionConverters._

/**
 * Round-trips `/v3/api/rawLabels`'s two GIS exports through GeoTools and reads the attributes back.
 *
 * These writers declare their schema as a string and then push values positionally, so a field added to one half and
 * not the other is invisible to the compiler: too many values throw only at write time, and too few silently null the
 * tail of every row. Reading the files back pins the field names -- including that the shapefile's stay inside the
 * DBF's 10-character limit, which is why `street_side` and `centerline_offset_m` become `streetSide` and
 * `ctrOffsetM` there (#2886) -- and pins the values that land under them.
 */
class RawLabelExportSpec extends PlaySpec with GuiceOneAppPerSuite with OptionValues {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val shapefileCreator = app.injector.instanceOf[ShapefilesCreatorHelper]

  /** A label fixture; `streetSide`/`centerlineOffsetM` are the fields under test, the rest are arbitrary but valid. */
  private def sampleLabel(
      labelId: Int,
      streetSide: Option[StreetSide.Value],
      centerlineOffsetM: Option[Double]
  ): LabelDataForApi = LabelDataForApi(
    labelId = labelId,
    userId = "user-uuid",
    panoId = "DsCvWstZYz9JL81V9NloOQ",
    panoSource = PanoSource.Gsv,
    labelType = "CurbRamp",
    severity = Some(1),
    tags = List.empty,
    description = None,
    timeCreated = OffsetDateTime.of(2023, 8, 16, 0, 0, 0, 0, ZoneOffset.UTC),
    highQualityUser = true,
    streetEdgeId = 951,
    osmWayId = 11584845L,
    regionId = 1,
    regionName = "Teaneck",
    streetSide = streetSide,
    centerlineOffsetM = centerlineOffsetM,
    latitude = 40.8839912414551,
    longitude = -74.0243606567383,
    correct = Some(true),
    agreeCount = 2,
    disagreeCount = 0,
    unsureCount = 0,
    validations = Seq.empty,
    auditTaskId = Some(6),
    missionId = Some(3),
    imageCaptureDate = Some("2012-08"),
    heading = Some(94.3114318847656),
    pitch = Some(-24.6774997711182),
    zoom = Some(2.0),
    canvasX = Some(395),
    canvasY = Some(151),
    canvasWidth = Some(480),
    canvasHeight = Some(720),
    panoX = Some(1781),
    panoY = Some(3980),
    panoWidth = Some(13312),
    panoHeight = Some(6656),
    cameraHeading = Some(228.928619384766),
    cameraPitch = Some(-0.998329997062683),
    cameraRoll = Some(0.888324597068312)
  )

  // One label on each side of the floor: a left-hand label with an offset, and one with neither.
  private val labels = Seq(
    sampleLabel(8, Some(StreetSide.Left), Some(4.25)),
    sampleLabel(9, None, None)
  )

  private def inTempDir[T](name: String)(body: String => T): T = {
    val dir = Files.createTempDirectory("raw-label-export-spec")
    try body(dir.resolve(name).toString)
    finally Files.walk(dir).sorted(java.util.Comparator.reverseOrder[Path]()).forEach(p => Files.delete(p))
  }

  /** Every feature the store holds, keyed by `label_id`, alongside the schema's attribute names in order. */
  private def readBack(
      store: org.geotools.data.DataStore,
      labelIdField: String
  ): (Seq[String], Map[Int, SimpleFeature]) =
    try {
      val typeName = store.getTypeNames()(0)
      val names    = store.getSchema(typeName).getAttributeDescriptors.asScala.map(_.getLocalName).toSeq
      val reader   = store.getFeatureSource(typeName).getFeatures.features()
      val features = Iterator
        .continually(if (reader.hasNext) Some(reader.next()) else None)
        .takeWhile(_.isDefined)
        .flatten
        .map(f => f.getAttribute(labelIdField).asInstanceOf[Number].intValue() -> f)
        .toMap
      reader.close()
      (names, features)
    } finally store.dispose()

  "the rawLabels shapefile" should {
    "carry streetSide and ctrOffsetM under DBF-legal names, with nulls for a label that has no side (#2886)" in {
      inTempDir("labels") { base =>
        val shp = Await
          .result(shapefileCreator.createRawLabelShapefile(Source(labels), base, 2), 60.seconds)
          .value
        val store             = new ShapefileDataStoreFactory().createDataStore(shp.toUri.toURL)
        val (names, features) = readBack(store, "labelId")

        names must contain allOf ("streetSide", "ctrOffsetM")
        names.foreach(_.length must be <= 10) // The DBF format truncates anything longer, silently.
        // Nothing fell off the end: the last declared field still holds its own value rather than a shifted one.
        features(8).getAttribute("panoUrl").toString must include("map_action=pano")

        features(8).getAttribute("streetSide") mustBe "left"
        features(8).getAttribute("ctrOffsetM") mustBe 4.25
        features(9).getAttribute("streetSide") mustBe null
        features(9).getAttribute("ctrOffsetM") mustBe null
      }
    }
  }

  "the rawLabels GeoPackage" should {
    "carry street_side and centerline_offset_m under their canonical snake_case names (#2886)" in {
      inTempDir("labels") { base =>
        val gpkg = Await
          .result(shapefileCreator.createRawLabelDataGeopackage(Source(labels), base, 2), 60.seconds)
          .value
        val store = DataStoreFinder.getDataStore(
          Map[String, Object](
            GeoPkgDataStoreFactory.DBTYPE.key   -> "geopkg",
            GeoPkgDataStoreFactory.DATABASE.key -> gpkg.toString
          ).asJava
        )
        val (names, features) = readBack(store, "label_id")

        names must contain allOf ("street_side", "centerline_offset_m")
        features(8).getAttribute("pano_url").toString must include("map_action=pano")

        features(8).getAttribute("street_side") mustBe "left"
        features(8).getAttribute("centerline_offset_m") mustBe 4.25
        features(9).getAttribute("street_side") mustBe null
        features(9).getAttribute("centerline_offset_m") mustBe null
      }
    }
  }
}
