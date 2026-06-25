package service

import com.google.inject.ImplementedBy
import formats.json.GalleryFormats.GalleryTaskSubmission
import models.gallery._
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[GalleryServiceImpl])
trait GalleryService {
  def submitGalleryTasks(
      submissions: Seq[GalleryTaskSubmission],
      ipAddress: String,
      userId: String
  ): Future[Seq[Int]]
}

@Singleton
class GalleryServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    galleryTaskInteractionTable: GalleryTaskInteractionTable,
    galleryTaskEnvironmentTable: GalleryTaskEnvironmentTable,
    implicit val ec: ExecutionContext
) extends GalleryService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  /**
   * Persists the interaction and environment data for a batch of Gallery task submissions.
   *
   * @param submissions Parsed Gallery task submissions, each carrying its interactions and environment.
   * @param ipAddress   IP address of the submitting user, stored on the environment row.
   * @param userId      ID of the submitting user, stored on both interaction and environment rows.
   * @return            The number of interactions inserted per submission.
   */
  def submitGalleryTasks(
      submissions: Seq[GalleryTaskSubmission],
      ipAddress: String,
      userId: String
  ): Future[Seq[Int]] = {
    val submissionActions: Seq[DBIO[Int]] = submissions.map { data =>
      val env = data.environment
      for {
        nInteractionSubmitted <- galleryTaskInteractionTable.insertMultiple(data.interactions.map { action =>
          GalleryTaskInteraction(0, action.action, action.panoId, action.note, action.timestamp, Some(userId))
        })
        _ <- galleryTaskEnvironmentTable.insert(
          GalleryTaskEnvironment(0, env.browser, env.browserVersion, env.browserWidth, env.browserHeight,
            env.availWidth, env.availHeight, env.screenWidth, env.screenHeight, env.operatingSystem, Some(ipAddress),
            env.language, Some(userId))
        )
      } yield nInteractionSubmitted.length
    }
    db.run(DBIO.sequence(submissionActions).transactionally)
  }
}
