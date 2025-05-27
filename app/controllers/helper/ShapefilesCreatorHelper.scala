package controllers.helper

import models.api.{LabelClusterForApi, LabelDataForApi, StreetDataForApi}
import models.attribute.{GlobalAttributeForApi, GlobalAttributeWithLabelForApi}
import models.computation.{RegionScore, StreetScore}
import models.label.{LabelAllMetadata, LabelPointTable}
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source, StreamConverters}
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
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters.MapHasAsJava

/**
 * This class handles the creation of Shapefile archives to be used by the ApiController.
 *
 * Code was started and modified from the Geotools feature tutorial:
 * https://docs.geotools.org/stable/tutorials/feature/csv2shp.html
 *
 */
@Singleton
class ShapefilesCreatorHelper @Inject()()(implicit ec: ExecutionContext, mat: Materializer) {

  /**
   * Creates a shapefile from the given source, saving it at outputFile.
   * @param source A data stream holding the data to be saved in the shapefile.
   * @param outputFile The output filename (with no extension).
   * @param batchSize The number of features from the data stream to process at a time.
   * @param featureType SimpleFeatureType definition with the schema for the given data type.
   * @param buildFeature A function that takes a data point and a SimpleFeatureBuilder and returns a SimpleFeature.
   * @tparam A The type of data in the source.
   */
  private def createGeneralShapefile[A](source: Source[A, _], outputFile: String, batchSize: Int, featureType: SimpleFeatureType, buildFeature: (A, SimpleFeatureBuilder) => SimpleFeature) = {
    val shapefilePath: Path = new File(outputFile + ".shp").toPath

    // Set up everything we need to create and store features before saving them.
    val dataStoreFactory = new ShapefileDataStoreFactory()
    val newDataStore = dataStoreFactory.createNewDataStore(Map(
      "url" -> shapefilePath.toUri.toURL,
      "create spatial index" -> java.lang.Boolean.TRUE
    ).asJava)

    newDataStore.createSchema(featureType)

    val typeName: String = newDataStore.getTypeNames()(0)
    val featureSource = newDataStore.getFeatureSource(typeName)
    val featureStore = featureSource.asInstanceOf[SimpleFeatureStore]
    val featureBuilder: SimpleFeatureBuilder = new SimpleFeatureBuilder(featureType)

    // Process data in batches.
    val data: Seq[Seq[A]] = Await.result(source.grouped(batchSize).runWith(Sink.seq), 30.seconds)
    try {
      data.foreach { batch =>
        // Create a feature from each data point in this batch and add it to the ArrayList.
        val features = new java.util.ArrayList[SimpleFeature]()
        batch.foreach { x =>
          featureBuilder.reset()
          val feature: SimpleFeature = buildFeature(x, featureBuilder)
          features.add(feature)
        }

        // Add this batch of features to the shapefile in a transaction.
        val transaction = new DefaultTransaction("create")
        try {
          featureStore.setTransaction(transaction)
          featureStore.addFeatures(DataUtilities.collection(features))
          transaction.commit()
        } catch {
          case e: Exception =>
            transaction.rollback()
            logger.error(s"Error creating shapefile: ${e.getMessage}", e)
        } finally {
          transaction.close()
        }
      }

      // Output the file path for the shapefile.
      Some(shapefilePath)
    } catch {
      case e: Exception =>
        logger.error(s"Error creating shapefile: ${e.getMessage}", e)
        None
    } finally {
      newDataStore.dispose()
    }
  }

  /**
   * Creates a zip archive from the given shapefiles, saving it at s"$baseFileName.zip".
   * @param files
   * @param baseFileName
   */
  def zipShapefiles(files: Seq[Path], baseFileName: String): Source[ByteString, Future[Boolean]] = {
    val zipPath = new File(s"$baseFileName.zip").toPath
    val zipOut = new ZipOutputStream(Files.newOutputStream(zipPath))

    // For each shapefile, add all component files to the zip archive.
    files.foreach { f =>
      val shapefile = f.toFile
      val directory = shapefile.getParentFile
      val basename = shapefile.getName.substring(0, shapefile.getName.length - 4)

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
    StreamConverters.fromInputStream(() => new BufferedInputStream(Files.newInputStream(zipPath)))
      .mapMaterializedValue(_.map { _ => Files.deleteIfExists(zipPath) })
  }

  def createAttributeShapeFile(source: Source[GlobalAttributeForApi, _], outputFile: String, batchSize: Int): Option[Path] = {
    // We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "Location",
      "the_geom:Point:srid=4326," // the geometry attribute: Point type
        + "id:Integer," // global attribute ID
        + "labelType:String," // Label type
        + "streetId:Integer," // Street edge ID of the nearest street
        + "osmWayId:String," // OSM way ID of the nearest street
        + "neighborhd:String," // Neighborhood Name
        + "avgImgDate:String," // Image date
        + "avgLblDate:String," // Label date
        + "severity:Integer," // Severity
        + "temporary:Boolean," // Temporary flag
        + "nAgree:Integer," // Agree validations
        + "nDisagree:Integer," // Disagree validations
        + "nUnsure:Integer," // Unsure validations
        + "clusterSze:Integer," // Number of labels in the cluster
        + "userIds:String" // List of User Ids
    )

    val geometryFactory: GeometryFactory = JTSFactoryFinder.getGeometryFactory
    def buildFeature(a: GlobalAttributeForApi, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      featureBuilder.add(geometryFactory.createPoint(new Coordinate(a.lng.toDouble, a.lat.toDouble)))
      featureBuilder.add(a.globalAttributeId)
      featureBuilder.add(a.labelType)
      featureBuilder.add(a.streetEdgeId)
      featureBuilder.add(a.osmStreetId.toString)
      featureBuilder.add(a.neighborhoodName)
      featureBuilder.add(a.avgImageCaptureDate)
      featureBuilder.add(a.avgLabelDate)
      featureBuilder.add(a.severity.map(Integer.valueOf).orNull)
      featureBuilder.add(a.temporary)
      featureBuilder.add(a.agreeCount)
      featureBuilder.add(a.disagreeCount)
      featureBuilder.add(a.unsureCount)
      featureBuilder.add(a.labelCount)
      featureBuilder.add(a.usersList.mkString("[", ",", "]"))
      featureBuilder.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  def createLabelShapeFile(source: Source[GlobalAttributeWithLabelForApi, _], outputFile: String, batchSize: Int): Option[Path] = {
    // We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "Location",
      "the_geom:Point:srid=4326," // the geometry attribute: Point type
        + "labelId:Integer," // label ID
        + "attribId:Integer," // attribute ID
        + "labelType:String," // Label type
        + "streetId:Integer," // Street edge ID of the nearest street
        + "osmWayId:String," // Street OSM ID of the nearest street
        + "neighborhd:String," // Neighborhood Name
        + "severity:Integer," // Severity
        + "temporary:Boolean," // Temporary flag
        + "gsvPanoID:String," // GSV Panorama ID
        + "heading:Double," // heading of panorama
        + "pitch:Double," // pitch of panorama
        + "zoom:Integer," // zoom of panorama
        + "canvasX:Integer," // canvasX position of panorama
        + "canvasY:Integer," // canvasY position of panorama
        + "canvasWdth:Integer," // width of source viewfinder
        + "canvasHght:Integer," // height of source viewfinder
        + "gsvUrl:String," // GSV URL
        + "imageDate:String," // Image date
        + "labelDate:String," // Label date
        + "nAgree:Integer," // Agree validations
        + "nDisagree:Integer," // Disagree validations
        + "nUnsure:Integer," // Unsure validations
        + "labelTags:String," // Label Tags
        + "labelDescr:String," // Label Description
        + "userId:String," // User Id
    )

    val geometryFactory: GeometryFactory = JTSFactoryFinder.getGeometryFactory
    def buildFeature(l: GlobalAttributeWithLabelForApi, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      featureBuilder.add(geometryFactory.createPoint(new Coordinate(l.labelLatLng._2.toDouble, l.labelLatLng._1.toDouble)))
      featureBuilder.add(l.labelId)
      featureBuilder.add(l.globalAttributeId)
      featureBuilder.add(l.labelType)
      featureBuilder.add(l.streetEdgeId)
      featureBuilder.add(l.osmStreetId.toString)
      featureBuilder.add(l.neighborhoodName)
      featureBuilder.add(l.labelSeverity.map(Integer.valueOf).orNull)
      featureBuilder.add(l.labelTemporary)
      featureBuilder.add(l.gsvPanoramaId)
      featureBuilder.add(l.pov.heading)
      featureBuilder.add(l.pov.pitch)
      featureBuilder.add(l.pov.zoom)
      featureBuilder.add(l.canvasXY.x)
      featureBuilder.add(l.canvasXY.y)
      featureBuilder.add(LabelPointTable.canvasWidth)
      featureBuilder.add(LabelPointTable.canvasHeight)
      featureBuilder.add(l.gsvUrl)
      featureBuilder.add(l.imageLabelDates._1)
      featureBuilder.add(l.imageLabelDates._2)
      featureBuilder.add(l.agreeDisagreeUnsureCount._1)
      featureBuilder.add(l.agreeDisagreeUnsureCount._2)
      featureBuilder.add(l.agreeDisagreeUnsureCount._3)
      featureBuilder.add(l.labelTags.mkString("[", ",", "]"))
      featureBuilder.add(l.labelDescription.map(String.valueOf).orNull)
      featureBuilder.add(l.userId)
      featureBuilder.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  def createLabelAllMetadataShapeFile(source: Source[LabelAllMetadata, _], outputFile: String, batchSize: Int): Option[Path] = {
    // We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "Location",
      "the_geom:Point:srid=4326," // the geometry attribute: Point type
        + "labelId:Integer," // label ID
        + "userId:String," // User Id
        + "gsvPanoID:String," // GSV Panorama ID
        + "labelType:String," // Label type
        + "severity:Integer," // Severity
        + "tags:String," // Label Tags
        + "temporary:String," // Temporary
        + "descriptn:String," // Label Description
        + "labelDate:String," // Label date
        + "streetId:Integer," // Street edge ID of the nearest street
        + "osmWayId:String," // OSM way ID of the nearest street
        + "neighborhd:String," // Neighborhood Name
        + "correct:String," // Whether the label was validated as correct
        + "nAgree:Integer," // Agree validations
        + "nDisagree:Integer," // Disagree validations
        + "nUnsure:Integer," // Unsure validations
        + "validatns:String," // Array of (userId, validation)
        + "taskId:Integer," // Audit task ID
        + "missionId:Integer," // Mission ID
        + "imageDate:String," // Image date
        + "heading:Double," // Heading of GSV when label was created
        + "pitch:Double," // Pitch of GSV when label was created
        + "zoom:Integer," // Zoom of GSV when label was created
        + "canvasX:Integer," // canvasX position of panorama
        + "canvasY:Integer," // canvasY position of panorama
        + "canvasWdth:Integer," // Width of source viewfinder
        + "canvasHght:Integer," // Height of source viewfinder
        + "gsvUrl:String," // GSV URL
        + "panoramaX:Integer," // X position of the label on the full GSV pano
        + "panoramaY:Integer," // Y position of the label on the full GSV pano
        + "panoWidth:Integer," // Width of the full GSV pano
        + "panoHeight:Integer," // Height of the full GSV pano
        + "panoHding:Double," // Heading of the full GSV pano's camera
        + "panoPitch:Double," // Pitch of the full GSV pano's camera
    )

    def buildFeature(l: LabelAllMetadata, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      featureBuilder.add(l.geom)
      featureBuilder.add(l.labelId)
      featureBuilder.add(l.userId)
      featureBuilder.add(l.panoId)
      featureBuilder.add(l.labelType)
      featureBuilder.add(l.severity.map(Integer.valueOf).orNull)
      featureBuilder.add(l.tags.mkString("[", ",", "]"))
      featureBuilder.add(String.valueOf(l.temporary))
      featureBuilder.add(l.description.map(String.valueOf).orNull)
      featureBuilder.add(l.timeCreated)
      featureBuilder.add(l.streetEdgeId)
      featureBuilder.add(String.valueOf(l.osmStreetId))
      featureBuilder.add(l.neighborhoodName)
      featureBuilder.add(l.correctStr.map(String.valueOf).orNull)
      featureBuilder.add(l.validationInfo.agreeCount)
      featureBuilder.add(l.validationInfo.disagreeCount)
      featureBuilder.add(l.validationInfo.unsureCount)
      featureBuilder.add(l.validations.mkString("[", ",", "]"))
      featureBuilder.add(l.auditTaskId)
      featureBuilder.add(l.missionId)
      featureBuilder.add(l.imageCaptureDate)
      featureBuilder.add(l.pov.heading)
      featureBuilder.add(l.pov.pitch)
      featureBuilder.add(l.pov.zoom)
      featureBuilder.add(l.canvasXY.x)
      featureBuilder.add(l.canvasXY.y)
      featureBuilder.add(LabelPointTable.canvasWidth)
      featureBuilder.add(LabelPointTable.canvasHeight)
      featureBuilder.add(l.gsvUrl)
      featureBuilder.add(l.panoLocation._1.x)
      featureBuilder.add(l.panoLocation._1.y)
      featureBuilder.add(l.panoWidth.map(Integer.valueOf).orNull)
      featureBuilder.add(l.panoHeight.map(Integer.valueOf).orNull)
      featureBuilder.add(l.cameraHeadingPitch._1)
      featureBuilder.add(l.cameraHeadingPitch._2)

      featureBuilder.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  /**
  * Creates a shapefile from LabelDataForApi objects.
  *
  * @param source Stream of LabelDataForApi objects
  * @param outputFile Base filename for the output file (without extension)
  * @param batchSize Number of features to process in each batch
  * @return Path to the created shapefile, or None if creation failed
  */
  def createRawLabelShapeFile(source: Source[LabelDataForApi, _], outputFile: String, batchSize: Int): Option[Path] = {
    // Define the feature type schema for LabelDataForApi
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "Location",
      "the_geom:Point:srid=4326," // The geometry attribute: Point type
        + "label_id:Integer," // Label ID
        + "user_id:String," // User ID
        + "gsv_pano_id:String," // GSV Panorama ID
        + "label_type:String," // Label type
        + "severity:Integer," // Severity
        + "tags:String," // Tags list
        + "description:String," // Description
        + "time_created:String," // Creation timestamp
        + "street_edge_id:Integer," // Street edge ID
        + "osm_street_id:String," // OSM street ID
        + "neighborhood:String," // Neighborhood name
        + "correct:String," // Validation correctness
        + "agree_count:Integer," // Agree validations count
        + "disagree_count:Integer," // Disagree validations count
        + "unsure_count:Integer," // Unsure validations count
        + "validations:String," // Validation details
        + "audit_task_id:Integer," // Audit task ID
        + "mission_id:Integer," // Mission ID
        + "image_date:String," // Image capture date
        + "heading:Double," // Heading angle
        + "pitch:Double," // Pitch angle
        + "zoom:Integer," // Zoom level
        + "canvas_x:Integer," // Canvas X position
        + "canvas_y:Integer," // Canvas Y position
        + "canvas_width:Integer," // Canvas width
        + "canvas_height:Integer," // Canvas height
        + "pano_x:Integer," // Panorama X position
        + "pano_y:Integer," // Panorama Y position
        + "pano_width:Integer," // Panorama width
        + "pano_height:Integer," // Panorama height
        + "camera_heading:Double," // Camera heading
        + "camera_pitch:Double," // Camera pitch
        + "gsv_url:String" // GSV URL
    )

    val geometryFactory: GeometryFactory = JTSFactoryFinder.getGeometryFactory

    def buildFeature(label: LabelDataForApi, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      // Add the geometry (Point)
      featureBuilder.add(geometryFactory.createPoint(new Coordinate(label.longitude, label.latitude)))

      // Add all attributes
      featureBuilder.add(label.labelId)
      featureBuilder.add(label.userId)
      featureBuilder.add(label.gsvPanoramaId)
      featureBuilder.add(label.labelType)
      featureBuilder.add(label.severity.orNull)
      featureBuilder.add(label.tags.mkString("[", ",", "]"))
      featureBuilder.add(label.description.orNull)
      featureBuilder.add(label.timeCreated.toString)
      featureBuilder.add(label.streetEdgeId)
      featureBuilder.add(label.osmStreetId.toString)
      featureBuilder.add(label.neighborhood)
      featureBuilder.add(label.correct.map(_.toString).orNull)
      featureBuilder.add(label.agreeCount)
      featureBuilder.add(label.disagreeCount)
      featureBuilder.add(label.unsureCount)

      // Format validations as a JSON-like string
      val validationsStr = label.validations.map(v => s"""{"user_id":"${v.userId}","validation":"${v.validationType}"}""").mkString(",")
      featureBuilder.add(s"[$validationsStr]")

      featureBuilder.add(label.auditTaskId.orNull)
      featureBuilder.add(label.missionId.orNull)
      featureBuilder.add(label.imageCaptureDate.orNull)
      featureBuilder.add(label.heading.orNull)
      featureBuilder.add(label.pitch.orNull)
      featureBuilder.add(label.zoom.orNull)
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
      featureBuilder.add(label.gsvUrl)

      featureBuilder.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  /**
   * Creates a shapefile from LabelClusterForApi objects.
   *
   * @param source Stream of LabelClusterForApi objects
   * @param outputFile Base filename for the output file (without extension)
   * @param batchSize Number of features to process in each batch
   * @return Path to the created shapefile, or None if creation failed
   */
  def createLabelClusterShapeFile(source: Source[LabelClusterForApi, _], outputFile: String, batchSize: Int): Option[Path] = {
    // Define the feature type schema for LabelClusterForApi
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "Location",
      "the_geom:Point:srid=4326," // the geometry attribute: Point type
        + "clusterId:Integer," // Cluster ID
        + "labelType:String," // Label type
        + "streetId:Integer," // Street edge ID
        + "osmWayId:String," // OSM way ID
        + "regionId:Integer," // Region ID
        + "regionName:String," // Region name
        + "avgImgDate:String," // Average image capture date
        + "avgLblDate:String," // Average label date
        + "severity:Integer," // Severity
        + "temporary:Boolean," // Temporary flag
        + "nAgree:Integer," // Agree count
        + "nDisagree:Integer," // Disagree count
        + "nUnsure:Integer," // Unsure count
        + "clusterSze:Integer," // Cluster size
        + "userIds:String" // User IDs
    )

    val geometryFactory: GeometryFactory = JTSFactoryFinder.getGeometryFactory

    def buildFeature(cluster: LabelClusterForApi, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      // Add the geometry (Point)
      featureBuilder.add(geometryFactory.createPoint(new Coordinate(cluster.avgLongitude, cluster.avgLatitude)))

      // Add all attributes
      featureBuilder.add(cluster.labelClusterId)
      featureBuilder.add(cluster.labelType)
      featureBuilder.add(cluster.streetEdgeId)
      featureBuilder.add(cluster.osmStreetId.toString)
      featureBuilder.add(cluster.regionId)
      featureBuilder.add(cluster.regionName)
      featureBuilder.add(cluster.avgImageCaptureDate.map(_.toString).orNull)
      featureBuilder.add(cluster.avgLabelDate.map(_.toString).orNull)
      featureBuilder.add(cluster.medianSeverity.map(Integer.valueOf).orNull)
      featureBuilder.add(cluster.agreeCount)
      featureBuilder.add(cluster.disagreeCount)
      featureBuilder.add(cluster.unsureCount)
      featureBuilder.add(cluster.clusterSize)
      featureBuilder.add(cluster.userIds.mkString("[", ",", "]"))

      featureBuilder.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  /**
  * Creates a GeoPackage file from LabelDataForApi objects.
  * GeoPackage is a SQLite-based format that stores geospatial data.
  *
  * @param source Stream of LabelDataForApi objects
  * @param outputFile Base filename for the output file (without extension)
  * @param batchSize Number of features to process in each batch
  * @return Path to the created GeoPackage file, or None if creation failed
  */
  def createRawLabelDataGeopackage(source: Source[LabelDataForApi, _], outputFile: String, batchSize: Int): Option[Path] = {
    // Create the output file path
    val geopackagePath: Path = new File(outputFile + ".gpkg").toPath

    try {
      // Set up the GeoPackage data store.
      val params = Map(
        GeoPkgDataStoreFactory.DBTYPE.key -> "geopkg",
        GeoPkgDataStoreFactory.DATABASE.key -> geopackagePath.toFile
      ).asJava
      val dataStore: DataStore = DataStoreFinder.getDataStore(params)

      // Define the feature type schema
      val featureType: SimpleFeatureType = DataUtilities.createType(
        "labels",
        "the_geom:Point:srid=4326," // the geometry attribute: Point type
          + "label_id:Integer," // label ID
          + "user_id:String," // User Id
          + "gsv_pano_id:String," // GSV Panorama ID
          + "label_type:String," // Label type
          + "severity:Integer," // Severity
          + "tags:String," // Label Tags
          + "description:String," // Label Description
          + "time_created:Date," // Creation timestamp
          + "street_edge_id:Integer," // Street edge ID
          + "osm_street_id:String," // OSM street ID
          + "neighborhood:String," // Neighborhood name
          + "correct:String," // Validation correctness
          + "agree_count:Integer," // Agree validations
          + "disagree_count:Integer," // Disagree validations
          + "unsure_count:Integer," // Unsure validations
          + "validations:String," // Validation details
          + "audit_task_id:Integer," // Audit task ID
          + "mission_id:Integer," // Mission ID
          + "image_date:String," // Image capture date
          + "heading:Double," // Heading angle
          + "pitch:Double," // Pitch angle
          + "zoom:Integer," // Zoom level
          + "canvas_x:Integer," // Canvas X position
          + "canvas_y:Integer," // Canvas Y position
          + "canvas_width:Integer," // Canvas width
          + "canvas_height:Integer," // Canvas height
          + "pano_x:Integer," // Panorama X position
          + "pano_y:Integer," // Panorama Y position
          + "pano_width:Integer," // Panorama width
          + "pano_height:Integer," // Panorama height
          + "camera_heading:Double," // Camera heading
          + "camera_pitch:Double," // Camera pitch
          + "gsv_url:String" // GSV URL
      )

      // Create the schema in the GeoPackage
      dataStore.createSchema(featureType)

      // Get feature store for writing
      val typeName = dataStore.getTypeNames()(0)
      val featureSource = dataStore.getFeatureSource(typeName)
      val featureStore = featureSource.asInstanceOf[SimpleFeatureStore]
      val featureBuilder = new SimpleFeatureBuilder(featureType)
      val geometryFactory = JTSFactoryFinder.getGeometryFactory

      // Process data in batches
      // Note: Because there is often so much raw label data, I increased the time out here to five minutes
      val data: Seq[Seq[LabelDataForApi]] = Await.result(source.grouped(batchSize).runWith(Sink.seq), 5.minutes)

      try {
        data.foreach { batch =>
          // Create a feature from each data point in this batch
          val features = new java.util.ArrayList[SimpleFeature]()
          batch.foreach { label =>
            featureBuilder.reset()

            // Add the geometry (Point)
            featureBuilder.add(geometryFactory.createPoint(new Coordinate(label.longitude, label.latitude)))

            // Add all attributes
            featureBuilder.add(label.labelId)
            featureBuilder.add(label.userId)
            featureBuilder.add(label.gsvPanoramaId)
            featureBuilder.add(label.labelType)
            featureBuilder.add(label.severity.map(Integer.valueOf).orNull)
            featureBuilder.add(label.tags.mkString("[", ",", "]"))
            featureBuilder.add(label.description.map(String.valueOf).orNull)

            // Convert timestamp to java.util.Date for GeoPackage compatibility
            val time = new java.util.Date(label.timeCreated.toInstant.toEpochMilli)
            featureBuilder.add(time)

            featureBuilder.add(label.streetEdgeId)
            featureBuilder.add(String.valueOf(label.osmStreetId))
            featureBuilder.add(label.neighborhood)
            featureBuilder.add(label.correct.map(_.toString).orNull)
            featureBuilder.add(label.agreeCount)
            featureBuilder.add(label.disagreeCount)
            featureBuilder.add(label.unsureCount)

            // Format validations as a JSON-like string
            val validationsStr = label.validations.map(v => s"""{"user_id":"${v.userId}","validation":"${v.validationType}"}""").mkString(",")
            featureBuilder.add(s"[$validationsStr]")

            featureBuilder.add(label.auditTaskId.map(Integer.valueOf).orNull)
            featureBuilder.add(label.missionId.map(Integer.valueOf).orNull)
            featureBuilder.add(label.imageCaptureDate.orNull)
            featureBuilder.add(label.heading.orNull)
            featureBuilder.add(label.pitch.orNull)
            featureBuilder.add(label.zoom.map(Integer.valueOf).orNull)
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

            // Add the GSV URL which is calculated from the label data
            featureBuilder.add(label.gsvUrl)

            features.add(featureBuilder.buildFeature(null))
          }

          // Add this batch of features to the GeoPackage in a transaction
          val transaction = new DefaultTransaction("create")
          try {
            featureStore.setTransaction(transaction)
            featureStore.addFeatures(DataUtilities.collection(features))
            transaction.commit()
          } catch {
            case e: Exception =>
              transaction.rollback()
              logger.error(s"Error creating GeoPackage: ${e.getMessage}", e)
          } finally {
            transaction.close()
          }
        }

        // Return the file path for the GeoPackage
        Some(geopackagePath)
      } catch {
        case e: Exception =>
          logger.error(s"Error creating GeoPackage: ${e.getMessage}", e)
          None
      } finally {
        // Clean up resources
        dataStore.dispose()
      }
    } catch {
      case e: Exception =>
        logger.error(s"Error setting up GeoPackage: ${e.getMessage}", e)
        None
    }
  }

  def createStreetShapefile(source: Source[StreetScore, _], outputFile: String, batchSize: Int): Option[Path] = {
    // We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "Location",
      "the_geom:LineString:srid=4326," // the geometry attribute: Line type
        + "streetId:Integer," // StreetId
        + "osmWayId:String," // osmWayId
        + "nghborhdId:String," // Region ID
        + "score:Double," // street score
        + "auditCount:Integer," // boolean representing whether the street is audited
        + "sigRamp:Double," // curb ramp significance weight
        + "sigNoRamp:Double," // no Curb ramp significance weight
        + "sigObs:Double," // obstacle significance weight
        + "sigSurfce:Double," // Surface problem significance weight
        + "nRamp:Integer," // curb ramp count, averaged across streets
        + "nNoRamp:Integer," // no Curb ramp count, averaged across streets
        + "nObs:Integer," // obstacle count, averaged across streets
        + "nSurfce:Integer," // Surface problem count, averaged across streets
        + "avgImgDate:String," // average image age in milliseconds
        + "avgLblDate:String" // average label age in milliseconds
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
      featureBuilder.add(s.attributes(0))
      featureBuilder.add(s.attributes(1))
      featureBuilder.add(s.attributes(2))
      featureBuilder.add(s.attributes(3))
      featureBuilder.add(s.avgImageCaptureDate.map(String.valueOf).orNull)
      featureBuilder.add(s.avgLabelDate.map(String.valueOf).orNull)
      featureBuilder.buildFeature(null)
    }

    createGeneralShapefile(source, outputFile, batchSize, featureType, buildFeature)
  }

  def createNeighborhoodShapefile(source: Source[RegionScore, _], outputFile: String, batchSize: Int): Option[Path] = {
    // We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "Location",
      "the_geom:Polygon:srid=4326," // line geometry
        + "neighborhd:String," // Neighborhood Name
        + "nghborhdId:Integer," // Neighborhood Id
        + "coverage:Double," // coverage score
        + "score:Double," // obstacle score
        + "sigRamp:Double," // curb ramp significance weight
        + "sigNoRamp:Double," // no Curb ramp significance weight
        + "sigObs:Double," // obstacle significance weight
        + "sigSurfce:Double," // Surface problem significance weight
        + "nRamp:Double," // curb ramp count
        + "nNoRamp:Double," // no Curb ramp count
        + "nObs:Double," // obstacle count
        + "nSurfce:Double," // Surface problem count
        + "avgImgDate:String," // average image age in milliseconds
        + "avgLblDate:String" // average label age in milliseconds
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
      featureBuilder.add(n.attributeScores(0))
      featureBuilder.add(n.attributeScores(1))
      featureBuilder.add(n.attributeScores(2))
      featureBuilder.add(n.attributeScores(3))
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
  def createStreetDataShapeFile(source: Source[StreetDataForApi, _], outputFile: String, batchSize: Int): Option[Path] = {
    // Define the feature type schema for StreetDataForApi
    val featureType: SimpleFeatureType = DataUtilities.createType(
      "Street",
      "the_geom:LineString:srid=4326," // the geometry attribute: LineString type
        + "street_id:Integer," // Street edge ID
        + "osm_id:String," // OSM street ID as String (shapefiles don't handle Long well)
        + "region_id:Integer," // Region ID
        + "region_name:String," // Region name
        + "way_type:String," // Type of street/way
        + "label_count:Integer," // Number of labels on this street
        + "audit_count:Integer," // Number of times audited
        + "user_count:Integer," // Number of unique users
        + "user_ids:String," // List of user IDs as a string
        + "first_label:String," // First label date
        + "last_label:String" // Last label date
    )

    def buildFeature(street: StreetDataForApi, featureBuilder: SimpleFeatureBuilder): SimpleFeature = {
      // Add the geometry (LineString)
      featureBuilder.add(street.geometry)

      // Add all attributes
      featureBuilder.add(street.streetEdgeId)
      featureBuilder.add(street.osmStreetId.toString) // Convert Long to String
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
   * GeoPackage is a SQLite-based format that stores geospatial data.
   *
   * @param source Stream of StreetDataForApi objects
   * @param outputFile Base filename for the output file (without extension)
   * @param batchSize Number of features to process in each batch
   * @return Path to the created GeoPackage file, or None if creation failed
   */
  def createStreetDataGeopackage(source: Source[StreetDataForApi, _], outputFile: String, batchSize: Int): Option[Path] = {
    // Create the output file path
    val geopackagePath: Path = new File(outputFile + ".gpkg").toPath

    try {
      // Set up the GeoPackage data store
      val params = Map(
        GeoPkgDataStoreFactory.DBTYPE.key -> "geopkg",
        GeoPkgDataStoreFactory.DATABASE.key -> geopackagePath.toFile
      ).asJava
      val dataStore: DataStore = DataStoreFinder.getDataStore(params)

      // Define the feature type schema
      // Note: Using String for osm_id instead of Long to avoid GeoTools type resolution issues
      val featureType: SimpleFeatureType = DataUtilities.createType(
        "streets",
        "the_geom:LineString:srid=4326," // LineString geometry
          + "street_id:Integer," // Street edge ID
          + "osm_id:String," // OSM street ID as String (GeoTools doesn't handle Long well)
          + "region_id:Integer," // Region ID
          + "region_name:String," // Region name
          + "way_type:String," // Type of street/way
          + "label_count:Integer," // Number of labels on this street
          + "audit_count:Integer," // Number of times audited
          + "user_count:Integer," // Number of unique users
          + "user_ids:String," // List of user IDs as a string
          + "first_label:String," // First label date
          + "last_label:String" // Last label date
      )

      // Create the schema in the GeoPackage
      dataStore.createSchema(featureType)

      // Get feature store for writing
      val typeName = dataStore.getTypeNames()(0)
      val featureSource = dataStore.getFeatureSource(typeName)
      val featureStore = featureSource.asInstanceOf[SimpleFeatureStore]
      val featureBuilder = new SimpleFeatureBuilder(featureType)

      // Process data in batches
      val data: Seq[Seq[StreetDataForApi]] = Await.result(source.grouped(batchSize).runWith(Sink.seq), 60.seconds)

      try {
        data.foreach { batch =>
          // Create a feature from each data point in this batch
          val features = new java.util.ArrayList[SimpleFeature]()
          batch.foreach { street =>
            featureBuilder.reset()

            // Add the geometry (LineString) - already in JTS format
            featureBuilder.add(street.geometry)

            // Add all attributes
            featureBuilder.add(street.streetEdgeId)
            featureBuilder.add(street.osmStreetId.toString) // Convert Long to String
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

            features.add(featureBuilder.buildFeature(null))
          }

          // Add this batch of features to the GeoPackage in a transaction
          val transaction = new DefaultTransaction("create")
          try {
            featureStore.setTransaction(transaction)
            featureStore.addFeatures(DataUtilities.collection(features))
            transaction.commit()
          } catch {
            case e: Exception =>
              transaction.rollback()
              logger.error(s"Error creating GeoPackage: ${e.getMessage}", e)
          } finally {
            transaction.close()
          }
        }

        // Return the file path for the GeoPackage
        Some(geopackagePath)
      } catch {
        case e: Exception =>
          logger.error(s"Error creating GeoPackage: ${e.getMessage}", e)
          None
      } finally {
        // Clean up resources
        dataStore.dispose()
      }
    } catch {
      case e: Exception =>
        logger.error(s"Error setting up GeoPackage: ${e.getMessage}", e)
        None
    }
  }

  /**
   * Creates a GeoPackage file from LabelClusterForApi objects.
   * GeoPackage is a SQLite-based format that stores geospatial data.
   *
   * @param source Stream of LabelClusterForApi objects
   * @param outputFile Base filename for the output file (without extension)
   * @param batchSize Number of features to process in each batch
   * @return Path to the created GeoPackage file, or None if creation failed
   */
  def createLabelClusterGeopackage(source: Source[LabelClusterForApi, _], outputFile: String, batchSize: Int): Option[Path] = {
    // Create the output file path
    val geopackagePath: Path = new File(outputFile + ".gpkg").toPath

    try {
      // Set up the GeoPackage data store
      val params = Map(
        GeoPkgDataStoreFactory.DBTYPE.key -> "geopkg",
        GeoPkgDataStoreFactory.DATABASE.key -> geopackagePath.toFile
      ).asJava
      val dataStore: DataStore = DataStoreFinder.getDataStore(params)

      // Define the feature type schema for label clusters
      val featureType: SimpleFeatureType = DataUtilities.createType(
        "label_clusters",
        "the_geom:Point:srid=4326," // the geometry attribute: Point type
          + "cluster_id:Integer," // Cluster ID
          + "label_type:String," // Label type
          + "street_edge_id:Integer," // Street edge ID
          + "osm_street_id:String," // OSM way ID (as String to avoid Long issues)
          + "region_id:Integer," // Region ID
          + "region_name:String," // Region name
          + "avg_image_date:Date," // Average image capture date
          + "avg_label_date:Date," // Average label date
          + "median_severity:Integer," // Median severity
          + "agree_count:Integer," // Agree count
          + "disagree_count:Integer," // Disagree count
          + "unsure_count:Integer," // Unsure count
          + "cluster_size:Integer," // Cluster size
          + "user_ids:String," // User IDs as JSON array string
          + "labels:String" // Raw labels (if included) as JSON string
      )

      // Create the schema in the GeoPackage
      dataStore.createSchema(featureType)

      // Get feature store for writing
      val typeName = dataStore.getTypeNames()(0)
      val featureSource = dataStore.getFeatureSource(typeName)
      val featureStore = featureSource.asInstanceOf[SimpleFeatureStore]
      val featureBuilder = new SimpleFeatureBuilder(featureType)
      val geometryFactory = JTSFactoryFinder.getGeometryFactory

      // Process data in batches
      val data: Seq[Seq[LabelClusterForApi]] = Await.result(source.grouped(batchSize).runWith(Sink.seq), 60.seconds)

      try {
        data.foreach { batch =>
          // Create a feature from each data point in this batch
          val features = new java.util.ArrayList[SimpleFeature]()
          batch.foreach { cluster =>
            featureBuilder.reset()

            // Add the geometry (Point)
            featureBuilder.add(geometryFactory.createPoint(new Coordinate(cluster.avgLongitude, cluster.avgLatitude)))

            // Add all attributes
            featureBuilder.add(cluster.labelClusterId)
            featureBuilder.add(cluster.labelType)
            featureBuilder.add(cluster.streetEdgeId)
            featureBuilder.add(cluster.osmStreetId.toString) // Convert Long to String
            featureBuilder.add(cluster.regionId)
            featureBuilder.add(cluster.regionName)

            // Convert OffsetDateTime to java.util.Date for GeoPackage compatibility
            featureBuilder.add(cluster.avgImageCaptureDate.map(dt => new java.util.Date(dt.toInstant.toEpochMilli)).orNull)
            featureBuilder.add(cluster.avgLabelDate.map(dt => new java.util.Date(dt.toInstant.toEpochMilli)).orNull)

            featureBuilder.add(cluster.medianSeverity.map(Integer.valueOf).orNull)
            featureBuilder.add(cluster.agreeCount)
            featureBuilder.add(cluster.disagreeCount)
            featureBuilder.add(cluster.unsureCount)
            featureBuilder.add(cluster.clusterSize)

            // Format user IDs as a JSON array string
            val userIdsStr = cluster.userIds.map(id => s""""$id"""").mkString(",")
            featureBuilder.add(s"[$userIdsStr]")

            // Add raw labels if they exist, formatted as JSON string
            val labelsStr = cluster.labels match {
              case Some(labelsList) => Json.stringify(Json.toJson(labelsList))
              case None => null
            }
            featureBuilder.add(labelsStr)

            features.add(featureBuilder.buildFeature(null))
          }

          // Add this batch of features to the GeoPackage in a transaction
          val transaction = new DefaultTransaction("create")
          try {
            featureStore.setTransaction(transaction)
            featureStore.addFeatures(DataUtilities.collection(features))
            transaction.commit()
          } catch {
            case e: Exception =>
              transaction.rollback()
              logger.error(s"Error creating GeoPackage: ${e.getMessage}", e)
          } finally {
            transaction.close()
          }
        }

        // Return the file path for the GeoPackage
        Some(geopackagePath)
      } catch {
        case e: Exception =>
          logger.error(s"Error creating GeoPackage: ${e.getMessage}", e)
          None
      } finally {
        // Clean up resources
        dataStore.dispose()
      }
    } catch {
      case e: Exception =>
        logger.error(s"Error setting up GeoPackage: ${e.getMessage}", e)
        None
    }
  }
}
