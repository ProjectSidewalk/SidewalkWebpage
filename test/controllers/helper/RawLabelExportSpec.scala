package controllers.helper

import models.api.{LabelClusterForApi, LabelDataForApi, RawLabelInClusterDataForApi, StreetDataForApi}
import models.label.StreetSide
import models.pano.PanoSource
import org.apache.pekko.stream.scaladsl.Source
import org.geotools.api.data.{DataStore, DataStoreFinder}
import org.geotools.api.feature.simple.SimpleFeature
import org.geotools.data.shapefile.ShapefileDataStoreFactory
import org.geotools.geopkg.GeoPkgDataStoreFactory
import org.locationtech.jts.geom.{Coordinate, GeometryFactory, PrecisionModel}
import org.scalatest.OptionValues
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder

import java.nio.file.{Files, Path}
import java.sql.DriverManager
import java.time.{OffsetDateTime, ZoneOffset}
import scala.concurrent.Await
import scala.concurrent.duration.DurationInt
import scala.jdk.CollectionConverters._
import scala.util.Using

/**
 * Round-trips `/v3/api/rawLabels`'s two GIS exports through GeoTools and reads the attributes back.
 *
 * These writers declare their schema as a string and then push values positionally, so a field added to one half and
 * not the other is invisible to the compiler: too many values throw only at write time, and too few silently null the
 * tail of every row. Reading the files back pins the field names -- including that the shapefile's stay inside the
 * DBF's 10-character limit, which is why `street_side` and `centerline_offset_m` become `streetSide` and
 * `ctrOffsetM` there (#2886) -- and pins the values that land under them.
 *
 * It also pins each GeoPackage layer's declared extent, which GeoTools on its own leaves at (0, 0, 0, 0) (#5275), and
 * that the shapefile's text survives outside Latin-1 (#5276).
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

  /** A label-cluster fixture and its raw labels; only their positions and region name vary between tests. */
  private def rawLabel(labelId: Int, latitude: Double, longitude: Double) = RawLabelInClusterDataForApi(
    labelId = labelId,
    userId = "user-uuid",
    panoId = "DsCvWstZYz9JL81V9NloOQ",
    panoSource = Some(PanoSource.Gsv),
    severity = Some(1),
    timeCreated = OffsetDateTime.of(2023, 8, 16, 0, 0, 0, 0, ZoneOffset.UTC),
    latitude = latitude,
    longitude = longitude,
    correct = None,
    imageCaptureDate = None
  )

  private def cluster(id: Int, latitude: Double, longitude: Double, labels: Seq[RawLabelInClusterDataForApi]) =
    LabelClusterForApi(
      labelClusterId = id, labelType = "CurbRamp", streetEdgeId = 951, intersectionId = None, osmWayId = 11584845L,
      regionId = 1, regionName = "Teaneck", avgImageCaptureDate = None, avgLabelDate = None, medianSeverity = Some(1),
      agreeCount = 0, disagreeCount = 0, unsureCount = 0, clusterSize = labels.size, labelIds = labels.map(_.labelId),
      userIds = Seq("user-uuid"), tagCounts = Map.empty, labels = Some(labels), avgLatitude = latitude,
      avgLongitude = longitude
    )

  private def inTempDir[T](name: String)(body: String => T): T = {
    val dir = Files.createTempDirectory("raw-label-export-spec")
    try body(dir.resolve(name).toString)
    finally Files.walk(dir).sorted(java.util.Comparator.reverseOrder[Path]()).forEach(p => Files.delete(p))
  }

  /** Every feature the store holds, keyed by `label_id`, alongside the schema's attribute names in order. */
  private def readBack(store: DataStore, labelIdField: String): (Seq[String], Map[Int, SimpleFeature]) =
    try {
      val typeName = store.getTypeNames()(0)
      val names    = store.getSchema(typeName).getAttributeDescriptors.asScala.map(_.getLocalName).toSeq
      val reader   = store.getFeatureSource(typeName).getFeatures.features()
      val features =
        try
          Iterator
            .continually(if (reader.hasNext) Some(reader.next()) else None)
            .takeWhile(_.isDefined)
            .flatten
            .map(f => f.getAttribute(labelIdField).asInstanceOf[Number].intValue() -> f)
            .toMap
        finally reader.close()
      (names, features)
    } finally store.dispose()

  /** Reads a shapefile the way GIS tools do, taking its text encoding from the `.cpg`. */
  private def openShapefile(shp: Path): DataStore = new ShapefileDataStoreFactory().createDataStore(shp.toUri.toURL)

  private def cpgOf(shp: Path): String = Files.readString(Path.of(shp.toString.stripSuffix(".shp") + ".cpg"))

  /**
   * The extent a GeoPackage declares for one layer, read straight from `gpkg_contents` the way GDAL and QGIS read it.
   * GeoTools' own reader turns a NULL extent into zeros, so it can't tell "unknown" apart from the (0, 0) bug.
   *
   * @return `(min_x, min_y, max_x, max_y)`, or None when all four are NULL (unknown). Fails on a partly NULL extent.
   */
  private def declaredExtent(gpkg: Path, tableName: String): Option[(Double, Double, Double, Double)] =
    Using.Manager { use =>
      val cx   = use(DriverManager.getConnection(s"jdbc:sqlite:$gpkg"))
      val stmt = use(cx.prepareStatement("SELECT min_x, min_y, max_x, max_y FROM gpkg_contents WHERE table_name = ?"))
      stmt.setString(1, tableName)
      val rs = use(stmt.executeQuery())
      rs.next() mustBe true
      Seq("min_x", "min_y", "max_x", "max_y").map(c => Option(rs.getObject(c)).map(_.asInstanceOf[Number].doubleValue))
    }.get match {
      case Seq(Some(minX), Some(minY), Some(maxX), Some(maxY)) => Some((minX, minY, maxX, maxY))
      case Seq(None, None, None, None)                         => None
      case partial                                             => fail(s"$tableName has a partly NULL extent: $partial")
    }

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

    "save non-Latin text as UTF-8 and ship a .cpg saying so, rather than question marks (#5276)" in {
      val taipei = sampleLabel(8, None, None).copy(regionName = "中山區新庄里", description = Some("人行道破損 — ok"))
      inTempDir("labels") { base =>
        val shp =
          Await.result(shapefileCreator.createRawLabelShapefile(Source.single(taipei), base, 1), 60.seconds).value
        cpgOf(shp) mustBe "UTF-8"

        val (_, features) = readBack(openShapefile(shp), "labelId")
        features(8).getAttribute("regionName") mustBe "中山區新庄里"
        features(8).getAttribute("descriptn") mustBe "人行道破損 — ok"
      }
    }

    "cut text too long for its DBF field between characters (#5276)" in {
      val long = sampleLabel(8, None, None).copy(description = Some("破" * 200))
      inTempDir("labels") { base =>
        val shp =
          Await.result(shapefileCreator.createRawLabelShapefile(Source.single(long), base, 1), 60.seconds).value
        val description = readBack(openShapefile(shp), "labelId")._2(8).getAttribute("descriptn").toString
        description mustBe "破" * 84 // 84 three-byte characters is 252 bytes, the most whole ones that fit in 254.
      }
    }

    "fail and delete every part of its half-written file when the data stops partway" in {
      inTempDir("labels") { base =>
        val broken = Source(labels).concat(Source.failed(new RuntimeException("stream broke")))
        Await.result(shapefileCreator.createRawLabelShapefile(broken, base, 1), 60.seconds) mustBe None
        Using.resource(Files.list(Path.of(base).getParent))(_.count()) mustBe 0
      }
    }
  }

  "the labelClusters shapefile" should {
    "save both layers as UTF-8, each with its own .cpg (#5276)" in {
      val taipei = cluster(1, 40.88, -74.03, Seq(rawLabel(1, 40.879, -74.031))).copy(regionName = "中山區新庄里")
      inTempDir("clusters") { base =>
        val shps = Await
          .result(shapefileCreator.createLabelClusterShapefileWithLabels(Source.single(taipei), base, 1), 60.seconds)
          .value
        shps.map(_.getFileName.toString) mustBe Seq("clusters.shp", "clusters_labels.shp")
        shps.foreach(cpgOf(_) mustBe "UTF-8")
        readBack(openShapefile(shps.head), "clusterId")._2(1).getAttribute("regionName") mustBe "中山區新庄里"
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

    "declare the bounding box of its labels as the layer extent, not (0, 0, 0, 0) (#5275)" in {
      val spread = Seq(
        sampleLabel(8, None, None).copy(latitude = 40.88, longitude = -74.03),
        sampleLabel(9, None, None).copy(latitude = 40.89, longitude = -74.02)
      )
      inTempDir("labels") { base =>
        // One label per batch, so the extent has to carry over from one batch to the next.
        val gpkg =
          Await.result(shapefileCreator.createRawLabelDataGeopackage(Source(spread), base, 1), 60.seconds).value
        declaredExtent(gpkg, "labels").value mustBe ((-74.03, 40.88, -74.02, 40.89))
      }
    }

    "leave the extent unknown (NULL) when there are no labels, rather than claiming (0, 0) (#5275)" in {
      inTempDir("labels") { base =>
        val gpkg = Await.result(shapefileCreator.createRawLabelDataGeopackage(Source.empty, base, 2), 60.seconds).value
        declaredExtent(gpkg, "labels") mustBe None
      }
    }

    "fail and delete its half-written file when the data stops partway, rather than serve missing rows" in {
      inTempDir("labels") { base =>
        val broken = Source(labels).concat(Source.failed(new RuntimeException("stream broke")))
        Await.result(shapefileCreator.createRawLabelDataGeopackage(broken, base, 1), 60.seconds) mustBe None
        Files.exists(Path.of(s"$base.gpkg")) mustBe false
      }
    }
  }

  "the streets GeoPackage" should {
    "declare the extent of its lines, including a bend that reaches past both ends (#5275)" in {
      // The middle point sticks out furthest, so an extent taken from each line's two ends would come up short.
      val bent = new GeometryFactory(new PrecisionModel(), 4326).createLineString(
        Array(new Coordinate(-74.03, 40.88), new Coordinate(-74.01, 40.90), new Coordinate(-74.02, 40.885))
      )
      val street = StreetDataForApi(
        streetEdgeId = 951, osmWayId = 11584845L, regionId = 1, regionName = "Teaneck", wayType = "residential",
        maxSpeed = None, status = "open", userIds = Seq.empty, labelCount = 0, auditCount = 0, outdated = false,
        geometry = bent
      )
      inTempDir("streets") { base =>
        val gpkg =
          Await.result(shapefileCreator.createStreetDataGeopackage(Source.single(street), base, 1), 60.seconds).value
        declaredExtent(gpkg, "streets").value mustBe ((-74.03, 40.88, -74.01, 40.90))
      }
    }
  }

  "the labelClusters GeoPackage" should {
    "declare each layer's own extent: clusters from their centers, raw labels from the labels (#5275)" in {
      // Each cluster's labels sit a little outside its center, so the two layers' extents differ.
      val clusters = Seq(
        cluster(1, 40.88, -74.03, Seq(rawLabel(1, 40.879, -74.031), rawLabel(2, 40.881, -74.029))),
        cluster(2, 40.89, -74.02, Seq(rawLabel(3, 40.889, -74.021), rawLabel(4, 40.891, -74.019)))
      )
      inTempDir("clusters") { base =>
        val gpkg =
          Await.result(shapefileCreator.createLabelClusterGeopackage(Source(clusters), base, 1), 60.seconds).value
        declaredExtent(gpkg, "label_clusters").value mustBe ((-74.03, 40.88, -74.02, 40.89))
        declaredExtent(gpkg, "raw_labels").value mustBe ((-74.031, 40.879, -74.019, 40.891))
      }
    }
  }
}
