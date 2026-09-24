package models.validation

import models.label.LabelTypeEnum
import play.api.libs.json.{JsObject, Json}

/**
 * The canned reasons a validator can give for a Disagree or Unsure vote, backing the `validation_reason` Postgres
 * enum type (#5475).
 *
 * One vocabulary for every surface that asks "why?": the Validate menus, the label detail card and the Gallery
 * cards all offer the same reasons for a label type, and each stores the one picked as `validation_task_comment
 * .reason` beside the comment text. The id is what analysis keys on — the text is whatever language the validator
 * was reading in, so "canned vs. free-text" and per-reason counts would otherwise be a string match.
 *
 * The ids are semantic rather than positional (`driveway`, not `no-button-2`), so a reason keeps its id when the
 * menu reorders and the same reason offered on two types (`not-pedestrian-path` on Obstacle and SurfaceProblem)
 * counts as one thing. The frontend's strings and tooltips are keyed by the same ids (`common:validation-reason.*`).
 *
 * NOTE: if changing these values, update the `validation_reason` Postgres enum type as well (407.sql), and the
 * locale files that carry each id's text.
 */
object ValidationReason extends Enumeration {
  type ValidationReason = Value

  // Disagree reasons.
  /** Something is here, but it should carry a different label type. First reason on every type. */
  val WrongType: Value          = Value("wrong-type")
  val Driveway: Value           = Value("driveway")
  val DrivewayTransition: Value = Value("driveway-transition")
  val ResidentialWalkway: Value = Value("residential-walkway")
  val NoSidewalkHere: Value     = Value("no-sidewalk-here")
  val UnsafeCrossing: Value     = Value("unsafe-crossing")
  val NotPedestrianPath: Value  = Value("not-pedestrian-path")
  val AmpleSpace: Value         = Value("ample-space")
  val NormalTiles: Value        = Value("normal-tiles")
  val SidewalkHere: Value       = Value("sidewalk-here")
  val TrafficMedian: Value      = Value("traffic-median")
  val NoVisibleCrosswalk: Value = Value("no-visible-crosswalk")
  val StopLine: Value           = Value("stop-line")
  val SpeedBump: Value          = Value("speed-bump")
  val VehicleSignalOnly: Value  = Value("vehicle-signal-only")
  val SignNoLight: Value        = Value("sign-no-light")
  val PoleNoSignal: Value       = Value("pole-no-signal")

  // Unsure reasons.
  val BetterImage: Value          = Value("better-image")
  val PlacementIncorrect: Value   = Value("placement-incorrect")
  val RampRequiredUnsure: Value   = Value("ramp-required-unsure")
  val SpaceToAvoidUnsure: Value   = Value("space-to-avoid-unsure")
  val TooMinorUnsure: Value       = Value("too-minor-unsure")
  val SidewalkNeededUnsure: Value = Value("sidewalk-needed-unsure")

  /** The two votes a reason can explain; an Agree carries an optional free-text note instead. */
  val reasonedVotes: Set[ValidationOption.Value] = Set(ValidationOption.Disagree, ValidationOption.Unsure)

  /**
   * The reasons each label type offers, per vote, in the order the menus show them. The Validate menu has room for
   * four Disagree reasons and three Unsure ones; every type leads with [[WrongType]] (#5409). Types absent here
   * (Other, Occlusion) offer no reasons, and their menus fall back to the free-text box alone.
   */
  val catalog: Map[LabelTypeEnum.Base, Map[ValidationOption.Value, Seq[Value]]] = {
    import LabelTypeEnum._
    import ValidationOption.{Disagree, Unsure}
    Map(
      CurbRamp -> Map(
        Disagree -> Seq(WrongType, Driveway, DrivewayTransition),
        Unsure   -> Seq(BetterImage, PlacementIncorrect, RampRequiredUnsure)
      ),
      NoCurbRamp -> Map(
        Disagree -> Seq(WrongType, ResidentialWalkway, NoSidewalkHere, UnsafeCrossing),
        Unsure   -> Seq(BetterImage, PlacementIncorrect, RampRequiredUnsure)
      ),
      Obstacle -> Map(
        Disagree -> Seq(WrongType, NotPedestrianPath, AmpleSpace),
        Unsure   -> Seq(BetterImage, PlacementIncorrect, SpaceToAvoidUnsure)
      ),
      SurfaceProblem -> Map(
        Disagree -> Seq(WrongType, NotPedestrianPath, NormalTiles),
        Unsure   -> Seq(BetterImage, PlacementIncorrect, TooMinorUnsure)
      ),
      NoSidewalk -> Map(
        Disagree -> Seq(WrongType, SidewalkHere, TrafficMedian),
        Unsure   -> Seq(BetterImage, PlacementIncorrect, SidewalkNeededUnsure)
      ),
      Crosswalk -> Map(
        Disagree -> Seq(WrongType, NoVisibleCrosswalk, StopLine, SpeedBump),
        Unsure   -> Seq(BetterImage, PlacementIncorrect)
      ),
      Signal -> Map(
        Disagree -> Seq(WrongType, VehicleSignalOnly, SignNoLight, PoleNoSignal),
        Unsure   -> Seq(BetterImage, PlacementIncorrect)
      )
    )
  }

  /** @return The reasons `labelType` offers for `vote`, in menu order; empty for a type or vote with none. */
  def offered(labelType: LabelTypeEnum.Base, vote: ValidationOption.Value): Seq[Value] =
    catalog.getOrElse(labelType, Map.empty).getOrElse(vote, Seq.empty)

  /** @return Whether `labelType` offers `reason` for either reasoned vote. */
  def offered(labelType: LabelTypeEnum.Base, reason: Value): Boolean =
    catalog.getOrElse(labelType, Map.empty).values.exists(_.contains(reason))

  /** Parses a reason id, `None` for an unknown one (the shape a request validator wants). */
  def withNameOption(name: String): Option[Value] = values.find(_.toString == name)

  /**
   * The catalog as `main.scala.html` stamps it onto every page (`window.validationReasons`): each label type's
   * reasons per vote, in menu order — `{"CurbRamp": {"Disagree": ["wrong-type", …], "Unsure": […]}, …}`.
   *
   * This is the only copy the frontend gets: `validationReasons.js` builds every reason list from it, and the
   * Validate menus, the label detail card and the Gallery cards all render from that. Text and tooltips are absent
   * by design: they are translated, and the frontend has them in its locale files under the same ids. Fixed at
   * build time, so it serializes once at class-load.
   */
  lazy val pageStampJson: String = Json.stringify(
    JsObject(
      LabelTypeEnum.ordered.flatMap { lt =>
        catalog.get(lt).map { byVote =>
          lt.name -> JsObject(Seq(ValidationOption.Disagree, ValidationOption.Unsure).map { vote =>
            vote.toString -> Json.toJson(byVote.getOrElse(vote, Seq.empty).map(_.toString))
          })
        }
      }
    )
  )
}
