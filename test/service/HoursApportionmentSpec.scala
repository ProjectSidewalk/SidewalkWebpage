package service

import org.scalatestplus.play.PlaySpec

/**
 * Pure tests for the tenth-rounding behind the Time Check page's hours breakdown (#4526).
 *
 * Needs no database and no application, because the property under test is arithmetic: the rows a volunteer reads
 * have to add up to the headline they hand a supervisor, while the headline stays the most accurate figure the
 * per-city numbers support.
 */
class HoursApportionmentSpec extends PlaySpec {

  private def city(id: String, hours: Double): CityHours =
    CityHours(id, id.capitalize, hours, isCurrentCity = false)

  private def apportion(hours: Seq[Double]): Seq[CityHours] =
    UserService.apportionToTenths(
      hours.zipWithIndex.map { case (h, i) => city(('a' + i).toChar.toString, h) }.sortBy(c => (-c.hours, c.cityId))
    )

  /** Summed in decimal, so a column of tenths compares against an exact expectation rather than an ulp beside it. */
  private def exactSum(hours: Seq[Double]): BigDecimal = hours.map(BigDecimal.decimal).sum

  "apportionToTenths" should {
    "land the rows on the rounded true total, for the cases independent rounding gets wrong" in {
      // Rounding each value on its own makes these add up to something other than their total.
      Seq(
        Seq(0.25, 0.25),
        Seq(0.44, 0.44),
        Seq(1.25, 1.25, 1.25),
        Seq(0.05, 0.05, 0.05, 0.05),
        Seq(6.25, 4.5),
        Seq(12.34, 6.25, 0.07, 3.5, 0.99)
      ).foreach { hours =>
        withClue(s"for $hours: ") {
          exactSum(apportion(hours).map(_.hours)) mustBe
            exactSum(hours).setScale(1, BigDecimal.RoundingMode.HALF_UP)
        }
      }
    }

    "round the headline from the full-precision total, not from the rounded rows" in {
      // 1.25 * 3 = 3.75 -> 3.8. Rounding each row first gives 1.3 * 3 = 3.9, overstating by six minutes.
      CrossCityHours(apportion(Seq(1.25, 1.25, 1.25)), 0).totalHours mustBe 3.8
      // 0.25 + 0.25 = 0.5, where rounding each row first gives 0.6.
      CrossCityHours(apportion(Seq(0.25, 0.25)), 0).totalHours mustBe 0.5
      // 0.44 + 0.44 = 0.88 -> 0.9, where rounding each row first gives 0.8.
      CrossCityHours(apportion(Seq(0.44, 0.44)), 0).totalHours mustBe 0.9
    }

    "keep every row within a tenth of the hours it actually represents" in {
      // Matched by city id, since apportioning preserves the descending order it was handed, not the input order.
      val hours = Seq(12.34, 6.25, 0.07, 3.5, 0.99)
      val shown = apportion(hours).map(row => row.cityId -> row.hours).toMap
      hours.zipWithIndex.foreach { case (exact, i) =>
        withClue(s"row for $exact: ") { (shown(('a' + i).toChar.toString) - exact).abs must be <= 0.10001 }
      }
    }

    "emit only whole tenths, so the page's one-decimal rendering is lossless" in {
      apportion(Seq(0.07, 1.23, 9.876)).foreach(row => row.hours mustBe UserService.toDisplayedTenth(row.hours))
    }

    "never reorder a descending list, so the table stays sorted after apportioning" in {
      apportion(Seq(5.0, 0.49, 0.46, 0.45, 0.2)).map(_.hours).sliding(2).foreach {
        case Seq(higher, lower) => higher must be >= lower
        case _                  => ()
      }
    }

    "give the same answer every time, so a reload doesn't reshuffle which city got the spare tenth" in {
      val input = Seq(city("teaneck-nj", 0.25), city("seattle-wa", 0.25))
      UserService.apportionToTenths(input) mustBe UserService.apportionToTenths(input)
    }

    "leave an empty breakdown at zero rather than dividing by nothing" in {
      UserService.apportionToTenths(Seq.empty) mustBe empty
      CrossCityHours(Seq.empty, 0).totalHours mustBe 0d
    }

    "preserve everything about a row except its hours" in {
      val row = CityHours("teaneck-nj", "Teaneck", 6.25, isCurrentCity = true)
      val out = UserService.apportionToTenths(Seq(row)).head
      out.cityId mustBe row.cityId
      out.cityName mustBe row.cityName
      out.isCurrentCity mustBe row.isCurrentCity
      out.hours mustBe 6.3
    }
  }

  "toDisplayedTenth" should {
    "round half up, matching how the page formats the number" in {
      UserService.toDisplayedTenth(6.25) mustBe 6.3
      UserService.toDisplayedTenth(0.05) mustBe 0.1
      UserService.toDisplayedTenth(0.04) mustBe 0.0
      UserService.toDisplayedTenth(0d) mustBe 0d
    }
  }
}
