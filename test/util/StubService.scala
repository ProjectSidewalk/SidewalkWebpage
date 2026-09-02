package util

import java.lang.reflect.{InvocationHandler, Method, Proxy}
import scala.reflect.ClassTag

/**
 * Builds a stand-in for a service trait that answers a named few of its methods and refuses every other call.
 *
 * For specs that pin what a controller *does* rather than what it computes, where running the real collaborator is
 * not an option — the admin job triggers each kick off a whole city's recompute or a call out to Overpass/Google.
 * Reflection because these traits carry ~20 members apiece that the spec has no answer for: anything beyond the
 * methods under test is a gap in the test's premise, and this fails at that call by name rather than returning a
 * plausible null.
 *
 * Only for traits whose members are all abstract, which is what a Scala trait needs to compile to a Java interface.
 */
object StubService {

  /**
   * @param answers Return value per method name. A value is reused across calls, so it must not be a one-shot.
   */
  def answering[T](answers: Map[String, Any])(implicit ct: ClassTag[T]): T = {
    answeringWith[T](answers.map { case (name, answer) => name -> (() => answer) })
  }

  /**
   * As `answering`, but each answer is produced per call, for a spec that varies one between its tests.
   *
   * @param answers Supplier of the return value, per method name.
   */
  def answeringWith[T](answers: Map[String, () => Any])(implicit ct: ClassTag[T]): T = {
    val iface = ct.runtimeClass
    require(iface.isInterface, s"${iface.getName} is not an interface, so it cannot be proxied.")

    // A key naming no method answers nothing, and the method it was meant for throws instead -- a failure that reads
    // as a gap in the interface rather than as the typo it is.
    val declared = iface.getMethods.map(_.getName).toSet
    answers.keys.filterNot(declared).foreach { name =>
      throw new IllegalArgumentException(s"${iface.getSimpleName} declares no method named $name.")
    }

    val handler = new InvocationHandler {
      override def invoke(proxy: AnyRef, method: Method, args: Array[AnyRef]): AnyRef = {
        answers.get(method.getName) match {
          case Some(answer) => answer().asInstanceOf[AnyRef]
          case None         =>
            method.getName match {
              case "toString" => s"stub of ${iface.getSimpleName} answering ${answers.keys.mkString(", ")}"
              case "hashCode" => Int.box(System.identityHashCode(proxy))
              case "equals"   => Boolean.box(proxy eq args(0))
              case other      => throw new NotImplementedError(s"${iface.getSimpleName}.$other is not stubbed.")
            }
        }
      }
    }
    Proxy.newProxyInstance(iface.getClassLoader, Array(iface), handler).asInstanceOf[T]
  }
}
