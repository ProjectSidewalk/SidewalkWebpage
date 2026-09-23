package service

import models.label.LabelTypeEnum
import models.user.SidewalkUserTable
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.RolledBackDb

/**
 * The SidewalkAI seed-row self-heal (#5349): a schema that never ran 281.sql as an evolution gets the AI's user_stat
 * row and its aiValidation missions at boot, with 281's values, and a schema that has them is left alone.
 *
 * The missing state is staged inside the rolled-back transaction rather than found: the stat row is deleted (nothing
 * references user_stat), and the missions are moved to another mission_type instead of deleted, since label_validation
 * rows (CI's seed has one) reference them.
 */
class AiSeedRowsSpec extends PlaySpec with GuiceOneAppPerSuite with RolledBackDb {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val aiService = app.injector.instanceOf[AiService]
  private val aiUserId       = SidewalkUserTable.aiUserId

  private def hideAiMissions(labelTypes: Option[Seq[String]]): DBIO[Int] = labelTypes match {
    case None =>
      sqlu"UPDATE mission SET mission_type = 'validation' WHERE user_id = $aiUserId AND mission_type = 'aiValidation'"
    case Some(types) =>
      val inList = types.map(t => s"'$t'").mkString(", ")
      sqlu"""UPDATE mission SET mission_type = 'validation'
             WHERE user_id = $aiUserId AND mission_type = 'aiValidation' AND label_type::text IN (#$inList)"""
  }

  private val aiMissions: DBIO[Seq[(String, Option[Int], Option[Int], Boolean)]] =
    sql"""SELECT label_type::text, labels_validated, labels_progress, completed FROM mission
          WHERE user_id = $aiUserId AND mission_type = 'aiValidation' ORDER BY mission_id"""
      .as[(String, Option[Int], Option[Int], Boolean)]

  "AiService.ensureSeedRows" should {
    "insert the stat row and every aiValidation mission a schema lacks, with 281's values, and then nothing" in {
      val (first, second, statRow, missions) = runRolledBack(for {
        _       <- hideAiMissions(None)
        _       <- sqlu"DELETE FROM user_stat WHERE user_id = $aiUserId"
        first   <- aiService.ensureSeedRowsDbio
        second  <- aiService.ensureSeedRowsDbio
        statRow <- sql"""SELECT high_quality, high_quality_manual, excluded FROM user_stat
                          WHERE user_id = $aiUserId""".as[(Boolean, Option[Boolean], Boolean)]
        missions <- aiMissions
      } yield (first, second, statRow, missions))

      first mustBe AiSeedRows(statRowInserted = true, LabelTypeEnum.ordered)
      second mustBe AiSeedRows(statRowInserted = false, Seq.empty)
      statRow mustBe Seq((true, Some(true), false))
      missions.map(_._1) mustBe LabelTypeEnum.orderedNames
      missions.map(m => (m._2, m._3, m._4)).distinct mustBe Seq((Some(1), Some(0), false))
    }

    "insert only the missions that are missing" in {
      val (healed, labelTypes) = runRolledBack(for {
        _          <- aiService.ensureSeedRowsDbio
        _          <- hideAiMissions(Some(Seq("Signal", "Occlusion")))
        healed     <- aiService.ensureSeedRowsDbio
        labelTypes <- aiMissions.map(_.map(_._1))
      } yield (healed, labelTypes))

      healed mustBe AiSeedRows(statRowInserted = false, Seq(LabelTypeEnum.Signal, LabelTypeEnum.Occlusion))
      // Distinct: CI's seed adds a second CurbRamp mission for the AI, which the heal rightly leaves alone.
      labelTypes.distinct.sorted mustBe LabelTypeEnum.orderedNames.sorted
    }
  }
}
