package models.validation

import models.label.LabelTypeEnum
import org.scalatestplus.play.PlaySpec
import play.api.libs.json.{JsObject, JsValue, Json}

import scala.io.Source
import scala.util.Using

/**
 * Pure unit tests for the canned-reason vocabulary (#5475). No app boot or DB required.
 *
 * The catalog is the one copy of "which reasons does a type offer, in what order"; three surfaces render from it
 * and the ids it names are what `validation_task_comment.reason` holds. These pin the shape those surfaces and the
 * locale files depend on, and hold the committed page-stamp fixture (which the JS suite stamps as
 * `window.validationReasons`) to what the pages actually stamp.
 */
class ValidationReasonSpec extends PlaySpec {

  /** Closes the file after parsing: streams left open accumulate across repeated runs in one sbt JVM. */
  private def readJson(path: String): JsValue = Using.resource(Source.fromFile(path))(src => Json.parse(src.mkString))

  private val english: JsObject = (readJson("public/locales/en/common.json") \ "validation-reason").as[JsObject]

  "catalog" should {
    "lead every type's Disagree reasons with wrong-type, which Expert Validate turns into the type picker (#5409)" in {
      for ((labelType, byVote) <- ValidationReason.catalog) {
        withClue(labelType.name) {
          byVote(ValidationOption.Disagree).headOption mustBe Some(ValidationReason.WrongType)
        }
      }
    }

    "fit the Validate menu, which has four Disagree buttons and three Unsure ones" in {
      for ((labelType, byVote) <- ValidationReason.catalog) {
        withClue(labelType.name) {
          byVote(ValidationOption.Disagree).size must be <= 4
          byVote(ValidationOption.Unsure).size must be <= 3
        }
      }
    }

    "offer each reason at most once per vote, since a repeated id could not be told apart when picked" in {
      for {
        (labelType, byVote) <- ValidationReason.catalog
        (vote, reasons)     <- byVote
      } {
        withClue(s"${labelType.name} $vote") { reasons.distinct mustBe reasons }
      }
    }

    "use every reason the enum declares, so no id can be stored that no surface offers" in {
      val offered = ValidationReason.catalog.values.flatMap(_.values.flatten).toSet
      ValidationReason.values.toSet mustBe offered
    }

    "only reason about the two votes that take a reason" in {
      ValidationReason.catalog.values.flatMap(_.keys).toSet mustBe ValidationReason.reasonedVotes
    }
  }

  "offered and offersReason" should {
    "answer for a type's own reasons and refuse another type's" in {
      ValidationReason.offersReason(LabelTypeEnum.CurbRamp, ValidationReason.Driveway) mustBe true
      ValidationReason.offersReason(LabelTypeEnum.Obstacle, ValidationReason.Driveway) mustBe false
      // A reason belongs to one vote: a Disagree reason is not an Unsure one on the same type.
      ValidationReason.offered(
        LabelTypeEnum.CurbRamp,
        ValidationOption.Unsure
      ) must not contain ValidationReason.Driveway
      // A type with no canned reasons offers none, rather than throwing on a lookup.
      ValidationReason.offersReason(LabelTypeEnum.Other, ValidationReason.WrongType) mustBe false
      ValidationReason.offered(LabelTypeEnum.Other, ValidationOption.Disagree) mustBe empty
    }
  }

  "withNameOption" should {
    "parse a known id and give None for anything else, since request bodies carry these as strings" in {
      ValidationReason.withNameOption("wrong-type") mustBe Some(ValidationReason.WrongType)
      ValidationReason.withNameOption("no-button-1") mustBe None
      ValidationReason.withNameOption("") mustBe None
    }
  }

  "the English locale" should {
    "carry text for every reason id, which is where every surface gets a reason's words" in {
      val missing = ValidationReason.values.map(_.toString).filter(id => (english \ id \ "text").asOpt[String].isEmpty)
      missing mustBe empty
    }
  }

  "pageStampJson" should {
    "match the committed fixture the JS suite stamps as window.validationReasons" in {
      // test/js/loadGlobalScript.js stamps that fixture. If it stops matching what the pages actually stamp, the JS
      // suite is testing a catalog no browser ever sees — so fail here instead, with the diff.
      val fixture = readJson("test/resources/validation-reasons-stamp.json")
      Json.parse(ValidationReason.pageStampJson) mustBe fixture
    }

    "list the types in canonical order, with both votes on each" in {
      val stamp = Json.parse(ValidationReason.pageStampJson).as[JsObject]
      stamp.keys.toSeq mustBe LabelTypeEnum.ordered.filter(ValidationReason.catalog.contains).map(_.name)
      for ((_, byVote) <- stamp.fields) byVote.as[JsObject].keys mustBe Set("Disagree", "Unsure")
    }
  }
}
