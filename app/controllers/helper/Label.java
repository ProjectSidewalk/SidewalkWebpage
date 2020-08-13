package controllers.helper;

import org.locationtech.jts.geom.Coordinate;

public class Label {
    public Coordinate coordinate;
    public int labelId;
    public int attributeId;
    public String labelType;
    public String neighborhoodName;
    public int severity;
    public boolean temporary;

    public Label(Coordinate coordinate, int labelId, int attributeId, String labelType, String neighborhoodName, int severity, boolean temporary) {
        this.coordinate = coordinate;
        this.labelId = labelId;
        this.attributeId = attributeId;
        this.labelType = labelType;
        this.neighborhoodName = neighborhoodName;
        this.severity = severity;
        this.temporary = temporary;
    }
    public Label(){};
}