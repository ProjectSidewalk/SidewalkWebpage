package controllers.helper;

import java.io.*;
import java.util.*;
import java.util.zip.*;

import org.geotools.data.DataUtilities;
import org.geotools.data.DefaultTransaction;
import org.geotools.data.Transaction;
import org.geotools.data.collection.ListFeatureCollection;
import org.geotools.data.shapefile.ShapefileDataStore;
import org.geotools.data.shapefile.ShapefileDataStoreFactory;
import org.geotools.data.simple.SimpleFeatureCollection;
import org.geotools.data.simple.SimpleFeatureSource;
import org.geotools.data.simple.SimpleFeatureStore;
import org.geotools.feature.simple.SimpleFeatureBuilder;
import org.geotools.geometry.jts.JTSFactoryFinder;
import org.locationtech.jts.geom.GeometryFactory;
import org.opengis.feature.simple.SimpleFeature;
import org.opengis.feature.simple.SimpleFeatureType;

/**
 * This example reads data for point locations and associated attributes from a comma separated text
 * (CSV) file and exports them as a new shapefile. It illustrates how to build a feature type.
 *
 * <p>Note: to keep things simple in the code below the input file should not have additional spaces
 * or tabs between fields.
 */
public class ShapefilesCreatorHelper {


    public static void createGeneralShapeFile(String outputFile, SimpleFeatureType TYPE, List<SimpleFeature> features) throws Exception{
        /*
         * Get an output file name and create the new shapefile
         */
        ShapefileDataStoreFactory dataStoreFactory = new ShapefileDataStoreFactory();

        Map<String, Serializable> params = new HashMap<>();
        params.put("url", new File(outputFile + ".shp").toURI().toURL());
        params.put("create spatial index", Boolean.TRUE);

        ShapefileDataStore newDataStore =
                (ShapefileDataStore) dataStoreFactory.createNewDataStore(params);

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

    public static void createAttributeShapeFile(String outputFile, List<Attribute> attributes) throws Exception {

        /*
         * We use the DataUtilities class to create a FeatureType that will describe the data in our
         * shapefile.
         *
         * See also the createFeatureType method below for another, more flexible approach.
         */
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
                        "Location",
                        "the_geom:Point:srid=4326,"
                                + // <- the geometry attribute: Point type
                                "id:Integer,"
                                + // <- a attribute ID
                                "label_type:String,"
                                + // <- Label type
                                "name:String,"
                                + // <- Neighborhood Name
                                "severity:Integer,"
                                + // <- Severity
                                "temporary:Boolean" // Temporary flag
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

        for(Attribute a : attributes){
            featureBuilder.add(geometryFactory.createPoint(a.coordinate));
            featureBuilder.add(a.id);
            featureBuilder.add(a.labelType);
            featureBuilder.add(a.neighborhood);
            featureBuilder.add(a.severity);
            featureBuilder.add(a.temporary);
            SimpleFeature feature = featureBuilder.buildFeature(null);
            features.add(feature);
        }


        createGeneralShapeFile(outputFile, TYPE, features);

    }


    public static void createLabelShapeFile(String outputFile, List<Label> labels) throws Exception {

        /*
         * We use the DataUtilities class to create a FeatureType that will describe the data in our
         * shapefile.
         *
         * See also the createFeatureType method below for another, more flexible approach.
         */
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
                        "Location",
                        "the_geom:Point:srid=4326,"
                                + // <- the geometry attribute: Point type
                                "labelId:Integer,"
                                + // <- label ID
                                "attribId:Integer,"
                                + // <- attribute ID
                                "lblType:String,"
                                + // <- Label type
                                "name:String,"
                                + // <- Neighborhood Name
                                "severity:Integer,"
                                + // <- Severity
                                "temp:Boolean" // Temporary flag
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

        for(Label l : labels){
            featureBuilder.add(geometryFactory.createPoint(l.coordinate));
            featureBuilder.add(l.labelId);
            featureBuilder.add(l.attributeId);
            featureBuilder.add(l.labelType);
            featureBuilder.add(l.neighborhoodName);
            featureBuilder.add(l.severity);
            featureBuilder.add(l.temporary);

            SimpleFeature feature = featureBuilder.buildFeature(null);
            features.add(feature);
        }


        createGeneralShapeFile(outputFile, TYPE, features);
    }

    public static void createStreetShapefile(String outputFile, List<Street> streets) throws Exception{
        /*
         * We use the DataUtilities class to create a FeatureType that will describe the data in our
         * shapefile.
         *
         * See also the createFeatureType method below for another, more flexible approach.
         */
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
                        "Location",
                        "the_geom:LineString:srid=4326,"
                                + // <- the geometry attribute: Line type
                                "streetId:Integer,"
                                + // <- StreetId
                                "score:Double," // street score
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

        for(Street s : streets){
            featureBuilder.add(geometryFactory.createLineString(s.geometry));
            featureBuilder.add(s.streetId);
            featureBuilder.add(s.score);

            SimpleFeature feature = featureBuilder.buildFeature(null);
            features.add(feature);
        }


        createGeneralShapeFile(outputFile, TYPE, features);

    }

    public static void createStreetAttributeShapefile(String outputFile, List<Street.Attribute> streets) throws Exception{
        /*
         * We use the DataUtilities class to create a FeatureType that will describe the data in our
         * shapefile.
         *
         * See also the createFeatureType method below for another, more flexible approach.
         */
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
                        "Location",
                            "the_geom:LineString:srid=4326,"
                                + // line geometry
                                "streetId:Integer,"
                                + // <- StreetId
                                "curbRamp:Double,"
                                + // <- curb ramp score
                                "noCurbRamp:Double,"
                                + // no Curb ramp score
                                "obstacle:Double,"
                                + // obstacle score
                                "surfProb:Double" // Surface problem score
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

        for(Street.Attribute s : streets){
            featureBuilder.add(geometryFactory.createLineString(s.geometry));
            featureBuilder.add(s.streetId);
            featureBuilder.add(s.curbRamp);
            featureBuilder.add(s.noCurbRamp);
            featureBuilder.add(s.obstacle);
            featureBuilder.add(s.surfaceProblem);

            SimpleFeature feature = featureBuilder.buildFeature(null);
            features.add(feature);
        }



        createGeneralShapeFile(outputFile, TYPE, features);

    }

    public static void createStreetSignificanceShapefile(String outputFile, List<Street.Significance> streets) throws Exception{
        /*
         * We use the DataUtilities class to create a FeatureType that will describe the data in our
         * shapefile.
         *
         * See also the createFeatureType method below for another, more flexible approach.
         */
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
                        "Location",
                        "the_geom:LineString:srid=4326,"
                                + // line geometry
                                "streetId:Integer,"
                                + // <- StreetId
                                "curbRamp:Double,"
                                + // <- curb ramp score
                                "noCurbRamp:Double,"
                                + // no Curb ramp score
                                "obstacle:Double,"
                                + // obstacle score
                                "surfProb:Double" // Surface problem score
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

        for(Street.Significance s : streets){
            featureBuilder.add(geometryFactory.createLineString(s.geometry));
            featureBuilder.add(s.streetId);
            featureBuilder.add(s.curbRamp);
            featureBuilder.add(s.noCurbRamp);
            featureBuilder.add(s.obstacle);
            featureBuilder.add(s.surfaceProblem);

            SimpleFeature feature = featureBuilder.buildFeature(null);
            features.add(feature);
        }



        createGeneralShapeFile(outputFile, TYPE, features);

    }

    public static void createNeighborhoodShapefile(String outputFile, List<Neighborhood> neighborhoods) throws Exception{
        /*
         * We use the DataUtilities class to create a FeatureType that will describe the data in our
         * shapefile.
         *
         * See also the createFeatureType method below for another, more flexible approach.
         */
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
                        "Location",
                        "the_geom:Polygon:srid=4326,"
                                + // line geometry
                                "name:String,"
                                + // <- Neighborhood Name
                                "regionId:Integer,"
                                + // <- Neighborhood Id
                                "coverage:Double,"
                                + // coverage score
                                "score:Double," // obstacle score
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

        for(Neighborhood n : neighborhoods){
            featureBuilder.add(geometryFactory.createPolygon(n.geometry));
            featureBuilder.add(n.name);
            featureBuilder.add(n.regionId);
            featureBuilder.add(n.coverage);
            featureBuilder.add(n.score);

            SimpleFeature feature = featureBuilder.buildFeature(null);
            features.add(feature);
        }


        createGeneralShapeFile(outputFile, TYPE, features);

    }


    public static void createNeighborhoodAttributeShapefile(String outputFile, List<Neighborhood.Attribute> neighborhoods) throws Exception{
        /*
         * We use the DataUtilities class to create a FeatureType that will describe the data in our
         * shapefile.
         *
         * See also the createFeatureType method below for another, more flexible approach.
         */
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
                        "Location",
                        "the_geom:LineString:srid=4326,"
                                + // line geometry
                                "regionId:Integer,"
                                + // <- StreetId
                                "curbRamp:Double,"
                                + // <- curb ramp score
                                "noCurbRamp:Double,"
                                + // no Curb ramp score
                                "obstacle:Double,"
                                + // obstacle score
                                "surfProb:Double" // Surface problem score
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

        for(Neighborhood.Attribute n : neighborhoods){
            featureBuilder.add(geometryFactory.createPolygon(n.geometry));
            featureBuilder.add(n.regionId);
            featureBuilder.add(n.curbRamp);
            featureBuilder.add(n.noCurbRamp);
            featureBuilder.add(n.obstacle);
            featureBuilder.add(n.surfaceProblem);

            SimpleFeature feature = featureBuilder.buildFeature(null);
            features.add(feature);
        }



        createGeneralShapeFile(outputFile, TYPE, features);

    }

    public static void createNeighborhoodSignificanceShapefile(String outputFile, List<Neighborhood.Significance> neighborhoods) throws Exception{
        /*
         * We use the DataUtilities class to create a FeatureType that will describe the data in our
         * shapefile.
         *
         * See also the createFeatureType method below for another, more flexible approach.
         */
        final SimpleFeatureType TYPE =
                DataUtilities.createType(
                        "Location",
                        "the_geom:LineString:srid=4326,"
                                + // line geometry
                                "regionId:Integer,"
                                + // <- StreetId
                                "curbRamp:Double,"
                                + // <- curb ramp score
                                "noCurbRamp:Double,"
                                + // no Curb ramp score
                                "obstacle:Double,"
                                + // obstacle score
                                "surfProb:Double" // Surface problem score
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

        for(Neighborhood.Significance n : neighborhoods){
            featureBuilder.add(geometryFactory.createPolygon(n.geometry));
            featureBuilder.add(n.regionId);
            featureBuilder.add(n.curbRamp);
            featureBuilder.add(n.noCurbRamp);
            featureBuilder.add(n.obstacle);
            featureBuilder.add(n.surfaceProblem);

            SimpleFeature feature = featureBuilder.buildFeature(null);
            features.add(feature);
        }



        createGeneralShapeFile(outputFile, TYPE, features);

    }

    public static File zipShapeFiles(String name, String[] files) throws IOException{
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