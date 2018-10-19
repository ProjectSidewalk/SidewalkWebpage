package controllers

import java.util.UUID

import scala.concurrent.Future

import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.impl.authenticators.{DummyAuthenticator, SessionAuthenticator}
//import com.mohiva.play.silhouette.test.{FakeEnvironment, FakeRequestWithAuthenticator}
import play.api.mvc.Result
//import play.api.test.{FakeRequest, PlaySpecification, WithApplication}
import models.user.User
import org.joda.time.DateTime

/**
  * http://silhouette.mohiva.com/docs/testing
  */
//class AdminControllerSpec extends PlaySpecification {
//  "The `fetchAuditTaskInteractionsOfAUser` method" should {
////    "return a list of JSON objects" in new WithApplication {
////      val adminIdentity = User(
////        UUID.fromString("00000000-0000-0000-0000-000000000000"),
////        LoginInfo("sidewalk", "sidewalk@sidewalk.com"),
////        "sidewalk",
////        "sidewalk@sidewalk.com",
////        Some(Seq("User", "Administrator"))
////      )
////
////      // FakeEnvironment: http://silhouette.mohiva.com/docs/testing#section-fakeenvironment
////      implicit val env = FakeEnvironment[User, SessionAuthenticator](Seq(adminIdentity.loginInfo -> adminIdentity))
////      val authenticator = new SessionAuthenticator(adminIdentity.loginInfo, DateTime.now(), DateTime.now(), None, None)
////      val request = FakeRequest().withAuthenticator(authenticator)
////      val controller = new AdminController()
////
////      // The `fetchAuditTaskInteractionsOfAUser` returns a UserAwareAction.async, which takes a request as an argument
////      val result = controller.fetchAuditTaskInteractionsOfAUser("kotaro")(request)
////
////      status(result) must equalTo(OK)
////
////      status(result) must equalTo(UNAUTHORIZED)
////    }
//  }
//}
