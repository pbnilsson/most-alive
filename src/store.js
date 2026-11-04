import { createFirebaseStore } from "./store-firebase.js";
import { createMockStore } from "./store-mock.js";

export function createStore() {
  const mock = new URLSearchParams(location.search).get("mock") === "1";
  return mock ? createMockStore() : createFirebaseStore();
}
