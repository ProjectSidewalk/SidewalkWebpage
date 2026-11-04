package models.utils

import play.api.libs.json.{JsError, JsSuccess, Json, Reads}

import java.io.InputStream
import scala.io.Source
import scala.util.Using

/** A JSON file under `conf/` that the app's behaviour is parameterized by, read once off the classpath. */
object JsonResource {

  /**
   * @param path The resource's classpath path, e.g. `/pano-scoring.json`.
   * @return The parsed file. A missing or malformed file throws here, loudly, rather than failing as a `NaN` later.
   */
  def load[T: Reads](path: String): T = {
    val stream: InputStream = Option(getClass.getResourceAsStream(path))
      .getOrElse(throw IllegalStateException(s"$path is missing from the classpath"))
    val raw: String = Using.resource(stream)(Source.fromInputStream(_, "UTF-8").mkString)
    Json.parse(raw).validate[T] match {
      case JsSuccess(parsed, _) => parsed
      case JsError(errors)      => throw IllegalStateException(s"$path is malformed: $errors")
    }
  }
}
