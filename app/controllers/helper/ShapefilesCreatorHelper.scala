package controllers.helper

import models.api.{AccessScoreApiModels, LabelClusterForApi, LabelDataForApi, RawLabelInClusterDataForApi, RegionAccessScoreForApi, RegionDataForApi, StreetAccessScoreForApi, StreetDataForApi}
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Source, StreamConverters}
import org.apache.pekko.util.ByteString
import org.geotools.data.shapefile.ShapefileDataStoreFactory
import org.geotools.data.simple._
import org.geotools.data.{DataStore, DataStoreFinder, DataUtilities, DefaultTransaction}
import org.geotools.feature.simple.SimpleFeatureBuilder
import org.geotools.geometry.jts.JTSFactoryFinder
import org.geotools.geopkg.GeoPkgDataStoreFactory
import org.locationtech.jts.geom.{Coordinate, GeometryFactory}
import org.opengis.feature.simple.{SimpleFeature, SimpleFeatureType}
import play.api.i18n.Lang.logger
import play.api.libs.json.JsResult.Exception
import play.api.libs.json.Json

import java.io.{BufferedInputStream, File}
import java.nio.file.{Files, Path}
import java.util.zip.{ZipEntry, ZipOutputStream}
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters.MapHasAsJava

/**
 * This class handles the creation of Shapefile archives to be used by the ApiController.
 *
 * Code was started and modified from the Geotools feature tutorial:
 * https://docs.geotools.org/stable/tutorials/feature/csv2shp.html
 */
@Singleton
class ShapefilesCreatorHelper @Inject() ()(implicit ec: ExecutionContext, mat: Materializer) {

  /**
   * Writes a batch of features to a feature store inside a transaction.
   *
   * @param featureStore The feature store to write to.
   * @param features The list of features to write.
   * @param rethrow If true, rethrows exceptions after rollback. If false, logs and swallows them.
   */
  private def writeFeatureBatch(
      featureStore: SimpleFeatureStore,
      features: java.util.ArrayList[SimpleFeature],
      rethrow: Boolean = false
  ): Unit = {
    val transaction = new DefaultTransaction("create")
    try {
      featureStore.setTransaction(transaction)
      featureStore.addFeatures(DataUtilities.collection(features))
      transaction.commit()
    } catch {
      case e: Exception =>
        transaction.rollback()
        if (rethrow) throw e
        else logger.error(s"Error writing features: ${e.getMessage}", e)
    } finally {
      transaction.close()
    }
  }

  /**
   * Creates a geopackage from the given source, saving it as outputFile.
   *
   * @param source A data stream holding the data to be saved in the shapefile.
   * @param outputFile The output filename (with no extension).
   * @param batchSize The number of features from the data stream to process at a time.
   * @param featureType SimpleFeatureType definition with the schema for the given data type.
   * @param buildFeature A function that takes a data point and a SimpleFeatureBuilder and returns a SimpleFeature.
   * @tparam A The type of data in the source.
   */
  private def createGeneralGeoPackage[A](
      source: Source[A, _],
      outputFile: String,
      batchSize: Int,
      featureType: SimpleFeatureType,
      buildFeature: (A, SimpleFeatureBuilder) => SimpleFeature
  ): Future[Option[Path]] = {
    val geopackagePath: Path = new File(outputFile + ".gpkg").toPath

    try {
      // Set up everything we need to create and store features before saving them.
      val params = Map(
        GeoPkgDataStoreFactory.DBTYPE.key   -> "geopkg",
        GeoPkgDataStoreFactory.DATABASE.key -> geopackagePath.toFile
      ).asJava
      val dataStore: DataStore = DataStoreFinder.getDataStore(params)

      // Create the schema in the GeoPackage.
      dataStore.createSchema(featureType)

      // Get feature store for writing.
      val typeName       = dataStore.getTypeNames()(0)
      val featureSource  = dataStore.getFeatureSource(typeName)
      val featureStore   = featureSource.asInstanceOf[SimpleFeatureStore]
      val featureBuilder = new SimpleFeatureBuilder(featureType)
      val features       = new java.util.ArrayList[SimpleFeature](batchSize)

      // Process data in batches.
      source
        .grouped(batchSize)
        .runForeach { batch =>
          // Create a feature from each data point in this batch and add it to the ArrayList.
          features.clear()
          batch.foreach { x =>
            featureBuilder.reset()
            val feature: SimpleFeature = buildFeature(x, featureBuilder)
            features.add(feature)
          }

          writeFeatureBatch(featureStore, features)
        }
        .map { _ =>
          // Return the file path for the GeoPackage.
          dataStore.dispose()
          Some(geopackagePath)
        }
        .recover { case e: Exception =>
          dataStore.dispose()
          logger.error(s"Error creating GeoPackage: ${e.getMessage}", e)
          None
        }
    } catch {
      case e: Exception =>
        logger.error(s"Error setting up GeoPackage: ${e.getMessage}", e)
        Future.successful(None)
    }
  }

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
    val shapefilePath: Path = new File(outputFile + ".shp").toPath

    try {
      // Set up everything we need to create and store features.
      val dataStoreFactory = new ShapefileDataStoreFactory()
      val newDataStore     = dataStoreFactory.createNewDataStore(
        Map(
          "url"                  -> shapefilePath.toUri.toURL,
          "create spatial index" -> java.lang.Boolean.FALSE // Disable so we don't run out of memory.
        ).asJava
      )

      newDataStore.createSchema(featureType)

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
          writeFeatureBatch(featureStore, features, rethrow = true)
        }
        .map { _ =>
          // Output the file path for the shapefile.
          newDataStore.dispose()
          Some(shapefilePath)
        }
        .recover { case e: Exception =>
          newDataStore.dispose()
          logger.error(s"Error creating shapefile: ${e.getMessage}", e)
          None
        }
    } catch {
      case e: Exception =>
        logger.error(s"Error setting up shapefile: ${e.getMessage}", e)
        Future.successful(None)
    }
  }

  /**
   * Creates a zip archive from the given shapefiles, saving it at s"$baseFileName.zip".
   *
   * @param files A sequence of Paths to the shapefiles to be zipped
   * @param baseFileName The base filename for the zip archive (without extension)
   */
  def zipShapefile(files: Seq[Path], baseFileName: String): Source[ByteString, Future[Boolean]] = {
    val zipPath = new File(s"$baseFileName.zip").toPath
    val zipOut  = new ZipOutputStream(Files.newOutputStream(zipPath))

    // For each shapefile, add all component files to the zip archive.
    files.foreach { f =>
      val shapefile = f.toFile
      val directory = shapefile.getParentFile
      val basename  = shapefile.getName.substring(0, shapefile.getName.length - 4)

      // Find all shapefile component files.
      val extensions = Seq(".shp", ".dbf", ".shx", ".prj", ".sbn", ".sbx", ".cpg", ".fix")
      extensions.foreach { ext =>
        val file = new File(directory, basename + ext)
        if (file.exists()) {
          zipOut.putNextEntry(new ZipEntry(file.getName))
          Files.copy(file.toPath, zipOut)
          zipOut.closeEntry()
          file.delete()
        }
      }
    }
    zipOut.close()

    // Set up a stream of the zip archive as a ByteString, setting it up to be deleted afterward.
    StreamConverters
      .fromInputStream(() => new BufferedInputStream(Files.newInputStream(zipPath)))
      .mapMaterializedValue(_.map { _ => Files.deleteIfExists(zipPath) })
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
    // Define the feature type schema for LabelDataForApi.
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "Location",
      "the_geom:Point:srid=4326," // The geometry attribute: Point type
      + "labelId:Integer,"        // Label ID
      + "userId:String,"          // User ID
      + "panoId:String,"          // Pano ID
      + "labelType:String,"       // Label type
      + "severity:Integer,"       // Severity
      + "tags:String,"            // Tags list
      + "descriptn:String,"       // Description
      + "labelTime:String,"       // Creation timestamp
      + "streetId:Integer,"       // Street edge ID
      + "osmWayId:String,"        // OSM street ID
      + "regionId:Integer,"       // Region (neighborhood) ID
      + "regionName:String,"      // Region (neighborhood) name
      + "correct:String,"         // Validation correctness
      + "nAgree:Integer,"         // Agree validations count
      + "nDisagree:Integer,"      // Disagree validations count
      + "nUnsure:Integer,"        // Unsure validations count
      + "validatns:String,"       // Validation details
      + "taskId:Integer,"         // Audit task ID
      + "missionId:Integer,"      // Mission ID
      + "imageDate:String,"       // Image capture date
      + "pov:String,"             // { heading: Double, pitch: Double, zoom: Double }
      + "canvasX:Integer,"        // Canvas X position
      + "canvasY:Integer,"        // Canvas Y position
      + "canvasWdth:Integer,"     // Canvas width
      + "canvasHght:Integer,"     // Canvas height
      + "panoX:Integer,"          // Panorama X position
      + "panoY:Integer,"          // Panorama Y position
      + "panoWidth:Integer,"      // Panorama width
      + "panoHeight:Integer,"     // Panorama height
      + "cameraHdng:Double,"      // Camera heading
      + "cameraPtch:Double,"      // Camera pitch
      + "cameraRoll:Double,"      // Camera roll
      + "panoUrl:String"          // Provider viewer URL (empty for providers without one)
    )

    val geometryFactory: GeometryFactory = JTSFactoryFinder.getGeometryFactory

    def buildFeature(label: LabelDataForApi, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      // Add the geometry (Point)
      featureBuilder.add(geometryFactory.createPoint(new Coordinate(label.longitude, label.latitude)))

      // Add all attributes
      featureBuilder.add(label.labelId)
      featureBuilder.add(label.userId)
      featureBuilder.add(label.panoId)
      featureBuilder.add(label.labelType)
      featureBuilder.add(label.severity.orNull)
      featureBuilder.add(label.tags.mkString("[", ",", "]"))
      featureBuilder.add(label.description.orNull)
      featureBuilder.add(label.timeCreated)
      featureBuilder.add(label.streetEdgeId)
      featureBuilder.add(label.osmWayId.toString)
      featureBuilder.add(label.regionId)
      featureBuilder.add(label.regionName)
      featureBuilder.add(label.correct.map(_.toString).orNull)
      featureBuilder.add(label.agreeCount)
      featureBuilder.add(label.disagreeCount)
      featureBuilder.add(label.unsureCount)

      // Format validations as a JSON-like string.
      val validationsStr =
        label.validations.map(v => s"""{"user_id":"${v.userId}","validation":"${v.validationType}"}""").mkString(",")
      featureBuilder.add(s"[$validationsStr]")

      featureBuilder.add(label.auditTaskId.orNull)
      featureBuilder.add(label.missionId.orNull)
      featureBuilder.add(label.imageCaptureDate.orNull)

      // Combine heading/pitch/zoom into a single field so that we don't hit max number of fields.
      val povString: Option[String] = (label.heading, label.pitch, label.zoom) match {
        case (Some(heading), Some(pitch), Some(zoom)) => Some(s"""{"heading":$heading,"pitch":$pitch,"zoom":$zoom""")
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
      + "severity:Integer,"       // Severity
      + "timeCreate:String,"      // Creation timestamp
      + "correct:String,"         // Validation correctness
      + "imageDate:String"        // Image capture date
    )

    val clusterShapefilePath: Path = new File(outputFile + ".shp").toPath
    val labelShapefilePath: Path   = new File(outputFile + "_labels.shp").toPath
    val geometryFactory            = JTSFactoryFinder.getGeometryFactory

    try {
      // Set up clusters shapefile.
      val clusterDataStoreFactory = new ShapefileDataStoreFactory()
      val clusterDataStore        = clusterDataStoreFactory.createNewDataStore(
        Map("url" -> clusterShapefilePath.toUri.toURL, "create spatial index" -> java.lang.Boolean.FALSE).asJava
      )
      clusterDataStore.createSchema(clusterShapefileFeatureType)
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
          writeFeatureBatch(clusterStore, clusterFeatures, rethrow = true)
        }
        .map { _ =>
          clusterDataStore.dispose()

          // Write the raw labels shapefile if any labels were collected.
          if (hasRawLabels && !allRawLabels.isEmpty) {
            val labelDataStoreFactory = new ShapefileDataStoreFactory()
            val labelDataStore        = labelDataStoreFactory.createNewDataStore(
              Map("url" -> labelShapefilePath.toUri.toURL, "create spatial index" -> java.lang.Boolean.FALSE).asJava
            )
            labelDataStore.createSchema(labelFeatureType)
            val labelStore =
              labelDataStore.getFeatureSource(labelDataStore.getTypeNames()(0)).asInstanceOf[SimpleFeatureStore]
            val labelBuilder  = new SimpleFeatureBuilder(labelFeatureType)
            val labelFeatures = new java.util.ArrayList[SimpleFeature](batchSize)

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
                labelBuilder.add(label.severity.map(Integer.valueOf).orNull)
                labelBuilder.add(label.timeCreated.toString)
                labelBuilder.add(label.correct.map(_.toString).orNull)
                labelBuilder.add(label.imageCaptureDate.orNull)
                labelFeatures.add(labelBuilder.buildFeature(null))
                count += 1
              }
              writeFeatureBatch(labelStore, labelFeatures, rethrow = true)
            }
            labelDataStore.dispose()
            Some(Seq(clusterShapefilePath, labelShapefilePath))
          } else {
            Some(Seq(clusterShapefilePath))
          }
        }
        .recover { case e: Exception =>
          clusterDataStore.dispose()
          logger.error(s"Error creating shapefile: ${e.getMessage}", e)
          None
        }
    } catch {
      case e: Exception =>
        logger.error(s"Error setting up shapefile: ${e.getMessage}", e)
        Future.successful(None)
    }
  }

  /**
   * Creates a GeoPackage file from LabelClusterForApi objects.
   *
   * @param source Stream of LabelClusterForApi objects
   * @param outputFile Base filename for the output file (without extension)
   * @param batchSize Number of features to process in each batch
   * @return Path to the created GeoPackage file, or None if creation failed
   */
  def createLabelClusterGeopackage(
      source: Source[LabelClusterForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    val clusterFeatureType: SimpleFeatureType = DataUtilities.createType(
      "label_clusters",
      "the_geom:Point:srid=4326,"  // the geometry attribute: Point type
      + "cluster_id:Integer,"      // Cluster ID
      + "label_type:String,"       // Label type
      + "street_edge_id:Integer,"  // Street edge ID
      + "osm_way_id:String,"       // OSM way ID (as String to avoid Long issues)
      + "region_id:Integer,"       // Region ID
      + "region_name:String,"      // Region name
      + "avg_image_date:String,"   // Average image capture date
      + "avg_label_date:String,"   // Average label date
      + "median_severity:Integer," // Median severity
      + "agree_count:Integer,"     // Agree count
      + "disagree_count:Integer,"  // Disagree count
      + "unsure_count:Integer,"    // Unsure count
      + "cluster_size:Integer,"    // Cluster size
      + "label_ids:String,"        // Label IDs as comma-separated list
      + "user_ids:String,"         // User IDs as JSON array string
      + "tag_counts:String"        // Tag counts as JSON object string
    )

    val labelFeatureType: SimpleFeatureType = DataUtilities.createType(
      "raw_labels",
      "the_geom:Point:srid=4326," // the geometry attribute: Point type
      + "label_id:Integer,"       // Label ID
      + "cluster_id:Integer,"     // Parent cluster ID
      + "user_id:String,"         // User ID
      + "pano_id:String,"         // Panorama ID
      + "severity:Integer,"       // Severity
      + "time_created:String,"    // Creation timestamp
      + "correct:String,"         // Validation correctness
      + "image_date:String"       // Image capture date
    )

    val geopackagePath: Path = new File(outputFile + ".gpkg").toPath

    try {
      val params = Map(
        GeoPkgDataStoreFactory.DBTYPE.key   -> "geopkg",
        GeoPkgDataStoreFactory.DATABASE.key -> geopackagePath.toFile
      ).asJava
      val dataStore: DataStore = DataStoreFinder.getDataStore(params)

      // Create both schemas.
      dataStore.createSchema(clusterFeatureType)

      val clusterTypeName = dataStore.getTypeNames()(0)
      val clusterStore    = dataStore.getFeatureSource(clusterTypeName).asInstanceOf[SimpleFeatureStore]
      val clusterBuilder  = new SimpleFeatureBuilder(clusterFeatureType)
      val clusterFeatures = new java.util.ArrayList[SimpleFeature](batchSize)

      // Collect raw labels to write as a second layer after the clusters.
      val allRawLabels    = new java.util.ArrayList[(Int, RawLabelInClusterDataForApi)]()
      val geometryFactory = JTSFactoryFinder.getGeometryFactory
      var hasRawLabels    = false

      source
        .grouped(batchSize)
        .runForeach { batch =>
          clusterFeatures.clear()
          batch.foreach { cluster =>
            clusterBuilder.reset()
            clusterBuilder.add(geometryFactory.createPoint(new Coordinate(cluster.avgLongitude, cluster.avgLatitude)))
            clusterBuilder.add(cluster.labelClusterId)
            clusterBuilder.add(cluster.labelType)
            clusterBuilder.add(cluster.streetEdgeId)
            clusterBuilder.add(cluster.osmWayId.toString)
            clusterBuilder.add(cluster.regionId)
            clusterBuilder.add(cluster.regionName)
            clusterBuilder.add(cluster.avgImageCaptureDate.orNull)
            clusterBuilder.add(cluster.avgLabelDate.orNull)
            clusterBuilder.add(cluster.medianSeverity.map(Integer.valueOf).orNull)
            clusterBuilder.add(cluster.agreeCount)
            clusterBuilder.add(cluster.disagreeCount)
            clusterBuilder.add(cluster.unsureCount)
            clusterBuilder.add(cluster.clusterSize)
            clusterBuilder.add(Json.stringify(Json.toJson(cluster.labelIds)))
            clusterBuilder.add(Json.stringify(Json.toJson(cluster.userIds)))
            clusterBuilder.add(Json.stringify(Json.toJson(cluster.tagCounts)))
            clusterFeatures.add(clusterBuilder.buildFeature(null))

            // Collect raw labels for the second layer.
            cluster.labels.foreach { labelsList =>
              hasRawLabels = true
              labelsList.foreach(label => allRawLabels.add((cluster.labelClusterId, label)))
            }
          }

          writeFeatureBatch(clusterStore, clusterFeatures)
        }
        .flatMap { _ =>
          // Write the raw labels layer if the raw labels were included.
          if (hasRawLabels && !allRawLabels.isEmpty) {
            dataStore.createSchema(labelFeatureType)
            val labelTypeName = "raw_labels"
            val labelStore    = dataStore.getFeatureSource(labelTypeName).asInstanceOf[SimpleFeatureStore]
            val labelBuilder  = new SimpleFeatureBuilder(labelFeatureType)
            val labelFeatures = new java.util.ArrayList[SimpleFeature](batchSize)

            // Write raw labels in batches.
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
                labelBuilder.add(label.severity.map(Integer.valueOf).orNull)
                labelBuilder.add(label.timeCreated.toString)
                labelBuilder.add(label.correct.map(_.toString).orNull)
                labelBuilder.add(label.imageCaptureDate.orNull)
                labelFeatures.add(labelBuilder.buildFeature(null))
                count += 1
              }

              writeFeatureBatch(labelStore, labelFeatures)
            }
          }

          dataStore.dispose()
          Future.successful(Some(geopackagePath))
        }
        .recover { case e: Exception =>
          dataStore.dispose()
          logger.error(s"Error creating GeoPackage: ${e.getMessage}", e)
          None
        }
    } catch {
      case e: Exception =>
        logger.error(s"Error setting up GeoPackage: ${e.getMessage}", e)
        Future.successful(None)
    }
  }

  /**
   * Creates a GeoPackage file from LabelDataForApi objects.
   *
   * @param source Stream of LabelDataForApi objects
   * @param outputFile Base filename for the output file (without extension)
   * @param batchSize Number of features to process in each batch
   * @return Path to the created GeoPackage file, or None if creation failed
   */
  def createRawLabelDataGeopackage(
      source: Source[LabelDataForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    // Define the feature type schema.
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "labels",
      "the_geom:Point:srid=4326," // the geometry attribute: Point type
      + "label_id:Integer,"       // label ID
      + "user_id:String,"         // User Id
      + "gsv_pano_id:String,"     // Pano ID
      + "label_type:String,"      // Label type
      + "severity:Integer,"       // Severity
      + "tags:String,"            // Label Tags
      + "description:String,"     // Label Description
      + "time_created:String,"    // Creation timestamp
      + "street_edge_id:Integer," // Street edge ID
      + "osm_way_id:String,"      // OSM street ID
      + "region_id:Integer,"      // Region (neighborhood) ID
      + "region_name:String,"     // Region (neighborhood) name
      + "correct:String,"         // Validation correctness
      + "agree_count:Integer,"    // Agree validations
      + "disagree_count:Integer," // Disagree validations
      + "unsure_count:Integer,"   // Unsure validations
      + "validations:String,"     // Validation details
      + "audit_task_id:Integer,"  // Audit task ID
      + "mission_id:Integer,"     // Mission ID
      + "image_date:String,"      // Image capture date
      + "heading:Double,"         // Heading angle
      + "pitch:Double,"           // Pitch angle
      + "zoom:Integer,"           // Zoom level
      + "canvas_x:Integer,"       // Canvas X position
      + "canvas_y:Integer,"       // Canvas Y position
      + "canvas_width:Integer,"   // Canvas width
      + "canvas_height:Integer,"  // Canvas height
      + "pano_x:Integer,"         // Panorama X position
      + "pano_y:Integer,"         // Panorama Y position
      + "pano_width:Integer,"     // Panorama width
      + "pano_height:Integer,"    // Panorama height
      + "camera_heading:Double,"  // Camera heading
      + "camera_pitch:Double,"    // Camera pitch
      + "camera_roll:Double,"     // Camera pitch
      + "pano_url:String"         // Provider viewer URL (empty for providers without one)
    )

    val geometryFactory: GeometryFactory = JTSFactoryFinder.getGeometryFactory
    def buildFeature(label: LabelDataForApi, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      // Format validations as a JSON-like string.
      val validationsStr =
        label.validations.map(v => s"""{"user_id":"${v.userId}","validation":"${v.validationType}"}""").mkString(",")

      // Add the geometry and all attributes.
      featureBuilder.add(geometryFactory.createPoint(new Coordinate(label.longitude, label.latitude)))
      featureBuilder.add(label.labelId)
      featureBuilder.add(label.userId)
      featureBuilder.add(label.panoId)
      featureBuilder.add(label.labelType)
      featureBuilder.add(label.severity.map(Integer.valueOf).orNull)
      featureBuilder.add(label.tags.mkString("[", ",", "]"))
      featureBuilder.add(label.description.map(String.valueOf).orNull)
      featureBuilder.add(label.timeCreated)
      featureBuilder.add(label.streetEdgeId)
      featureBuilder.add(String.valueOf(label.osmWayId))
      featureBuilder.add(label.regionId)
      featureBuilder.add(label.regionName)
      featureBuilder.add(label.correct.map(_.toString).orNull)
      featureBuilder.add(label.agreeCount)
      featureBuilder.add(label.disagreeCount)
      featureBuilder.add(label.unsureCount)
      featureBuilder.add(s"[$validationsStr]")
      featureBuilder.add(label.auditTaskId.map(Integer.valueOf).orNull)
      featureBuilder.add(label.missionId.map(Integer.valueOf).orNull)
      featureBuilder.add(label.imageCaptureDate.orNull)
      featureBuilder.add(label.heading.orNull)
      featureBuilder.add(label.pitch.orNull)
      featureBuilder.add(label.zoom.orNull)
      featureBuilder.add(label.canvasX.map(Integer.valueOf).orNull)
      featureBuilder.add(label.canvasY.map(Integer.valueOf).orNull)
      featureBuilder.add(label.canvasWidth.map(Integer.valueOf).orNull)
      featureBuilder.add(label.canvasHeight.map(Integer.valueOf).orNull)
      featureBuilder.add(label.panoX.map(Integer.valueOf).orNull)
      featureBuilder.add(label.panoY.map(Integer.valueOf).orNull)
      featureBuilder.add(label.panoWidth.map(Integer.valueOf).orNull)
      featureBuilder.add(label.panoHeight.map(Integer.valueOf).orNull)
      featureBuilder.add(label.cameraHeading.orNull)
      featureBuilder.add(label.cameraPitch.orNull)
      featureBuilder.add(label.cameraRoll.orNull)
      featureBuilder.add(label.panoUrl.getOrElse(""))
      featureBuilder.buildFeature(null)
    }

    createGeneralGeoPackage(source, outputFile, batchSize, featureType, buildFeature)
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
      + "status:String,"               // Street availability: open, no_imagery, closed, or disabled
      + "labelCount:Integer,"          // Number of labels on this street
      + "auditCount:Integer,"          // Number of times audited
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
      featureBuilder.add(street.status)
      featureBuilder.add(street.labelCount)
      featureBuilder.add(street.auditCount)
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
   * Creates a GeoPackage file from StreetDataForApi objects.
   *
   * @param source Stream of StreetDataForApi objects
   * @param outputFile Base filename for the output file (without extension)
   * @param batchSize Number of features to process in each batch
   * @return Path to the created GeoPackage file, or None if creation failed
   */
  def createStreetDataGeopackage(
      source: Source[StreetDataForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    // Define the feature type schema.
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "streets",
      "the_geom:LineString:srid=4326," // LineString geometry
      + "street_id:Integer,"           // Street edge ID
      + "osm_way_id:String,"           // OSM street ID as String (GeoTools doesn't handle Long well)
      + "region_id:Integer,"           // Region ID
      + "region_name:String,"          // Region name
      + "way_type:String,"         // Type of street/way. Using String instead of Long to avoid type resolution issues.
      + "status:String,"           // Street availability: open, no_imagery, closed, or disabled
      + "label_count:Integer,"     // Number of labels on this street
      + "audit_count:Integer,"     // Number of times audited
      + "user_count:Integer,"      // Number of unique users
      + "user_ids:String,"         // List of user IDs as a string
      + "first_label_time:String," // First label date
      + "last_label_time:String"   // Last label date
    )

    def buildFeature(street: StreetDataForApi, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      // Format user IDs as a JSON array string, handling potential null values.
      val userIdsStr = street.userIds.map(id => if (id == null) "null" else s""""$id"""").mkString(",")

      // Add the geometry (LineString) - already in JTS format.
      featureBuilder.add(street.geometry)

      // Add all attributes.
      featureBuilder.add(street.streetEdgeId)
      featureBuilder.add(street.osmWayId.toString) // Convert Long to String
      featureBuilder.add(street.regionId)
      featureBuilder.add(street.regionName)
      featureBuilder.add(street.wayType)
      featureBuilder.add(street.status)
      featureBuilder.add(street.labelCount)
      featureBuilder.add(street.auditCount)
      featureBuilder.add(street.userIds.size)
      featureBuilder.add(s"[$userIdsStr]")
      featureBuilder.add(street.firstLabelDate.map(_.toString).orNull)
      featureBuilder.add(street.lastLabelDate.map(_.toString).orNull)

      featureBuilder.buildFeature(null)
    }

    createGeneralGeoPackage(source, outputFile, batchSize, featureType, buildFeature)
  }

  /**
   * Creates a shapefile from RegionDataForApi objects.
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
      + "streetCount:Integer,"           // Number of streets in this region
      + "userCount:Integer,"             // Number of unique users who labeled in this region
      + "auditCount:Integer,"            // Number of completed audits in this region
      + "totalDistM:Double,"             // Total street distance in this region, meters (DBF caps names at 10 chars)
      + "audDistM:Double,"               // Audited street distance in this region, meters
      + "complRate:Double,"              // Fraction of street distance audited (0.0–1.0)
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
      featureBuilder.add(region.completionRate)
      featureBuilder.add(region.firstLabelDate.map(_.toString).orNull)
      featureBuilder.add(region.lastLabelDate.map(_.toString).orNull)
      featureBuilder.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  /**
   * Creates a GeoPackage file from RegionDataForApi objects.
   *
   * @param source Stream of RegionDataForApi objects
   * @param outputFile Base filename for the output file (without extension)
   * @param batchSize Number of features to process in each batch
   * @return Path to the created GeoPackage file, or None if creation failed
   */
  def createRegionDataGeopackage(
      source: Source[RegionDataForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    // Define the feature type schema.
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "regions",
      "the_geom:MultiPolygon:srid=4326," // MultiPolygon geometry
      + "region_id:Integer,"             // Region ID
      + "name:String,"                   // Region name
      + "label_count:Integer,"           // Number of labels in this region
      + "street_count:Integer,"          // Number of streets in this region
      + "user_count:Integer,"            // Number of unique users who labeled in this region
      + "audit_count:Integer,"           // Number of completed audits in this region
      + "total_distance_m:Double,"       // Total street distance in this region, meters
      + "audited_distance_m:Double,"     // Audited street distance in this region, meters
      + "completion_rate:Double,"        // Fraction of street distance audited (0.0–1.0)
      + "first_label_time:String,"       // First label date
      + "last_label_time:String"         // Last label date
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
      featureBuilder.add(region.completionRate)
      featureBuilder.add(region.firstLabelDate.map(_.toString).orNull)
      featureBuilder.add(region.lastLabelDate.map(_.toString).orNull)
      featureBuilder.buildFeature(null)
    }

    createGeneralGeoPackage(source, outputFile, batchSize, featureType, buildFeature)
  }

  /**
   * Creates a shapefile from StreetAccessScoreForApi objects (v3, #3855).
   *
   * The per-label-type count/sub-score columns use short codes (e.g. nCRamp, sCRamp) because the DBF format truncates
   * column names at 10 characters; GeoJSON/CSV/GeoPackage keep the full snake_case names.
   */
  def createStreetAccessScoreShapefile(
      source: Source[StreetAccessScoreForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    val perTypeSpec: String = AccessScoreApiModels.orderedTypes
      .map { t => val c = AccessScoreApiModels.shapefileTypeCode(t); s"n$c:Integer,s$c:Double" }
      .mkString(",")
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "AccessScoreStreet",
      "the_geom:LineString:srid=4326," // LineString geometry
      + "streetId:Integer,"            // Street edge ID
      + "osmWayId:String,"             // OSM way ID as String (shapefiles don't handle Long well)
      + "regionId:Integer,"            // Region ID
      + "score:Double,"                // Access score (null if unaudited)
      + "auditCount:Integer,"          // Number of completed audits
      + "lengthM:Double,"              // Street length in meters
      + "labelCount:Integer,"          // Number of labels contributing to the score
      + perTypeSpec                    // Per-type cluster count (n<code>) and sub-score (s<code>)
    )

    def buildFeature(s: StreetAccessScoreForApi, fb: SimpleFeatureBuilder): SimpleFeature = {
      fb.add(s.geometry)
      fb.add(s.streetEdgeId)
      fb.add(s.osmWayId.toString)
      fb.add(s.regionId)
      fb.add(s.score.map(Double.box).orNull)
      fb.add(s.auditCount)
      fb.add(s.lengthMeters)
      fb.add(s.labelCount)
      AccessScoreApiModels.orderedTypes.foreach { t =>
        fb.add(s.clusterCounts.getOrElse(t, 0))
        fb.add(s.subScores.getOrElse(t, 0.0))
      }
      fb.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  /** Creates a GeoPackage from StreetAccessScoreForApi objects (v3, #3855). Full snake_case column names (no 10-char limit). */
  def createStreetAccessScoreGeopackage(
      source: Source[StreetAccessScoreForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    val perTypeSpec: String = AccessScoreApiModels.orderedTypes
      .flatMap { t => val n = AccessScoreApiModels.snakeType(t); Seq(s"n_$n:Integer", s"score_$n:Double") }
      .mkString(",")
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "access_score_streets",
      "the_geom:LineString:srid=4326,street_id:Integer,osm_way_id:String,region_id:Integer,score:Double," +
        "audit_count:Integer,length_meters:Double,label_count:Integer," + perTypeSpec
    )

    def buildFeature(s: StreetAccessScoreForApi, fb: SimpleFeatureBuilder): SimpleFeature = {
      fb.add(s.geometry)
      fb.add(s.streetEdgeId)
      fb.add(s.osmWayId.toString)
      fb.add(s.regionId)
      fb.add(s.score.map(Double.box).orNull)
      fb.add(s.auditCount)
      fb.add(s.lengthMeters)
      fb.add(s.labelCount)
      AccessScoreApiModels.orderedTypes.foreach { t =>
        fb.add(s.clusterCounts.getOrElse(t, 0))
        fb.add(s.subScores.getOrElse(t, 0.0))
      }
      fb.buildFeature(null)
    }

    createGeneralGeoPackage(source, outputFile, batchSize, featureType, buildFeature)
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
      AccessScoreApiModels.orderedTypes.foreach { t => fb.add(r.avgClusterCounts.getOrElse(t, 0.0)) }
      fb.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  /** Creates a GeoPackage from RegionAccessScoreForApi objects (v3, #3855). Full snake_case column names. */
  def createRegionAccessScoreGeopackage(
      source: Source[RegionAccessScoreForApi, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    val perTypeSpec: String = AccessScoreApiModels.orderedTypes
      .map { t => s"avg_n_${AccessScoreApiModels.snakeType(t)}:Double" }
      .mkString(",")
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "access_score_regions",
      "the_geom:MultiPolygon:srid=4326,region_id:Integer,name:String,score:Double,coverage:Double," +
        "audited_street_count:Integer,total_street_count:Integer," + perTypeSpec
    )

    def buildFeature(r: RegionAccessScoreForApi, fb: SimpleFeatureBuilder): SimpleFeature = {
      fb.add(r.geometry)
      fb.add(r.regionId)
      fb.add(r.name)
      fb.add(r.score.map(Double.box).orNull)
      fb.add(r.coverage)
      fb.add(r.auditedStreetCount)
      fb.add(r.totalStreetCount)
      AccessScoreApiModels.orderedTypes.foreach { t => fb.add(r.avgClusterCounts.getOrElse(t, 0.0)) }
      fb.buildFeature(null)
    }

    createGeneralGeoPackage(source, outputFile, batchSize, featureType, buildFeature)
  }
}
