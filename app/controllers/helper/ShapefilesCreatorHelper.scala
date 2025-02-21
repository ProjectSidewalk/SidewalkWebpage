package controllers.helper

import controllers.AccessScoreStreet
import models.attribute.{GlobalAttributeForAPI, GlobalAttributeWithLabelForAPI}
import models.label.LabelPointTable

import java.util
import scala.jdk.CollectionConverters.MapHasAsJava
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source, StreamConverters}
import org.apache.pekko.util.ByteString
import org.locationtech.jts.geom.Coordinate
import play.api.i18n.Lang.logger

import javax.inject.{Inject, Singleton}
import scala.concurrent.{Await, ExecutionContext}
import scala.concurrent.duration.DurationInt
import org.geotools.data._
import org.geotools.data.shapefile._
import org.geotools.data.simple._
import org.opengis.feature.simple._
import play.api.libs.json.JsResult.Exception

import java.io.BufferedInputStream

import org.geotools.data.{DataUtilities, DefaultTransaction}
import org.geotools.data.shapefile.ShapefileDataStoreFactory
import org.geotools.data.simple.SimpleFeatureCollection
import org.geotools.feature.simple.SimpleFeatureBuilder
import org.geotools.geometry.jts.JTSFactoryFinder
import org.geotools.referencing.crs.DefaultGeographicCRS
import org.locationtech.jts.geom.GeometryFactory
import org.opengis.feature.simple.{SimpleFeature, SimpleFeatureType}
import java.io.{ByteArrayOutputStream, File, IOException}
import java.nio.file.{Files, Path}
import scala.concurrent.Future
import java.util.zip.{ZipEntry, ZipOutputStream}

/**
 * This class handles the creation of Shapefile archives to be used by the SidewalkAPIController.
 *
 * Code was started and modified from the Geotools feature tutorial: 
 * https://docs.geotools.org/stable/tutorials/feature/csv2shp.html
 *
 */
@Singleton
class ShapefilesCreatorHelper @Inject()()(implicit ec: ExecutionContext, mat: Materializer) {

//    def createGeneralShapeFile(String outputFile, SimpleFeatureType TYPE, List<SimpleFeature> features) = {
//        // Get an output file name and create the new shapefile.
//        ShapefileDataStoreFactory dataStoreFactory = new ShapefileDataStoreFactory()
//
//        Map<String, Serializable> params = new HashMap<>()
//        params.put("url", new File(outputFile + ".shp").toURI().toURL())
//        params.put("create spatial index", Boolean.TRUE)
//
//        ShapefileDataStore newDataStore = (ShapefileDataStore) dataStoreFactory.createNewDataStore(params)
//
//        // TYPE is used as a template to describe the file contents.
//        newDataStore.createSchema(TYPE)
//
//        // Write the features to the shapefile.
//        Transaction transaction = new DefaultTransaction(outputFile)
//
//        String typeName = newDataStore.getTypeNames()[0]
//        SimpleFeatureSource featureSource = newDataStore.getFeatureSource(typeName)
//        SimpleFeatureType SHAPE_TYPE = featureSource.getSchema()
//        /*
//         * The Shapefile format has a couple limitations:
//         * - "the_geom" is always first, and used for the geometry attribute name
//         * - "the_geom" must be of type Point, MultiPoint, MuiltiLineString, MultiPolygon
//         * - Attribute names are limited in length
//         * - Integers are limited to 9 digits. Use Strings if integers can be larger
//         * - Not all data types are supported (example Timestamp represented as Date)
//         *
//         * Each data store has different limitations so check the resulting SimpleFeatureType.
//         */
//        if (featureSource instanceof SimpleFeatureStore) {
//            SimpleFeatureStore featureStore = (SimpleFeatureStore) featureSource
//            /*
//             * SimpleFeatureStore has a method to add features from a
//             * SimpleFeatureCollection object, so we use the ListFeatureCollection
//             * class to wrap our list of features.
//             */
//            SimpleFeatureCollection collection = new ListFeatureCollection(TYPE, features)
//            featureStore.setTransaction(transaction)
//            try {
//                featureStore.addFeatures(collection)
//                transaction.commit()
//            } catch (Exception problem) {
//                problem.printStackTrace()
//                transaction.rollback()
//            } finally {
//                transaction.close()
//            }
//        }
//    }

  def createAttributeShapeFile(source: Source[GlobalAttributeForAPI, _], outputFile: String, batchSize: Int): Option[Path] = {
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

    val geometryFactory: GeometryFactory = JTSFactoryFinder.getGeometryFactory
    val featureBuilder: SimpleFeatureBuilder = new SimpleFeatureBuilder(featureType)

    val t00 = System.currentTimeMillis()
    var t0 = System.currentTimeMillis()
    var t1 = System.currentTimeMillis()

    // Process attributes in batches.
    val attrList: Seq[Seq[GlobalAttributeForAPI]] = Await.result(source.grouped(batchSize).runWith(Sink.seq), 30.seconds)
    try {
      attrList.foreach { batch =>
        // Create a feature from each attribute in this batch and add it to the ArrayList.
        val features = new java.util.ArrayList[SimpleFeature]()
        batch.foreach { a =>
          featureBuilder.reset()

          featureBuilder.add(geometryFactory.createPoint(new Coordinate(a.lng, a.lat)))
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
          featureBuilder.add("[" + a.usersList.mkString(",") + "]")

          val feature: SimpleFeature = featureBuilder.buildFeature(null)
          features.add(feature)
        }

        // Add this batch of features to the shapefile in a transaction.
        val transaction = new DefaultTransaction("create")
        try {
          featureStore.setTransaction(transaction)
          featureStore.addFeatures(DataUtilities.collection(features))
          transaction.commit()
          t1 = System.currentTimeMillis()
          println(s"${t1 - t0} ms to add attribute features")
          t0 = System.currentTimeMillis()
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
      val t3 = System.currentTimeMillis()
      println(s"${t3 - t00} ms to process all attributes")
    }
  }

  def createLabelShapeFile(source: Source[GlobalAttributeWithLabelForAPI, _], outputFile: String, batchSize: Int): Option[Path] = {
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

    val geometryFactory: GeometryFactory = JTSFactoryFinder.getGeometryFactory
    val featureBuilder: SimpleFeatureBuilder = new SimpleFeatureBuilder(featureType)

    val t00 = System.currentTimeMillis()
    var t0 = System.currentTimeMillis()
    var t1 = System.currentTimeMillis()

    // Process labels in batches.
    val attrList: Seq[Seq[GlobalAttributeWithLabelForAPI]] = Await.result(source.grouped(batchSize).runWith(Sink.seq), 30.seconds)
    try {
      attrList.foreach { batch =>
        // Create a feature from each label in this batch and add it to the ArrayList.
        val features = new java.util.ArrayList[SimpleFeature]()
        batch.foreach { l =>
          featureBuilder.reset()

          featureBuilder.add(geometryFactory.createPoint(new Coordinate(l.labelLatLng._2, l.labelLatLng._1)))
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
          featureBuilder.add("[" + l.labelTags.mkString(",") + "]")
          featureBuilder.add(l.labelDescription.map(String.valueOf).orNull)
          featureBuilder.add(l.userId)

          val feature: SimpleFeature = featureBuilder.buildFeature(null)
          features.add(feature)
        }

        // Add this batch of features to the shapefile in a transaction.
        val transaction = new DefaultTransaction("create")
        try {
          featureStore.setTransaction(transaction)
          featureStore.addFeatures(DataUtilities.collection(features))
          transaction.commit()
          t1 = System.currentTimeMillis()
          println(s"${t1 - t0} ms to add label features")
          t0 = System.currentTimeMillis()
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
      val t3 = System.currentTimeMillis()
      println(s"${t3 - t00} ms to process all labels")
    }
  }

//    public static void createRawLabelShapeFile(String outputFile, APIBBox bbox) throws Exception {
//        // We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
//        final SimpleFeatureType TYPE =
//                DataUtilities.createType(
//                        "Location",
//                        "the_geom:Point:srid=4326," // the geometry attribute: Point type
//                                + "labelId:Integer," // label ID
//                                + "userId:String," // User Id
//                                + "gsvPanoID:String," // GSV Panorama ID
//                                + "labelType:String," // Label type
//                                + "severity:Integer," // Severity
//                                + "tags:String," // Label Tags
//                                + "temporary:String," // Temporary
//                                + "descriptn:String," // Label Description
//                                + "labelDate:String," // Label date
//                                + "streetId:Integer," // Street edge ID of the nearest street
//                                + "osmWayId:String," // OSM way ID of the nearest street
//                                + "neighborhd:String," // Neighborhood Name
//                                + "correct:String," // Whether the label was validated as correct
//                                + "nAgree:Integer," // Agree validations
//                                + "nDisagree:Integer," // Disagree validations
//                                + "nUnsure:Integer," // Unsure validations
//                                + "validatns:String," // Array of (userId, validation)
//                                + "taskId:Integer," // Audit task ID
//                                + "missionId:Integer," // Mission ID
//                                + "imageDate:String," // Image date
//                                + "heading:Double," // Heading of GSV when label was created
//                                + "pitch:Double," // Pitch of GSV when label was created
//                                + "zoom:Integer," // Zoom of GSV when label was created
//                                + "canvasX:Integer," // canvasX position of panorama
//                                + "canvasY:Integer," // canvasY position of panorama
//                                + "canvasWdth:Integer," // Width of source viewfinder
//                                + "canvasHght:Integer," // Height of source viewfinder
//                                + "gsvUrl:String," // GSV URL
//                                + "panoramaX:Integer," // X position of the label on the full GSV pano
//                                + "panoramaY:Integer," // Y position of the label on the full GSV pano
//                                + "panoWidth:Integer," // Width of the full GSV pano
//                                + "panoHeight:Integer," // Height of the full GSV pano
//                                + "panoHding:Double," // Heading of the full GSV pano's camera
//                                + "panoPitch:Double," // Pitch of the full GSV pano's camera
//                )
//
//        // Set up the output shapefile.
//        ShapefileDataStoreFactory dataStoreFactory = new ShapefileDataStoreFactory()
//        Map<String, Serializable> params = new HashMap<>()
//        params.put("url", new File(outputFile + ".shp").toURI().toURL())
//        params.put("create spatial index", Boolean.TRUE)
//        ShapefileDataStore newDataStore = (ShapefileDataStore) dataStoreFactory.createNewDataStore(params)
//        newDataStore.createSchema(TYPE)
//
//        String typeName = newDataStore.getTypeNames()[0]
//        SimpleFeatureStore featureStore = (SimpleFeatureStore) newDataStore.getFeatureSource(typeName)
//
//        // Take batches of 20k labels at a time, convert them into a "feature" and add them to the shapefile.
//        GeometryFactory geometryFactory = JTSFactoryFinder.getGeometryFactory()
//        SimpleFeatureBuilder featureBuilder = new SimpleFeatureBuilder(TYPE)
//        int startIndex = 0
//        int batchSize = 20000
//        boolean moreWork = true
//        while (moreWork) {
//            // Query the database for the next batch of labels.
//            List<LabelAllMetadata> labels = JavaConverters.seqAsJavaListConverter(
//                    LabelTable.getAllLabelMetadata(bbox, Option.apply(startIndex), Option.apply(batchSize))
//            ).asJava()
//            List<SimpleFeature> features = new ArrayList<>()
//
//            // Convert the labels into a "feature".
//            for (LabelAllMetadata l: labels) {
//                featureBuilder.add(geometryFactory.createPoint(new Coordinate(l.geom().lng(), l.geom().lat())))
//                featureBuilder.add(l.labelId())
//                featureBuilder.add(l.userId())
//                featureBuilder.add(l.panoId())
//                featureBuilder.add(l.labelType())
//                featureBuilder.add(l.severity().getOrElse(new AbstractFunction0<Integer>() {
//                    @Override public Integer apply() { return null }
//                }))
//                featureBuilder.add("[" + l.tags().mkString(",") + "]")
//                featureBuilder.add(String.valueOf(l.temporary()))
//                featureBuilder.add(l.description().getOrElse(new AbstractFunction0<String>() {
//                    @Override public String apply() { return null }
//                }))
//                featureBuilder.add(l.timeCreated())
//                featureBuilder.add(l.streetEdgeId())
//                featureBuilder.add(String.valueOf(l.osmStreetId()))
//                featureBuilder.add(l.neighborhoodName())
//                featureBuilder.add(l.correcStr().getOrElse(new AbstractFunction0<String>() {
//                    @Override public String apply() { return null }
//                }))
//                featureBuilder.add(l.validationInfo().agreeCount())
//                featureBuilder.add(l.validationInfo().disagreeCount())
//                featureBuilder.add(l.validationInfo().unsureCount())
//                featureBuilder.add("[" + l.validations().mkString(",") + "]")
//                featureBuilder.add(l.auditTaskId())
//                featureBuilder.add(l.missionId())
//                featureBuilder.add(l.imageCaptureDate())
//                featureBuilder.add(l.pov().heading())
//                featureBuilder.add(l.pov().pitch())
//                featureBuilder.add(l.pov().zoom())
//                featureBuilder.add(l.canvasXY().x())
//                featureBuilder.add(l.canvasXY().y())
//                featureBuilder.add(LabelPointTable.canvasWidth())
//                featureBuilder.add(LabelPointTable.canvasHeight())
//                featureBuilder.add(l.gsvUrl())
//                featureBuilder.add(l.panoLocation()._1().x())
//                featureBuilder.add(l.panoLocation()._1().y())
//                featureBuilder.add(l.panoWidth().getOrElse(new AbstractFunction0<Integer>() {
//                    @Override public Integer apply() { return null }
//                }))
//                featureBuilder.add(l.panoHeight().getOrElse(new AbstractFunction0<Integer>() {
//                    @Override public Integer apply() { return null }
//                }))
//                featureBuilder.add(l.cameraHeadingPitch()._1())
//                featureBuilder.add(l.cameraHeadingPitch()._2())
//
//                SimpleFeature feature = featureBuilder.buildFeature(null)
//                features.add(feature)
//            }
//
//            // Add the features to the shapefile.
//            SimpleFeatureCollection collection = new ListFeatureCollection(TYPE, features)
//            Transaction transaction = new DefaultTransaction(outputFile)
//            featureStore.setTransaction(transaction)
//            try {
//                featureStore.addFeatures(collection)
//                transaction.commit()
//            } catch (Exception problem) {
//                problem.printStackTrace()
//                transaction.rollback()
//            } finally {
//                transaction.close()
//            }
//
//            startIndex += batchSize
//            if (labels.size() < batchSize) moreWork = false
//        }
//    }

  def createStreetShapefile(source: Source[AccessScoreStreet, _], outputFile: String, batchSize: Int): Option[Path] = {
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

//    val geometryFactory: GeometryFactory = JTSFactoryFinder.getGeometryFactory
    val featureBuilder: SimpleFeatureBuilder = new SimpleFeatureBuilder(featureType)

    val t00 = System.currentTimeMillis()
    var t0 = System.currentTimeMillis()
    var t1 = System.currentTimeMillis()

    // Process streets in batches.
    val streetList: Seq[Seq[AccessScoreStreet]] = Await.result(source.grouped(batchSize).runWith(Sink.seq), 30.seconds)
    try {
      streetList.foreach { batch =>
        // Create a feature from each street in this batch and add it to the ArrayList.
        val features = new java.util.ArrayList[SimpleFeature]()
        batch.foreach { s =>
          featureBuilder.reset()

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

          val feature: SimpleFeature = featureBuilder.buildFeature(null)
          features.add(feature)
        }

        // Add this batch of features to the shapefile in a transaction.
        val transaction = new DefaultTransaction("create")
        try {
          featureStore.setTransaction(transaction)
          featureStore.addFeatures(DataUtilities.collection(features))
          transaction.commit()
          t1 = System.currentTimeMillis()
          println(s"${t1 - t0} ms to add street features")
          t0 = System.currentTimeMillis()
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
      val t3 = System.currentTimeMillis()
      println(s"${t3 - t00} ms to process all streets")
    }
//      createGeneralShapeFile(outputFile, TYPE, features)
  }

//    public static void createNeighborhoodShapefile(String outputFile, List<NeighborhoodAttributeSignificance> neighborhoods) throws Exception {
//        // We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
//        final SimpleFeatureType TYPE =
//                DataUtilities.createType(
//                        "Location",
//                        "the_geom:Polygon:srid=4326," // line geometry
//                        + "neighborhd:String," // Neighborhood Name
//                        + "nghborhdId:Integer," // Neighborhood Id
//                        + "coverage:Double," // coverage score
//                        + "score:Double," // obstacle score
//                        + "sigRamp:Double," // curb ramp significance weight
//                        + "sigNoRamp:Double," // no Curb ramp significance weight
//                        + "sigObs:Double," // obstacle significance weight
//                        + "sigSurfce:Double," // Surface problem significance weight
//                        + "nRamp:Double," // curb ramp count
//                        + "nNoRamp:Double," // no Curb ramp count
//                        + "nObs:Double," // obstacle count
//                        + "nSurfce:Double," // Surface problem count
//                        + "avgImgDate:String," // average image age in milliseconds
//                        + "avgLblDate:String" // average label age in milliseconds
//                )
//
//        // Take the list of neighborhoods, convert them into a "feature", and add them to the Shapefile.
//        GeometryFactory geometryFactory = JTSFactoryFinder.getGeometryFactory()
//        SimpleFeatureBuilder featureBuilder = new SimpleFeatureBuilder(TYPE)
//        List<SimpleFeature> features = new ArrayList<>()
//        for (NeighborhoodAttributeSignificance n: neighborhoods) {
//            featureBuilder.add(geometryFactory.createPolygon(n.shapefileGeom()))
//            featureBuilder.add(n.name())
//            featureBuilder.add(n.regionID())
//            featureBuilder.add(n.coverage())
//            featureBuilder.add(n.score())
//            featureBuilder.add(n.significanceScores()[0])
//            featureBuilder.add(n.significanceScores()[1])
//            featureBuilder.add(n.significanceScores()[2])
//            featureBuilder.add(n.significanceScores()[3])
//            featureBuilder.add(n.attributeScores()[0])
//            featureBuilder.add(n.attributeScores()[1])
//            featureBuilder.add(n.attributeScores()[2])
//            featureBuilder.add(n.attributeScores()[3])
//            featureBuilder.add(n.avgImageCaptureDate().getOrElse(new AbstractFunction0<Timestamp>() {
//                @Override public Timestamp apply() { return null }
//            }))
//            featureBuilder.add(n.avgLabelDate().getOrElse(new AbstractFunction0<Timestamp>() {
//                @Override public Timestamp apply() { return null }
//            }))
//
//            SimpleFeature feature = featureBuilder.buildFeature(null)
//            features.add(feature)
//        }
//        createGeneralShapeFile(outputFile, TYPE, features)
//    }


  /**
   * Creates a zip archive from the given shapefiles, saving it at s"$baseFileName.zip".
   *
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

    // Set up a stream of the zip archive as a ByteString, setting it up to be deleted afterwards.
    StreamConverters.fromInputStream(() =>
      new BufferedInputStream(Files.newInputStream(zipPath))
    ).mapMaterializedValue(_.map { _ =>
      Files.deleteIfExists(zipPath)
    })
  }
}
