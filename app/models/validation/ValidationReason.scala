package models.validation

import models.label.LabelType
import models.utils.{NamedEnum, PgEnumCompanion}
import play.api.libs.json.{JsObject, Json}

/**
 * The canned reasons a validator can give for a Disagree or Unsure vote, backing the `validation_reason` Postgres
 * enum type (#5475).
 *
 * One vocabulary for every surface that asks "why?": the Validate menus, the label detail card and the Gallery
 * cards all offer the same reasons for a label type, and each stores the one picked as `validation_task_comment
 * .reason` beside the comment text. The id is what analysis keys on; the text is whatever language the validator
 * was reading in, so "canned vs. free-text" and per-reason counts would otherwise be a string match.
 *
 * The ids are semantic rather than positional (`driveway`, not `no-button-2`), so a reason keeps its id when the
 * menu reorders and the same reason offered on two types (`not-pedestrian-path` on Obstacle and SurfaceProblem)
 * counts as one thing. The frontend's strings and tooltips are keyed by the same ids (`common:validation-reason.*`).
 *
 * NOTE: if changing these values, update the `validation_reason` Postgres enum type as well (423.sql), and the
 * locale files that carry each id's text.
 */
enum ValidationReason(val name: String) extends NamedEnum {
  // Disagree reasons.
  /** Something is here, but it should carry a different label type. First reason on every type. */
  case WrongType          extends ValidationReason("wrong-type")
  case Driveway           extends ValidationReason("driveway")
  case DrivewayTransition extends ValidationReason("driveway-transition")
  case ResidentialWalkway extends ValidationReason("residential-walkway")
  case NoSidewalkHere     extends ValidationReason("no-sidewalk-here")
  case UnsafeCrossing     extends ValidationReason("unsafe-crossing")
  case NotPedestrianPath  extends ValidationReason("not-pedestrian-path")
  case AmpleSpace         extends ValidationReason("ample-space")
  case NormalTiles        extends ValidationReason("normal-tiles")
  case SidewalkHere       extends ValidationReason("sidewalk-here")
  case TrafficMedian      extends ValidationReason("traffic-median")
  case NoVisibleCrosswalk extends ValidationReason("no-visible-crosswalk")
  case StopLine           extends ValidationReason("stop-line")
  case SpeedBump          extends ValidationReason("speed-bump")
  case VehicleSignalOnly  extends ValidationReason("vehicle-signal-only")
  case SignNoLight        extends ValidationReason("sign-no-light")
  case PoleNoSignal       extends ValidationReason("pole-no-signal")

  // Unsure reasons.
  case BetterImage          extends ValidationReason("better-image")
  case PlacementIncorrect   extends ValidationReason("placement-incorrect")
  case RampRequiredUnsure   extends ValidationReason("ramp-required-unsure")
  case SpaceToAvoidUnsure   extends ValidationReason("space-to-avoid-unsure")
  case TooMinorUnsure       extends ValidationReason("too-minor-unsure")
  case SidewalkNeededUnsure extends ValidationReason("sidewalk-needed-unsure")
}

object ValidationReason extends PgEnumCompanion[ValidationReason]("validation_reason") {

  /** The two votes a reason can explain; an Agree carries an optional free-text note instead. */
  val reasonedVotes: Set[ValidationOption] = Set(ValidationOption.Disagree, ValidationOption.Unsure)

  /**
   * The reasons each label type offers, per vote, in the order the menus show them. The Validate menu has room for
   * four Disagree reasons and three Unsure ones; every type leads with [[WrongType]] (#5409). Types absent here
   * (Other, Occlusion) offer no reasons, and their menus fall back to the free-text box alone.
   */
  val catalog: Map[LabelType, Map[ValidationOption, Seq[ValidationReason]]] = {
    import LabelType.*
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
  def offered(labelType: LabelType, vote: ValidationOption): Seq[ValidationReason] =
    catalog.getOrElse(labelType, Map.empty).getOrElse(vote, Seq.empty)

  /** @return Whether `labelType` offers `reason` for either reasoned vote. */
  def offersReason(labelType: LabelType, reason: ValidationReason): Boolean =
    catalog.getOrElse(labelType, Map.empty).values.exists(_.contains(reason))

  /**
   * The catalog as `main.scala.html` stamps it onto every page (`window.validationReasons`): each label type's
   * reasons per vote, in menu order: `{"CurbRamp": {"Disagree": ["wrong-type", …], "Unsure": […]}, …}`.
   *
   * This is the only copy the frontend gets: `validationReasons.js` builds every reason list from it, and the
   * Validate menus, the label detail card and the Gallery cards all render from that. Text and tooltips are absent
   * by design: they are translated, and the frontend has them in its locale files under the same ids. Fixed at
   * build time, so it serializes once at class-load.
   */
  val pageStampJson: String = Json.stringify(
    JsObject(
      LabelType.ordered.flatMap { lt =>
        catalog.get(lt).map { byVote =>
          lt.name -> JsObject(Seq(ValidationOption.Disagree, ValidationOption.Unsure).map { vote =>
            vote.name -> Json.toJson(byVote.getOrElse(vote, Seq.empty).map(_.name))
          })
        }
      }
    )
  )
}
