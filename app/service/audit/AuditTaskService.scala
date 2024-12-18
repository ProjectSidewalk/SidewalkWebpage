package service.audit

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import models.audit.{AuditTask, AuditTaskTable, StreetEdgeWithAuditStatus}

@ImplementedBy(classOf[AuditTaskServiceImpl])
trait AuditTaskService {
  def selectStreetsWithAuditStatus(filterLowQuality: Boolean, regionIds: List[Int], routeIds: List[Int]): Future[Seq[StreetEdgeWithAuditStatus]]
}

@Singleton
class AuditTaskServiceImpl @Inject()(auditTaskTable: AuditTaskTable, implicit val ec: ExecutionContext) extends AuditTaskService {

  def selectStreetsWithAuditStatus(filterLowQuality: Boolean, regionIds: List[Int], routeIds: List[Int]): Future[Seq[StreetEdgeWithAuditStatus]] = {
      auditTaskTable.selectStreetsWithAuditStatus(filterLowQuality, regionIds, routeIds)
    }
}
