/**
 * Módulo de reflexión encargado de construir el feedback del sistema 
 * cuando falla un comando o el usuario ingresa un motivo de rechazo ('n [motivo]').
 */
class Reflector {
  static createFeedback({ command, error, userReason, isRejected }) {
    if (isRejected) {
      if (userReason) {
        return `[SISTEMA: El usuario denegó el comando '${command}'. Motivo: "${userReason}". Reajusta tu estrategia sin repetir este comando.]`;
      }
      return `[SISTEMA: El usuario denegó la ejecución del comando '${command}'. Bucle autónomo pausado.]`;
    }

    if (error) {
      return `[SISTEMA ERROR CRÍTICO: Falló la ejecución del comando '${command}':\n${error}\nATENCIÓN: Revisa la sintaxis. El ejecutable DEBE ir al inicio.]`;
    }

    return null;
  }
}

module.exports = Reflector;