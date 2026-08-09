import * as api from "./api.js";

export function createSessionController(onChange) {
  let authenticated = false;
  let viewer = null;

  return {
    get authenticated() {
      return authenticated;
    },
    get viewer() {
      return viewer;
    },
    async login(username, password) {
      const result = await api.login(username, password);
      authenticated = true;
      viewer = result.viewer || null;
      onChange();
    },
    async logout({ forceLocal = false } = {}) {
      try {
        await api.logout();
      } catch (error) {
        if (!forceLocal) throw error;
      }
      authenticated = false;
      viewer = null;
      onChange();
    },
    async restore() {
      try {
        const result = await api.loadResource("overview");
        if (!result.viewer?.userId || result.viewer.role !== "admin") {
          throw new Error("Invalid admin session response");
        }
        authenticated = true;
        viewer = result.viewer;
        onChange();
        return true;
      } catch {
        authenticated = false;
        viewer = null;
        onChange();
        return false;
      }
    },
  };
}
