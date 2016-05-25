package controllers

import models.sidewalk.{SidewalkEdgeTable, SidewalkEdge}

import play.api.mvc._
import play.api.libs.json._
import play.extras.geojson
import com.vividsolutions.jts.io.{WKBReader, WKBWriter, WKTReader}
import com.vividsolutions.jts.geom.{Coordinate, GeometryFactory, PrecisionModel}

import formats.json.SidewalkFormats._

/**
 * References:
 * play-geojson: https://github.com/jroper/play-geojson
 * jts coordinate: http://www.vividsolutions.com/jts/javadoc/com/vividsolutions/jts/geom/Coordinate.html
 * JTS GeometryFactory: http://programcreek.com/java-api-examples/index.php?api=com.vividsolutions.jts.geom.PrecisionModel
  */

object SidewalkController extends Controller {

  val wkbReader = new WKBReader()
  val wkbWriter = new WKBWriter(2, true)
  val wktReader = new WKTReader()
  val pm = new PrecisionModel()
  val srid = 4326
  val fact: GeometryFactory = new GeometryFactory(pm, srid)
  val rand = new scala.util.Random  // http://stackoverflow.com/questions/7783902/can-scala-util-random-nextint-int-occasionally-return-a-negative-value

  /**
   *
   * @return
   */
  def index = Action {
    val sidewalks = SidewalkEdgeTable.all
    Ok(views.html.sidewalks.list(sidewalks))
  }

  /**
   * This method returns a collection of all the sidewalk edges in the sidewalk_edges table
   * in a Geojson format.
   *
   * @return A FeatureCollection of LineStrings in Geojson
   */
  def listSidewalks = Action {

    val features: List[JsObject] = SidewalkEdgeTable.all.map { edge =>
      val coordinates: Array[Coordinate] = edge.geom.getCoordinates
      val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList  // Map it to an immutable list
      val linestring: geojson.LineString[geojson.LatLng] = geojson.LineString(latlngs)
      val properties = Json.obj(
        "sidewalk_edge_id" -> edge.sidewalkEdgeId,
        "source" -> edge.source,
        "target" -> edge.target,
        "way_type" -> edge.wayType,
        "parent_sidewalk_edge_id" -> JsNull
      )
      Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)  // I'm being explicit about geojson.LineString because it collides with a class in JTS.
    }

    val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
    Ok(featureCollection)
  }

  /**
   * This method changes the column deleted to be true
   * @param sidewalkEdgeId A sidewalk edge id
   * @return
   */
  def removeSidewalk(sidewalkEdgeId: Int) = Action {
    SidewalkEdgeTable.delete(sidewalkEdgeId)
    Ok("Removed a sidewalk")
  }

  /**
   * This method edits existing sidewalk edges. It first inserts new edited sidewalk edges based on the passed LineStrings, then sets the deleted column of
   * parent sidewalk edges to be deleted.
   *
   * @return
   */
  def editSidewalks = TODO
//  def editSidewalks = Action(BodyParsers.parse.json) { request =>
//    val featureCollectionResult = request.body.validate[FeatureCollection]
//    featureCollectionResult.fold(
//      errors => {
//        BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors)))
//      },
//      featureCollection => {
//        featureCollection.features.foreach { feature =>
//
//          val coordinates = feature.geometry.coordinates
//          val properties = feature.properties
//          val coord: Array[Coordinate] = coordinates.map(coord => new Coordinate(coord.head.toDouble, coord(1).toDouble)).toArray
//          val newLineString = fact.createLineString(coord)
//
//          val sourceId = properties.source.getOrElse(-1) // Todo. Create a new node if id is not specified
//          val targetId = properties.target.getOrElse(-1) // Todo. Create a new ndoe if id is not speficied
//
//          properties.parentSidewalkEdgeId match {
//            case None => None
//            case _ =>
//              val edge: SidewalkEdge = new SidewalkEdge(Some(rand.nextInt(Integer.MAX_VALUE)), newLineString, sourceId, targetId,
//                coord.head.x.toFloat, coord.head.y.toFloat, coord.last.x.toFloat, coord.last.y.toFloat, properties.wayType, properties.parentSidewalkEdgeId, false, None)
//
//              SidewalkEdgeTable.delete(properties.parentSidewalkEdgeId.get) // Delete the parent
//
//              val id = SidewalkEdgeTable.save(edge)
//          }
//        }
//
//        Ok(Json.obj("status" -> "OK", "message" -> "FeatureCollection created."))  // Todo. Return a mapping from parentSidewalkEdgeId to the new
//      }
//    )
//  }


  /**
   * This method takes a FeatureCollection of LineStrings in a Geojson format.
   *
   * References:
   * Using Json with Play 1. https://www.playframework.com/documentation/2.3.x/ScalaJson
   * Using Json with Play 2. https://www.playframework.com/documentation/2.3.x/ScalaJsonHttp
   * Using Json with Play 3. https://www.playframework.com/documentation/2.3.x/ScalaBodyParsers
   * JTS, a list of coordinates to a polygon. http://stackoverflow.com/questions/6570017/how-to-create-a-polygon-in-jts-when-we-have-list-of-coordinate
   * JTS. GeometryFactory documentation. http://www.vividsolutions.com/jts/javadoc/com/vividsolutions/jts/geom/GeometryFactory.html
   *
   * @return
   */
  def createSidewalks = Action(BodyParsers.parse.json) { request =>
    val featureCollectionResult = request.body.validate[FeatureCollection]
    featureCollectionResult.fold(
      errors => {
        BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors)))
      },
      featureCollection => {
        featureCollection.features.foreach { feature =>
          val coordinates = feature.geometry.coordinates
          val properties = feature.properties
          val coord: Array[Coordinate] = coordinates.map(coord => new Coordinate(coord.head.toDouble, coord(1).toDouble)).toArray
          val newLineString = fact.createLineString(coord)

          val sourceId = properties.source.getOrElse(-1) // Todo. Create a new node if id is not specified
          val targetId = properties.target.getOrElse(-1) // Todo. Create a new ndoe if id is not speficied

          val edge: SidewalkEdge = SidewalkEdge(Some(rand.nextInt(Integer.MAX_VALUE)), newLineString, sourceId, targetId,
            coord.head.x.toFloat, coord.head.y.toFloat, coord.last.x.toFloat, coord.last.y.toFloat, properties.wayType, false, None)
          SidewalkEdgeTable.save(edge)
          println(edge.toString)
        }

        Ok(Json.obj("status" -> "OK", "message" -> "FeatureCollection created."))
      }
    )
  }
}
