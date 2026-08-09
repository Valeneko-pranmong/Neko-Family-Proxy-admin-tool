export function createStore() {
  const state = {
    active: "overview",
    data: {},
    loading: false,
    refreshing: false,
    error: "",
    overviewRange: "14d",
    toast: "",
    couponFormOpen: false,
  };
  const listeners = new Set();
  return {
    state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    patch(next) {
      Object.assign(state, next);
      listeners.forEach((listener) => listener(state));
    },
  };
}
