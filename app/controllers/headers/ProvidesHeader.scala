package controllers.headers

import play.api.mvc._
import play.api.i18n.MessagesApi
import play.api.i18n.Messages
import play.api.Play.current


case class Header(menu: Seq[MenuItem], user: Option[String])
case class MenuItem(url: String, name: String)

trait ProvidesHeader {

  def messagesApi: MessagesApi = Messages.Implicits.applicationMessagesApi

  implicit def header[A](implicit request: Request[A]) : Header = {
    val menu = Seq(MenuItem("/home", "Home"),
      MenuItem("/about", "About"),
      MenuItem("/contact", "Contact"))
    val user = request.session.get("user")
    Header(menu, user)
  }
}
