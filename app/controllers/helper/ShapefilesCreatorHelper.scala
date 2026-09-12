package controllers.helper

import models.api.{
  AccessScoreApiModels,
  ApiFields,
  IntersectionAccessScoreForApi,
  LabelClusterForApi,
  LabelDataForApi,
  RawLabelInClusterDataForApi,
  RegionAccessScoreForApi,
  RegionDataForApi,
  SidewalkPresenceForApi,
  StreetAccessScoreForApi,
  StreetDataForApi
}
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Source
import org.geotools.api.data.{DataStore, DataStoreFinder, SimpleFeatureStore, Transaction}
import org.geotools.api.feature.simple.{SimpleFeature, SimpleFeatureType}
import org.geotools.data.shapefile.ShapefileDataStoreFactory
import org.geotools.data.simple.SimpleFeatureCollection
import org.geotools.data.{DataUtilities, DefaultTransaction}
import org.geotools.feature.simple.{SimpleFeatureBuilder, SimpleFeatureTypeBuilder}
import org.geotools.geometry.jts.JTSFactoryFinder
import org.geotools.geopkg.GeoPkgDataStoreFactory
import org.geotools.jdbc.JDBCDataStore
import org.locationtech.jts.geom.{Coordinate, Envelope, Geometry, GeometryFactory, LineString, MultiPolygon, Point}
import play.api.Logger
import play.api.libs.json.Json

import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.sql.Types
import java.util.zip.{ZipEntry, ZipOutputStream}
import javax.inject.{Inject, Singleton}
import scala.collection.mutable
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters.{ListHasAsScala, MapHasAsJava, SeqHasAsJava}
import scala.util.{Failure, Success, Try, Using}

/**
 * This class handles the creation of Shapefile archives to be used by the ApiController.
 *
 * Code was started and modified from the Geotools feature tutorial:
 * https://docs.geotools.org/stable/tutorials/feature/csv2shp.html
 */
@Singleton
class ShapefilesCreatorHelper @Inject() ()(implicit ec: ExecutionContext, mat: Materializer) {
  private val logger = Logger(this.getClass)

  private val shapefilePartExtensions = Seq(".shp", ".dbf", ".shx", ".prj", ".sbn", ".sbx", ".cpg", ".fix")

  /**
   * Opens the GeoPackage at the given path as a data store, which the caller disposes. `DataStoreFinder` returns null
   * rather than throwing when no factory accepts the params (e.g. gt-geopkg's service file lost in packaging).
   *
   * @return The store as the SQL-backed kind gt-geopkg builds, so [[writeGeoPackageExtent]] can borrow its connection.
   */
  private def openGeoPackage(geopackagePath: Path): JDBCDataStore = {
    val params = Map(
      GeoPkgDataStoreFactory.DBTYPE.key   -> "geopkg",
      GeoPkgDataStoreFactory.DATABASE.key -> geopackagePath.toFile
    ).asJava
    DataStoreFinder.getDataStore(params) match {
      case store: JDBCDataStore => store
      case null                 =>
        throw new IllegalStateException(
          "No GeoTools DataStore factory accepted the GeoPackage params (is gt-geopkg on " +
            "the classpath with its META-INF/services entry?)"
        )
      case other =>
        other.dispose()
        throw new IllegalStateException(
          s"gt-geopkg returned a ${other.getClass.getName}, not a JDBCDataStore, so layer extents can't be saved"
        )
    }
  }

  /**
   * Creates a GeoPackage, lets `writeLayers` fill it, and closes it. A failed export deletes its half-written file,
   * since the caller only cleans up a file it gets back.
   *
   * @param outputFile The output filename (with no extension).
   * @param writeLayers Writes every layer into the open GeoPackage, each through [[writeGeoPackageLayer]].
   * @return Path to the finished GeoPackage, or None if any part of it failed.
   */
  private def createGeoPackage(outputFile: String)(writeLayers: JDBCDataStore => Future[Unit]): Future[Option[Path]] = {
    val geopackagePath: Path = new File(outputFile + ".gpkg").toPath
    Future(openGeoPackage(geopackagePath))
      .flatMap(dataStore => Future.delegate(writeLayers(dataStore)).andThen(_ => dataStore.dispose()))
      .map(_ => Some(geopackagePath))
      .recover { case e: Exception =>
        logger.error(s"Error creating GeoPackage: ${e.getMessage}", e)
        val _ = Try(Files.deleteIfExists(geopackagePath))
        None
      }
  }

  /**
   * Writes one layer of an open GeoPackage a batch at a time, then saves the layer's extent. Every GeoPackage layer is
   * written through here, so none can be left claiming an extent of (0, 0, 0, 0) (#5275).
   *
   * @param dataStore The open GeoPackage.
   * @param featureType The layer's schema; its type name becomes the table name.
   * @param batches The layer's features, each batch saved in its own transaction.
   * @return Completes once every batch is saved; fails if any batch fails.
   */
  private def writeGeoPackageLayer(
      dataStore: JDBCDataStore,
      featureType: SimpleFeatureType,
      batches: Source[java.util.List[SimpleFeature], _]
  ): Future[Unit] = {
    dataStore.createSchema(featureType)
    val tableName    = featureType.getTypeName
    val featureStore = dataStore.getFeatureSource(tableName).asInstanceOf[SimpleFeatureStore]
    val extent       = new Envelope()
    batches
      .runForeach { features =>
        val batch = DataUtilities.collection(features)
        writeFeatureBatch(featureStore, batch)
        extent.expandToInclude(batch.getBounds)
      }
      .map(_ => writeGeoPackageExtent(dataStore, tableName, extent))
  }

  /**
   * Saves a layer's real bounding box in `gpkg_contents`, which QGIS and GDAL trust as the layer's extent. GeoTools
   * writes that row before any feature exists and never updates it, leaving (0, 0, 0, 0) (#5275). An empty layer gets
   * NULLs, which the GeoPackage spec reads as "extent unknown". A failure is only logged: every feature is already
   * saved, so the file is still worth serving.
   *
   * @param dataStore The open GeoPackage; call before disposing it.
   * @param extent The bounding box of every feature written to the layer.
   */
  private def writeGeoPackageExtent(dataStore: JDBCDataStore, tableName: String, extent: Envelope): Unit = {
    val bounds: Seq[Option[Double]] =
      if (extent.isNull) Seq.fill(4)(None)
      else Seq(extent.getMinX, extent.getMinY, extent.getMaxX, extent.getMaxY).map(Some(_))
    val rowsUpdated: Try[Int] = Using.Manager { use =>
      val cx   = use(dataStore.getConnection(Transaction.AUTO_COMMIT))
      val stmt = use(
        cx.prepareStatement(
          "UPDATE gpkg_contents SET min_x = ?, min_y = ?, max_x = ?, max_y = ?, " +
            "last_change = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE table_name = ?"
        )
      )
      bounds.zipWithIndex.foreach {
        case (Some(bound), i) => stmt.setDouble(i + 1, bound)
        case (None, i)        => stmt.setNull(i + 1, Types.DOUBLE)
      }
      stmt.setString(5, tableName)
      stmt.executeUpdate()
    }
    rowsUpdated match {
      case Success(1) => ()
      // No matching row means GeoTools has started naming the row differently, and exports are back to (0, 0, 0, 0).
      case Success(n) => logger.warn(s"GeoPackage extent not saved: $n gpkg_contents rows match $tableName")
      case Failure(e) => logger.warn(s"GeoPackage extent not saved for $tableName: ${e.getMessage}", e)
    }
  }

  /**
   * Creates an empty UTF-8 shapefile (#5276). GeoTools never writes the `.cpg` itself, and `createSchema` deletes one.
   *
   * @param shapefilePath Where the `.shp` goes.
   * @param featureType The shapefile's schema.
   * @return The new store, which the caller disposes.
   */
  private def newShapefileStore(shapefilePath: Path, featureType: SimpleFeatureType): DataStore = {
    val store = new ShapefileDataStoreFactory().createNewDataStore(
      Map[String, AnyRef](
        ShapefileDataStoreFactory.URLP.key                 -> shapefilePath.toUri.toURL,
        ShapefileDataStoreFactory.CREATE_SPATIAL_INDEX.key -> java.lang.Boolean.FALSE, // So we don't run out of memory.
        ShapefileDataStoreFactory.DBFCHARSET.key           -> StandardCharsets.UTF_8
      ).asJava
    )
    try {
      store.createSchema(featureType)
      val cpgPath = shapefilePath.resolveSibling(shapefilePath.getFileName.toString.stripSuffix(".shp") + ".cpg")
      Files.writeString(cpgPath, "UTF-8")
      store
    } catch {
      case e: Exception =>
        store.dispose()
        throw e
    }
  }

  /** Deletes every part of a failed shapefile, since callers only clean up files they get back. */
  private def deleteShapefileParts(shapefilePath: Path): Unit = {
    val basename = shapefilePath.getFileName.toString.stripSuffix(".shp")
    shapefilePartExtensions.foreach(ext => Try(Files.deleteIfExists(shapefilePath.resolveSibling(basename + ext))))
  }

  /** Rejects attribute names over the DBF format's 10-char limit, which GeoTools would otherwise truncate silently. */
  private def requireDbfSafeNames(featureType: SimpleFeatureType): Unit = {
    val tooLong = featureType.getAttributeDescriptors.asScala.map(_.getLocalName).filter(_.length > 10)
    require(
      tooLong.isEmpty,
      s"Shapefile schema ${featureType.getTypeName} has attribute names over DBF's 10-char limit: ${tooLong.mkString(", ")}"
    )
  }

  /**
   * Saves a batch of features in one transaction. A failure rolls the batch back and is rethrown, so the export fails
   * instead of serving a file with rows missing.
   *
   * @param featureStore The feature store to write to.
   * @param features The batch to save.
   */
  private def writeFeatureBatch(featureStore: SimpleFeatureStore, features: SimpleFeatureCollection): Unit = {
    val transaction = new DefaultTransaction("create")
    try {
      featureStore.setTransaction(transaction)
      featureStore.addFeatures(features)
      transaction.commit()
    } catch {
      case e: Exception =>
        transaction.rollback()
        throw e
    } finally {
      transaction.close()
    }
  }

  /**
   * One GeoPackage layer, whose columns are a record type's API fields: the same list its JSON and CSV come from, so
   * the three can't name, order, or fill a field differently (#5273).
   *
   * @param apiFields The fields that become the layer's columns, each named by its `geoPackageName`.
   */
  final private class GeoPackageLayer[T](
      tableName: String,
      geometryType: Class[_ <: Geometry],
      apiFields: ApiFields[T],
      geometry: T => Geometry
  ) {
    private val names: Seq[String] = apiFields.fields.map(_.geoPackageName)
    // ArcGIS only takes names of letters, digits, and underscores that start with a letter.
    require(
      names.forall(_.matches("[A-Za-z][A-Za-z0-9_]*")),
      s"$tableName has column names ArcGIS rejects: ${names.filterNot(_.matches("[A-Za-z][A-Za-z0-9_]*"))}"
    )
    // SQLite ignores case in column names, and GeoTools adds its own `fid` and `the_geom` columns.
    private val takenNames: Seq[String] = Seq("fid", "the_geom") ++ names.map(_.toLowerCase)
    require(
      takenNames.distinct.size == takenNames.size,
      s"$tableName has clashing GeoPackage column names: ${takenNames.diff(takenNames.distinct)}"
    )

    val featureType: SimpleFeatureType = {
      val builder = new SimpleFeatureTypeBuilder()
      // The geometry column comes from a spec string, like every other export's, so it gets the same srid=4326 setup.
      builder.init(DataUtilities.createType(tableName, s"the_geom:${geometryType.getSimpleName}:srid=4326"))
      apiFields.fields.foreach(f => builder.add(f.geoPackageName, f.column.binding))
      builder.buildFeatureType()
    }

    /** @return The record as a feature, its values in the same order as [[featureType]]'s columns. */
    def toFeature(record: T, builder: SimpleFeatureBuilder): SimpleFeature = {
      builder.reset()
      builder.add(geometry(record))
      apiFields.fields.foreach(f => builder.add(f.geoPackageValue(record)))
      builder.buildFeature(null)
    }
  }

  private val pointFactory: GeometryFactory = JTSFactoryFinder.getGeometryFactory

  private def point(longitude: Double, latitude: Double): Point =
    pointFactory.createPoint(new Coordinate(longitude, latitude))

  // Lazy, so a layer with a bad field list breaks only its own export rather than this whole helper's construction.
  private lazy val rawLabelsLayer = new GeoPackageLayer[LabelDataForApi](
    "labels",
    classOf[Point],
    LabelDataForApi,
    l => point(l.longitude, l.latitude)
  )
  private lazy val labelClustersLayer = new GeoPackageLayer[LabelClusterForApi](
    "label_clusters",
    classOf[Point],
    LabelClusterForApi,
    c => point(c.avgLongitude, c.avgLatitude)
  )
  private lazy val clusterRawLabelsLayer = new GeoPackageLayer[(Int, RawLabelInClusterDataForApi)](
    "raw_labels",
    classOf[Point],
    RawLabelInClusterDataForApi.InCluster,
    { case (_, l) => point(l.longitude, l.latitude) }
  )
  private lazy val streetsLayer =
    new GeoPackageLayer[StreetDataForApi]("streets", classOf[LineString], StreetDataForApi, _.geometry)
  private lazy val sidewalkPresenceLayer = new GeoPackageLayer[SidewalkPresenceForApi](
    "sidewalk_presence",
    classOf[LineString],
    SidewalkPresenceForApi,
    _.geometry
  )
  private lazy val regionsLayer =
    new GeoPackageLayer[RegionDataForApi]("regions", classOf[MultiPolygon], RegionDataForApi, _.geometry)
  private lazy val accessScoreStreetsLayer = new GeoPackageLayer[StreetAccessScoreForApi](
    "access_score_streets",
    classOf[LineString],
    StreetAccessScoreForApi,
    _.geometry
  )
  private lazy val accessScoreIntersectionsLayer = new GeoPackageLayer[IntersectionAccessScoreForApi](
    "access_score_intersections",
    classOf[Point],
    IntersectionAccessScoreForApi,
    _.geometry
  )
  private lazy val accessScoreRegionsLayer = new GeoPackageLayer[RegionAccessScoreForApi](
    "access_score_regions",
    classOf[MultiPolygon],
    RegionAccessScoreForApi,
    _.geometry
  )

  /** @return A single-layer GeoPackage of every record in `source`, saved as `outputFile.gpkg`, or None if it failed. */
  private def createGeneralGeoPackage[A](
      source: Source[A, _],
      outputFile: String,
      batchSize: Int,
      layer: GeoPackageLayer[A]
  ): Future[Option[Path]] =
    createGeoPackage(outputFile) { dataStore =>
      val featureBuilder = new SimpleFeatureBuilder(layer.featureType)
      val batches        = source.grouped(batchSize).map(_.map(layer.toFeature(_, featureBuilder)).asJava)
      writeGeoPackageLayer(dataStore, layer.featureType, batches)
    }

  /** Creates a GeoPackage of labels (`/v3/api/rawLabels`), in a `labels` layer. */
  def createRawLabelDataGeopackage(
      source: Source[LabelDataForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = createGeneralGeoPackage(source, outputFile, batchSize, rawLabelsLayer)

  /**
   * Creates a GeoPackage of label clusters, in a `label_clusters` layer. When the clusters carry their raw labels, those
   * go in a second `raw_labels` layer, each naming its cluster in `label_cluster_id`.
   *
   * @return Path to the finished GeoPackage, or None if any part of it failed.
   */
  def createLabelClusterGeopackage(
      source: Source[LabelClusterForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] =
    createGeoPackage(outputFile) { dataStore =>
      val clusterBuilder = new SimpleFeatureBuilder(labelClustersLayer.featureType)
      val labelBuilder   = new SimpleFeatureBuilder(clusterRawLabelsLayer.featureType)

      // Collect raw labels to write as a second layer after the clusters.
      val allRawLabels = mutable.ArrayBuffer.empty[(Int, RawLabelInClusterDataForApi)]

      val clusterBatches = source.grouped(batchSize).map { batch =>
        batch.foreach(c => c.labels.foreach(_.foreach(label => allRawLabels += ((c.labelClusterId, label)))))
        batch.map(labelClustersLayer.toFeature(_, clusterBuilder)).asJava
      }
      writeGeoPackageLayer(dataStore, labelClustersLayer.featureType, clusterBatches).flatMap { _ =>
        // The raw labels layer only exists when the raw labels were included.
        if (allRawLabels.isEmpty) Future.unit
        else {
          val labelBatches = Source
            .fromIterator(() => allRawLabels.iterator)
            .grouped(batchSize)
            .map(_.map(clusterRawLabelsLayer.toFeature(_, labelBuilder)).asJava)
          writeGeoPackageLayer(dataStore, clusterRawLabelsLayer.featureType, labelBatches)
        }
      }
    }

  /** Creates a GeoPackage of streets (`/v3/api/streets`), in a `streets` layer. */
  def createStreetDataGeopackage(
      source: Source[StreetDataForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = createGeneralGeoPackage(source, outputFile, batchSize, streetsLayer)

  /** Creates a GeoPackage of street sides (`/v3/api/sidewalkPresence`, #5279), in a `sidewalk_presence` layer. */
  def createSidewalkPresenceGeopackage(
      source: Source[SidewalkPresenceForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = createGeneralGeoPackage(source, outputFile, batchSize, sidewalkPresenceLayer)

  /** Creates a GeoPackage of regions (`/v3/api/regions`), in a `regions` layer. */
  def createRegionDataGeopackage(
      source: Source[RegionDataForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = createGeneralGeoPackage(source, outputFile, batchSize, regionsLayer)

  /** Creates a GeoPackage of street AccessScores (v3, #3855), in an `access_score_streets` layer. */
  def createStreetAccessScoreGeopackage(
      source: Source[StreetAccessScoreForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = createGeneralGeoPackage(source, outputFile, batchSize, accessScoreStreetsLayer)

  /** Creates a GeoPackage of intersection AccessScores (v3, #5095), in an `access_score_intersections` layer. */
  def createIntersectionAccessScoreGeopackage(
      source: Source[IntersectionAccessScoreForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = createGeneralGeoPackage(source, outputFile, batchSize, accessScoreIntersectionsLayer)

  /** Creates a GeoPackage of region AccessScores (v3, #3855), in an `access_score_regions` layer. */
  def createRegionAccessScoreGeopackage(
      source: Source[RegionAccessScoreForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = createGeneralGeoPackage(source, outputFile, batchSize, accessScoreRegionsLayer)

  /**
   * Creates a shapefile from the given source, saving it at outputFile.
   *
   * @param source A data stream holding the data to be saved in the shapefile.
   * @param outputFile The output filename (with no extension).
   * @param batchSize The number of features from the data stream to process at a time.
   * @param featureType SimpleFeatureType definition with the schema for the given data type.
   * @param buildFeature A function that takes a data point and a SimpleFeatureBuilder and returns a SimpleFeature.
   * @tparam A The type of data in the source.
   */
  private def createGeneralShapefile[A](
      source: Source[A, _],
      outputFile: String,
      batchSize: Int,
      featureType: SimpleFeatureType,
      buildFeature: (A, SimpleFeatureBuilder) => SimpleFeature
  ): Future[Option[Path]] = {
    val shapefilePath: Path     = new File(outputFile + ".shp").toPath
    var newDataStore: DataStore = null

    try {
      requireDbfSafeNames(featureType)

      // Set up everything we need to create and store features.
      newDataStore = newShapefileStore(shapefilePath, featureType)

      val typeName: String                     = newDataStore.getTypeNames()(0)
      val featureSource                        = newDataStore.getFeatureSource(typeName)
      val featureStore                         = featureSource.asInstanceOf[SimpleFeatureStore]
      val featureBuilder: SimpleFeatureBuilder = new SimpleFeatureBuilder(featureType)
      val features                             = new java.util.ArrayList[SimpleFeature](batchSize)

      // Process data in batches.
      source
        .grouped(batchSize)
        .runForeach { batch =>
          features.clear()

          // Create a feature from each data point in this batch and add it to the ArrayList.
          batch.foreach { x =>
            featureBuilder.reset()
            val feature: SimpleFeature = buildFeature(x, featureBuilder)
            features.add(feature)
          }

          // Add this batch of features to the shapefile in a transaction.
          writeFeatureBatch(featureStore, DataUtilities.collection(features))
        }
        .map { _ =>
          // Output the file path for the shapefile.
          newDataStore.dispose()
          Some(shapefilePath)
        }
        .recover { case e: Exception =>
          newDataStore.dispose()
          deleteShapefileParts(shapefilePath)
          logger.error(s"Error creating shapefile: ${e.getMessage}", e)
          None
        }
    } catch {
      case e: Exception =>
        Option(newDataStore).foreach(_.dispose())
        deleteShapefileParts(shapefilePath)
        logger.error(s"Error setting up shapefile: ${e.getMessage}", e)
        Future.successful(None)
    }
  }

  /**
   * Creates a zip archive from the given shapefiles, saving it at s"$baseFileName.zip" and deleting their parts.
   *
   * @param files A sequence of Paths to the shapefiles to be zipped
   * @param baseFileName The base filename for the zip archive (without extension)
   * @return The path of the zip archive.
   */
  def zipShapefile(files: Seq[Path], baseFileName: String): Path = {
    val zipPath = new File(s"$baseFileName.zip").toPath
    val zipOut  = new ZipOutputStream(Files.newOutputStream(zipPath))

    // For each shapefile, add all component files to the zip archive.
    try {
      files.foreach { f =>
        val shapefile = f.toFile
        val directory = shapefile.getParentFile
        val basename  = shapefile.getName.substring(0, shapefile.getName.length - 4)

        shapefilePartExtensions.foreach { ext =>
          val file = new File(directory, basename + ext)
          if (file.exists()) {
            zipOut.putNextEntry(new ZipEntry(file.getName))
            Files.copy(file.toPath, zipOut)
            zipOut.closeEntry()
            file.delete()
          }
        }
      }
    } finally zipOut.close()

    zipPath
  }

  /**
   * Creates a shapefile from LabelDataForApi objects.
   *
   * @param source Stream of LabelDataForApi objects
   * @param outputFile Base filename for the output file (without extension)
   * @param batchSize Number of features to process in each batch
   * @return Path to the created shapefile, or None if creation failed
   */
  def createRawLabelShapefile(
      source: Source[LabelDataForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    // Text columns are fixed width; the 254-byte default put Seattle's .dbf over 1GB (#4133). Longer values get cut off.
    val featureType: SimpleFeatureType = {
      val builder = new SimpleFeatureTypeBuilder()
      builder.init(DataUtilities.createType("Location", "the_geom:Point:srid=4326"))
      def text(name: String, width: Int): Unit = {
        builder.length(width)
        builder.add(name, classOf[String])
      }
      builder.add("labelId", classOf[Integer])
      text("userId", 36)     // UUID
      text("panoId", 128)    // Google photosphere ids are 64 chars today; room for a longer provider id
      text("panoSource", 16) // Imagery provider (gsv, mapillary, infra3d)
      text("labelType", 16)
      builder.add("severity", classOf[Integer])
      text("tags", 254)                                     // Tags list
      text("descriptn", 254)                                // Description
      text("labelTime", 40)                                 // Creation timestamp, ISO 8601 with an offset
      builder.add("hiQualUser", classOf[java.lang.Boolean]) // Whether the labeler is flagged as high quality
      builder.add("streetId", classOf[Integer])
      text("osmWayId", 20) // OSM street ID, a long
      builder.add("regionId", classOf[Integer])
      text("regionName", 100)                              // Region (neighborhood) name
      text("streetSide", 8)                                // left/right of the edge's digitized direction
      builder.add("ctrOffsetM", classOf[java.lang.Double]) // Signed offset from the street centerline in metres
      text("correct", 8)                                   // Validation correctness: true/false or empty
      builder.add("nAgree", classOf[Integer])
      builder.add("nDisagree", classOf[Integer])
      builder.add("nUnsure", classOf[Integer])
      text("validatns", 254) // Validation details as JSON
      builder.add("taskId", classOf[Integer])
      builder.add("missionId", classOf[Integer])
      text("imageDate", 32) // Image capture date
      text("pov", 100)      // {"heading": Double, "pitch": Double, "zoom": Double}; three 17-digit doubles fit
      builder.add("canvasX", classOf[Integer])
      builder.add("canvasY", classOf[Integer])
      builder.add("canvasWdth", classOf[Integer])
      builder.add("canvasHght", classOf[Integer])
      builder.add("panoX", classOf[Integer])
      builder.add("panoY", classOf[Integer])
      builder.add("panoWidth", classOf[Integer])
      builder.add("panoHeight", classOf[Integer])
      builder.add("cameraHdng", classOf[java.lang.Double])
      builder.add("cameraPtch", classOf[java.lang.Double])
      builder.add("cameraRoll", classOf[java.lang.Double])
      text("panoUrl", 254) // Provider viewer URL (empty for providers without one)
      builder.buildFeatureType()
    }

    val geometryFactory: GeometryFactory = JTSFactoryFinder.getGeometryFactory

    def buildFeature(label: LabelDataForApi, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      // Add the geometry (Point)
      featureBuilder.add(geometryFactory.createPoint(new Coordinate(label.longitude, label.latitude)))

      // Add all attributes
      featureBuilder.add(label.labelId)
      featureBuilder.add(label.userId)
      featureBuilder.add(label.panoId)
      featureBuilder.add(label.panoSource.toString)
      featureBuilder.add(label.labelType)
      featureBuilder.add(label.severity.orNull)
      featureBuilder.add(label.tags.mkString("[", ",", "]"))
      featureBuilder.add(label.description.orNull)
      featureBuilder.add(label.timeCreated)
      featureBuilder.add(label.highQualityUser)
      featureBuilder.add(label.streetEdgeId)
      featureBuilder.add(label.osmWayId.toString)
      featureBuilder.add(label.regionId)
      featureBuilder.add(label.regionName)
      featureBuilder.add(label.streetSide.map(_.toString).orNull)
      featureBuilder.add(label.centerlineOffsetM.map(Double.box).orNull)
      featureBuilder.add(label.correct.map(_.toString).orNull)
      featureBuilder.add(label.agreeCount)
      featureBuilder.add(label.disagreeCount)
      featureBuilder.add(label.unsureCount)

      featureBuilder.add(Json.stringify(label.validationsJson))

      featureBuilder.add(label.auditTaskId.orNull)
      featureBuilder.add(label.missionId.orNull)
      featureBuilder.add(label.imageCaptureDate.orNull)

      // Combine heading/pitch/zoom into a single field so that we don't hit max number of fields.
      val povString: Option[String] = (label.heading, label.pitch, label.zoom) match {
        case (Some(heading), Some(pitch), Some(zoom)) => Some(s"""{"heading":$heading,"pitch":$pitch,"zoom":$zoom}""")
        case _                                        => None
      }
      featureBuilder.add(povString.orNull)
      featureBuilder.add(label.canvasX.orNull)
      featureBuilder.add(label.canvasY.orNull)
      featureBuilder.add(label.canvasWidth.orNull)
      featureBuilder.add(label.canvasHeight.orNull)
      featureBuilder.add(label.panoX.orNull)
      featureBuilder.add(label.panoY.orNull)
      featureBuilder.add(label.panoWidth.orNull)
      featureBuilder.add(label.panoHeight.orNull)
      featureBuilder.add(label.cameraHeading.orNull)
      featureBuilder.add(label.cameraPitch.orNull)
      featureBuilder.add(label.cameraRoll.orNull)
      featureBuilder.add(label.panoUrl.getOrElse(""))

      featureBuilder.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  // Shared schema used by both createLabelClusterShapefile and createLabelClusterShapefileWithLabels.
  private val clusterShapefileFeatureType: SimpleFeatureType = DataUtilities.createType(
    "Location",
    "the_geom:Point:srid=4326," // the geometry attribute: Point type
    + "clusterId:Integer,"      // Cluster ID
    + "labelType:String,"       // Label type
    + "streetId:Integer,"       // Street edge ID
    + "intersecId:Integer,"     // Intersection ID (null if none)
    + "osmWayId:String,"        // OSM way ID
    + "regionId:Integer,"       // Region ID
    + "regionName:String,"      // Region name
    + "avgImgDate:String,"      // Average image capture date
    + "avgLblDate:String,"      // Average label date
    + "severity:Integer,"       // Severity
    + "nAgree:Integer,"         // Agree count
    + "nDisagree:Integer,"      // Disagree count
    + "nUnsure:Integer,"        // Unsure count
    + "clusterSze:Integer,"     // Cluster size
    + "labelIds:String,"        // Label IDs as comma-separated list
    + "userIds:String,"         // User IDs
    + "tagCounts:String"        // Tag counts as JSON
  )

  // Shared builder used by both createLabelClusterShapefile and createLabelClusterShapefileWithLabels.
  private def buildClusterShapefileFeature(
      cluster: LabelClusterForApi,
      featureBuilder: SimpleFeatureBuilder,
      geometryFactory: GeometryFactory
  ): SimpleFeature = {
    featureBuilder.add(geometryFactory.createPoint(new Coordinate(cluster.avgLongitude, cluster.avgLatitude)))
    featureBuilder.add(cluster.labelClusterId)
    featureBuilder.add(cluster.labelType)
    featureBuilder.add(cluster.streetEdgeId)
    featureBuilder.add(cluster.intersectionId.map(Integer.valueOf).orNull)
    featureBuilder.add(cluster.osmWayId.toString)
    featureBuilder.add(cluster.regionId)
    featureBuilder.add(cluster.regionName)
    featureBuilder.add(cluster.avgImageCaptureDate.map(_.toString).orNull)
    featureBuilder.add(cluster.avgLabelDate.map(_.toString).orNull)
    featureBuilder.add(cluster.medianSeverity.map(Integer.valueOf).orNull)
    featureBuilder.add(cluster.agreeCount)
    featureBuilder.add(cluster.disagreeCount)
    featureBuilder.add(cluster.unsureCount)
    featureBuilder.add(cluster.clusterSize)
    featureBuilder.add(Json.stringify(Json.toJson(cluster.labelIds)))
    featureBuilder.add(Json.stringify(Json.toJson(cluster.userIds)))
    featureBuilder.add(Json.stringify(Json.toJson(cluster.tagCounts)))
    featureBuilder.buildFeature(null)
  }

  /**
   * Creates a shapefile from LabelClusterForApi objects.
   *
   * @param source Stream of LabelClusterForApi objects
   * @param outputFile Base filename for the output file (without extension)
   * @param batchSize Number of features to process in each batch
   * @return Path to the created shapefile, or None if creation failed
   */
  def createLabelClusterShapefile(
      source: Source[LabelClusterForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    val geometryFactory = JTSFactoryFinder.getGeometryFactory
    createGeneralShapefile(
      source,
      outputFile,
      batchSize,
      clusterShapefileFeatureType,
      (cluster, fb) => buildClusterShapefileFeature(cluster, fb, geometryFactory)
    )
  }

  /**
   * Creates shapefile(s) from LabelClusterForApi objects. When raw labels are included in the cluster data, a second
   * shapefile for the raw labels is also created.
   *
   * @param source Stream of LabelClusterForApi objects
   * @param outputFile Base filename for the output file (without extension)
   * @param batchSize Number of features to process in each batch
   * @return Paths to the created shapefile(s), or None if creation failed
   */
  def createLabelClusterShapefileWithLabels(
      source: Source[LabelClusterForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Seq[Path]]] = {
    val labelFeatureType: SimpleFeatureType = DataUtilities.createType(
      "Location",
      "the_geom:Point:srid=4326," // the geometry attribute: Point type
      + "labelId:Integer,"        // Label ID
      + "clusterId:Integer,"      // Parent cluster ID
      + "userId:String,"          // User ID
      + "panoId:String,"          // Panorama ID
      + "panoSource:String,"      // Imagery provider (gsv, mapillary, infra3d)
      + "severity:Integer,"       // Severity
      + "timeCreate:String,"      // Creation timestamp
      + "correct:String,"         // Validation correctness
      + "imageDate:String"        // Image capture date
    )

    val clusterShapefilePath: Path = new File(outputFile + ".shp").toPath
    val labelShapefilePath: Path   = new File(outputFile + "_labels.shp").toPath
    val geometryFactory            = JTSFactoryFinder.getGeometryFactory

    var clusterDataStore: DataStore = null

    try {
      requireDbfSafeNames(clusterShapefileFeatureType)
      requireDbfSafeNames(labelFeatureType)

      // Set up clusters shapefile.
      clusterDataStore = newShapefileStore(clusterShapefilePath, clusterShapefileFeatureType)
      val clusterStore =
        clusterDataStore.getFeatureSource(clusterDataStore.getTypeNames()(0)).asInstanceOf[SimpleFeatureStore]
      val clusterBuilder  = new SimpleFeatureBuilder(clusterShapefileFeatureType)
      val clusterFeatures = new java.util.ArrayList[SimpleFeature](batchSize)

      // Collect raw labels to write a second shapefile after processing clusters.
      val allRawLabels = new java.util.ArrayList[(Int, RawLabelInClusterDataForApi)]()
      var hasRawLabels = false

      source
        .grouped(batchSize)
        .runForeach { batch =>
          clusterFeatures.clear()
          batch.foreach { cluster =>
            clusterBuilder.reset()
            clusterFeatures.add(buildClusterShapefileFeature(cluster, clusterBuilder, geometryFactory))

            // Collect raw labels.
            cluster.labels.foreach { labelsList =>
              hasRawLabels = true
              labelsList.foreach(label => allRawLabels.add((cluster.labelClusterId, label)))
            }
          }
          writeFeatureBatch(clusterStore, DataUtilities.collection(clusterFeatures))
        }
        .map { _ =>
          clusterDataStore.dispose()

          // Write the raw labels shapefile if any labels were collected.
          if (hasRawLabels && !allRawLabels.isEmpty) {
            val labelDataStore = newShapefileStore(labelShapefilePath, labelFeatureType)
            val labelStore     =
              labelDataStore.getFeatureSource(labelDataStore.getTypeNames()(0)).asInstanceOf[SimpleFeatureStore]
            val labelBuilder  = new SimpleFeatureBuilder(labelFeatureType)
            val labelFeatures = new java.util.ArrayList[SimpleFeature](batchSize)

            try {
              val labelIter = allRawLabels.iterator()
              while (labelIter.hasNext) {
                labelFeatures.clear()
                var count = 0
                while (labelIter.hasNext && count < batchSize) {
                  val (clusterId, label) = labelIter.next()
                  labelBuilder.reset()
                  labelBuilder.add(geometryFactory.createPoint(new Coordinate(label.longitude, label.latitude)))
                  labelBuilder.add(label.labelId)
                  labelBuilder.add(clusterId)
                  labelBuilder.add(label.userId)
                  labelBuilder.add(label.panoId)
                  labelBuilder.add(label.panoSource.map(_.toString).orNull)
                  labelBuilder.add(label.severity.map(Integer.valueOf).orNull)
                  labelBuilder.add(label.timeCreated.toString)
                  labelBuilder.add(label.correct.map(_.toString).orNull)
                  labelBuilder.add(label.imageCaptureDate.orNull)
                  labelFeatures.add(labelBuilder.buildFeature(null))
                  count += 1
                }
                writeFeatureBatch(labelStore, DataUtilities.collection(labelFeatures))
              }
            } finally labelDataStore.dispose()
            Some(Seq(clusterShapefilePath, labelShapefilePath))
          } else {
            Some(Seq(clusterShapefilePath))
          }
        }
        .recover { case e: Exception =>
          clusterDataStore.dispose()
          Seq(clusterShapefilePath, labelShapefilePath).foreach(deleteShapefileParts)
          logger.error(s"Error creating shapefile: ${e.getMessage}", e)
          None
        }
    } catch {
      case e: Exception =>
        Option(clusterDataStore).foreach(_.dispose())
        Seq(clusterShapefilePath, labelShapefilePath).foreach(deleteShapefileParts)
        logger.error(s"Error setting up shapefile: ${e.getMessage}", e)
        Future.successful(None)
    }
  }

  /**
   * Creates a shapefile from StreetDataForApi objects.
   *
   * @param source Stream of StreetDataForApi objects
   * @param outputFile Base filename for the output file (without extension)
   * @param batchSize Number of features to process in each batch
   * @return Path to the created shapefile, or None if creation failed
   */
  def createStreetDataShapefile(
      source: Source[StreetDataForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    // Define the feature type schema for StreetDataForApi
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "Street",
      "the_geom:LineString:srid=4326," // the geometry attribute: LineString type
      + "streetId:Integer,"            // Street edge ID
      + "osmWayId:String,"             // OSM street ID as String (shapefiles don't handle Long well)
      + "regionId:Integer,"            // Region ID
      + "regionName:String,"           // Region name
      + "wayType:String,"              // Type of street/way
      + "maxSpeed:String,"             // Raw OSM maxspeed tag (e.g. "25 mph"); empty when unknown
      + "status:String,"               // Street availability: open, no_imagery, closed, or disabled
      + "labelCount:Integer,"          // Number of labels on this street
      + "auditCount:Integer,"          // Number of times audited
      + "outdated:Boolean,"            // Audited before, but all audits predate newer imagery (needs re-audit)
      + "userCount:Integer,"           // Number of unique users
      + "userIds:String,"              // List of user IDs as a string
      + "firstLabel:String,"           // First label date
      + "lastLabel:String"             // Last label date
    )

    def buildFeature(street: StreetDataForApi, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      // Add the geometry (LineString)
      featureBuilder.add(street.geometry)

      // Add all attributes
      featureBuilder.add(street.streetEdgeId)
      featureBuilder.add(street.osmWayId.toString) // Convert Long to String
      featureBuilder.add(street.regionId)
      featureBuilder.add(street.regionName)
      featureBuilder.add(street.wayType)
      featureBuilder.add(street.maxSpeed.orNull)
      featureBuilder.add(street.status)
      featureBuilder.add(street.labelCount)
      featureBuilder.add(street.auditCount)
      featureBuilder.add(street.outdated)
      featureBuilder.add(street.userIds.size)

      // Format user IDs as a JSON array string, handling potential null values
      val userIdsStr = street.userIds.map(id => if (id == null) "null" else s""""$id"""").mkString(",")
      featureBuilder.add(s"[$userIdsStr]")

      // Add date fields
      featureBuilder.add(street.firstLabelDate.map(_.toString).orNull)
      featureBuilder.add(street.lastLabelDate.map(_.toString).orNull)

      featureBuilder.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  /**
   * Writes sidewalk presence faces (#5279) as a Shapefile: one LineString per face, both faces of a street sharing
   * its geometry. Field names are camelCase and abbreviated to the DBF format's 10-character limit; the GeoPackage
   * carries the canonical snake_case names.
   */
  def createSidewalkPresenceShapefile(
      source: Source[SidewalkPresenceForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "SidewalkPresence",
      "the_geom:LineString:srid=4326," // The street's geometry, shared by its two faces
      + "streetId:Integer,"
        + "side:String,"
        + "osmWayId:String," // OSM way ID as String (shapefiles don't handle Long well)
        + "regionId:Integer,"
        + "regionName:String,"
        + "wayType:String,"
        + "status:String,"
        + "presence:String,"
        + "basis:String,"     // presence_basis
        + "nsLabels:Integer," // no_sidewalk_label_count
        + "nsUsers:Integer,"  // no_sidewalk_user_count
        + "labelCount:Integer,"
        + "auditCount:Integer,"
        + "firstNsLbl:String," // first_no_sidewalk_label_date
        + "lastNsLbl:String"   // last_no_sidewalk_label_date
    )

    def buildFeature(face: SidewalkPresenceForApi, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      featureBuilder.add(face.geometry)
      featureBuilder.add(face.streetEdgeId)
      featureBuilder.add(face.streetSide)
      featureBuilder.add(face.osmWayId.toString)
      featureBuilder.add(face.regionId)
      featureBuilder.add(face.regionName)
      featureBuilder.add(face.wayType)
      featureBuilder.add(face.status)
      featureBuilder.add(face.presence)
      featureBuilder.add(face.presenceBasis)
      featureBuilder.add(face.noSidewalkLabelCount)
      featureBuilder.add(face.noSidewalkUserCount)
      featureBuilder.add(face.labelCount)
      featureBuilder.add(face.auditCount)
      featureBuilder.add(face.firstNoSidewalkLabelDate.map(_.toString).orNull)
      featureBuilder.add(face.lastNoSidewalkLabelDate.map(_.toString).orNull)
      featureBuilder.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  /**
   * Creates a shapefile from RegionDataForApi objects.
   *
   * Column names are kept to 10 characters because the DBF format cuts anything longer short (`streetCnt`,
   * `totalDistM`, `complRate`, …); the GeoJSON, CSV, and GeoPackage formats keep the full snake_case names.
   *
   * @param source Stream of RegionDataForApi objects
   * @param outputFile Base filename for the output file (without extension)
   * @param batchSize Number of features to process in each batch
   * @return Path to the created shapefile, or None if creation failed
   */
  def createRegionDataShapefile(
      source: Source[RegionDataForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    // Define the feature type schema for RegionDataForApi.
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "Region",
      "the_geom:MultiPolygon:srid=4326," // the geometry attribute: MultiPolygon type
      + "regionId:Integer,"              // Region ID
      + "name:String,"                   // Region name
      + "labelCount:Integer,"            // Number of labels in this region
      + "streetCnt:Integer,"             // Number of streets in this region
      + "userCount:Integer,"             // Number of unique users who labeled in this region
      + "auditCount:Integer,"            // Number of completed audits in this region
      + "totalDistM:Double,"             // Total street distance in this region, meters
      + "audDistM:Double,"               // Distance audited with current imagery in this region, meters
      + "outdDistM:Double,"              // Distance needing re-audit (all audits predate newer imagery), meters
      + "complRate:Double,"              // Fraction of street distance audited with current imagery (0.0–1.0)
      + "firstLabel:String,"             // First label date
      + "lastLabel:String"               // Last label date
    )

    def buildFeature(region: RegionDataForApi, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      featureBuilder.add(region.geometry)
      featureBuilder.add(region.regionId)
      featureBuilder.add(region.name)
      featureBuilder.add(region.labelCount)
      featureBuilder.add(region.streetCount)
      featureBuilder.add(region.userCount)
      featureBuilder.add(region.auditCount)
      featureBuilder.add(region.totalDistanceM)
      featureBuilder.add(region.auditedDistanceM)
      featureBuilder.add(region.outdatedDistanceM)
      featureBuilder.add(region.completionRate)
      featureBuilder.add(region.firstLabelDate.map(_.toString).orNull)
      featureBuilder.add(region.lastLabelDate.map(_.toString).orNull)
      featureBuilder.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  /**
   * Creates a shapefile from StreetAccessScoreForApi objects (v3, #3855).
   *
   * The per-label-type columns use short codes because the DBF format truncates column names at 10 characters:
   * cluster count `n<code>`, sub-score `s<code>`, cluster count per rating bucket `n1<code>`..`n3<code>` plus
   * `n0<code>` for unrated clusters, and tag adjustment `t<code>`. GeoJSON/CSV/GeoPackage keep the full snake_case names.
   */
  def createStreetAccessScoreShapefile(
      source: Source[StreetAccessScoreForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    val perTypeSpec: String = AccessScoreApiModels.orderedTypes
      .map { t =>
        val c = AccessScoreApiModels.shapefileTypeCode(t); s"n$c:Integer,s$c:Double"
      }
      .mkString(",")
    val perBucketSpec: String = AccessScoreApiModels.typeBucketColumns
      .map { case (t, b) =>
        s"${AccessScoreApiModels.shapefileBucketPrefix(b)}${AccessScoreApiModels.shapefileTypeCode(t)}:Integer"
      }
      .mkString(",")
    val perTagSpec: String = AccessScoreApiModels.orderedTypes
      .map { t => s"t${AccessScoreApiModels.shapefileTypeCode(t)}:Double" }
      .mkString(",")
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "AccessScoreStreet",
      "the_geom:LineString:srid=4326," // LineString geometry
      + "streetId:Integer,"            // Street edge ID
      + "osmWayId:String,"             // OSM way ID as String (shapefiles don't handle Long well)
      + "streetName:String,"           // The OSM way's name tag (null if unnamed); 10 chars, the DBF ceiling
      + "regionId:Integer,"            // Region ID
      + "score:Double,"                // Headline score: mean of the segment and its end intersections (null if none)
      + "segScore:Double,"             // The segment's own score (null if unaudited)
      + "sIntId:Integer,"              // Start intersection ID (null if none)
      + "eIntId:Integer,"              // End intersection ID (null if none)
      + "sIntScore:Double,"            // Start intersection's score (null if unscored)
      + "eIntScore:Double,"            // End intersection's score (null if unscored)
      + "auditCount:Integer,"          // Number of completed audits
      + "lengthM:Double,"              // Street length in meters
      + "labelCount:Integer,"          // Number of labels contributing to the score
      + perTypeSpec + ","              // Per-type cluster count (n<code>) and sub-score (s<code>)
      + perBucketSpec + ","            // Per-type cluster count per rating bucket (n1..n3<code>, n0<code> unrated)
      + perTagSpec                     // Per-type summed tag adjustment (t<code>)
    )

    def buildFeature(s: StreetAccessScoreForApi, fb: SimpleFeatureBuilder): SimpleFeature = {
      fb.add(s.geometry)
      fb.add(s.streetEdgeId)
      fb.add(s.osmWayId.toString)
      fb.add(s.streetName.orNull)
      fb.add(s.regionId)
      fb.add(s.score.map(Double.box).orNull)
      fb.add(s.segmentScore.map(Double.box).orNull)
      fb.add(s.startIntersectionId.map(Integer.valueOf).orNull)
      fb.add(s.endIntersectionId.map(Integer.valueOf).orNull)
      fb.add(s.startIntersectionScore.map(Double.box).orNull)
      fb.add(s.endIntersectionScore.map(Double.box).orNull)
      fb.add(s.auditCount)
      fb.add(s.lengthMeters)
      fb.add(s.labelCount)
      AccessScoreApiModels.orderedTypes.foreach { t =>
        fb.add(s.clusterCounts.getOrElse(t, 0))
        fb.add(s.subScores.getOrElse(t, 0.0))
      }
      AccessScoreApiModels.typeBucketColumns.foreach { case (t, b) =>
        fb.add(s.severityCounts.getOrElse(t, Map.empty[String, Int]).getOrElse(b, 0))
      }
      AccessScoreApiModels.orderedTypes.foreach { t => fb.add(s.tagAdjustments.getOrElse(t, 0.0)) }
      fb.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  /** Creates a shapefile from RegionAccessScoreForApi objects (v3, #3855). Per-type avg-count columns use short codes. */
  def createRegionAccessScoreShapefile(
      source: Source[RegionAccessScoreForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    val perTypeSpec: String = AccessScoreApiModels.orderedTypes
      .map { t => s"a${AccessScoreApiModels.shapefileTypeCode(t)}:Double" }
      .mkString(",")
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "AccessScoreRegion",
      "the_geom:MultiPolygon:srid=4326," // MultiPolygon geometry
      + "regionId:Integer,"              // Region ID
      + "name:String,"                   // Region name
      + "score:Double,"                  // Length-weighted region score (null if no audited streets)
      + "coverage:Double,"               // Fraction of streets audited
      + "audited:Integer,"               // Audited street count
      + "total:Integer,"                 // Total street count
      + "intScore:Double,"               // Mean score of the region's scored intersections (null if none)
      + "intCount:Integer,"              // Intersections in the region (grade-separated crossings excluded)
      + "scIntCount:Integer,"            // How many of them are scored
      + perTypeSpec                      // Per-type mean cluster count (a<code>)
    )

    def buildFeature(r: RegionAccessScoreForApi, fb: SimpleFeatureBuilder): SimpleFeature = {
      fb.add(r.geometry)
      fb.add(r.regionId)
      fb.add(r.name)
      fb.add(r.score.map(Double.box).orNull)
      fb.add(r.coverage)
      fb.add(r.auditedStreetCount)
      fb.add(r.totalStreetCount)
      fb.add(r.intersectionScore.map(Double.box).orNull)
      fb.add(r.intersectionCount)
      fb.add(r.scoredIntersectionCount)
      AccessScoreApiModels.orderedTypes.foreach { t => fb.add(r.avgClusterCounts.getOrElse(t, 0.0)) }
      fb.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  /**
   * Creates a shapefile from IntersectionAccessScoreForApi objects (v3, #5095). Per-type columns use the same short
   * codes as the street shapefile, over the intersection types only.
   */
  def createIntersectionAccessScoreShapefile(
      source: Source[IntersectionAccessScoreForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    val types: Seq[String]  = AccessScoreApiModels.orderedIntersectionTypes
    val perTypeSpec: String = types
      .map { t =>
        val c = AccessScoreApiModels.shapefileTypeCode(t); s"n$c:Integer,s$c:Double"
      }
      .mkString(",")
    val perBucketSpec: String = AccessScoreApiModels.intersectionTypeBucketColumns
      .map { case (t, b) =>
        s"${AccessScoreApiModels.shapefileBucketPrefix(b)}${AccessScoreApiModels.shapefileTypeCode(t)}:Integer"
      }
      .mkString(",")
    val perTagSpec: String = types.map { t => s"t${AccessScoreApiModels.shapefileTypeCode(t)}:Double" }.mkString(",")
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "AccessScoreIntersection",
      "the_geom:Point:srid=4326," // Point geometry
      + "intersecId:Integer,"     // Intersection ID
      + "regionId:Integer,"       // Region ID (null if none)
      + "degree:Integer,"         // Streets meeting here
      + "gradeSep:String,"        // "true" for a bridge/tunnel crossing, never scored
      + "streetIds:String,"       // Comma-separated street edge IDs
      + "auditCount:Integer,"     // Completed audits summed over those streets
      + "score:Double,"           // Access score (null if unscored)
      + "labelCount:Integer,"     // Number of labels contributing to the score
      + perTypeSpec + ","         // Per-type cluster count (n<code>) and sub-score (s<code>)
      + perBucketSpec + ","       // Per-type cluster count per rating bucket
      + perTagSpec                // Per-type summed tag adjustment (t<code>)
    )

    def buildFeature(i: IntersectionAccessScoreForApi, fb: SimpleFeatureBuilder): SimpleFeature = {
      fb.add(i.geometry)
      fb.add(i.intersectionId)
      fb.add(i.regionId.map(Integer.valueOf).orNull)
      fb.add(i.degree)
      fb.add(i.gradeSeparated.toString)
      fb.add(i.streetEdgeIds.mkString(","))
      fb.add(i.auditCount)
      fb.add(i.score.map(Double.box).orNull)
      fb.add(i.labelCount)
      types.foreach { t =>
        fb.add(i.clusterCounts.getOrElse(t, 0))
        fb.add(i.subScores.getOrElse(t, 0.0))
      }
      AccessScoreApiModels.intersectionTypeBucketColumns.foreach { case (t, b) =>
        fb.add(i.severityCounts.getOrElse(t, Map.empty[String, Int]).getOrElse(b, 0))
      }
      types.foreach { t => fb.add(i.tagAdjustments.getOrElse(t, 0.0)) }
      fb.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }
}
