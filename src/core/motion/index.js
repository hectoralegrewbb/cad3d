// Control de movimiento (Motion): perfiles, comandos de un eje, sincronismo, levas, interpolación y plan horneado.
export { profileKinds, restMove, normalizeLimits, makeProfile, rampPhases, stopDistance, smoothOffset, quinticBlend } from './profiles.js';
export { camLaws, camKinds, buildCam, camAt, riseDwellCam, syncCam, tableCam } from './cams.js';
export { axisTypes, startModes, homingMethods, commandTypes, commandGroups, defaultCommand, defaultMotion, defaultAxisAction, defaultPathMotion, segmentTypes, validateMotion } from './commands.js';
export { buildPath, buildPieces } from './path.js';
export { registrationErrors, seededRandom } from './sync.js';
export { buildMotionPlan, getMotionPlan, isMotionAction, defaultHorizon } from './plan.js';
