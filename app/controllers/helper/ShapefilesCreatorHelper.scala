package controllers.helper

import models.api.{LabelClusterForApi, LabelDataForApi, RawLabelInClusterDataForApi, StreetDataForApi}
import models.computation.{RegionScore, StreetScore}
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
      + "neighborhd:String,"      // Neighborhood name
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
      + "imageUrl:String"         // Pano URL
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
      featureBuilder.add(label.neighborhood)
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
      featureBuilder.add(label.imageUrl)

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
      + "neighborhood:String,"    // Neighborhood name
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
      + "image_url:String"        // Pano URL
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
      featureBuilder.add(label.neighborhood)
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
      featureBuilder.add(label.imageUrl)
      featureBuilder.buildFeature(null)
    }

    createGeneralGeoPackage(source, outputFile, batchSize, featureType, buildFeature)
  }

  def createStreetShapefile(
      source: Source[StreetScore, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    // We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "Location",
      "the_geom:LineString:srid=4326," // the geometry attribute: Line type
      + "streetId:Integer,"            // StreetId
      + "osmWayId:String,"             // osmWayId
      + "nghborhdId:String,"           // Region ID
      + "score:Double,"                // street score
      + "auditCount:Integer,"          // boolean representing whether the street is audited
      + "sigRamp:Double,"              // curb ramp significance weight
      + "sigNoRamp:Double,"            // no Curb ramp significance weight
      + "sigObs:Double,"               // obstacle significance weight
      + "sigSurfce:Double,"            // Surface problem significance weight
      + "nRamp:Integer,"               // curb ramp count, averaged across streets
      + "nNoRamp:Integer,"             // no Curb ramp count, averaged across streets
      + "nObs:Integer,"                // obstacle count, averaged across streets
      + "nSurfce:Integer,"             // Surface problem count, averaged across streets
      + "avgImgDate:String,"           // average image age in milliseconds
      + "avgLblDate:String"            // average label age in milliseconds
    )

    def buildFeature(s: StreetScore, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      featureBuilder.add(s.streetEdge.geom)
      featureBuilder.add(s.streetEdge.streetEdgeId)
      featureBuilder.add(String.valueOf(s.osmId))
      featureBuilder.add(s.regionId)
      featureBuilder.add(s.score)
      featureBuilder.add(s.auditCount)
      featureBuilder.add(s.significance(0))
      featureBuilder.add(s.significance(1))
      featureBuilder.add(s.significance(2))
      featureBuilder.add(s.significance(3))
      featureBuilder.add(s.clusters(0))
      featureBuilder.add(s.clusters(1))
      featureBuilder.add(s.clusters(2))
      featureBuilder.add(s.clusters(3))
      featureBuilder.add(s.avgImageCaptureDate.map(String.valueOf).orNull)
      featureBuilder.add(s.avgLabelDate.map(String.valueOf).orNull)
      featureBuilder.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  def createRegionShapefile(
      source: Source[RegionScore, _],
      outputFile: String,
      batchSize: Int
  ): Future[Option[Path]] = {
    // We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "Location",
      "the_geom:Polygon:srid=4326," // line geometry
      + "neighborhd:String,"        // Neighborhood Name
      + "nghborhdId:Integer,"       // Neighborhood Id
      + "coverage:Double,"          // coverage score
      + "score:Double,"             // obstacle score
      + "sigRamp:Double,"           // curb ramp significance weight
      + "sigNoRamp:Double,"         // no Curb ramp significance weight
      + "sigObs:Double,"            // obstacle significance weight
      + "sigSurfce:Double,"         // Surface problem significance weight
      + "nRamp:Double,"             // curb ramp count
      + "nNoRamp:Double,"           // no Curb ramp count
      + "nObs:Double,"              // obstacle count
      + "nSurfce:Double,"           // Surface problem count
      + "avgImgDate:String,"        // average image age in milliseconds
      + "avgLblDate:String"         // average label age in milliseconds
    )

    def buildFeature(n: RegionScore, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      featureBuilder.add(n.geom)
      featureBuilder.add(n.name)
      featureBuilder.add(n.regionId)
      featureBuilder.add(n.coverage)
      featureBuilder.add(n.score)
      featureBuilder.add(n.significanceScores(0))
      featureBuilder.add(n.significanceScores(1))
      featureBuilder.add(n.significanceScores(2))
      featureBuilder.add(n.significanceScores(3))
      featureBuilder.add(n.clusterScores(0))
      featureBuilder.add(n.clusterScores(1))
      featureBuilder.add(n.clusterScores(2))
      featureBuilder.add(n.clusterScores(3))
      featureBuilder.add(n.avgImageCaptureDate.map(String.valueOf).orNull)
      featureBuilder.add(n.avgLabelDate.map(String.valueOf).orNull)
      featureBuilder.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
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
}
