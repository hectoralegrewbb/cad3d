import { EventEmitter } from './eventEmitter.js';

// Estado inmutable + historial por referencias (los reducers comparten estructura, el snapshot es barato).
// - apply(reducer): un cambio = una entrada de undo.
// - applyTransient(reducer): para gestos continuos (drag). El reducer recibe SIEMPRE el estado base
//   del inicio del gesto; commitTransient() lo convierte en una sola entrada de undo.
export class DocumentStore extends EventEmitter {
  constructor(initialState, { historyLimit = 200 } = {}) {
    super();
    this.currentState = initialState;
    this.undoStack = [];
    this.redoStack = [];
    this.transientBaseline = null;
    this.historyLimit = historyLimit;
  }

  get state() {
    return this.currentState;
  }

  get canUndo() {
    return this.undoStack.length > 0 || this.transientBaseline !== null;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  apply(reducer) {
    this.commitTransient();
    const next = reducer(this.currentState);
    if (next === this.currentState) return;
    this.pushUndo(this.currentState);
    this.currentState = next;
    this.redoStack = [];
    this.emit({ reason: 'apply' });
  }

  applyTransient(reducer) {
    if (this.transientBaseline === null) this.transientBaseline = this.currentState;
    this.currentState = reducer(this.transientBaseline);
    this.emit({ reason: 'transient' });
  }

  commitTransient() {
    if (this.transientBaseline === null) return;
    const baseline = this.transientBaseline;
    this.transientBaseline = null;
    if (this.currentState !== baseline) {
      this.pushUndo(baseline);
      this.redoStack = [];
    }
    this.emit({ reason: 'commit' });
  }

  cancelTransient() {
    if (this.transientBaseline === null) return;
    this.currentState = this.transientBaseline;
    this.transientBaseline = null;
    this.emit({ reason: 'cancel' });
  }

  undo() {
    this.commitTransient();
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(this.currentState);
    this.currentState = this.undoStack.pop();
    this.emit({ reason: 'undo' });
    return true;
  }

  redo() {
    this.commitTransient();
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(this.currentState);
    this.currentState = this.redoStack.pop();
    this.emit({ reason: 'redo' });
    return true;
  }

  replace(state, { resetHistory = true } = {}) {
    this.transientBaseline = null;
    this.currentState = state;
    if (resetHistory) {
      this.undoStack = [];
      this.redoStack = [];
    }
    this.emit({ reason: 'replace' });
  }

  pushUndo(state) {
    this.undoStack.push(state);
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
  }
}
