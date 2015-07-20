package controllers

import scala.concurrent._
import play.api.libs.concurrent.Execution.Implicits.defaultContext

import play.api._
import play.api.mvc._
import play.api.data._
import play.api.data.Forms._
import play.api.Play.current
import play.api.libs.json._


import play.api.{ Play, Logger }
import play.api.mvc._
import play.api.i18n.Messages
import scala.concurrent.Future
import play.api.libs.json.Json


import com.mohiva.play.silhouette.impl.authenticators.JWTAuthenticator
import com.mohiva.play.silhouette.api.Silhouette



object Application extends Controller {
  def index = TODO
}
