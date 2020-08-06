package controllers.helper;

import org.locationtech.jts.geom.Coordinate;

public class Label {
    public Coordinate coordinate;
    public int labelId;
    public int attributeId;
    public String labelType;
    public String neighborhoodName;
    public String gsvPanoramaId;
    public float heading;
    public float pitch;
    public int zoom;
    public Coordinate canvas;
    public int canvasWidth;
    public int canvasHeight;
    public int severity;
    public boolean temporary;

}