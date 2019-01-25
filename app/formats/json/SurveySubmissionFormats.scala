package formats.json

import play.api.libs.json.{ JsPath, Reads }

import play.api.libs.functional.syntax._

object SurveySubmissionFormats {
  case class SurveySingleSubmission(surveyQuestionId: String, answerText: String)

  implicit val surveySingleSubmissionReads: Reads[SurveySingleSubmission] = (
    (JsPath \ "name").read[String] and
    (JsPath \ "value").read[String])(SurveySingleSubmission.apply _)

}