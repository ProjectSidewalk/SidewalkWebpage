package service

import com.google.inject.ImplementedBy
import models.street.{SidewalkPresenceRebuildCounts, SidewalkPresenceTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsObject, Json}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/**
 * What a rebuild of the `sidewalk_presence` table did (#5279).
 *
 * @param faces    Rows in the table afterwards: two per street.
 * @param inserted Faces of streets that had no row yet.
 * @param updated  Rows whose verdict, basis, counts, or dates changed.
 * @param deleted  Rows whose street is gone.
 */
case class SidewalkPresenceRebuildResult(faces: Int, inserted: Int, updated: Int, deleted: Int) {

  /**
   * The counts as they are stored against a `background_job_run` row.
   *
   * @return The run's `details` object.
   */
  def runDetails: JsObject = Json.obj(
    "faces"    -> faces,
    "inserted" -> inserted,
    "updated"  -> updated,
    "deleted"  -> deleted
  )
}

@ImplementedBy(classOf[SidewalkPresenceServiceImpl])
trait SidewalkPresenceService {

  /** Re-derives every block face's sidewalk presence from the current labels and audits, in one transaction. */
  def rebuild(): Future[SidewalkPresenceRebuildResult]
}

/**
 * Keeps the derived `sidewalk_presence` table current (#5279). Runs nightly after the day's labeling: labels arrive
 * all day and a full re-derivation is cheap (seconds, even for Seattle), so recomputing everything is simpler than
 * tracking which faces a label touched.
 */
@Singleton
class SidewalkPresenceServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    sidewalkPresenceTable: SidewalkPresenceTable
)(implicit ec: ExecutionContext)
    extends SidewalkPresenceService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  def rebuild(): Future[SidewalkPresenceRebuildResult] =
    db.run(sidewalkPresenceTable.rebuild.transactionally).map { counts: SidewalkPresenceRebuildCounts =>
      SidewalkPresenceRebuildResult(counts.total, counts.inserted, counts.updated, counts.deleted)
    }
}
