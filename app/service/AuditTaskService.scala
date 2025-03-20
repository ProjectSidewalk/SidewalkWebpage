package service

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import models.audit.{AuditTaskTable, StreetEdgeWithAuditStatus}

@ImplementedBy(classOf[AuditTaskServiceImpl])
trait AuditTaskService {
  def selectStreetsWithAuditStatus(filterLowQuality: Boolean, regionIds: Seq[Int], routeIds: Seq[Int]): Future[Seq[StreetEdgeWithAuditStatus]]
}

@Singleton
class AuditTaskServiceImpl @Inject()(auditTaskTable: AuditTaskTable, implicit val ec: ExecutionContext) extends AuditTaskService {

  def selectStreetsWithAuditStatus(filterLowQuality: Boolean, regionIds: Seq[Int], routeIds: Seq[Int]): Future[Seq[StreetEdgeWithAuditStatus]] = {
      auditTaskTable.selectStreetsWithAuditStatus(filterLowQuality, regionIds, routeIds)
    }
}
