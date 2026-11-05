export class EventEmitter {
  constructor() {
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(payload) {
    this.listeners.forEach((listener) => listener(payload));
  }
}
