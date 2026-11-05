package service

import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.i18n.Lang
import play.api.inject.guice.GuiceApplicationBuilder
import util.SidewalkSpec

/**
 * Server-side tag translation (#4445): the backend reads the same `public/locales` tag map i18next does, and must
 * resolve a tag exactly as the browser would, so the share page's crawler-visible text matches what a visitor sees.
 *
 * Expected strings are the current translations in `public/locales/<lang>/common.json`; a spec failure after a
 * translation edit just needs the new wording here.
 *
 * Boots the app so `Langs` is the real `play.i18n.langs`. Requires a Postgres+PostGIS database (via DATABASE_URL /
 * DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI).
 */
class TagTranslationServiceSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
      .disable[modules.ActorModule] // No eager background actors during tests.
      .build()

  private lazy val service: TagTranslationService = app.injector.instanceOf[TagTranslationService]

  "translate" should {
    // Expected strings are the current translations on purpose; a wording change in a locale file updates them here.
    "translate a known tag in every sampled language" in {
      service.translate("bumpy", Lang("es"), "usa") mustBe "textura irregular"
      service.translate("bumpy", Lang("de"), "usa") mustBe "holprig"
      service.translate("bumpy", Lang("zh-TW"), "usa") mustBe "顛簸"
    }

    "use the colon-to-dash key and expand $t() nesting as i18next does" in {
      service.translate("cycle lane: parked car", Lang("es"), "usa") mustBe "carril bici: auto estacionado"
    }

    "fall back to the raw tag name when no language has it" in {
      service.translate("not a real tag", Lang("es"), "usa") mustBe "not a real tag"
    }

    "fall back to English for a language the site does not offer" in {
      service.translate("APS", Lang("ja"), "usa") mustBe "tactile-audible buttons"
    }

    "let a regional English overlay win, and fall back through en for the rest" in {
      service.translate("narrow sidewalk", Lang("en-NZ"), "new-zealand") mustBe "narrow footpath"
      service.translate("APS", Lang("en-NZ"), "new-zealand") mustBe "tactile-audible buttons"
    }

    "apply the country overlay only in a language that has one" in {
      service.translate("pole", Lang("de"), "switzerland") mustBe "Pfosten/Verkehrsschild/Strassenlaterne"
      service.translate("APS", Lang("en"), "switzerland") mustBe "tactile-audible box"
      service.translate("APS", Lang("en"), "usa") mustBe "tactile-audible buttons"
    }
  }

  "languageChain" should {
    "try the bare language only when the site offers it, and always end in English" in {
      service.languageChain(Lang("en-US")) mustBe Seq("en-US", "en")
      service.languageChain(Lang("pt-BR")) mustBe Seq("pt-BR", "en")
      service.languageChain(Lang("es")) mustBe Seq("es", "en")
      service.languageChain(Lang("ja")) mustBe Seq("en")
    }
  }
}
