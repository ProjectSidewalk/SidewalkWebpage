package controllers

import models.audit._
import play.api.mvc._


/**
 * Street controller
 */
object TaskController extends Controller {

  def get = Action {
    val newTask: NewTask = AuditTaskTable.getNewTask
    Ok("Hi")
  }
}
