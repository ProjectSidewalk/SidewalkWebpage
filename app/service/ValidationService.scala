package service

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import play.api.cache._
import com.google.inject.ImplementedBy
import models.label.{LabelTable, LabelValidationTable}
import models.utils.MyPostgresDriver
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import models.utils.MyPostgresDriver.api._

@ImplementedBy(classOf[ValidationServiceImpl])
trait ValidationService {
  def countValidations: Future[Int]
}

@Singleton
class ValidationServiceImpl @Inject()(
                                  protected val dbConfigProvider: DatabaseConfigProvider,
                                  cache: CacheApi,
                                  labelValidationTable: LabelValidationTable,
                                  implicit val ec: ExecutionContext
                                 ) extends ValidationService with HasDatabaseConfigProvider[MyPostgresDriver] {
  //  import driver.api._

  def countValidations: Future[Int] = {
    db.run(labelValidationTable.countValidations)
  }
}
