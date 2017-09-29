package formats.json

import java.sql.Timestamp

import play.api.libs.json.{JsBoolean, JsPath, Reads}

import scala.collection.immutable.Seq
import play.api.libs.functional.syntax._


object SurveySubmissionFormats {
  case class SurveySingleSubmission(surveyQuestionId: String, answerText: String);
  case class SurveySubmission(answeredQuestions: Seq[SurveySingleSubmission], isAdmin: Boolean);

  implicit val surveySingleSubmissionReads: Reads[SurveySingleSubmission] = (
    (JsPath \ "name").read[String] and
      (JsPath \ "value").read[String]
    )(SurveySingleSubmission.apply _)

  implicit val surveySubmissionReads: Reads[SurveySubmission] = (
    (JsPath \ "answered_questions").read[Seq[SurveySingleSubmission]] and
      (JsPath \ "is_admin").read[Boolean]
    )(SurveySubmission.apply _)

}