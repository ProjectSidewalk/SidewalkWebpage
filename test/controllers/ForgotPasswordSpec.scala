package controllers

import models.utils.MyPostgresProfile.api.*
import org.apache.pekko.stream.Materializer
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.i18n.{Lang, MessagesApi}
import play.api.inject.bind
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.mailer.{Email, MailerClient}
import play.api.mvc.Result
import play.api.test.CSRFTokenHelper.*
import play.api.test.FakeRequest
import play.api.test.Helpers.*
import util.{LogCapture, SidewalkSpec, SignedUpAccounts}

import java.util.UUID
import scala.collection.mutable.ListBuffer
import scala.concurrent.Future

/**
 * Pins what the forgot-password form tells the user (#4531): an unknown address and a delivered email get the same
 * confirmation, and a send the mailer could not complete is reported as such rather than as sent. The mailer is a
 * stub so no SMTP connection is attempted; the real `SMTPMailer` would refuse-connect in dev and CI either way.
 */
class ForgotPasswordSpec extends SidewalkSpec with SignedUpAccounts with GuiceOneAppPerSuite {

  /** Records sends, or throws the failure a test arms, so one app serves both outcomes. */
  private class StubMailer extends MailerClient {
    @volatile var failWith: Option[Exception] = None
    val sent: ListBuffer[Email]               = ListBuffer.empty

    /**
     * @param data The email the controller built.
     * @return A fixed message id, as a real mailer returns one.
     */
    override def send(data: Email): String = failWith match {
      case Some(e) => throw e
      case None    =>
        synchronized(sent += data)
        "stub-message-id"
    }

    /** Clears what earlier tests armed or recorded, since the suite shares one app and so one mailer. */
    def reset(): Unit = {
      failWith = None
      synchronized(sent.clear())
    }
  }

  private val mailer = new StubMailer

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      // Every request here comes from FakeRequest's 127.0.0.1; throttling has its own suite (UserAuthRateLimitSpec).
      .configure("rate-limit.enabled" -> false)
      .overrides(bind[MailerClient].toInstance(mailer))
      .build()

  given mat: Materializer = app.materializer

  private lazy val messagesApi = app.injector.instanceOf[MessagesApi]
  private given lang: Lang     = Lang("en") // Requests here send no Accept-Language, so Play serves English.

  /** Addresses submitted here; their sessionless webpage_activity rows have no user id to clean them up by. */
  private var usedEmails: Set[String] = Set.empty

  /** @return The response to submitting `email` on the forgot-password form, without a session. */
  private def forgot(email: String): Future[Result] = {
    usedEmails += email
    route(
      app,
      FakeRequest(POST, "/forgotPassword").withFormUrlEncodedBody("emailForgotPassword" -> email).withCSRFToken
    ).get
  }

  /** @return An address no account has; the UUID keeps the cleanup in `afterAll` to this suite's own rows. */
  private def unknownEmail(): String = s"nobody.${UUID.randomUUID().toString.replace("-", "").take(20)}@example.test"

  override def afterAll(): Unit = {
    try usedEmails.foreach(e => runAccounts(sqlu"DELETE FROM webpage_activity WHERE activity LIKE ${"%" + e + "%"}"))
    finally super.afterAll()
  }

  "POST /forgotPassword" should {

    "confirm neutrally for an address with no account, sending nothing" in {
      mailer.reset()
      val r = forgot(unknownEmail())
      status(r) mustBe SEE_OTHER
      redirectLocation(r) mustBe Some("/forgotPassword")
      flash(r).get("info") mustBe Some(messagesApi("reset.pw.email.reset.pw.sent"))
      flash(r).get("error") mustBe None
      mailer.sent mustBe empty
    }

    "confirm and send the reset link for a registered address" in {
      mailer.reset()
      val (_, email, _) = signUpFreshUser()
      val r             = forgot(email)
      status(r) mustBe SEE_OTHER
      redirectLocation(r) mustBe Some("/forgotPassword")
      flash(r).get("info") mustBe Some(messagesApi("reset.pw.email.reset.pw.sent"))
      flash(r).get("error") mustBe None
      mailer.sent.size mustBe 1
      mailer.sent.head.to mustBe Seq(email)
      mailer.sent.head.subject mustBe messagesApi("reset.pw.email.reset.title")
      mailer.sent.head.bodyHtml.get must include("/resetPassword?token=")
    }

    "respond identically for an unknown address and a delivered one" in {
      mailer.reset()
      val (_, email, _) = signUpFreshUser()
      val unknown       = forgot(unknownEmail())
      val delivered     = forgot(email)
      status(delivered) mustBe status(unknown)
      redirectLocation(delivered) mustBe redirectLocation(unknown)
      flash(delivered).data mustBe flash(unknown).data
      mailer.sent.size mustBe 1
    }

    "tell the user when the email could not be sent, with no success message" in {
      mailer.reset()
      val (_, email, _) = signUpFreshUser()
      mailer.failWith = Some(RuntimeException("SMTP connect refused"))
      LogCapture.capturing(classOf[UserController].getName) { logged =>
        val r = forgot(email)
        status(r) mustBe SEE_OTHER
        redirectLocation(r) mustBe Some("/forgotPassword")
        flash(r).get("error") mustBe Some(messagesApi("reset.pw.email.send.failed"))
        flash(r).get("info") mustBe None
        mailer.sent mustBe empty
        logged().exists(_.contains("Failed to send password reset email")) mustBe true
      }

      // The failure leaves no sticky state: the next request, with the mailer back, confirms and sends.
      mailer.failWith = None
      val retry = forgot(email)
      flash(retry).get("info") mustBe Some(messagesApi("reset.pw.email.reset.pw.sent"))
      flash(retry).get("error") mustBe None
      mailer.sent.size mustBe 1
    }
  }
}
