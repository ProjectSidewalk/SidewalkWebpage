package controllers.headers

import play.api.mvc._




trait ProvidesHeader {
  case class Header(menu: Seq[MenuItem], user: Option[String])
  case class MenuItem(url: String, name: String)

  implicit def header[A](implicit request: Request[A]) : Header = {
    val menu = Seq(MenuItem("/home", "Home"),
      MenuItem("/about", "About"),
      MenuItem("/contact", "Contact"))
    val user = request.session.get("user")
    Header(menu, user)
  }
}
