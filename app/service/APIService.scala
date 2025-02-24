package service

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import controllers.APIBBox
import controllers.APIType.APIType
import models.attribute.{GlobalAttributeForAPI, GlobalAttributeTable, GlobalAttributeWithLabelForAPI}
import models.label.{LabelAllMetadata, LabelTable}
import models.region.{Region, RegionTable}
import models.street.{StreetEdgeInfo, StreetEdgeTable}
import models.utils.MyPostgresProfile
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.scaladsl.Source

@ImplementedBy(classOf[APIServiceImpl])
trait APIService {
  def getAttributesInBoundingBox(apiType: APIType, bbox: APIBBox, severity: Option[String], batchSize: Int): Source[GlobalAttributeForAPI, _]
  def getGlobalAttributesWithLabelsInBoundingBox(bbox: APIBBox, severity: Option[String], batchSize: Int): Source[GlobalAttributeWithLabelForAPI, _]
  def selectStreetsIntersecting(apiType: APIType, bbox: APIBBox): Future[Seq[StreetEdgeInfo]]
  def getNeighborhoodsWithin(bbox: APIBBox): Future[Seq[Region]]
  def getAllLabelMetadata(bbox: APIBBox, batchSize: Int): Source[LabelAllMetadata, _]
}

@Singleton
class APIServiceImpl @Inject()(
                                   protected val dbConfigProvider: DatabaseConfigProvider,
                                   globalAttributeTable: GlobalAttributeTable,
                                   streetEdgeTable: StreetEdgeTable,
                                   regionTable: RegionTable,
                                   labelTable: LabelTable,
                                   implicit val ec: ExecutionContext
                                 ) extends APIService with HasDatabaseConfigProvider[MyPostgresProfile] {

  // Sets up streaming query to get global attributes in a bounding box.
  def getAttributesInBoundingBox(apiType: APIType, bbox: APIBBox, severity: Option[String], batchSize: Int): Source[GlobalAttributeForAPI, _] = {
    Source.fromPublisher(db.stream(
      globalAttributeTable.getAttributesInBoundingBox(apiType, bbox, severity)
        .transactionally.withStatementParameters(fetchSize = batchSize)
    ))
  }

  // Sets up streaming query to get global attributes with their associated labels in a bounding box.
  def getGlobalAttributesWithLabelsInBoundingBox(bbox: APIBBox, severity: Option[String], batchSize: Int): Source[GlobalAttributeWithLabelForAPI, _] = {
    Source.fromPublisher(db.stream(
      globalAttributeTable.getGlobalAttributesWithLabelsInBoundingBox(bbox, severity)
        .transactionally.withStatementParameters(fetchSize = batchSize)
    ))
  }

  def selectStreetsIntersecting(apiType: APIType, bbox: APIBBox): Future[Seq[StreetEdgeInfo]] = {
    db.run(streetEdgeTable.selectStreetsIntersecting(apiType, bbox))
  }

  def getNeighborhoodsWithin(bbox: APIBBox): Future[Seq[Region]] = {
    db.run(regionTable.getNeighborhoodsWithin(bbox))
  }

  def getAllLabelMetadata(bbox: APIBBox, batchSize: Int): Source[LabelAllMetadata, _] = {
    Source.fromPublisher(db.stream(
      labelTable.getAllLabelMetadata(bbox)
        .transactionally.withStatementParameters(fetchSize = batchSize)
    ))
  }
}
