package service

import scala.concurrent.ExecutionContext
import javax.inject._
import com.google.inject.ImplementedBy
import controllers.APIBBox
import controllers.APIType.APIType
import models.attribute.{GlobalAttributeForAPI, GlobalAttributeTable, GlobalAttributeWithLabelForAPI}
import models.utils.MyPostgresProfile
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import models.utils.MyPostgresProfile.api._
import org.apache.pekko.stream.scaladsl.Source

@ImplementedBy(classOf[APIServiceImpl])
trait APIService {
  def getGlobalAttributesInBoundingBox(apiType: APIType, bbox: APIBBox, severity: Option[String], batchSize: Int): Source[GlobalAttributeForAPI, _]
  def getGlobalAttributesWithLabelsInBoundingBox(bbox: APIBBox, severity: Option[String], batchSize: Int): Source[GlobalAttributeWithLabelForAPI, _]
}

@Singleton
class APIServiceImpl @Inject()(
                                   protected val dbConfigProvider: DatabaseConfigProvider,
                                   globalAttributeTable: GlobalAttributeTable,
                                   implicit val ec: ExecutionContext
                                 ) extends APIService with HasDatabaseConfigProvider[MyPostgresProfile] {

  // Sets up streaming query to get global attributes in a bounding box.
  def getGlobalAttributesInBoundingBox(apiType: APIType, bbox: APIBBox, severity: Option[String], batchSize: Int): Source[GlobalAttributeForAPI, _] = {
    Source.fromPublisher(db.stream(
      globalAttributeTable.getGlobalAttributesInBoundingBox(apiType, bbox, severity)
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
}
