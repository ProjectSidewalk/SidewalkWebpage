package modules

import play.api.http.HttpConfiguration
import play.api.i18n._
import play.api.{Configuration, Environment}

import javax.inject.{Inject, Singleton}

/**
 * Custom MessagesApi provider that extends DefaultMessagesApiProvider to add server-specific message overrides.
 */
@Singleton
class CustomMessagesApiProvider @Inject() (
    environment: Environment,
    config: Configuration,
    langs: Langs,
    httpConfiguration: HttpConfiguration
) extends DefaultMessagesApiProvider(environment, config, langs, httpConfiguration) {

  val currentCityId: String    = config.get[String]("city-id")
  val currentCountryId: String = config.get[String](s"city-params.country-id.$currentCityId")

  override lazy val get: MessagesApi = {
    val defaultMessages: Map[String, Map[String, String]] = super.loadAllMessages

    // Load a special set of translations for servers in India.
    val finalMessages: Map[String, Map[String, String]] = if (currentCountryId == "india") {
      val specialOverrides: Map[String, Map[String, String]] = getIndiaSpecificOverrides
      mergeMessages(defaultMessages, specialOverrides)
    } else {
      defaultMessages
    }

    // Create MessagesApi with merged messages using all the same config as parent.
    new DefaultMessagesApi(
      finalMessages,
      langs,
      langCookieName = langCookieName,
      langCookieSecure = langCookieSecure,
      langCookieHttpOnly = langCookieHttpOnly,
      langCookieSameSite = langCookieSameSite,
      httpConfiguration = httpConfiguration,
      langCookieMaxAge = langCookieMaxAge
    )
  }

  /**
   * Returns server-specific message overrides.
   */
  private def getIndiaSpecificOverrides: Map[String, Map[String, String]] = {
    try {
      // Load from conf/messages/messages-india.en for English overrides.
      val specialEnglishMessages = loadMessages("messages-india.en")
      Map("en" -> specialEnglishMessages)
    } catch {
      case _: Exception =>
        Map.empty[String, Map[String, String]] // If no file found, return no message overrides.
    }
  }

  /**
   * Merges default and server-specific override messages.
   */
  private def mergeMessages(
      default: Map[String, Map[String, String]],
      overrides: Map[String, Map[String, String]]
  ): Map[String, Map[String, String]] = {
    val allLangs: Set[String] = default.keySet ++ overrides.keySet
    allLangs.map { lang =>
      val defaultLangMessages  = default.getOrElse(lang, Map.empty)
      val overrideLangMessages = overrides.getOrElse(lang, Map.empty)
      lang -> (defaultLangMessages ++ overrideLangMessages) // overrides win
    }.toMap
  }
}
