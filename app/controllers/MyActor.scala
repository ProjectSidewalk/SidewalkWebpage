package controllers

import javax.inject.Inject

import play.api.libs.concurrent.Akka
import akka.actor.Actor
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.user.User

import scala.concurrent.Future
import scala.io.Source

class MyActor @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

//  def receive = {
//    case "test" ⇒ println("received test")
//    case _      ⇒ println("received unknown message")
//  }

//  def test() = UserAwareAction.async { implicit request =>
//    val pw = "adsf"
//    println("testinggg")
//    val filename = "testkeyfile.txt"
//    val bufferedSource = Source.fromFile(filename)
//    val key: Option[String] = bufferedSource.getLines.toList.headOption
//    bufferedSource.close
//
//    key match {
//      case Some(str) =>
//        if (pw == str) {
//          println("Success!")
//          Future.successful(Ok("Success!\n"))
//        } else {
//          println("Failure! Wrong key!")
//          Future.successful(Ok("Failure! Wrong key!\n"))
//        }
//      case _ =>
//        println("Failure! Couldn't read key file!")
//        Future.successful(Ok("Failure! Couldn't read key file!\n"))
//    }
//  }
}