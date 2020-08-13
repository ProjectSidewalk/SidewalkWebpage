package controllers.helper;

import org.locationtech.jts.geom.Coordinate;

public class Neighborhood {
    public String name;
    public Coordinate[] geometry;
    public int regionId;
    public double coverage;
    public double score;


    public Neighborhood(String name, Coordinate[] geometry, int regionId){
        this.name = name;
        this.geometry = geometry;
        this.regionId = regionId;
    }


    public Neighborhood(String name, Coordinate[] geometry, int regionId, double coverage, double score){
        this(name, geometry, regionId);
        this.coverage = coverage;
        this.score = score;
    }

    public static class Attribute{
        public Coordinate[] geometry;
        public int regionId;
        public double curbRamp;
        public double noCurbRamp;
        public double obstacle;
        public double surfaceProblem;

        public Attribute(int regionId, Coordinate[] geometry, double[] values){
            this.geometry = geometry;
            this.regionId = regionId;
            this.curbRamp = values[0];
            this.noCurbRamp = values[1];
            this.obstacle = values[2];
            this.surfaceProblem = values[3];

        }

    }
    public static class Significance{
        public Coordinate[] geometry;
        public int regionId;
        public double curbRamp;
        public double noCurbRamp;
        public double obstacle;
        public double surfaceProblem;

        public Significance(int regionId, Coordinate[] geometry, double[] values){
            this.geometry = geometry;
            this.regionId = regionId;
            this.curbRamp = values[0];
            this.noCurbRamp = values[1];
            this.obstacle = values[2];
            this.surfaceProblem = values[3];

        }
    }

}
