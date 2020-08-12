package controllers.helper;

import org.locationtech.jts.geom.Coordinate;
public class Street {
    public Coordinate[] geometry;
    public int streetId;
    public double score;

    public static class Attribute{
        public Coordinate[] geometry;
        public int streetId;
        public double curbRamp;
        public double noCurbRamp;
        public double obstacle;
        public double surfaceProblem;

        public Attribute(int streetId, Coordinate[] geometry, double[] values){
            this.geometry = geometry;
            this.streetId = streetId;
            this.curbRamp = values[0];
            this.noCurbRamp = values[1];
            this.obstacle = values[2];
            this.surfaceProblem = values[3];

        }

    }
    public static class Significance{
        public Coordinate[] geometry;
        public int streetId;
        public double curbRamp;
        public double noCurbRamp;
        public double obstacle;
        public double surfaceProblem;

        public Significance(int streetId, Coordinate[] geometry, double[] values){
            this.geometry = geometry;
            this.streetId = streetId;
            this.curbRamp = values[0];
            this.noCurbRamp = values[1];
            this.obstacle = values[2];
            this.surfaceProblem = values[3];

        }
    }
}
