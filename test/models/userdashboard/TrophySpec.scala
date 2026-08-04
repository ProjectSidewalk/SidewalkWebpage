package models.userdashboard

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

import scala.io.Source
import scala.util.Using

/**
 * Pure tests for the `Trophy` variant mappings (#4451) and their coupling to the messages files.
 *
 * `tagLabel` values are not display strings: the trophy-case template lowercases them into a
 * `dashboard.trophy.tag.<tag>` message-key lookup, so a variant whose tag has no matching key renders the raw key
 * string in the corner ribbon. The compiler can't see that coupling (the key is assembled at runtime in Twirl), so
 * this spec walks every variant and asserts the key exists in `messages.en` — the exact drift that shipped the
 * `freeExplore` trophy without its `dashboard.trophy.tag.explore` key.
 */
class TrophySpec extends AnyFunSuite with Matchers {

  private def trophy(variant: String, rank: Int = 0) = Trophy("🏆", "t", "s", variant, rank)

  test("freeExplore maps to its own css class and the Explore tag") {
    trophy("freeExplore").cssClass shouldBe "ud-trophy-free-explore"
    trophy("freeExplore").tagLabel shouldBe Some("Explore")
  }

  test("region and pioneer keep their css classes and tags") {
    trophy("region").cssClass shouldBe "ud-trophy-region"
    trophy("region").tagLabel shouldBe Some("Region")
    trophy("pioneer").cssClass shouldBe "ud-trophy-pioneer"
    trophy("pioneer").tagLabel shouldBe Some("Pioneer")
  }

  test("podium trophies take their rank class and carry no tag (the medal conveys placement)") {
    trophy("podium", rank = 2).cssClass shouldBe "ud-trophy-2"
    trophy("podium", rank = 2).tagLabel shouldBe None
  }

  test("every variant's tagLabel has a matching dashboard.trophy.tag.* key in messages.en") {
    val messagesEn = Using.resource(Source.fromFile("conf/messages/messages.en"))(_.getLines().toList)
    val variants   = Seq("podium", "region", "pioneer", "freeExplore")
    for {
      variant <- variants
      tag     <- trophy(variant).tagLabel
    } {
      val key = s"dashboard.trophy.tag.${tag.toLowerCase}"
      withClue(s"variant '$variant' needs message key '$key': ") {
        messagesEn.exists(_.trim.startsWith(s"$key ")) shouldBe true
      }
    }
  }
}
