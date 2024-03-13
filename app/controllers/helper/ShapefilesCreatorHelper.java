package controllers.helper;

import java.io.*;
import java.sql.Timestamp;
import java.util.*;
import java.util.zip.*;

import controllers.APIBBox;
import controllers.APIType;
import models.attribute.GlobalAttributeTable;
import models.label.LabelPointTable;
import org.geotools.data.*;
import org.geotools.data.shapefile.*;
import org.geotools.data.simple.*;
import org.opengis.feature.simple.*;
import org.locationtech.jts.geom.Coordinate;
import org.geotools.data.collection.ListFeatureCollection;
import org.geotools.feature.simple.SimpleFeatureBuilder;
import org.geotools.geometry.jts.JTSFactoryFinder;
import org.locationtech.jts.geom.GeometryFactory;
import scala.Option;
import scala.collection.JavaConverters;
import scala.runtime.AbstractFunction0;

import models.attribute.GlobalAttributeForAPI;
import models.attribute.GlobalAttributeWithLabelForAPI;
import controllers.NeighborhoodAttributeSignificance;
import controllers.StreetAttributeSignificance;

/**
 * This class handles the creation of Shapefile archives to be used by the SidewalkAPIController.
 *
 * Code was started and modified from the Geotools feature tutorial: 
 * https://docs.geotools.org/stable/tutorials/feature/csv2shp.html
 *
 */
public class ShapefilesCreatorHelper {

    public static void createGeneralShapeFile(String outputFile, SimpleFeatureType TYPE, List<SimpleFeature> features) throws Exception {
        // Get an output file name and create the new shapefile.
        ShapefileDataStoreFactory dataStoreFactory = new ShapefileDataStoreFactory();

        Map<String, Serializable> params = new HashMap<>();
        params.put("url", new File(outputFile + ".shp").toURI().toURL());
        params.put("create spatial index", Boolean.TRUE);

        ShapefileDataStore newDataStore = (ShapefileDataStore) dataStoreFactory.createNewDataStore(params);

        // TYPE is used as a template to describe the file contents.
        newDataStore.createSchema(TYPE);

        // Write the features to the shapefile.
        Transaction transaction = new DefaultTransaction(outputFile);

        String typeName = newDataStore.getTypeNames()[0];
        SimpleFeatureSource featureSource = newDataStore.getFeatureSource(typeName);
        SimpleFeatureType SHAPE_TYPE = featureSource.getSchema();
        /*
         * The Shapefile format has a couple limitations:
         * - "the_geom" is always first, and used for the geometry attribute name
         * - "the_geom" must be of type Point, MultiPoint, MuiltiLineString, MultiPolygon
         * - Attribute names are limited in length
         * - Integers are limited to 9 digits. Use Strings if integers can be larger
         * - Not all data types are supported (example Timestamp represented as Date)
         *
         * Each data store has different limitations so check the resulting SimpleFeatureType.
         */
        if (featureSource instanceof SimpleFeatureStore) {
            SimpleFeatureStore featureStore = (SimpleFeatureStore) featureSource;
            /*
             * SimpleFeatureStore has a method to add features from a
             * SimpleFeatureCollection object, so we use the ListFeatureCollection
             * class to wrap our list of features.
             */
            SimpleFeatureCollection collection = new ListFeatureCollection(TYPE, features);
            featureStore.setTransaction(transaction);
            try {
                featureStore.addFeatures(collection);
                transaction.commit();
            } catch (Exception problem) {
                problem.printStackTrace();
                transaction.rollback();
            } finally {
                transaction.close();
            }
        }
    }

    public static void createAttributeShapeFile(String outputFile, APIBBox bbox, Option<String> severity) throws Exception {
        // We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
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
                        + "nNotsure:Integer," // Notsure validations
                        + "clusterSze:Integer," // Number of labels in the cluster
                        + "userIds:String" // List of User Ids
                );

        // Set up the output shapefile.
        ShapefileDataStoreFactory dataStoreFactory = new ShapefileDataStoreFactory();
        Map<String, Serializable> params = new HashMap<>();
        params.put("url", new File(outputFile + ".shp").toURI().toURL());
        params.put("create spatial index", Boolean.TRUE);
        ShapefileDataStore newDataStore = (ShapefileDataStore) dataStoreFactory.createNewDataStore(params);
        newDataStore.createSchema(TYPE);

        String typeName = newDataStore.getTypeNames()[0];
        SimpleFeatureStore featureStore = (SimpleFeatureStore) newDataStore.getFeatureSource(typeName);

        // Take batches of 20k attributes at a time, convert them into a "feature" and add them to the shapefile.
        GeometryFactory geometryFactory = JTSFactoryFinder.getGeometryFactory();
        SimpleFeatureBuilder featureBuilder = new SimpleFeatureBuilder(TYPE);
        int startIndex = 0;
        int batchSize = 20000;
        boolean moreWork = true;
        while (moreWork) {
            // Query the database for the next batch of attributes.
            List<GlobalAttributeForAPI> attributes = JavaConverters.seqAsJavaListConverter(
                    GlobalAttributeTable.getGlobalAttributesInBoundingBox(APIType.Attribute(), bbox, severity, Option.apply(startIndex), Option.apply(batchSize))
            ).asJava();
            List<SimpleFeature> features = new ArrayList<>();

            // Convert the attributes into a "feature".
            for (GlobalAttributeForAPI a: attributes) {
                featureBuilder.add(geometryFactory.createPoint(new Coordinate(a.lng(), a.lat())));
                featureBuilder.add(a.globalAttributeId());
                featureBuilder.add(a.labelType());
                featureBuilder.add(a.streetEdgeId());
                featureBuilder.add(String.valueOf(a.osmStreetId()));
                featureBuilder.add(a.neighborhoodName());
                featureBuilder.add(a.avgImageCaptureDate());
                featureBuilder.add(a.avgLabelDate());
                featureBuilder.add(a.severity().getOrElse(new AbstractFunction0<Integer>() {
                    @Override public Integer apply() { return null; }
                }));
                featureBuilder.add(a.temporary());
                featureBuilder.add(a.agreeCount());
                featureBuilder.add(a.disagreeCount());
                featureBuilder.add(a.notsureCount());
                featureBuilder.add(a.labelCount());
                featureBuilder.add("[" + a.usersList().mkString(",") + "]");
                SimpleFeature feature = featureBuilder.buildFeature(null);
                features.add(feature);
            }

            // Add the features to the shapefile.
            SimpleFeatureCollection collection = new ListFeatureCollection(TYPE, features);
            Transaction transaction = new DefaultTransaction(outputFile);
            featureStore.setTransaction(transaction);
            try {
                featureStore.addFeatures(collection);
                transaction.commit();
            } catch (Exception problem) {
                problem.printStackTrace();
                transaction.rollback();
            } finally {
                transaction.close();
            }

            startIndex += batchSize;
            if (attributes.size() < batchSize) moreWork = false;
        }
    }

    public static void createLabelShapeFile(String outputFile, APIBBox bbox, Option<String> severity) throws Exception {
        // We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
                        "Location",
                        "the_geom:Point:srid=4326," // the geometry attribute: Point type
                        + "labelId:Integer," // label ID
                        + "attribId:Integer," // attribute ID
                        + "labelType:String," // Label type
                        + "streetId:Integer," // Street edge ID of the nearest street
                        + "osmWayId:String," // Street OSM ID of the nearest street (10 char max)
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
                        + "imageDate," // Image date
                        + "labelDate," // Label date
                        + "nAgree:Integer," // Agree validations
                        + "nDisagree:Integer," // Disagree validations
                        + "nNotsure:Integer," // Notsure validations
                        + "labelTags:String," // Label Tags
                        + "labelDescr:String," // Label Description
                        + "userId:String," // User Id
                );

        // Set up the output shapefile.
        ShapefileDataStoreFactory dataStoreFactory = new ShapefileDataStoreFactory();
        Map<String, Serializable> params = new HashMap<>();
        params.put("url", new File(outputFile + ".shp").toURI().toURL());
        params.put("create spatial index", Boolean.TRUE);
        ShapefileDataStore newDataStore = (ShapefileDataStore) dataStoreFactory.createNewDataStore(params);
        newDataStore.createSchema(TYPE);

        String typeName = newDataStore.getTypeNames()[0];
        SimpleFeatureStore featureStore = (SimpleFeatureStore) newDataStore.getFeatureSource(typeName);

        // Take batches of 20k attributes at a time, convert them into a "feature" and add them to the shapefile.
        GeometryFactory geometryFactory = JTSFactoryFinder.getGeometryFactory();
        SimpleFeatureBuilder featureBuilder = new SimpleFeatureBuilder(TYPE);
        int startIndex = 0;
        int batchSize = 20000;
        boolean moreWork = true;
        while (moreWork) {
            // Query the database for the next batch of attributes.
            List<GlobalAttributeWithLabelForAPI> labels = JavaConverters.seqAsJavaListConverter(
                    GlobalAttributeTable.getGlobalAttributesWithLabelsInBoundingBox(bbox, severity, Option.apply(startIndex), Option.apply(batchSize))
            ).asJava();
            List<SimpleFeature> features = new ArrayList<>();

            // Convert the attributes into a "feature".
            for (GlobalAttributeWithLabelForAPI l: labels) {
                featureBuilder.add(geometryFactory.createPoint(new Coordinate(Double.parseDouble(l.labelLatLng()._2.toString()), Double.parseDouble(l.labelLatLng()._1.toString()))));
                featureBuilder.add(l.labelId());
                featureBuilder.add(l.globalAttributeId());
                featureBuilder.add(l.labelType());
                featureBuilder.add(l.streetEdgeId());
                featureBuilder.add(String.valueOf(l.osmStreetId()));
                featureBuilder.add(l.neighborhoodName());
                featureBuilder.add(l.labelSeverity().getOrElse(new AbstractFunction0<Integer>() {
                    @Override public Integer apply() { return null; }
                }));
                featureBuilder.add(l.labelTemporary());
                featureBuilder.add(l.gsvPanoramaId());
                featureBuilder.add(l.headingPitchZoom()._1());
                featureBuilder.add(l.headingPitchZoom()._2());
                featureBuilder.add(l.headingPitchZoom()._3());
                featureBuilder.add(l.canvasXY()._1());
                featureBuilder.add(l.canvasXY()._2());
                featureBuilder.add(LabelPointTable.canvasWidth());
                featureBuilder.add(LabelPointTable.canvasHeight());
                featureBuilder.add(l.gsvUrl());
                featureBuilder.add(l.imageLabelDates()._1);
                featureBuilder.add(l.imageLabelDates()._2);
                featureBuilder.add(l.agreeDisagreeNotsureCount()._1());
                featureBuilder.add(l.agreeDisagreeNotsureCount()._2());
                featureBuilder.add(l.agreeDisagreeNotsureCount()._3());
                featureBuilder.add("[" + l.labelTags().mkString(",") + "]");
                featureBuilder.add(l.labelDescription().getOrElse(new AbstractFunction0<String>() {
                    @Override public String apply() { return null; }
                }));
                featureBuilder.add(l.userId());
                SimpleFeature feature = featureBuilder.buildFeature(null);
                features.add(feature);
            }

            // Add the features to the shapefile.
            SimpleFeatureCollection collection = new ListFeatureCollection(TYPE, features);
            Transaction transaction = new DefaultTransaction(outputFile);
            featureStore.setTransaction(transaction);
            try {
                featureStore.addFeatures(collection);
                transaction.commit();
            } catch (Exception problem) {
                problem.printStackTrace();
                transaction.rollback();
            } finally {
                transaction.close();
            }

            startIndex += batchSize;
            if (labels.size() < batchSize) moreWork = false;
        }
    }

    public static void createStreetShapefile(String outputFile, List<StreetAttributeSignificance> streets) throws Exception {
        // We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
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
                );

        // Take the list of streets, convert them into a "feature", and add them to the Shapefile.
        GeometryFactory geometryFactory = JTSFactoryFinder.getGeometryFactory();
        SimpleFeatureBuilder featureBuilder = new SimpleFeatureBuilder(TYPE);
        List<SimpleFeature> features = new ArrayList<>();
        for (StreetAttributeSignificance s: streets) {
            featureBuilder.add(geometryFactory.createLineString(s.geometry()));
            featureBuilder.add(s.streetID());
            featureBuilder.add(String.valueOf(s.osmID()));
            featureBuilder.add(s.regionID());
            featureBuilder.add(s.score());
            featureBuilder.add(s.auditCount());
            featureBuilder.add(s.significanceScores()[0]);
            featureBuilder.add(s.significanceScores()[1]);
            featureBuilder.add(s.significanceScores()[2]);
            featureBuilder.add(s.significanceScores()[3]);
            featureBuilder.add(s.attributeScores()[0]);
            featureBuilder.add(s.attributeScores()[1]);
            featureBuilder.add(s.attributeScores()[2]);
            featureBuilder.add(s.attributeScores()[3]);
            featureBuilder.add(s.avgImageCaptureDate().getOrElse(new AbstractFunction0<Timestamp>() {
                @Override public Timestamp apply() { return null; }
            }));
            featureBuilder.add(s.avgLabelDate().getOrElse(new AbstractFunction0<Timestamp>() {
                @Override public Timestamp apply() { return null; }
            }));

            SimpleFeature feature = featureBuilder.buildFeature(null);
            features.add(feature);
        }

        createGeneralShapeFile(outputFile, TYPE, features);
    }

    public static void createNeighborhoodShapefile(String outputFile, List<NeighborhoodAttributeSignificance> neighborhoods) throws Exception {
        // We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
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
                );

        // Take the list of neighborhoods, convert them into a "feature", and add them to the Shapefile.
        GeometryFactory geometryFactory = JTSFactoryFinder.getGeometryFactory();
        SimpleFeatureBuilder featureBuilder = new SimpleFeatureBuilder(TYPE);
        List<SimpleFeature> features = new ArrayList<>();
        for (NeighborhoodAttributeSignificance n: neighborhoods) {
            featureBuilder.add(geometryFactory.createPolygon(n.shapefileGeom()));
            featureBuilder.add(n.name());
            featureBuilder.add(n.regionID());
            featureBuilder.add(n.coverage());
            featureBuilder.add(n.score());
            featureBuilder.add(n.significanceScores()[0]);
            featureBuilder.add(n.significanceScores()[1]);
            featureBuilder.add(n.significanceScores()[2]);
            featureBuilder.add(n.significanceScores()[3]);
            featureBuilder.add(n.attributeScores()[0]);
            featureBuilder.add(n.attributeScores()[1]);
            featureBuilder.add(n.attributeScores()[2]);
            featureBuilder.add(n.attributeScores()[3]);
            featureBuilder.add(n.avgImageCaptureDate().getOrElse(new AbstractFunction0<Timestamp>() {
                @Override public Timestamp apply() { return null; }
            }));
            featureBuilder.add(n.avgLabelDate().getOrElse(new AbstractFunction0<Timestamp>() {
                @Override public Timestamp apply() { return null; }
            }));

            SimpleFeature feature = featureBuilder.buildFeature(null);
            features.add(feature);
        }
        createGeneralShapeFile(outputFile, TYPE, features);
    }

    /*
     * Creates a zip archive from the given array of shapefile filenames, and returns
     * the zip archive as a java File type.
     *
     * name - The name of the zip archive
     * files - an array of names of shapefiles that should be in a zip archive
     */
    public static File zipShapeFiles(String name, String[] files) throws IOException {
        FileOutputStream fos = new FileOutputStream(name + ".zip");
        ZipOutputStream zipOut = new ZipOutputStream(fos);
        for (String outputFile: files) {
            List<String> components = Arrays.asList(outputFile + ".dbf", outputFile + ".fix", outputFile + ".prj",
                    outputFile + ".shp", outputFile + ".shx");
            for (String srcFile : components) {
                try {
                    File fileToZip = new File(srcFile);
                    FileInputStream fis = new FileInputStream(srcFile);
                    ZipEntry zipEntry = new ZipEntry(fileToZip.getName());
                    zipOut.putNextEntry(zipEntry);

                    byte[] bytes = new byte[1024];
                    int length;
                    while ((length = fis.read(bytes)) >= 0) {
                        zipOut.write(bytes, 0, length);
                    }
                    fis.close();
                    fileToZip.delete();
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }
        zipOut.close();
        fos.close();
        return new File(name + ".zip");
    }
}
