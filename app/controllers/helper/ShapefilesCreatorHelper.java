package controllers.helper;

import java.io.*;
import java.sql.Timestamp;
import java.util.*;
import java.util.zip.*;
import org.geotools.data.*;
import org.geotools.data.shapefile.*;
import org.geotools.data.simple.*;
import org.opengis.feature.simple.*;
import org.locationtech.jts.geom.Coordinate;
import org.geotools.data.collection.ListFeatureCollection;
import org.geotools.feature.simple.SimpleFeatureBuilder;
import org.geotools.geometry.jts.JTSFactoryFinder;
import org.locationtech.jts.geom.GeometryFactory;
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
        /*
         * Get an output file name and create the new shapefile
         */
        ShapefileDataStoreFactory dataStoreFactory = new ShapefileDataStoreFactory();

        Map<String, Serializable> params = new HashMap<>();
        params.put("url", new File(outputFile + ".shp").toURI().toURL());
        params.put("create spatial index", Boolean.TRUE);

        ShapefileDataStore newDataStore = (ShapefileDataStore) dataStoreFactory.createNewDataStore(params);

        /*
         * TYPE is used as a template to describe the file contents
         */
        newDataStore.createSchema(TYPE);

        /*
         * Write the features to the shapefile
         */
        Transaction transaction = new DefaultTransaction("create");

        String typeName = newDataStore.getTypeNames()[0];
        SimpleFeatureSource featureSource = newDataStore.getFeatureSource(typeName);
        SimpleFeatureType SHAPE_TYPE = featureSource.getSchema();
        /*
         * The Shapefile format has a couple limitations:
         * - "the_geom" is always first, and used for the geometry attribute name
         * - "the_geom" must be of type Point, MultiPoint, MuiltiLineString, MultiPolygon
         * - Attribute names are limited in length
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

    public static void createAttributeShapeFile(String outputFile, List<GlobalAttributeForAPI> attributes) throws Exception {
        /*
         * We use the DataUtilities class to create a FeatureType that will describe the data in our
         * shapefile.
         *
         * See also the createFeatureType method below for another, more flexible approach.
         */
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
                        "Location",
                        "the_geom:Point:srid=4326," // the geometry attribute: Point type
                        + "id:Integer," // a attribute ID
                        + "labelType:String," // Label type
                        + "streetId:Integer," // Street edge ID of the nearest street
                        + "osmWayId:Integer," // Street OSM ID of the nearest street
                        + "neighborhd:String," // Neighborhood Name
                        + "avgImgDate:String," // Image date
                        + "avgLblDate:String," // Label date
                        + "severity:Integer," // Severity
                        + "temporary:Boolean," // Temporary flag
                        + "nAgree:Integer," // Agree validations
                        + "nDisagree:Integer," // Disagree validations
                        + "nNotsure:Integer" // Notsure validations
                );

        /*
         * A list to collect features as we create them.
         */
        List<SimpleFeature> features = new ArrayList<>();

        /*
         * GeometryFactory will be used to create the geometry attribute of each feature,
         * using a Point object for the location.
         */
        GeometryFactory geometryFactory = JTSFactoryFinder.getGeometryFactory();

        SimpleFeatureBuilder featureBuilder = new SimpleFeatureBuilder(TYPE);

        for(GlobalAttributeForAPI a : attributes){
            featureBuilder.add(geometryFactory.createPoint(new Coordinate(a.lng(), a.lat())));
            featureBuilder.add(a.globalAttributeId());
            featureBuilder.add(a.labelType());
            featureBuilder.add(a.streetEdgeId());
            featureBuilder.add(a.osmStreetId());
            featureBuilder.add(a.neighborhoodName());
            featureBuilder.add(a.avgImageDate());
            featureBuilder.add(a.avgLabelDate());
            featureBuilder.add(a.severity().getOrElse(new AbstractFunction0<Integer>() {
                @Override
                public Integer apply() {
                    return null;
                }
            }));
            featureBuilder.add(a.temporary());
            featureBuilder.add(a.agreeCount());
            featureBuilder.add(a.disagreeCount());
            featureBuilder.add(a.notsureCount());
            SimpleFeature feature = featureBuilder.buildFeature(null);
            features.add(feature);
        }
        createGeneralShapeFile(outputFile, TYPE, features);
    }

    public static void createLabelShapeFile(String outputFile, List<GlobalAttributeWithLabelForAPI> labels) throws Exception {
        /*
         * We use the DataUtilities class to create a FeatureType that will describe the data in our
         * shapefile.
         *
         * See also the createFeatureType method below for another, more flexible approach.
         */
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
                        "Location",
                        "the_geom:Point:srid=4326," // the geometry attribute: Point type
                        + "labelId:Integer," // label ID
                        + "attribId:Integer," // attribute ID
                        + "labelType:String," // Label type
                        + "streetId:Integer," // Street edge ID of the nearest street
                        + "osmWayId:Integer," // Street OSM ID of the nearest street (10 char max)
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
                        + "labelDescr:String" // Label Description
                );



        /*
         * A list to collect features as we create them.
         */
        List<SimpleFeature> features = new ArrayList<>();

        /*
         * GeometryFactory will be used to create the geometry attribute of each feature,
         * using a Point object for the location.
         */
        GeometryFactory geometryFactory = JTSFactoryFinder.getGeometryFactory();

        SimpleFeatureBuilder featureBuilder = new SimpleFeatureBuilder(TYPE);

        for(GlobalAttributeWithLabelForAPI l : labels){
            featureBuilder.add(geometryFactory.createPoint(new Coordinate(Double.parseDouble(l.labelLatLng()._2.toString()), Double.parseDouble(l.labelLatLng()._1.toString()))));
            featureBuilder.add(l.labelId());
            featureBuilder.add(l.globalAttributeId());
            featureBuilder.add(l.labelType());
            featureBuilder.add(l.streetEdgeId());
            featureBuilder.add(l.osmStreetId());
            featureBuilder.add(l.neighborhoodName());
            featureBuilder.add(l.labelSeverity().getOrElse(new AbstractFunction0<Integer>() {
                @Override
                public Integer apply() {
                    return null;
                }
            }));
            featureBuilder.add(l.labelTemporary());
            featureBuilder.add(l.gsvPanoramaId());
            featureBuilder.add(l.headingPitchZoom()._1());
            featureBuilder.add(l.headingPitchZoom()._2());
            featureBuilder.add(l.headingPitchZoom()._3());
            featureBuilder.add(l.canvasXY()._1());
            featureBuilder.add(l.canvasXY()._2());
            featureBuilder.add(l.canvasWidthHeight()._1());
            featureBuilder.add(l.canvasWidthHeight()._2());
            featureBuilder.add(l.gsvUrl());
            featureBuilder.add(l.imageLabelDates()._1);
            featureBuilder.add(l.imageLabelDates()._2);
            featureBuilder.add(l.agreeCount());
            featureBuilder.add(l.disagreeCount());
            featureBuilder.add(l.notsureCount());
            featureBuilder.add("[" + l.labelTags().mkString(",") + "]");
            featureBuilder.add(l.labelDescription().getOrElse(new AbstractFunction0<String>() {
                @Override
                public String apply() {
                    return null;
                }
            }));
            SimpleFeature feature = featureBuilder.buildFeature(null);
            features.add(feature);
        }

        createGeneralShapeFile(outputFile, TYPE, features);
    }

    public static void createStreetShapefile(String outputFile, List<StreetAttributeSignificance> streets) throws Exception{
        /*
         * We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
         *
         * See also the createFeatureType method below for another, more flexible approach.
         */
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
                        "Location",
                        "the_geom:LineString:srid=4326," // the geometry attribute: Line type
                        + "streetId:Integer," // StreetId
                        + "osmWayId:Integer," // osmWayId
                        + "score:Double," // street score
                        + "auditCount:Integer," // boolean representing whether the street is audited
                        + "sigRamp:Double," // curb ramp significance score
                        + "sigNoRamp:Double," // no Curb ramp significance score
                        + "sigObs:Double," // obstacle significance score
                        + "sigSurfce:Double," // Surface problem significance score
                        + "nRamp:Double," // curb ramp feature score
                        + "nNoRamp:Double," // no Curb ramp feature score
                        + "nObs:Double," // obstacle feature score
                        + "nSurfce:Double," // Surface problem feature score
                        + "avgImgDate:String," // average image age in milliseconds
                        + "avgLblDate:String" // average label age in milliseconds
                );

        /*
         * A list to collect features as we create them.
         */
        List<SimpleFeature> features = new ArrayList<>();

        /*
         * GeometryFactory will be used to create the geometry attribute of each feature,
         * using a Point object for the location.
         */
        GeometryFactory geometryFactory = JTSFactoryFinder.getGeometryFactory();

        SimpleFeatureBuilder featureBuilder = new SimpleFeatureBuilder(TYPE);

        for (StreetAttributeSignificance s : streets) {
            featureBuilder.add(geometryFactory.createLineString(s.geometry()));
            featureBuilder.add(s.streetID());
            featureBuilder.add(s.osmID());
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
            featureBuilder.add(s.avgImageDate().getOrElse(new AbstractFunction0<Timestamp>() {
                @Override
                public Timestamp apply() {
                    return null;
                }
            }));
            featureBuilder.add(s.avgLabelDate().getOrElse(new AbstractFunction0<Timestamp>() {
                @Override
                public Timestamp apply() {
                    return null;
                }
            }));

            SimpleFeature feature = featureBuilder.buildFeature(null);
            features.add(feature);
        }

        createGeneralShapeFile(outputFile, TYPE, features);
    }

    public static void createNeighborhoodShapefile(String outputFile, List<NeighborhoodAttributeSignificance> neighborhoods) throws Exception{
        /*
         * We use the DataUtilities class to create a FeatureType that will describe the data in our shapefile.
         *
         * See also the createFeatureType method below for another, more flexible approach.
         */
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
                        "Location",
                        "the_geom:Polygon:srid=4326," // line geometry
                        + "neighborhd:String," // Neighborhood Name
                        + "regionId:Integer," // Neighborhood Id
                        + "coverage:Double," // coverage score
                        + "score:Double," // obstacle score
                        + "sigRamp:Double," // curb ramp significance score
                        + "sigNoRamp:Double," // no Curb ramp significance score
                        + "sigObs:Double," // obstacle significance score
                        + "sigSurfce:Double," // Surface problem significance score
                        + "nRamp:Double," // curb ramp feature score
                        + "nNoRamp:Double," // no Curb ramp feature score
                        + "nObs:Double," // obstacle feature score
                        + "nSurfce:Double," // Surface problem feature score
                        + "avgImgDate:String," // average image age in milliseconds
                        + "avgLblDate:String" // average label age in milliseconds
                );

        /*
         * A list to collect features as we create them.
         */
        List<SimpleFeature> features = new ArrayList<>();

        /*
         * GeometryFactory will be used to create the geometry attribute of each feature,
         * using a Point object for the location.
         */
        GeometryFactory geometryFactory = JTSFactoryFinder.getGeometryFactory();

        SimpleFeatureBuilder featureBuilder = new SimpleFeatureBuilder(TYPE);

        for(NeighborhoodAttributeSignificance n : neighborhoods){
            featureBuilder.add(geometryFactory.createPolygon(n.geometry()));
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
            featureBuilder.add(n.avgImageDate().getOrElse(new AbstractFunction0<Timestamp>() {
                @Override
                public Timestamp apply() {
                    return null;
                }
            }));
            featureBuilder.add(n.avgLabelDate().getOrElse(new AbstractFunction0<Timestamp>() {
                @Override
                public Timestamp apply() {
                    return null;
                }
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
        for (String outputFile: files){
            List<String> components = Arrays.asList(outputFile + ".dbf", outputFile + ".fix", outputFile + ".prj",
                    outputFile + ".shp", outputFile + ".shx");
            for (String srcFile : components){
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
                } catch (Exception e){
                }
            }
        }
        zipOut.close();
        fos.close();

        return new File(name + ".zip");
    }
}
