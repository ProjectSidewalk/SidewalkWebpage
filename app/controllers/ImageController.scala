package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.user.User
import play.api.mvc.BodyParsers
import java.util.UUID
import scala.concurrent.Future
import play.api.libs.json._
import play.api.mvc.AnyContent
import play.api.mvc.Action
import play.api.mvc.Request
import java.io._
import java.util.Base64
import javax.imageio.ImageIO
import java.awt.image.BufferedImage


class ImageController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  var isInitialized = false

  var CROPS_DIR_NAME = "crops"

  def saveToFile(filename: String, content: String): Unit = {
    val file = new File(filename)
    val bw = new BufferedWriter(new FileWriter(file))
    bw.write(content)
    bw.close()
  }

  def writePngFile(filename: String, b64String: String): Unit = {
    val imageBytes = Base64.getDecoder.decode(b64String)
    val inputStream = new ByteArrayInputStream(imageBytes)
    val bufferedImage = ImageIO.read(inputStream)
    ImageIO.write(bufferedImage, "jpg", new File(filename))
  }

  def initialize(): Unit = {
    val file = new File(CROPS_DIR_NAME)
    file.mkdir()
    isInitialized = true
  }

  def saveImage = Action { request: Request[AnyContent] =>

    if (!isInitialized) {
      initialize()
    }

    println("saveImage")

    val body: AnyContent = request.body
    val jsonBody: Option[JsValue] = body.asJson
    // some
    // Expecting json body
    jsonBody
      .map { json =>
        var b64String: String = (json \ "b64").as[String].split(",")(1)
        var name = (json \ "name").as[String]
        writePngFile("crops" + File.separator + name, b64String)
        Ok("Got: " + (json \ "name").as[String])
      }
      .getOrElse {
        BadRequest("Expecting application/json request body")
      }
  }
}
